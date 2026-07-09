package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
)

type fakeTokenVerifier struct {
	claims cryptoclient.TokenClaims
	err    error
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
		json.Unmarshal(received, &parsed)
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

func TestWSServerRejectsMissingToken(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user1"}})
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

func TestWSServerRejectsInvalidToken(t *testing.T) {
	ws := NewWSServer(nil, fakeTokenVerifier{err: errors.New("invalid")})
	request := httptest.NewRequest(http.MethodGet, "/ws?token=bad", nil)
	response := httptest.NewRecorder()

	ws.ServeWS(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}
