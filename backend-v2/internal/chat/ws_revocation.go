package chat

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
)

// RevocationRelay closes matching connections on every chat replica. Database
// checks in readPump and heartbeat also cover missed notifications/reconnects.
func RevocationRelay(ctx context.Context, databaseURL string, ws *WSServer) {
	relayNotifications(ctx, databaseURL, authctx.RevocationChannel, ws.applyRevocation)
}

func (ws *WSServer) applyRevocation(payload string) error {
	var event authctx.RevocationEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return err
	}
	if event.UserID == "" || (event.TokenHash == "") == (event.Generation == nil) {
		return errors.New("invalid revocation event")
	}
	ws.mu.RLock()
	var clients []*Client
	for client := range ws.clients[event.UserID] {
		if (event.TokenHash != "" && authctx.TokenHash(client.token) == event.TokenHash) ||
			(event.Generation != nil && client.claims.TokenGeneration < *event.Generation) {
			clients = append(clients, client)
		}
	}
	ws.mu.RUnlock()
	for _, client := range clients {
		client.revoke()
	}
	return nil
}

func (c *Client) revoke() {
	c.close()
	// Close is safe concurrently with reads/writes and interrupts blocked I/O.
	_ = c.Conn.Close()
}

func (ws *WSServer) authorizeClient(client *Client) bool {
	select {
	case <-client.done:
		return false
	default:
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if ws.tokenChecker == nil || (client.claims.Expires > 0 && time.Now().Unix() >= client.claims.Expires) {
		client.revoke()
		return false
	}
	revoked, err := ws.tokenChecker.IsTokenRevoked(ctx, client.token, client.claims)
	if err != nil || revoked {
		client.revoke()
		return false
	}
	// A notification may have arrived while the database check was in flight.
	select {
	case <-client.done:
		return false
	default:
		return true
	}
}
