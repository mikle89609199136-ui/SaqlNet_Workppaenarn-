package chat

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/push"
)

type recordingPush struct {
	mu     sync.Mutex
	events []push.Event
}

func (r *recordingPush) Notify(event push.Event) {
	r.mu.Lock()
	r.events = append(r.events, event)
	r.mu.Unlock()
}

// Отправка пачки — одно событие push на чат: уведомления чата всё равно
// сворачиваются в одно (#717).
func TestSendMessagesNotifiesPushOncePerBatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	svc := NewService(db, &recordingRealtime{}, nil)
	pushed := &recordingPush{}
	svc.SetPush(pushed)

	expectSendAllowed(mock)
	mock.ExpectBegin()
	expectInsert(mock, "первое", 0)
	expectInsert(mock, "второе", 1)
	mock.ExpectCommit()

	recorder := sendBatch(NewHandler(svc), sendBody(textItem("первое"), textItem("второе")))

	require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
	require.Equal(t, []push.Event{{
		Kind: push.KindMessage, ChatID: messageValidationChatID, ActorID: messageValidationUserID,
	}}, pushed.events)
}

func TestSendMessagesWithoutPushStillWorks(t *testing.T) {
	handler, mock, _ := batchHandler(t)
	expectSendAllowed(mock)
	mock.ExpectBegin()
	expectInsert(mock, "текст", 0)
	mock.ExpectCommit()

	recorder := sendBatch(handler, sendBody(textItem("текст")))
	require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
}

// Приложение на экране — на это устройство push не идёт. Состояние у
// каждого соединения своё; чужие соединения не влияют.
func TestClientStateMarksVisibleDevices(t *testing.T) {
	const subscription = "0b1e9c2a-3f4d-4e5f-8a6b-7c8d9e0f1a2b"
	ws := &WSServer{clients: make(map[string]map[*Client]bool)}
	phone := &Client{UserID: "masha"}
	laptop := &Client{UserID: "masha"}
	stranger := &Client{UserID: "oleg"}
	ws.clients["masha"] = map[*Client]bool{phone: true, laptop: true}
	ws.clients["oleg"] = map[*Client]bool{stranger: true}

	ws.handleClientState(phone, map[string]interface{}{"visible": true, "pushSubscriptionId": subscription})
	require.Equal(t, map[string]bool{subscription: true}, ws.VisiblePushSubscriptions("masha"))

	// Свернули приложение — снова получает push.
	ws.handleClientState(phone, map[string]interface{}{"visible": false, "pushSubscriptionId": subscription})
	require.Empty(t, ws.VisiblePushSubscriptions("masha"))

	// Чужой id подписки в своём соединении скрывает только свои уведомления.
	ws.handleClientState(stranger, map[string]interface{}{"visible": true, "pushSubscriptionId": subscription})
	require.Empty(t, ws.VisiblePushSubscriptions("masha"))

	// Не UUID — не принимается.
	ws.handleClientState(laptop, map[string]interface{}{"visible": true, "pushSubscriptionId": "../../etc"})
	require.Empty(t, ws.VisiblePushSubscriptions("masha"))
}

func TestCallInviteNotifiesPushOnlyForRoomWithChat(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &WSServer{
		db:             db,
		clients:        make(map[string]map[*Client]bool),
		callRooms:      NewCallRoomManager(),
		pendingInvites: map[string]*pendingInvite{},
	}
	pushed := &recordingPush{}
	ws.SetPush(pushed)
	caller := &Client{UserID: "igor", Send: make(chan []byte, 4)}

	// Комнаты нет — приглашение не уходит, и push нет (#850).
	ws.handleCallInvite(caller, map[string]interface{}{"to": "masha", "roomId": "no-room"})
	require.Empty(t, pushed.events)

	ws.callRooms.CreateRoom("igor", "room-1", "p2p", "audio", "chat-1", "")
	mock.ExpectQuery(`FROM chats\.chats c`).WithArgs("chat-1", "igor", "masha").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`users\.blocked_users`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`FROM auth\.users au`).WillReturnRows(sqlmock.NewRows([]string{"name", "avatar"}).AddRow("Игорь", ""))
	ws.handleCallInvite(caller, map[string]interface{}{"to": "masha", "roomId": "room-1", "kind": "video"})
	require.Equal(t, []push.Event{{
		Kind: push.KindCall, ChatID: "chat-1", ActorID: "igor", CalleeID: "masha",
		RoomID: "room-1", CallKind: "audio",
	}}, pushed.events, "вид звонка — из комнаты, а не из сообщения")
	ws.inviteMu.Lock()
	ws.pendingInvites["masha"].timer.Stop()
	ws.inviteMu.Unlock()
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMissedCallNotifiesOnlyWhenUnanswered(t *testing.T) {
	ws := &WSServer{}
	pushed := &recordingPush{}
	ws.SetPush(pushed)

	ws.notifyMissedCall("room-1", &RoomSnapshot{ChatID: "chat-1", HostID: "igor", CallKind: "video", AnsweredAt: 123})
	require.Empty(t, pushed.events)

	ws.notifyMissedCall("room-1", &RoomSnapshot{ChatID: "chat-1", HostID: "igor", CallKind: "video"})
	require.Equal(t, []push.Event{{
		Kind: push.KindMissedCall, ChatID: "chat-1", ActorID: "igor", RoomID: "room-1", CallKind: "video",
	}}, pushed.events)
}

// Звонок без ответа закрывается сервером (#713). «Пропущенный» push — только
// тому, кто не ответил; отклонивший сам о своём отказе push не получает.
func TestUnansweredCallClosesRoomAndPushesOnlyMissed(t *testing.T) {
	db, _, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	ws := &WSServer{
		db:             db,
		clients:        make(map[string]map[*Client]bool),
		callRooms:      NewCallRoomManager(),
		pendingInvites: map[string]*pendingInvite{},
	}
	pushed := &recordingPush{}
	ws.SetPush(pushed)
	igor := &Client{UserID: "igor", Send: make(chan []byte, 8)}
	masha := &Client{UserID: "masha", Send: make(chan []byte, 8)}
	ws.clients["igor"] = map[*Client]bool{igor: true}
	ws.clients["masha"] = map[*Client]bool{masha: true}

	ring := func(roomID string) *pendingInvite {
		ws.callRooms.CreateRoom("igor", roomID, "p2p", "audio", "chat-1", "")
		require.True(t, ws.callRooms.JoinRoom(roomID, "igor", "", "").OK)
		invite := &pendingInvite{roomID: roomID, callerID: "igor", caller: igor, timer: time.AfterFunc(time.Hour, func() {})}
		ws.inviteMu.Lock()
		ws.pendingInvites["masha"] = invite
		ws.inviteMu.Unlock()
		return invite
	}

	ring("room-declined")
	ws.handleCallInviteResponse(masha, map[string]interface{}{"roomId": "room-declined", "accepted": false})
	require.Nil(t, ws.callRooms.GetRoom("room-declined"), "звонящий на отказ call_leave не шлёт — комнату закрывает сервер")
	require.Nil(t, ws.callRooms.GetUserRoom("igor"))
	require.Empty(t, pushed.events)

	invite := ring("room-missed")
	ws.expireInvite("masha", invite)
	require.Nil(t, ws.callRooms.GetRoom("room-missed"))
	require.Equal(t, []push.Event{{
		Kind: push.KindMissedCall, ChatID: "chat-1", ActorID: "igor", RoomID: "room-missed", CallKind: "audio",
	}}, pushed.events)
}
