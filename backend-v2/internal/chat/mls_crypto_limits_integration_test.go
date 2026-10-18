//go:build integration

package chat

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
)

const (
	cryptoMax   = "91600000-0000-4000-8000-000000000011"
	cryptoAnna  = "91600000-0000-4000-8000-000000000012"
	cryptoBoris = "91600000-0000-4000-8000-000000000013"
)

func fakeValidCrypto(t *testing.T) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"valid":true,"key_id":"k","next_epoch":1}`))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("CRYPTO_URL", srv.URL)
}

func mlsDo(t *testing.T, h *Handler, userID, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID}))
	rec := httptest.NewRecorder()
	h.MLSRoutes(rec, req)
	return rec
}

func cryptoFixture(t *testing.T, limits *mlsLimits) (*Handler, *sql.DB, string) {
	t.Helper()
	db := dbtest.Postgres(t)
	for id, name := range map[string]string{cryptoMax: "max", cryptoAnna: "anna", cryptoBoris: "boris"} {
		dbtest.User(t, db, id, name)
	}
	svc := NewService(db, &recordingRealtime{}, nil)
	svc.mls = limits
	chatID, _, err := svc.CreatePrivate(context.Background(), cryptoMax, cryptoAnna)
	require.NoError(t, err)
	return NewHandler(svc), db, chatID
}

func TestMLSBusyCryptoAnswers503OnCommitWelcomeAndProposals(t *testing.T) {
	fakeValidCrypto(t)
	limits := newMLSLimitsFromEnv()
	h, db, chatID := cryptoFixture(t, limits)

	for range cap(limits.crypto) {
		limits.crypto <- struct{}{}
	}

	base := "/api/v2/mls/group/" + chatID
	cases := []struct{ name, path, body string }{
		{"commit", base + "/commit", `{"commitBytes":"c","currentEpoch":0,"treeStructure":"t"}`},
		{"welcome", base + "/welcome", `{"recipientId":"` + cryptoAnna + `","welcomeBytes":"w","epoch":1}`},
		{"proposals", base + "/proposals", `{"proposalType":"add","proposalBytes":"p","epoch":0}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := mlsDo(t, h, cryptoMax, http.MethodPost, tc.path, tc.body)
			require.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
			require.Equal(t, "1", rec.Header().Get("Retry-After"))
			require.Contains(t, rec.Body.String(), "crypto_busy")
		})
	}

	for _, table := range []string{"group_mls_state", "group_mls_commits", "group_mls_welcome", "group_mls_proposals"} {
		var n int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM crypto.`+table).Scan(&n))
		require.Zero(t, n, "%s must stay empty", table)
	}
}

func TestMLSNonMemberIsDeniedBeforeCryptoSlotIsTaken(t *testing.T) {
	fakeValidCrypto(t)
	limits := newMLSLimitsFromEnv()
	h, _, chatID := cryptoFixture(t, limits)
	for range cap(limits.crypto) {
		limits.crypto <- struct{}{}
	}

	rec := mlsDo(t, h, cryptoBoris, http.MethodPost, "/api/v2/mls/group/"+chatID+"/commit",
		`{"commitBytes":"c","currentEpoch":0,"treeStructure":"t"}`)

	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "access denied")
}

func TestMLSNormalGroupAdditionFitsDefaultLimits(t *testing.T) {
	fakeValidCrypto(t)
	limits := newMLSLimitsFromEnv()
	h, _, chatID := cryptoFixture(t, limits)

	svc := h.service
	_, _, err := svc.CreatePrivate(context.Background(), cryptoMax, cryptoBoris)
	require.NoError(t, err)

	ok := func(rec *httptest.ResponseRecorder, what string) {
		require.Equal(t, http.StatusOK, rec.Code, "%s: %s", what, rec.Body.String())
	}

	uploadBody := `{"keypackages":["` + strings.Repeat(`a","`, 19) + `a"]}`
	ok(mlsDo(t, h, cryptoAnna, http.MethodPost, "/api/v2/mls/keypackages", uploadBody), "anna upload")
	ok(mlsDo(t, h, cryptoBoris, http.MethodPost, "/api/v2/mls/keypackages", uploadBody), "boris upload")

	ok(mlsDo(t, h, cryptoMax, http.MethodGet, "/api/v2/mls/keypackages/"+cryptoAnna, ""), "fetch anna")
	ok(mlsDo(t, h, cryptoMax, http.MethodGet, "/api/v2/mls/keypackages/"+cryptoBoris, ""), "fetch boris")
	ok(mlsDo(t, h, cryptoMax, http.MethodPost, "/api/v2/mls/group/"+chatID+"/commit",
		`{"commitBytes":"c","currentEpoch":0,"treeStructure":"t"}`), "commit")
	ok(mlsDo(t, h, cryptoMax, http.MethodPost, "/api/v2/mls/group/"+chatID+"/welcome",
		`{"recipientId":"`+cryptoAnna+`","welcomeBytes":"w","epoch":1}`), "welcome")
}

func TestMLSUploadIsAtomicWhenCryptoBecomesBusyMidway(t *testing.T) {
	limits := newMLSLimitsFromEnv()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 3 {
			for range cap(limits.crypto) {
				limits.crypto <- struct{}{}
			}
		}
		_, _ = w.Write([]byte(`{"valid":true,"key_id":"k","next_epoch":1}`))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("CRYPTO_URL", srv.URL)
	h, db, _ := cryptoFixture(t, limits)

	rec := mlsDo(t, h, cryptoAnna, http.MethodPost, "/api/v2/mls/keypackages", `{"keypackages":["a","b","c","d","e"]}`)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())

	var stored int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM crypto.user_mls_keypackages WHERE user_id = $1`, cryptoAnna).Scan(&stored))
	require.Zero(t, stored, "a rejected upload must not leave a partial set of keys")

	for range cap(limits.crypto) {
		<-limits.crypto
	}
	rec = mlsDo(t, h, cryptoAnna, http.MethodPost, "/api/v2/mls/keypackages", `{"keypackages":["a","b","c","d","e"]}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM crypto.user_mls_keypackages WHERE user_id = $1`, cryptoAnna).Scan(&stored))
	require.Equal(t, 5, stored)
}
