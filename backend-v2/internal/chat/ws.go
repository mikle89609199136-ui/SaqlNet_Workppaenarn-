package chat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/presence"

	"github.com/gorilla/websocket"
)

const (
	wsPingInterval  = 30 * time.Second
	wsReadDeadline  = 90 * time.Second
	wsWriteDeadline = 10 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return allowedWSOrigin(origin)
	},
}

type tokenVerifier interface {
	VerifyToken(context.Context, string) (cryptoclient.TokenClaims, error)
}

type Client struct {
	UserID        string
	Conn          *websocket.Conn
	Send          chan []byte
	done          chan struct{}
	heartbeatDone chan struct{}
	closeOnce     sync.Once
	CallRoomID    string // non-empty while in a call room
	ConnectionID  string // уникальный ID WS-соединения для presence
}

// close безопасно закрывает канал done ровно один раз, сигнализируя фоновым
// горутинам (включая heartbeat) о завершении жизненного цикла клиента.
func (c *Client) close() {
	c.closeOnce.Do(func() {
		close(c.done)
	})
}

type WSServer struct {
	db             *sql.DB
	crypto         tokenVerifier
	clients        map[string]map[*Client]bool
	mu             sync.RWMutex
	register       chan *Client
	unreg          chan *Client
	callRooms      *CallRoomManager
	pendingInvites map[string]json.RawMessage
	inviteMu       sync.Mutex
	presence       presence.Store
	pingInterval   time.Duration // интервал heartbeat; 0 → wsPingInterval
}

// NewWSServer создаёт и запускает новый экземпляр WSServer.
// store — источник online-состояния; nil допустим (presence отключён).
func NewWSServer(db *sql.DB, crypto tokenVerifier, store presence.Store) *WSServer {
	ws := &WSServer{
		db:             db,
		crypto:         crypto,
		clients:        make(map[string]map[*Client]bool),
		register:       make(chan *Client),
		unreg:          make(chan *Client),
		callRooms:      NewCallRoomManager(),
		pendingInvites: make(map[string]json.RawMessage),
		presence:       store,
		pingInterval:   wsPingInterval,
	}
	go ws.run()
	return ws
}

func (ws *WSServer) CallRooms() *CallRoomManager {
	return ws.callRooms
}

func (ws *WSServer) IsUserConnected(userID string) bool {
	if ws == nil || userID == "" {
		return false
	}
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	return len(ws.clients[userID]) > 0
}

func (ws *WSServer) run() {
	for {
		select {
		case client := <-ws.register:
			ws.mu.Lock()
			if ws.clients[client.UserID] == nil {
				ws.clients[client.UserID] = make(map[*Client]bool)
			}
			ws.clients[client.UserID][client] = true
			ws.mu.Unlock()

		case client := <-ws.unreg:
			ws.mu.Lock()
			if conns, ok := ws.clients[client.UserID]; ok {
				if _, ok := conns[client]; ok {
					delete(conns, client)
					client.close()
					close(client.Send)
					if len(conns) == 0 {
						delete(ws.clients, client.UserID)
					}
				}
			}
			ws.mu.Unlock()
		}
	}
}

// ServeWS выполняет HTTP-upgrade до WebSocket, аутентифицирует пользователя
// по токену, регистрирует соединение в presence.Store и запускает горутины
// чтения, записи и heartbeat.
func (ws *WSServer) ServeWS(w http.ResponseWriter, r *http.Request) {
	if ws.crypto == nil {
		http.Error(w, "token verifier unavailable", http.StatusServiceUnavailable)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		header := r.Header.Get("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			token = strings.TrimPrefix(header, "Bearer ")
		}
	}
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	claims, err := ws.crypto.VerifyToken(r.Context(), token)
	if err != nil || claims.Subject == "" {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if authctx.NewDBTokenChecker(ws.db).IsTokenRevoked(r.Context(), token) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade error", "err", err)
		return
	}

	if err := conn.SetReadDeadline(time.Now().Add(wsReadDeadline)); err != nil {
		_ = conn.Close()
		return
	}

	connID := newConnectionID()
	client := &Client{UserID: claims.Subject, Conn: conn, Send: make(chan []byte, 256), done: make(chan struct{}), heartbeatDone: make(chan struct{}), ConnectionID: connID}
	if ws.presence != nil {
		if err := ws.presence.Connect(r.Context(), client.UserID, client.ConnectionID); err != nil {
			slog.Error("presence connect error", "userID", client.UserID, "err", err)
		}
	}
	ws.register <- client

	// Deliver pending call invite if any
	ws.inviteMu.Lock()
	if invite, ok := ws.pendingInvites[client.UserID]; ok {
		// Check if the room is still alive
		var roomID string
		var tmp map[string]interface{}
		if json.Unmarshal(invite, &tmp) == nil {
			roomID, _ = tmp["roomId"].(string)
		}
		if roomID != "" && ws.callRooms.GetRoom(roomID) != nil {
			client.Send <- invite
		} else {
			delete(ws.pendingInvites, client.UserID)
		}
	}
	ws.inviteMu.Unlock()

	go ws.writePump(client)
	go ws.readPump(client)
	// #nosec - горутина долгоживущая, r.Context() отменяется после завершения HTTP-upgrade
	go ws.heartbeat(client)
}

// newConnectionID генерирует случайный UUID v4 для идентификации
// конкретного WebSocket-соединения в presence.Store.
func newConnectionID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant RFC4122
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// readPump читает входящие WS-сообщения клиента.
// При завершении (ошибка чтения или закрытие соединения) удаляет lease
// из presence.Store и отправляет клиента на отмену регистрации.
func (ws *WSServer) readPump(client *Client) {
	defer func() {
		client.close()
		ws.handleCallDisconnect(client)
		if client.heartbeatDone != nil {
			<-client.heartbeatDone
		}
		if ws.presence != nil && client.ConnectionID != "" {
			// Горутина долгоживущая — r.Context() к этому моменту отменён.
			if err := ws.presence.Disconnect(context.Background(), client.UserID, client.ConnectionID); err != nil {
				slog.Error("presence disconnect error", "userID", client.UserID, "err", err)
			}
		}
		ws.unreg <- client
		_ = client.Conn.Close()
	}()
	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			break
		}
		if err := client.Conn.SetReadDeadline(time.Now().Add(wsReadDeadline)); err != nil {
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		msgType, _ := msg["type"].(string)
		switch msgType {
		case "ping", "pong":
			client.Send <- []byte(`{"type":"pong"}`)

		case "typing":
			chatID, _ := msg["chatId"].(string)
			if chatID != "" {
				var isMember bool
				if err := ws.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`, chatID, client.UserID).Scan(&isMember); err != nil {
					break
				}
				if isMember {
					msg["userId"] = client.UserID
					msg["senderId"] = client.UserID
					typingMessage, _ := json.Marshal(msg)
					ws.BroadcastToChat(chatID, typingMessage, client.UserID)
				}
			}

		case "call_join":
			ws.handleCallJoin(client, msg)

		case "call_leave":
			ws.handleCallLeave(client, msg)

		case "call_offer", "call_answer", "call_ice":
			to, _ := msg["to"].(string)
			if to == "" {
				break
			}
			roomID, _ := msg["roomId"].(string)
			if roomID == "" {
				roomID = client.CallRoomID
			}
			out, _ := json.Marshal(map[string]interface{}{
				"type":    msgType,
				"roomId":  roomID,
				"from":    client.UserID,
				"payload": msg["payload"],
			})
			ws.sendToUser(to, out)

		case "call_invite":
			ws.handleCallInvite(client, msg)

		case "call_invite_response":
			ws.handleCallInviteResponse(client, msg)

		// Legacy WebRTC message types — forward as-is with from injected
		case "webrtc_offer", "webrtc_answer", "webrtc_candidate", "crane_hangup":
			to, _ := msg["to"].(string)
			if to != "" {
				msg["from"] = client.UserID
				out, _ := json.Marshal(msg)
				ws.sendToUser(to, out)
			} else {
				chatID, _ := msg["chatId"].(string)
				if chatID != "" {
					ws.BroadcastToChat(chatID, message, client.UserID)
				}
			}
		}
	}
}

func (ws *WSServer) handleCallJoin(client *Client, msg map[string]interface{}) {
	roomID, _ := msg["roomId"].(string)
	if roomID == "" {
		return
	}
	// Ensure room exists — create if caller is first to join
	if ws.callRooms.GetRoom(roomID) == nil {
		callKind, _ := msg["callKind"].(string)
		chatID, _ := msg["chatId"].(string)
		title, _ := msg["title"].(string)
		ws.callRooms.CreateRoom(client.UserID, roomID, "group", callKind, chatID, title)
	}
	displayName, _ := msg["displayName"].(string)
	avatarURL, _ := msg["avatarUrl"].(string)
	r := ws.callRooms.JoinRoom(roomID, client.UserID, displayName, avatarURL)
	if !r.OK {
		out, _ := json.Marshal(map[string]interface{}{"type": "call_error", "reason": r.Error})
		client.Send <- out
		return
	}
	client.CallRoomID = roomID
	// Send joined confirmation with current peers
	joined, _ := json.Marshal(map[string]interface{}{
		"type":   "call_joined",
		"roomId": roomID,
		"peers":  r.Peers,
		"self":   map[string]string{"userId": client.UserID},
	})
	client.Send <- joined
	// Notify existing peers
	peerJoined, _ := json.Marshal(map[string]interface{}{
		"type":   "call_peer_joined",
		"roomId": roomID,
		"peer": map[string]interface{}{
			"userId":      client.UserID,
			"displayName": displayName,
			"avatarUrl":   avatarURL,
		},
	})
	ws.sendToCallRoom(roomID, peerJoined, client.UserID)
}

func (ws *WSServer) handleCallLeave(client *Client, msg map[string]interface{}) {
	roomID, _ := msg["roomId"].(string)
	if roomID == "" {
		roomID = client.CallRoomID
	}
	if roomID == "" {
		return
	}
	ws.doLeaveRoom(client, roomID)
}

func (ws *WSServer) doLeaveRoom(client *Client, roomID string) {
	lr := ws.callRooms.LeaveRoom(roomID, client.UserID)
	peerLeft, _ := json.Marshal(map[string]interface{}{
		"type":   "call_peer_left",
		"roomId": roomID,
		"peer":   map[string]string{"userId": client.UserID},
	})
	ws.sendToCallRoom(roomID, peerLeft, client.UserID)
	if lr.Closed && lr.Snapshot != nil {
		go ws.saveCallMessage(lr.Snapshot)
		ws.inviteMu.Lock()
		for uid, inv := range ws.pendingInvites {
			var tmp map[string]interface{}
			if json.Unmarshal(inv, &tmp) == nil {
				if rid, _ := tmp["roomId"].(string); rid == roomID {
					cancelled, _ := json.Marshal(map[string]interface{}{"type": "call_cancelled", "roomId": roomID})
					ws.sendToUser(uid, cancelled)
					delete(ws.pendingInvites, uid)
				}
			}
		}
		ws.inviteMu.Unlock()
	}
	client.CallRoomID = ""
}

func (ws *WSServer) handleCallInvite(client *Client, msg map[string]interface{}) {
	to, _ := msg["to"].(string)
	roomID, _ := msg["roomId"].(string)
	if to == "" || roomID == "" {
		return
	}
	if ws.callRooms.GetUserRoom(to) != nil {
		busy, _ := json.Marshal(map[string]interface{}{
			"type":     "call_invite_response",
			"roomId":   roomID,
			"from":     to,
			"accepted": false,
			"reason":   "busy",
		})
		ws.sendToUser(client.UserID, busy)
		return
	}
	invite, _ := json.Marshal(map[string]interface{}{
		"type":       "call_incoming",
		"roomId":     roomID,
		"kind":       strOrDefault(msg["kind"], "video"),
		"callType":   strOrDefault(msg["callType"], "p2p"),
		"from":       client.UserID,
		"fromName":   msg["fromName"],
		"fromAvatar": msg["fromAvatar"],
		"title":      msg["title"],
	})
	ws.sendToUser(to, invite)
	// Store for offline delivery
	ws.inviteMu.Lock()
	ws.pendingInvites[to] = invite
	ws.inviteMu.Unlock()
}

func (ws *WSServer) handleCallInviteResponse(client *Client, msg map[string]interface{}) {
	to, _ := msg["to"].(string)
	if to == "" {
		return
	}
	roomID, _ := msg["roomId"].(string)
	accepted, _ := msg["accepted"].(bool)
	reason, _ := msg["reason"].(string)
	out, _ := json.Marshal(map[string]interface{}{
		"type":     "call_invite_response",
		"roomId":   roomID,
		"from":     client.UserID,
		"accepted": accepted,
		"reason":   reason,
	})
	ws.sendToUser(to, out)
	ws.inviteMu.Lock()
	delete(ws.pendingInvites, client.UserID)
	ws.inviteMu.Unlock()
}

func (ws *WSServer) handleCallDisconnect(client *Client) {
	if client.CallRoomID == "" {
		return
	}
	ws.doLeaveRoom(client, client.CallRoomID)
}

func (ws *WSServer) saveCallMessage(snap *RoomSnapshot) {
	if snap.ChatID == "" {
		return
	}
	status := "missed"
	var duration int64
	if snap.AnsweredAt > 0 {
		status = "answered"
		duration = (time.Now().UnixMilli() - snap.AnsweredAt) / 1000
	}
	content, _ := json.Marshal(map[string]interface{}{
		"callKind":    snap.CallKind,
		"status":      status,
		"duration":    duration,
		"initiatorId": snap.HostID,
	})
	var msgID string
	err := ws.db.QueryRow(
		`INSERT INTO messages.messages (chat_id, sender_id, content, type) VALUES ($1, $2, $3, 'call') RETURNING id`,
		snap.ChatID, snap.HostID, string(content),
	).Scan(&msgID)
	if err != nil {
		slog.Error("saveCallMessage", "err", err)
		return
	}
	out, _ := json.Marshal(map[string]interface{}{
		"type":   "new_message",
		"chatId": snap.ChatID,
		"message": map[string]interface{}{
			"id":       msgID,
			"type":     "call",
			"content":  string(content),
			"senderId": snap.HostID,
		},
	})
	ws.BroadcastToChat(snap.ChatID, out, "")
}

// heartbeat периодически отправляет ping-сообщение клиенту и продлевает
// TTL его lease в presence.Store. Останавливается при закрытии client.done.
func (ws *WSServer) heartbeat(client *Client) {
	if client.heartbeatDone != nil {
		defer close(client.heartbeatDone)
	}
	interval := wsPingInterval
	if ws.pingInterval > 0 {
		interval = ws.pingInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	ping, _ := json.Marshal(map[string]string{"type": "ping"})
	for {
		select {
		case <-client.done:
			return
		case <-ticker.C:
			select {
			case <-client.done:
				return
			default:
			}
			if ws.presence != nil && client.ConnectionID != "" {
				hbCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				err := ws.presence.Heartbeat(hbCtx, client.UserID, client.ConnectionID)
				cancel()
				if err != nil {
					slog.Error("presence heartbeat error", "userID", client.UserID, "err", err)
				}
			}
			select {
			case client.Send <- ping:
			case <-client.done:
				return
			default:
				return
			}
		}
	}
}

func (ws *WSServer) writePump(client *Client) {
	defer client.Conn.Close()
	for {
		message, ok := <-client.Send
		if !ok {
			if err := client.Conn.SetWriteDeadline(time.Now().Add(wsWriteDeadline)); err != nil {
				return
			}
			_ = client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
		if err := client.Conn.SetWriteDeadline(time.Now().Add(wsWriteDeadline)); err != nil {
			return
		}
		if err := client.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

func (ws *WSServer) BroadcastToChat(chatID string, message []byte, excludeUserID string) {
	if excludeUserID != "" {
		var isMember bool
		if err := ws.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`, chatID, excludeUserID).Scan(&isMember); err != nil || !isMember {
			return
		}
	}

	rows, err := ws.db.Query(`SELECT user_id FROM chats.members WHERE chat_id = $1`, chatID)
	if err != nil {
		return
	}
	defer rows.Close()

	ws.mu.RLock()
	defer ws.mu.RUnlock()

	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			continue
		}
		if memberID == excludeUserID {
			continue
		}
		ws.sendToUserLocked(memberID, message)
	}
}

func (ws *WSServer) BroadcastToUsers(userIDs []string, message []byte) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	for _, uid := range userIDs {
		ws.sendToUserLocked(uid, message)
	}
}

func (ws *WSServer) sendToUser(userID string, message []byte) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	ws.sendToUserLocked(userID, message)
}

func (ws *WSServer) sendToCallRoom(roomID string, message []byte, exceptUserID string) {
	ids := ws.callRooms.ParticipantIDs(roomID, exceptUserID)
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	for _, uid := range ids {
		ws.sendToUserLocked(uid, message)
	}
}

func (ws *WSServer) sendToUserLocked(userID string, message []byte) {
	if conns, ok := ws.clients[userID]; ok {
		for client := range conns {
			select {
			case client.Send <- message:
			default:
			}
		}
	}
}

func allowedWSOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	for _, allowed := range strings.Split(config.Required("ALLOWED_ORIGINS"), ",") {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" || allowed == origin {
			return true
		}
	}
	return false
}

func strOrDefault(v interface{}, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}
