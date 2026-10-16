package chat

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"craneapp/backend-v2/internal/platform/privacy"
)

// Приглашение на звонок (#850).
//
// Всё, что видит получатель, берёт сервер: имя и аватар звонящего — из
// профиля (аватар — по правилу «Фото»), вид звонка и тип — из комнаты.
// Приглашать можно только собеседника личного чата и только в свою
// комнату; иначе приглашение молча отбрасывается, и звонящий не узнаёт,
// занят ли посторонний ему человек. Приглашение живёт callInviteTTL и
// отменяется, если звонящий отключился, не дождавшись ответа. «Принял»
// звонящий получает, когда принявший уже вошёл в комнату (#939).

// callInviteTTL — столько звонит входящий, как таймаут дозвона на клиенте.
// Переменная, а не константа, — для тестов.
var callInviteTTL = 60 * time.Second

// callAcceptHold — сколько «принял» ждёт входа принявшего в комнату (#939),
// прежде чем уйти звонящему всё равно. Переменная — для тестов.
var callAcceptHold = 5 * time.Second

// pendingInvite — приглашение, ждущее ответа, по получателю.
type pendingInvite struct {
	roomID   string
	callerID string
	caller   *Client // подключение, с которого звали: его отключение отменяет приглашение
	payload  json.RawMessage
	timer    *time.Timer
}

// heldAccept — «принял», придержанный до входа принявшего в комнату, по
// принявшему (#939). Звонящий начинает согласование, как только узнал о
// «принял», а сигнал адресату вне комнаты сервер отбрасывает
// (relayCallSignal): уйди «принял» сразу — предложение звонящего обогнало
// бы вход принявшего и пропало, и звонок завис бы.
type heldAccept struct {
	roomID   string
	callerID string
	caller   *Client
	response []byte
	timer    *time.Timer
}

func (ws *WSServer) handleCallInvite(client *Client, msg map[string]interface{}) {
	to, _ := msg["to"].(string)
	roomID, _ := msg["roomId"].(string)
	if to == "" || roomID == "" || to == client.UserID {
		return
	}
	// Поля комнаты, кроме участников, после создания не меняются.
	room := ws.callRooms.GetRoom(roomID)
	if room == nil || room.hostID != client.UserID || !ws.arePrivatePeers(room.chatID, client.UserID, to) {
		return
	}
	// До проверки «занят», записей, событий и push (#714).
	if !ws.allowCallInvite(client.UserID, to, roomID) {
		return
	}
	if ws.callRooms.GetUserRoom(to) != nil {
		ws.recordCallRefused(roomID, to, callEndBusy)
		ws.refuseInvite(client.UserID, roomID, to, "busy")
		ws.endUnansweredCall(roomID, client.UserID, false)
		return
	}

	// До отправки: ответ на приглашение пишется в ту же запись (#713).
	ws.recordCallInvited(roomID, to)
	name, avatar := ws.callerCard(client.UserID, to)
	payload, _ := json.Marshal(map[string]interface{}{
		"type":       "call_incoming",
		"roomId":     roomID,
		"kind":       room.callKind,
		"callType":   room.roomType,
		"from":       client.UserID,
		"fromName":   name,
		"fromAvatar": avatar,
	})
	ws.sendToUser(to, payload)
	// Push — на устройства, где приложение не на экране (#717).
	ws.notifyCallInvite(roomID, client.UserID, to, room.callKind)

	invite := &pendingInvite{roomID: roomID, callerID: client.UserID, caller: client, payload: payload}
	ws.inviteMu.Lock()
	if prev := ws.pendingInvites[to]; prev != nil {
		prev.timer.Stop()
	}
	invite.timer = time.AfterFunc(callInviteTTL, func() { ws.expireInvite(to, invite) })
	ws.pendingInvites[to] = invite
	ws.inviteMu.Unlock()
}

// handleCallInviteResponse — ответ принимается только от приглашённого, по
// его действующему приглашению, и уходит звонящему этой комнаты. Кому
// отвечать, клиент не решает.
func (ws *WSServer) handleCallInviteResponse(client *Client, msg map[string]interface{}) {
	roomID, _ := msg["roomId"].(string)
	accepted, _ := msg["accepted"].(bool)
	reason, _ := msg["reason"].(string)
	if reason != "busy" {
		reason = ""
	}

	ws.inviteMu.Lock()
	invite := ws.pendingInvites[client.UserID]
	if invite == nil || invite.roomID != roomID {
		ws.inviteMu.Unlock()
		return
	}
	ws.inviteMu.Unlock()
	// Оставляем приглашение зарегистрированным на время проверки: отказ
	// должен отменить звонок на всех устройствах, где он уже показан.
	if accepted && !ws.allowCallInvite(invite.callerID, client.UserID, roomID) {
		return
	}
	ws.inviteMu.Lock()
	if ws.pendingInvites[client.UserID] != invite {
		ws.inviteMu.Unlock()
		return
	}
	invite.timer.Stop()
	delete(ws.pendingInvites, client.UserID)
	ws.inviteMu.Unlock()

	out, _ := json.Marshal(map[string]interface{}{
		"type":     "call_invite_response",
		"roomId":   roomID,
		"from":     client.UserID,
		"accepted": accepted,
		"reason":   reason,
	})
	if accepted {
		ws.holdAccept(client.UserID, invite, out)
		return
	}
	// Итог — раньше, чем звонящий узнает об отказе и положит трубку (#713).
	refusal := callEndDeclined
	if reason == "busy" {
		refusal = callEndBusy
	}
	ws.recordCallRefused(roomID, client.UserID, refusal)
	ws.sendToUser(invite.callerID, out)
	ws.endUnansweredCall(roomID, invite.callerID, false)
}

// holdAccept — «принял» уходит звонящему из handleCallJoin принявшего
// (releaseAccept), а если вход так и не пришёл — через callAcceptHold, как
// раньше, чтобы звонящий не остался без ответа.
func (ws *WSServer) holdAccept(to string, invite *pendingInvite, response []byte) {
	held := &heldAccept{roomID: invite.roomID, callerID: invite.callerID, caller: invite.caller, response: response}
	ws.inviteMu.Lock()
	// Вошёл раньше, чем ответил, — ждать нечего. Проверка под inviteMu:
	// вход снимает придержанный «принял» тоже под ним, после JoinRoom.
	if ws.callRooms.IsParticipant(invite.roomID, to) {
		ws.inviteMu.Unlock()
		ws.sendToUser(invite.callerID, response)
		return
	}
	prev := ws.heldAccepts[to]
	if prev != nil {
		prev.timer.Stop()
	}
	if ws.heldAccepts == nil {
		ws.heldAccepts = make(map[string]*heldAccept)
	}
	held.timer = time.AfterFunc(callAcceptHold, func() {
		ws.sendHeldAccept(to, func(h *heldAccept) bool { return h == held })
	})
	ws.heldAccepts[to] = held
	ws.inviteMu.Unlock()
	if prev != nil {
		ws.sendToUser(prev.callerID, prev.response)
	}
}

// releaseAccept — принявший вошёл в комнату: теперь сигналы звонящего до
// него дойдут, «принял» можно отправить.
func (ws *WSServer) releaseAccept(to, roomID string) {
	ws.sendHeldAccept(to, func(h *heldAccept) bool { return h.roomID == roomID })
}

func (ws *WSServer) sendHeldAccept(to string, match func(*heldAccept) bool) {
	ws.inviteMu.Lock()
	held := ws.heldAccepts[to]
	if held == nil || !match(held) {
		ws.inviteMu.Unlock()
		return
	}
	held.timer.Stop()
	delete(ws.heldAccepts, to)
	ws.inviteMu.Unlock()
	ws.sendToUser(held.callerID, held.response)
}

// dropHeldAcceptsLocked — звонящий отключился или комната закрылась:
// «принял» больше не нужен. Вызывать под inviteMu.
func (ws *WSServer) dropHeldAcceptsLocked(match func(*heldAccept) bool) {
	for to, held := range ws.heldAccepts {
		if match(held) {
			held.timer.Stop()
			delete(ws.heldAccepts, to)
		}
	}
}

// deliverPendingInvite — входящий, пришедший, пока получатель был не в
// сети, доставляется при подключении, если комната ещё жива.
func (ws *WSServer) deliverPendingInvite(client *Client) {
	ws.inviteMu.Lock()
	invite := ws.pendingInvites[client.UserID]
	if invite != nil && ws.callRooms.GetRoom(invite.roomID) == nil {
		invite.timer.Stop()
		delete(ws.pendingInvites, client.UserID)
		invite = nil
	}
	ws.inviteMu.Unlock()
	if invite != nil {
		// Правило могло измениться, пока получатель был не в сети.
		if !ws.allowCallInvite(invite.callerID, client.UserID, invite.roomID) {
			return
		}
		// Пока читали базу, приглашение могло истечь или смениться.
		ws.inviteMu.Lock()
		defer ws.inviteMu.Unlock()
		if ws.pendingInvites[client.UserID] != invite {
			return
		}
		select {
		case client.Send <- invite.payload:
		default:
		}
	}
}

// expireInvite — никто не ответил за callInviteTTL.
func (ws *WSServer) expireInvite(to string, invite *pendingInvite) {
	ws.inviteMu.Lock()
	if ws.pendingInvites[to] != invite {
		ws.inviteMu.Unlock()
		return
	}
	delete(ws.pendingInvites, to)
	ws.inviteMu.Unlock()
	ws.recordCallNoAnswer(invite.roomID)
	ws.sendCallCancelled(to, invite.roomID)
	ws.endUnansweredCall(invite.roomID, invite.callerID, true)
}

// cancelInvitesFrom — звонящий отключился, не дождавшись ответа.
func (ws *WSServer) cancelInvitesFrom(client *Client) {
	type cancelled struct{ to, roomID string }
	var gone []cancelled
	ws.inviteMu.Lock()
	for to, invite := range ws.pendingInvites {
		if invite.caller == client {
			invite.timer.Stop()
			delete(ws.pendingInvites, to)
			gone = append(gone, cancelled{to, invite.roomID})
		}
	}
	ws.dropHeldAcceptsLocked(func(h *heldAccept) bool { return h.caller == client })
	ws.inviteMu.Unlock()
	for _, c := range gone {
		ws.sendCallCancelled(c.to, c.roomID)
		ws.closeCallRoomIfEmpty(c.roomID)
	}
}

// cancelInvitesForRoom — комната закрылась: её приглашения больше не звонят.
func (ws *WSServer) cancelInvitesForRoom(roomID string) {
	var gone []string
	ws.inviteMu.Lock()
	for to, invite := range ws.pendingInvites {
		if invite.roomID == roomID {
			invite.timer.Stop()
			delete(ws.pendingInvites, to)
			gone = append(gone, to)
		}
	}
	ws.dropHeldAcceptsLocked(func(h *heldAccept) bool { return h.roomID == roomID })
	ws.inviteMu.Unlock()
	for _, to := range gone {
		ws.sendCallCancelled(to, roomID)
	}
}

// endUnansweredCall — звонок кончился без ответа (отказ, занят, не
// ответил): звонящий выводится из комнаты, если он там один, и комната
// закрывается с итогом (#713). Клиент звонящего на отказ call_leave не
// шлёт; его подключение со старой комнатой безвредно — сигналы в
// закрытую комнату отбрасываются, следующий вход её заменит.
//
// missed — звонок пропущен (не ответил): тогда push «пропущенный». Тому,
// кто сам отклонил, и тому, до кого приглашение не дошло (занят,
// заблокировал), — не нужно.
func (ws *WSServer) endUnansweredCall(roomID, callerID string, missed bool) {
	if snap, ok := ws.callRooms.LeaveIfAlone(roomID, callerID); ok {
		ws.recordCallLeft(roomID, callerID)
		ws.closeCallRoom(roomID, snap, missed)
	}
}

// closeCallRoomIfEmpty — в комнату так никто и не вошёл: закрыть её, как
// закрывается комната после ухода последнего участника.
func (ws *WSServer) closeCallRoomIfEmpty(roomID string) {
	if snap, ok := ws.callRooms.CloseIfEmpty(roomID); ok {
		ws.callRoomClosed(roomID, snap)
	}
}

// callRoomClosed — итог в истории (#713), запись о звонке в чате,
// «пропущенный» push, если не ответили, отмена приглашений.
func (ws *WSServer) callRoomClosed(roomID string, snap *RoomSnapshot) {
	ws.closeCallRoom(roomID, snap, true)
}

func (ws *WSServer) closeCallRoom(roomID string, snap *RoomSnapshot, missedPush bool) {
	ws.recordCallEnded(roomID, snap)
	go ws.saveCallMessage(snap)
	if missedPush {
		ws.notifyMissedCall(roomID, snap)
	}
	ws.cancelInvitesForRoom(roomID)
}

func (ws *WSServer) sendCallCancelled(to, roomID string) {
	out, _ := json.Marshal(map[string]interface{}{"type": "call_cancelled", "roomId": roomID})
	ws.sendToUser(to, out)
}

func (ws *WSServer) refuseInvite(callerID, roomID, to, reason string) {
	out, _ := json.Marshal(map[string]interface{}{
		"type":     "call_invite_response",
		"roomId":   roomID,
		"from":     to,
		"accepted": false,
		"reason":   reason,
	})
	ws.sendToUser(callerID, out)
}

// arePrivatePeers — оба собеседники этого личного чата. Ошибка базы — нет.
func (ws *WSServer) arePrivatePeers(chatID, a, b string) bool {
	if ws.db == nil || chatID == "" {
		return false
	}
	var ok bool
	err := ws.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM chats.chats c
			WHERE c.id = $1 AND c.type = 'private'
			  AND EXISTS(SELECT 1 FROM chats.members m WHERE m.chat_id = c.id AND m.user_id = $2)
			  AND EXISTS(SELECT 1 FROM chats.members m WHERE m.chat_id = c.id AND m.user_id = $3)
		)`, chatID, a, b).Scan(&ok)
	if err != nil {
		slog.Error("call invite peers check", "err", err)
		return false
	}
	return ok
}

// callerCard — имя звонящего из профиля (имя и фамилия, иначе username) и
// аватар по правилу «Фото» для получателя.
func (ws *WSServer) callerCard(callerID, viewerID string) (string, string) {
	if ws.db == nil {
		return "", ""
	}
	var name, avatar string
	err := ws.db.QueryRow(`
		SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), NULLIF(au.first_name, ''), au.username),
		       COALESCE(up.avatar_url, '')
		FROM auth.users au
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE au.id = $1`, callerID).Scan(&name, &avatar)
	if err != nil {
		slog.Error("call invite caller card", "err", err)
		return "", ""
	}
	if avatar != "" {
		slots := []privacy.PhotoSlot{{OwnerID: callerID, URL: &avatar}}
		if err := privacy.HidePhotos(context.Background(), ws.db, viewerID, slots); err != nil {
			avatar = ""
		}
	}
	return name, avatar
}

// allowCallInvite проверяет ту же политику, что создание комнаты. Отказ
// не создаёт сообщений и новых записей, не раскрывает presence. Ранее
// доставленный входящий отменяется, неотвеченная комната закрывается.
func (ws *WSServer) allowCallInvite(callerID, to, roomID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), callRecordTimeout)
	defer cancel()
	err := checkCallPrivacy(ctx, ws.db, to, callerID)
	if err == nil {
		return true
	}
	reason := "calls_forbidden"
	if errors.Is(err, ErrBlockedByUser) {
		reason = "blocked_by_user"
	} else if !errors.Is(err, ErrCallsForbidden) {
		slog.Error("call privacy check", "err", err)
	}
	ws.inviteMu.Lock()
	cancelled := false
	if invite := ws.pendingInvites[to]; invite != nil && invite.roomID == roomID && invite.callerID == callerID {
		invite.timer.Stop()
		delete(ws.pendingInvites, to)
		cancelled = true
	}
	ws.inviteMu.Unlock()
	if cancelled {
		ws.sendCallCancelled(to, roomID)
	}
	ws.closeDeniedCallRoom(roomID, callerID)
	ws.refuseInvite(callerID, roomID, to, reason)
	return false
}
