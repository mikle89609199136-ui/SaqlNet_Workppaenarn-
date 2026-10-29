package chat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
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
		return authctx.OwnOrAllowedOrigin(r, r.Header.Get("Origin"))
	},
}

type tokenVerifier interface {
	VerifyToken(context.Context, string) (cryptoclient.TokenClaims, error)
}

type Client struct {
	token         string
	claims        cryptoclient.TokenClaims
	UserID        string
	Conn          *websocket.Conn
	Send          chan []byte // не закрывается; завершение сигнализируется через done
	done          chan struct{}
	heartbeatDone chan struct{} // закрывается при завершении ws.heartbeat (барьер перед Disconnect)
	closeOnce     sync.Once
	// Комната звонка этого подключения; пусто — не в звонке. Пишет только
	// своя горутина и только под ws.mu: доставка сигналов читает поле
	// чужих подключений (#849).
	CallRoomID string
	// Окно частоты сигналов звонка (#849); только своя горутина.
	signalWindow time.Time
	signalCount  int
	ConnectionID string // уникальный ID WS-соединения для presence

	// Push (#717): подписка этого устройства и видно ли приложение. На
	// устройство, где приложение на экране, push не отправляется. Пишет
	// readPump, читают рассылки — под ws.mu.
	pushSubscriptionID string
	visible            bool
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
	tokenChecker   authctx.TokenChecker
	clients        map[string]map[*Client]bool
	mu             sync.RWMutex
	register       chan *Client
	unreg          chan *Client
	callRooms      *CallRoomManager
	pendingInvites map[string]*pendingInvite // по получателю (#850)
	heldAccepts    map[string]*heldAccept    // по принявшему (#939); создаётся при первой записи
	inviteMu       sync.Mutex                // и pendingInvites, и heldAccepts
	presence       presence.Store
	activity       presenceActivity // время активности и собеседники; nil — не ведётся
	pingInterval   time.Duration    // интервал heartbeat; 0 → wsPingInterval
	stop           chan struct{}
	stopped        chan struct{}
	stopOnce       sync.Once

	// «Печатает» (#866): кеш участников и ограничение частоты, см. typing.go.
	typingOnce          sync.Once
	typingState         *typingState
	typingMembersLoader chatMembersLoader // подмена загрузки в тестах; nil — из базы
	typingClock         func() time.Time  // подмена часов в тестах; nil — time.Now

	push pushNotifier // push о звонках (#717); nil — выключен

	disconnectGrace time.Duration // ожидание call_join после обрыва; 0 → callDisconnectGrace
}

// NewWSServer создаёт и запускает новый экземпляр WSServer.
// store — источник online-состояния; nil допустим (presence отключён).
func NewWSServer(db *sql.DB, crypto tokenVerifier, store presence.Store) *WSServer {
	ws := &WSServer{
		db:             db,
		crypto:         crypto,
		tokenChecker:   authctx.NewDBTokenChecker(db),
		clients:        make(map[string]map[*Client]bool),
		register:       make(chan *Client),
		unreg:          make(chan *Client),
		callRooms:      NewCallRoomManager(),
		pendingInvites: make(map[string]*pendingInvite),
		presence:       store,
		pingInterval:   wsPingInterval,
		stop:           make(chan struct{}),
		stopped:        make(chan struct{}),
	}
	if db != nil {
		ws.activity = dbPresenceActivity{db: db}
	}
	go ws.run()
	return ws
}

// Close stops the server's registration loop. Call it after the HTTP server
// has stopped accepting handshakes and active test connections are closed.
func (ws *WSServer) Close() {
	if ws == nil || ws.stop == nil || ws.stopped == nil {
		return
	}
	ws.stopOnce.Do(func() { close(ws.stop) })
	<-ws.stopped
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
	if ws.stopped != nil {
		defer close(ws.stopped)
	}
	for {
		select {
		case <-ws.stop:
			return
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

	// Токен доступен только в HttpOnly-cookie (#705): ни заголовок, ни URL
	// больше не являются способом аутентификации сокета.
	token, source := authctx.TokenFromRequest(r)
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	// Cookie браузер подставляет сам, и в сокет с ней мог бы подключиться
	// чужой сайт — только свой или точно разрешённый адрес, без "*".
	if source != authctx.TokenCookie || !authctx.OwnOrAllowedOrigin(r, r.Header.Get("Origin")) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}

	claims, err := ws.crypto.VerifyToken(r.Context(), token)
	if errors.Is(err, cryptoclient.ErrTokenGenerationProtocol) {
		http.Error(w, "crypto token-generation protocol is not ready", http.StatusServiceUnavailable)
		return
	}
	if err != nil && !errors.Is(err, cryptoclient.ErrInvalidToken) {
		http.Error(w, "session verification is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if err != nil || claims.Subject == "" {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if ws.tokenChecker == nil {
		http.Error(w, "token revocation check unavailable", http.StatusServiceUnavailable)
		return
	}
	revoked, err := ws.tokenChecker.IsTokenRevoked(r.Context(), token, claims)
	if err != nil {
		http.Error(w, "token revocation check unavailable", http.StatusServiceUnavailable)
		return
	}
	if revoked {
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
	client := &Client{token: token, claims: claims, UserID: claims.Subject, Conn: conn, Send: make(chan []byte, 256), done: make(chan struct{}), heartbeatDone: make(chan struct{}), ConnectionID: connID}
	// Второе окно или вкладка — не новость: о входе сообщаем только тогда,
	// когда до этого соединений не было вовсе.
	firstConnection := !ws.isOnlineElsewhere(r.Context(), client.UserID, client)
	if ws.presence != nil {
		if err := ws.presence.Connect(r.Context(), client.UserID, client.ConnectionID); err != nil {
			slog.Error("presence connect error", "userID", client.UserID, "err", err)
		}
	}
	ws.register <- client

	// Входящий, пришедший, пока человек был не в сети (#850).
	ws.deliverPendingInvite(client)

	go ws.writePump(client)
	go ws.readPump(client)
	// #nosec - горутина долгоживущая, r.Context() отменяется после завершения HTTP-upgrade
	go ws.heartbeat(client)
	if firstConnection {
		go ws.announcePresence(client.UserID, true)
	} else {
		go ws.touchPresence(client.UserID)
	}
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
		// Закрыто последнее соединение — человек вышел из сети.
		go ws.announceOffline(client)
		ws.unreg <- client
		_ = client.Conn.Close()
	}()
	// Recheck after registration: logout may commit between handshake and registration.
	if !ws.authorizeClient(client) {
		return
	}
	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			break
		}
		if err := client.Conn.SetReadDeadline(time.Now().Add(wsReadDeadline)); err != nil {
			break
		}

		if !ws.authorizeClient(client) {
			return
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
			ws.handleTyping(client.UserID, chatID)

		case "client_state":
			ws.handleClientState(client, msg)

		case "call_join":
			ws.handleCallJoin(client, msg)

		case "call_leave":
			ws.handleCallLeave(client, msg)

		case "call_offer", "call_answer", "call_ice":
			ws.relayCallSignal(client, msgType, msg)

		case "call_invite":
			ws.handleCallInvite(client, msg)

		case "call_invite_response":
			ws.handleCallInviteResponse(client, msg)
		}
	}
}

func (ws *WSServer) handleCallJoin(client *Client, msg map[string]interface{}) {
	roomID, _ := msg["roomId"].(string)
	if roomID == "" {
		return
	}
	// Оборванный звонок пока только читаем: отказ не должен убрать его
	// из очереди, которую закрывает таймер восстановления (#714).
	room := ws.callRooms.GetRoomForJoin(roomID, client.UserID)
	// Войти можно только в комнату, созданную через POST /calls/rooms, и
	// только участнику её чата (#848). Комната входом не создаётся.
	// «Нет комнаты» и «чужая» отвечаются одинаково: не раскрываем, что
	// комната есть.
	if room == nil || !ws.mayJoinCallRoom(client.UserID, room.ChatID) {
		out, _ := json.Marshal(map[string]interface{}{"type": "call_error", "roomId": roomID, "reason": "room_not_found"})
		client.Send <- out
		return
	}
	// Нельзя обойти запрет прямым call_join в ранее созданную комнату.
	if !ws.allowCallRoomJoin(room.ChatID, room.HostID) {
		ws.closeDeniedCallRoom(roomID, room.HostID)
		out, _ := json.Marshal(map[string]interface{}{"type": "call_error", "roomId": roomID, "reason": "calls_forbidden"})
		client.Send <- out
		return
	}
	// Только после проверок переносим разрешённый звонок в активные.
	ws.callRooms.Restore(roomID, client.UserID)
	displayName, _ := msg["displayName"].(string)
	avatarURL, _ := msg["avatarUrl"].(string)
	r := ws.callRooms.JoinRoom(roomID, client.UserID, displayName, avatarURL)
	if !r.OK {
		out, _ := json.Marshal(map[string]interface{}{"type": "call_error", "reason": r.Error})
		client.Send <- out
		return
	}
	ws.setCallRoom(client, roomID)
	// Прежняя комната, опустевшая от этого входа, закрывается как обычно:
	// с итогом и записью о звонке в чате (#713).
	if r.Closed != nil {
		ws.recordCallLeft(r.ClosedRoomID, client.UserID)
		ws.callRoomClosed(r.ClosedRoomID, r.Closed)
	}
	// Звонок один на один: вошёл к собеседнику — значит, ответили (#713).
	ws.recordCallJoined(roomID, client.UserID, len(r.Peers) > 0)
	// Send joined confirmation with current peers
	joined, _ := json.Marshal(map[string]interface{}{
		"type":   "call_joined",
		"roomId": roomID,
		"peers":  r.Peers,
		"self":   map[string]string{"userId": client.UserID},
	})
	client.Send <- joined
	// Принял звонок — звонящему «принял» только теперь (#939).
	ws.releaseAccept(client.UserID, roomID)
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

// mayJoinCallRoom — пользователь участник чата комнаты. Ошибка базы — не пускать.
func (ws *WSServer) mayJoinCallRoom(userID, chatID string) bool {
	if chatID == "" || ws.db == nil {
		return false
	}
	var member bool
	err := ws.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
		userID, chatID,
	).Scan(&member)
	if err != nil {
		slog.Error("call room membership check", "err", err)
		return false
	}
	return member
}

// Лимиты сигналов звонка с одного подключения (#849): SDP — единицы КБ,
// кандидатов за раз — десятки.
const (
	maxCallSignalBytes      = 64 << 10
	maxCallSignalsPerSecond = 50
)

// allowCallSignal — не превышена ли частота сигналов этого подключения.
func (c *Client) allowCallSignal(now time.Time) bool {
	if now.Sub(c.signalWindow) >= time.Second {
		c.signalWindow = now
		c.signalCount = 0
	}
	c.signalCount++
	return c.signalCount <= maxCallSignalsPerSecond
}

func (ws *WSServer) setCallRoom(client *Client, roomID string) {
	ws.mu.Lock()
	client.CallRoomID = roomID
	ws.mu.Unlock()
}

// relayCallSignal — предложение, ответ или кандидат соединения (#849):
// только если отправитель вошёл в комнату этим подключением, получатель —
// участник той же комнаты, а roomId сообщения — она же. Доставка — только
// подключениям получателя в этой комнате. Всё прочее молча отбрасывается:
// ответ подсказал бы, есть ли у человека звонок.
func (ws *WSServer) relayCallSignal(client *Client, msgType string, msg map[string]interface{}) {
	to, _ := msg["to"].(string)
	roomID, _ := msg["roomId"].(string)
	current := client.CallRoomID // пишет только своя горутина
	if to == "" || to == client.UserID || roomID == "" || roomID != current {
		return
	}
	if !client.allowCallSignal(time.Now()) {
		return
	}
	if !ws.callRooms.IsParticipant(roomID, client.UserID) || !ws.callRooms.IsParticipant(roomID, to) {
		return
	}
	payload, err := json.Marshal(msg["payload"])
	if err != nil || len(payload) > maxCallSignalBytes {
		return
	}
	out, _ := json.Marshal(map[string]interface{}{
		"type":    msgType,
		"roomId":  roomID,
		"from":    client.UserID,
		"payload": json.RawMessage(payload),
	})
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	for conn := range ws.clients[to] {
		if conn.CallRoomID != roomID {
			continue
		}
		select {
		case conn.Send <- out:
		default:
		}
	}
}

func (ws *WSServer) handleCallLeave(client *Client, msg map[string]interface{}) {
	roomID, _ := msg["roomId"].(string)
	if roomID == "" {
		roomID = client.CallRoomID
	}
	// Выходит подключение, которое входило, — как и сигналы (#849): другая
	// вкладка того же человека чужой звонок не завершает.
	if roomID == "" || roomID != client.CallRoomID {
		return
	}
	ws.doLeaveRoom(client, roomID, peerLeftByLeave)
}

// Почему собеседник вышел из звонка (#775): сам («Завершить») — звонок
// закончен; оборвался сокет (перезагрузка, пропала сеть) — клиент ждёт
// его возвращения и восстанавливает звонок.
const (
	peerLeftByLeave      = "left"
	peerLeftByDisconnect = "disconnected"
	callDisconnectGrace  = 25 * time.Second
)

func (ws *WSServer) doLeaveRoom(client *Client, roomID, reason string) {
	var lr LeaveResult
	if reason == peerLeftByDisconnect {
		grace := ws.disconnectGrace
		if grace <= 0 {
			grace = callDisconnectGrace
		}
		lr = ws.callRooms.DisconnectRoom(roomID, client.UserID, grace, func(snap *RoomSnapshot) {
			ws.callRoomClosed(roomID, snap)
		})
	} else {
		lr = ws.callRooms.LeaveRoom(roomID, client.UserID)
	}
	// Не участник (не входил, уже вышел, комната закрыта) — сообщать
	// некому и не о чем: иначе любой, кто знает id комнаты, «выходил» бы
	// из чужого звонка, и собеседники его завершали бы.
	if !lr.OK {
		ws.setCallRoom(client, "")
		return
	}
	ws.recordCallLeft(roomID, client.UserID)
	peerLeft, _ := json.Marshal(map[string]interface{}{
		"type":   "call_peer_left",
		"roomId": roomID,
		"peer":   map[string]string{"userId": client.UserID},
		"reason": reason,
	})
	ws.sendToCallRoom(roomID, peerLeft, client.UserID)
	if lr.Closed && lr.Snapshot != nil {
		ws.callRoomClosed(roomID, lr.Snapshot)
	}
	ws.setCallRoom(client, "")
}

func (ws *WSServer) handleCallDisconnect(client *Client) {
	if client.CallRoomID != "" {
		ws.doLeaveRoom(client, client.CallRoomID, peerLeftByDisconnect)
	}
	// Звал и не дождался ответа — приглашение больше не звонит (#850).
	ws.cancelInvitesFrom(client)
}

func (ws *WSServer) saveCallMessage(snap *RoomSnapshot) {
	if snap.ChatID == "" {
		return
	}
	status := "missed"
	var duration int64
	if snap.AnsweredAt > 0 {
		status = "answered"
		endedAt := time.Now().UnixMilli()
		if snap.EndedAt > 0 {
			endedAt = snap.EndedAt
		}
		duration = max(0, endedAt-snap.AnsweredAt) / 1000
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
			if !ws.authorizeClient(client) {
				return
			}
			ws.sendPresenceHeartbeat(client)
			ws.touchPresence(client.UserID)
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

// sendPresenceHeartbeat отправляет периодический heartbeat в presence.Store
// с таймаутом 5 секунд. Ошибки логируются и не прерывают работу сокета.
func (ws *WSServer) sendPresenceHeartbeat(client *Client) {
	if ws.presence == nil || client.ConnectionID == "" {
		return
	}
	hbCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := ws.presence.Heartbeat(hbCtx, client.UserID, client.ConnectionID)
	if err != nil {
		slog.Error("presence heartbeat error", "userID", client.UserID, "err", err)
	}
}

func (ws *WSServer) writePump(client *Client) {
	defer client.Conn.Close()
	for {
		select {
		case <-client.done:
			if err := client.Conn.SetWriteDeadline(time.Now().Add(wsWriteDeadline)); err != nil {
				return
			}
			_ = client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		case message, ok := <-client.Send:
			// Send принадлежит производителям сообщений и намеренно не закрывается:
			// завершение жизненного цикла клиента сигнализируется через done.
			if !ok {
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
}

// BroadcastToChat рассылает сообщение участникам чата, кроме excludeUserID.
// Если excludeUserID задан, он сам должен быть участником — иначе рассылки
// нет. Участники читаются одним запросом до блокировки: ws.mu не держится
// на базе, и подключения с отключениями не ждут чужих запросов (#866).
func (ws *WSServer) BroadcastToChat(chatID string, message []byte, excludeUserID string) {
	rows, err := ws.db.Query(`SELECT user_id FROM chats.members WHERE chat_id = $1`, chatID)
	if err != nil {
		return
	}
	var recipients []string
	senderIsMember := excludeUserID == ""
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			continue
		}
		if memberID == excludeUserID {
			senderIsMember = true
			continue
		}
		recipients = append(recipients, memberID)
	}
	failed := rows.Err() != nil
	_ = rows.Close()
	if failed || !senderIsMember {
		return
	}

	ws.BroadcastToUsers(recipients, message)
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
