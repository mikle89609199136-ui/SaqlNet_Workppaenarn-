package chat

import (
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCallDisconnectGraceExpires(t *testing.T) {
	for _, both := range []bool{false, true} {
		name := "one disconnected"
		if both {
			name = "both disconnected"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				m := NewCallRoomManager()
				m.CreateRoom("a", "room", "p2p", "audio", "chat", "")
				require.True(t, m.JoinRoom("room", "a", "", "").OK)
				require.True(t, m.JoinRoom("room", "b", "", "").OK)
				var closed atomic.Int32
				expired := func(snap *RoomSnapshot) {
					closed.Add(1)
					require.Equal(t, "chat", snap.ChatID)
					require.NotZero(t, snap.AnsweredAt)
				}
				require.True(t, m.DisconnectRoom("room", "a", callDisconnectGrace, expired).OK)
				if both {
					require.True(t, m.DisconnectRoom("room", "b", callDisconnectGrace, expired).OK)
				}
				time.Sleep(24 * time.Second)
				synctest.Wait()
				require.NotNil(t, m.GetRoomPublic("room"))
				require.Zero(t, closed.Load())
				time.Sleep(time.Second)
				synctest.Wait()
				require.Nil(t, m.GetRoomPublic("room"))
				require.Nil(t, m.GetUserRoom("a"))
				require.Nil(t, m.GetUserRoom("b"))
				require.Equal(t, int32(1), closed.Load())
				require.False(t, m.JoinRoom("room", "a", "", "").OK)
			})
		})
	}
}

func TestCallRejoinCancelsOnlyItsDisconnectTimer(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		m := NewCallRoomManager()
		m.CreateRoom("a", "room", "p2p", "audio", "chat", "")
		m.JoinRoom("room", "a", "", "")
		m.JoinRoom("room", "b", "", "")
		var closed atomic.Int32
		expired := func(*RoomSnapshot) { closed.Add(1) }
		m.DisconnectRoom("room", "a", callDisconnectGrace, expired)
		time.Sleep(10 * time.Second)
		require.True(t, m.JoinRoom("room", "a", "", "").OK)
		m.DisconnectRoom("room", "a", callDisconnectGrace, expired)
		time.Sleep(15 * time.Second)
		synctest.Wait()
		require.NotNil(t, m.GetRoomPublic("room"), "старый таймер не закрывает новый обрыв")
		require.True(t, m.JoinRoom("room", "a", "", "").OK)
		time.Sleep(callDisconnectGrace)
		synctest.Wait()
		require.True(t, m.IsParticipant("room", "a"))
		require.True(t, m.IsParticipant("room", "b"))
		require.Zero(t, closed.Load())
	})
}

func TestCallLeaveDuringGraceClosesImmediately(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		m := NewCallRoomManager()
		m.CreateRoom("a", "room", "p2p", "audio", "chat", "")
		m.JoinRoom("room", "a", "", "")
		m.JoinRoom("room", "b", "", "")
		var closed atomic.Int32
		m.DisconnectRoom("room", "a", callDisconnectGrace, func(*RoomSnapshot) { closed.Add(1) })
		require.True(t, m.LeaveRoom("room", "b").Closed)
		require.Nil(t, m.GetRoomPublic("room"))
		time.Sleep(callDisconnectGrace)
		synctest.Wait()
		require.Zero(t, closed.Load(), "таймер не закрывает комнату повторно")
	})
}
