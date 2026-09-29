package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
)

type fakeTokenVerifier struct {
	claims cryptoclient.TokenClaims
	err    error
}

type fakeTokenChecker struct {
	revoked bool
	err     error
}

func (f fakeTokenChecker) IsTokenRevoked(_ context.Context, _ string, _ cryptoclient.TokenClaims) (bool, error) {
	return f.revoked, f.err
}

func (f fakeTokenVerifier) VerifyToken(_ context.Context, _ string) (cryptoclient.TokenClaims, error) {
	return f.claims, f.err
}

func TestWSServer_Signaling(t *testing.T) {
	ws := &WSServer{
		clients: make(map[string]map[*Client]bool),
		// mock db is not needed just for testing sendToUser
	}

	client1 := &Client{UserID: "user1", Send: make(chan []byte, 10)}
	client2 := &Client{UserID: "user2", Send: make(chan []byte, 10)}

	ws.clients["user1"] = map[*Client]bool{client1: true}
	ws.clients["user2"] = map[*Client]bool{client2: true}

	msg := map[string]interface{}{
		"type": "call_invite",
		"to":   "user2",
	}
	bytes, _ := json.Marshal(msg)

	ws.sendToUser("user2", bytes)

	select {
	case received := <-client2.Send:
		var parsed map[string]interface{}
		if err := json.Unmarshal(received, &parsed); err != nil {
			t.Fatalf("decode received message: %v", err)
		}
		if parsed["type"] != "call_invite" {
			t.Errorf("Expected call_invite, got %v", parsed["type"])
		}
	default:
		t.Error("Expected user2 to receive message, got nothing")
	}

	select {
	case <-client1.Send:
		t.Error("user1 should not receive the message")
	default:
		// success
	}
}

// TestWSServer_UnregisterStopsHeartbeatWithoutClosingSend фиксирует регрессию
// #304: heartbeat и другие производители могут ещё завершать работу после
// отключения клиента, поэтому канал Send нельзя закрывать со стороны цикла
// регистрации.
func TestWSServer_UnregisterStopsHeartbeatWithoutClosingSend(t *testing.T) {
	ws := NewWSServer(nil, nil, nil)
	t.Cleanup(ws.Close)

	client := &Client{
		UserID:        "user1",
		Send:          make(chan []byte, 1),
		done:          make(chan struct{}),
		heartbeatDone: make(chan struct{}),
	}

	ws.register <- client
	go ws.heartbeat(client)
	ws.unreg <- client

	// Небуферизованная register служит барьером: к моменту возврата отправки
	// предыдущая ветка unreg уже полностью выполнена.
	ws.register <- &Client{UserID: "barrier"}

	<-client.done
	select {
	case <-client.heartbeatDone:
	case <-time.After(time.Second):
		t.Fatal("heartbeat не завершился после unregister")
	}

	select {
	case _, ok := <-client.Send:
		if !ok {
			t.Fatal("unregister не должен закрывать Send")
		}
		t.Fatal("неожиданное сообщение в Send")
	default:
	}
}

func TestWSServerRejectsMissingToken(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}}, nil)
	t.Cleanup(ws.Close)
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

func TestWSServerRejectsInvalidToken(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{err: errors.New("invalid")}, nil)
	t.Cleanup(ws.Close)
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	request.Header.Set("Authorization", "Bearer bad")
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

func TestWSServerReportsIncompatibleCryptoAsUnavailable(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{err: cryptoclient.ErrTokenGenerationProtocol}, nil)
	t.Cleanup(ws.Close)
	ws.tokenChecker = fakeTokenChecker{}
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	request.Header.Set("Authorization", "Bearer legacy")
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
}

func TestWSServerRejectsHandshakeWhenRevocationCheckFails(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}}, nil)
	t.Cleanup(ws.Close)
	ws.tokenChecker = fakeTokenChecker{err: errors.New("database unavailable")}
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
}

func TestWSServerRejectsRevokedToken(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}}, nil)
	t.Cleanup(ws.Close)
	ws.tokenChecker = fakeTokenChecker{revoked: true}
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	request.Header.Set("Authorization", "Bearer revoked")
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

// Сокет с cookie сессии (#705): браузер подставляет её сам, поэтому
// подключиться с ней можно только со своего или точно разрешённого адреса.
func TestWSServerCookieSessionRequiresOwnOrigin(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}}, nil)
	t.Cleanup(ws.Close)
	// «Отозван» — чтобы проверка дошла до конца без настоящего апгрейда.
	ws.tokenChecker = fakeTokenChecker{revoked: true}

	handshake := func(origin string) int {
		request := httptest.NewRequest(http.MethodGet, "https://craneapp.example/ws", nil)
		request.Header.Set("Origin", origin)
		request.AddCookie(&http.Cookie{Name: "__Host-craneapp_session", Value: "cookie-token"})
		response := httptest.NewRecorder()
		ws.ServeWS(response, request)
		return response.Code
	}

	if code := handshake("https://evil.example"); code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d, want 403", code)
	}
	// Свой адрес: токен из cookie принят и дошёл до проверки отзыва.
	if code := handshake("https://craneapp.example"); code != http.StatusUnauthorized {
		t.Fatalf("own origin: %d, want the revocation check (401)", code)
	}
}

// Токен в адресе сокета больше не принимается (#705): адреса попадают в
// журналы. Только cookie сессии или заголовок.
func TestWSServerRejectsTokenInURL(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}}, nil)
	t.Cleanup(ws.Close)
	ws.tokenChecker = fakeTokenChecker{}
	request := httptest.NewRequest(http.MethodGet, "/ws?token=valid", nil)
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("token in URL: %d, want 401", response.Code)
	}
}
