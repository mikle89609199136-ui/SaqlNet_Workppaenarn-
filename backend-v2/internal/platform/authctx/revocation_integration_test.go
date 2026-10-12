//go:build integration

package authctx_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

type integrationCryptoServer struct {
	mu            sync.Mutex
	nextToken     int
	claimsByToken map[string]cryptoclient.TokenClaims
}

func startIntegrationCryptoServer(t *testing.T) *httptest.Server {
	t.Helper()
	state := &integrationCryptoServer{claimsByToken: make(map[string]cryptoclient.TokenClaims)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/v1/password/verify":
			_ = json.NewEncoder(w).Encode(map[string]bool{"valid": true})
		case "/internal/v1/token/issue":
			var request struct {
				Subject         string `json:"subject"`
				Username        string `json:"username"`
				TokenGeneration int64  `json:"token_generation"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid issue request", http.StatusBadRequest)
				return
			}
			state.mu.Lock()
			state.nextToken++
			token := fmt.Sprintf("issued-token-%d-generation-%d", state.nextToken, request.TokenGeneration)
			state.claimsByToken[token] = cryptoclient.TokenClaims{
				Subject:         request.Subject,
				Username:        request.Username,
				IssuedAt:        time.Now().Unix(),
				Expires:         time.Now().Add(time.Hour).Unix(),
				TokenGeneration: request.TokenGeneration,
			}
			state.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"token":            token,
				"expires_at":       time.Now().Add(time.Hour).Unix(),
				"token_generation": request.TokenGeneration,
			})
		case "/internal/v1/token/verify":
			var request struct {
				Token string `json:"token"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid verify request", http.StatusBadRequest)
				return
			}
			state.mu.Lock()
			claims, ok := state.claimsByToken[request.Token]
			state.mu.Unlock()
			if !ok {
				http.Error(w, "unknown token", http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(claims)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func loginIntegrationToken(t *testing.T, service *auth.Service) string {
	t.Helper()
	_, token, err := service.Login(t.Context(), "generation-test", "password", "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	return token
}

func TestLogoutAndLogoutAllRevocationLifecycle(t *testing.T) {
	db := startRevocationPostgres(t)
	migrationFiles := revocationMigrationFiles(t)
	tokenGenerationMigration := migrationIndex(t, migrationFiles, "0025_auth_token_generation.sql")
	applyRevocationMigrations(t, db, migrationFiles[:tokenGenerationMigration])

	const userID = "11111111-1111-4111-8111-111111111111"
	if _, err := db.Exec(`
		INSERT INTO auth.users (id, username, password_hash, first_name)
		VALUES ($1, 'generation-test', 'hash', 'Generation')
	`, userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	applyRevocationMigrations(t, db, migrationFiles[tokenGenerationMigration:tokenGenerationMigration+1])
	t.Run("migration backfills existing users with a non-null generation", func(t *testing.T) {
		assertTokenGenerationBackfill(t, db, userID)
	})
	applyRevocationMigrations(t, db, migrationFiles[tokenGenerationMigration+1:])
	if err := auth.CheckSessionSchema(t.Context(), db); err != nil {
		t.Fatalf("auth session schema after migrations: %v", err)
	}

	cryptoServer := startIntegrationCryptoServer(t)
	crypto := cryptoclient.NewClient(cryptoServer.URL)
	service := auth.NewService(db, crypto)
	checker := authctx.NewDBTokenChecker(db)
	oldToken1 := loginIntegrationToken(t, service)
	oldToken2 := loginIntegrationToken(t, service)
	assertSessionCount(t, service, userID, oldToken1, 2)
	oldClaims, err := crypto.VerifyToken(t.Context(), oldToken1)
	if err != nil {
		t.Fatalf("verify old token: %v", err)
	}
	if oldClaims.TokenGeneration != 0 {
		t.Fatalf("expected login generation 0, got %d", oldClaims.TokenGeneration)
	}
	httpHandler := authenticatedIntegrationHandler(crypto, checker)
	wsServer := chat.NewWSServer(db, crypto, nil)
	t.Cleanup(wsServer.Close)
	wsHTTPServer := httptest.NewServer(http.HandlerFunc(wsServer.ServeWS))
	t.Cleanup(wsHTTPServer.Close)

	assertRevocation(t, checker, oldToken1, oldClaims, false)
	assertRevocation(t, checker, oldToken2, oldClaims, false)
	assertAuthenticatedHTTPStatus(t, httpHandler, oldToken1, http.StatusNoContent)
	assertWebSocketHandshakeStatus(t, wsHTTPServer.URL, oldToken2, http.StatusSwitchingProtocols)

	logoutAllHandler := authctx.Middleware(crypto, checker)(http.HandlerFunc(
		auth.NewHandler(service, auth.WithLogoutAllGenerationEnabled(true)).LogoutAll,
	))
	assertAuthenticatedHTTPRequestStatus(t, logoutAllHandler, http.MethodPost, oldToken1, http.StatusOK)
	assertRevocation(t, checker, oldToken1, oldClaims, true)
	assertRevocation(t, checker, oldToken2, oldClaims, true)
	assertAuthenticatedHTTPStatus(t, httpHandler, oldToken1, http.StatusUnauthorized)
	assertWebSocketHandshakeStatus(t, wsHTTPServer.URL, oldToken2, http.StatusUnauthorized)
	assertSessionCount(t, service, userID, oldToken1, 0)

	newToken1 := loginIntegrationToken(t, service)
	newToken2 := loginIntegrationToken(t, service)
	newClaims1, err := crypto.VerifyToken(t.Context(), newToken1)
	if err != nil {
		t.Fatalf("verify first new token: %v", err)
	}
	newClaims2, err := crypto.VerifyToken(t.Context(), newToken2)
	if err != nil {
		t.Fatalf("verify second new token: %v", err)
	}
	if newClaims1.TokenGeneration != 1 || newClaims2.TokenGeneration != 1 {
		t.Fatalf("expected post-logout login generation 1, got %d and %d", newClaims1.TokenGeneration, newClaims2.TokenGeneration)
	}
	assertRevocation(t, checker, newToken1, newClaims1, false)
	assertRevocation(t, checker, newToken2, newClaims2, false)
	assertSessionCount(t, service, userID, newToken1, 2)
	assertAuthenticatedHTTPStatus(t, httpHandler, newToken1, http.StatusNoContent)
	assertAuthenticatedHTTPStatus(t, httpHandler, newToken2, http.StatusNoContent)

	assertSingleLogoutOnlyChangesLinkedDeviceSession(t, db, service, userID, newToken1, time.Unix(newClaims1.Expires, 0).UTC())
	assertRevocation(t, checker, newToken1, newClaims1, true)
	assertRevocation(t, checker, newToken2, newClaims2, false)
	assertSessionCount(t, service, userID, newToken2, 1)
	assertAuthenticatedHTTPStatus(t, httpHandler, newToken1, http.StatusUnauthorized)
	assertAuthenticatedHTTPStatus(t, httpHandler, newToken2, http.StatusNoContent)
	assertWebSocketHandshakeStatus(t, wsHTTPServer.URL, newToken1, http.StatusUnauthorized)
	assertWebSocketHandshakeStatus(t, wsHTTPServer.URL, newToken2, http.StatusSwitchingProtocols)
}

type deviceSessionState struct {
	ID         string
	LastActive string
	IsCurrent  bool
}

func assertSingleLogoutOnlyChangesLinkedDeviceSession(t *testing.T, db *sql.DB, service *auth.Service, userID, token string, expiresAt time.Time) {
	t.Helper()
	const currentDeviceID = "22222222-2222-4222-8222-222222222222"
	const otherDeviceID = "33333333-3333-4333-8333-333333333333"
	if _, err := db.Exec(`
		INSERT INTO public.user_sessions (id, user_id, device_name, last_active, is_current)
		VALUES
			($2, $1, 'current-device', NOW() - INTERVAL '1 minute', TRUE),
			($3, $1, 'other-device', NOW() - INTERVAL '2 minutes', FALSE)
	`, userID, currentDeviceID, otherDeviceID); err != nil {
		t.Fatalf("seed device sessions: %v", err)
	}
	result, err := db.Exec(`
		UPDATE auth.sessions SET device_session_id = $3
		WHERE user_id = $1 AND access_token_hash = $2
	`, userID, authctx.TokenHash(token), currentDeviceID)
	if err != nil {
		t.Fatalf("link current credential to device session: %v", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("linked auth sessions = %d, want 1 (err=%v)", affected, err)
	}

	before := readDeviceSessionStates(t, db, userID)
	if err := service.Logout(t.Context(), userID, token, expiresAt); err != nil {
		t.Fatalf("logout current token: %v", err)
	}
	after := readDeviceSessionStates(t, db, userID)
	if len(before) != 2 || len(after) != 2 {
		t.Fatalf("unexpected device sessions: before=%+v after=%+v", before, after)
	}
	if after[0].ID != currentDeviceID || after[0].IsCurrent || after[0].LastActive == before[0].LastActive {
		t.Fatalf("linked device session was not terminated: before=%+v after=%+v", before[0], after[0])
	}
	if after[1].ID != otherDeviceID || !reflect.DeepEqual(after[1], before[1]) {
		t.Fatalf("unrelated device session changed: before=%+v after=%+v", before[1], after[1])
	}
}

func readDeviceSessionStates(t *testing.T, db *sql.DB, userID string) []deviceSessionState {
	t.Helper()
	rows, err := db.Query(`
		SELECT id::text, last_active::text, is_current
		FROM public.user_sessions
		WHERE user_id = $1
		ORDER BY id
	`, userID)
	if err != nil {
		t.Fatalf("read device sessions: %v", err)
	}
	defer rows.Close()

	var states []deviceSessionState
	for rows.Next() {
		var state deviceSessionState
		if err := rows.Scan(&state.ID, &state.LastActive, &state.IsCurrent); err != nil {
			t.Fatalf("scan device session: %v", err)
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate device sessions: %v", err)
	}
	return states
}

func assertSessionCount(t *testing.T, service *auth.Service, userID, currentToken string, want int) {
	t.Helper()
	sessions, err := service.Sessions(t.Context(), userID, currentToken)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != want {
		t.Fatalf("session count = %d, want %d: %+v", len(sessions), want, sessions)
	}
}

func authenticatedIntegrationHandler(verifier authctx.TokenVerifier, checker *authctx.DBTokenChecker) http.Handler {
	return authctx.Middleware(verifier, checker)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if current := authctx.MustUser(r); current.ID == "" {
			http.Error(w, "authenticated user is missing", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

func assertAuthenticatedHTTPStatus(t *testing.T, handler http.Handler, token string, want int) {
	t.Helper()
	assertAuthenticatedHTTPRequestStatus(t, handler, http.MethodGet, token, want)
}

func assertAuthenticatedHTTPRequestStatus(t *testing.T, handler http.Handler, method, token string, want int) {
	t.Helper()
	request := httptest.NewRequest(method, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: token})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != want {
		t.Fatalf("HTTP token %q: expected status %d, got %d: %s", token, want, response.Code, response.Body.String())
	}
}

func assertWebSocketHandshakeStatus(t *testing.T, serverURL, token string, want int) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/ws"
	header := http.Header{"Cookie": {"craneapp_session=" + token}, "Origin": {serverURL}}
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, header)
	if response != nil && response.Body != nil {
		defer response.Body.Close()
	}
	if connection != nil {
		defer connection.Close()
	}

	if want == http.StatusSwitchingProtocols {
		if err != nil {
			t.Fatalf("WebSocket token %q: expected successful handshake, got %v", token, err)
		}
		if response == nil || response.StatusCode != want {
			t.Fatalf("WebSocket token %q: expected status %d, got %#v", token, want, response)
		}
		return
	}

	if err == nil {
		t.Fatalf("WebSocket token %q: expected rejected handshake with status %d", token, want)
	}
	if response == nil {
		t.Fatalf("WebSocket token %q: expected HTTP response with status %d, got error %v", token, want, err)
	}
	if response.StatusCode != want {
		t.Fatalf("WebSocket token %q: expected status %d, got %d", token, want, response.StatusCode)
	}
}

func assertRevocation(t *testing.T, checker *authctx.DBTokenChecker, token string, claims cryptoclient.TokenClaims, want bool) {
	t.Helper()
	revoked, err := checker.IsTokenRevoked(t.Context(), token, claims)
	if err != nil {
		t.Fatalf("check token %q: %v", token, err)
	}
	if revoked != want {
		t.Fatalf("token %q: expected revoked=%t, got %t", token, want, revoked)
	}
}

func startRevocationPostgres(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:16",
			ExposedPorts: []string{"5432/tcp"},
			Env:          map[string]string{"POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
			WaitingFor: wait.ForAll(
				wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
				wait.ForListeningPort("5432/tcp"),
			).WithDeadline(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("postgres host: %v", err)
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		t.Fatalf("postgres port: %v", err)
	}
	dsn := fmt.Sprintf("postgres://postgres:test@%s:%s/test?sslmode=disable", host, port.Port())
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func revocationMigrationFiles(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob("../../../migrations/*.sql")
	if err != nil {
		t.Fatalf("find migrations: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no migrations found")
	}
	sort.Strings(files)
	return files
}

func migrationIndex(t *testing.T, files []string, name string) int {
	t.Helper()
	for index, path := range files {
		if filepath.Base(path) == name {
			return index
		}
	}
	t.Fatalf("migration %s not found", name)
	return -1
}

func applyRevocationMigrations(t *testing.T, db *sql.DB, files []string) {
	t.Helper()
	for _, path := range files {
		migration, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read migration %s: %v", path, err)
		}
		if _, err := db.Exec(string(migration)); err != nil {
			t.Fatalf("apply migration %s: %v", path, err)
		}
	}
}

func assertTokenGenerationBackfill(t *testing.T, db *sql.DB, userID string) {
	t.Helper()
	var generation int64
	var isNullable string
	var columnDefault sql.NullString
	if err := db.QueryRow(`
		SELECT u.token_generation, c.is_nullable, c.column_default
		FROM auth.users u
		JOIN information_schema.columns c
		  ON c.table_schema = 'auth'
		 AND c.table_name = 'users'
		 AND c.column_name = 'token_generation'
		WHERE u.id = $1
	`, userID).Scan(&generation, &isNullable, &columnDefault); err != nil {
		t.Fatalf("read migrated token generation: %v", err)
	}
	if generation != 0 {
		t.Fatalf("expected existing user token generation 0, got %d", generation)
	}
	if isNullable != "NO" {
		t.Fatalf("expected token_generation to be NOT NULL, got is_nullable=%q", isNullable)
	}
	if !columnDefault.Valid || !strings.Contains(columnDefault.String, "0") {
		t.Fatalf("expected token_generation to have a zero default, got %q", columnDefault.String)
	}
}
