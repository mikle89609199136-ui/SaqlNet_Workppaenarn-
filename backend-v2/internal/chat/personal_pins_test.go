package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestPersonalPinCommitAndDevices(t *testing.T) {
	for _, commitFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "all owner devices", true: "commit fails"}[commitFails], func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			first := &Client{Send: make(chan []byte, 1)}
			second := &Client{Send: make(chan []byte, 1)}
			other := &Client{Send: make(chan []byte, 1)}
			ws := &WSServer{clients: map[string]map[*Client]bool{"owner": {first: true, second: true}, "other": {other: true}}}
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT 1 FROM chats.members").WithArgs("chat", "owner").WillReturnRows(sqlmock.NewRows([]string{"one"}).AddRow(1))
			mock.ExpectQuery("SELECT 1 FROM messages.messages").WithArgs("message", "chat", "owner").WillReturnRows(sqlmock.NewRows([]string{"one"}).AddRow(1))
			mock.ExpectQuery("INSERT INTO messages.personal_pins").WithArgs("owner", "chat", "message").WillReturnRows(sqlmock.NewRows([]string{"at"}).AddRow(time.Now()))
			commit := mock.ExpectCommit()
			if commitFails {
				commit.WillReturnError(errors.New("commit failed"))
			}
			err = NewService(db, ws, nil).SetPersonalPin(context.Background(), "owner", "chat", "message", true)
			if commitFails {
				require.Error(t, err)
				require.Empty(t, first.Send)
				require.Empty(t, second.Send)
			} else {
				require.NoError(t, err)
				require.Len(t, first.Send, 1)
				require.Equal(t, <-first.Send, <-second.Send)
			}
			require.Empty(t, other.Send)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestPersonalPinStateNotBroadcastToChat(t *testing.T) {
	message := Message{IsPinned: true, IsChatPinned: true, IsPersonalPinned: true}
	payload, err := messagePinnedPayload(Pin{Message: message})
	require.NoError(t, err)
	var event struct {
		Pin Pin `json:"pin"`
	}
	require.NoError(t, json.Unmarshal(payload, &event))
	require.False(t, event.Pin.Message.IsPersonalPinned)
	require.True(t, event.Pin.Message.IsChatPinned)
	require.False(t, forBroadcast(&message).IsPersonalPinned)
	require.True(t, message.IsPersonalPinned)
}
