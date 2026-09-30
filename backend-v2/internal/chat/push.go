package chat

import (
	"craneapp/backend-v2/internal/push"
)

// Push-уведомления (#717): чат сообщает о событиях, а кому и как
// отправить — решает push.Notifier.

// pushNotifier — то, что чату нужно от рассылки. Nil — push выключен.
type pushNotifier interface {
	Notify(event push.Event)
}

// SetPush подключает рассылку push к сервису сообщений.
func (s *Service) SetPush(notifier pushNotifier) { s.push = notifier }

// SetPush подключает рассылку push к звонкам.
func (ws *WSServer) SetPush(notifier pushNotifier) { ws.push = notifier }

// handleClientState — клиент сообщает, на экране ли приложение и какая у
// этого устройства push-подписка: {"type":"client_state","visible":true,
// "pushSubscriptionId":"…"}. Подписка сверяется с владельцем при отборе
// (push.Directory отдаёт только подписки получателя), так что чужой id
// ничего не даёт: скрыть можно лишь свои уведомления.
func (ws *WSServer) handleClientState(client *Client, msg map[string]interface{}) {
	visible, _ := msg["visible"].(bool)
	subscriptionID, _ := msg["pushSubscriptionId"].(string)
	if subscriptionID != "" && validate.Var(subscriptionID, "uuid") != nil {
		subscriptionID = ""
	}
	ws.mu.Lock()
	client.visible = visible
	client.pushSubscriptionID = subscriptionID
	ws.mu.Unlock()
}

// VisiblePushSubscriptions — подписки устройств пользователя, где
// приложение сейчас на экране.
func (ws *WSServer) VisiblePushSubscriptions(userID string) map[string]bool {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	visible := map[string]bool{}
	for client := range ws.clients[userID] {
		if client.visible && client.pushSubscriptionID != "" {
			visible[client.pushSubscriptionID] = true
		}
	}
	return visible
}

func (s *Service) notifyMessage(chatID, senderID string) {
	if s.push == nil {
		return
	}
	s.push.Notify(push.Event{Kind: push.KindMessage, ChatID: chatID, ActorID: senderID})
}

// notifyCallInvite — push о входящем звонке. Звонок привязан к чату: без
// чата push не отправляется, а участие обоих в чате проверяет Notifier.
func (ws *WSServer) notifyCallInvite(roomID, callerID, calleeID, callKind string) {
	if ws.push == nil || ws.callRooms == nil {
		return
	}
	room := ws.callRooms.GetRoomPublic(roomID)
	if room == nil || room.ChatID == "" {
		return
	}
	ws.push.Notify(push.Event{
		Kind: push.KindCall, ChatID: room.ChatID, ActorID: callerID, CalleeID: calleeID,
		RoomID: roomID, CallKind: callKind,
	})
}

// notifyMissedCall — звонок закончился без ответа: входящий на телефоне
// заменяется «пропущенным» (тот же Topic и тег уведомления).
func (ws *WSServer) notifyMissedCall(roomID string, snap *RoomSnapshot) {
	if ws.push == nil || snap == nil || snap.ChatID == "" || snap.AnsweredAt > 0 {
		return
	}
	ws.push.Notify(push.Event{
		Kind: push.KindMissedCall, ChatID: snap.ChatID, ActorID: snap.HostID,
		RoomID: roomID, CallKind: snap.CallKind,
	})
}
