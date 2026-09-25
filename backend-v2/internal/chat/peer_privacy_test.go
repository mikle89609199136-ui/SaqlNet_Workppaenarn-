package chat

import (
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/privacy"
)

func peerChat() Chat {
	return Chat{
		Type:         "private",
		AvatarURL:    "/api/v2/media/avatar",
		PeerIsOnline: true,
		PeerLastSeen: "2026-09-26T12:00:00Z",
	}
}

func TestApplyPeerPrivacy(t *testing.T) {
	t.Run("открытые настройки — всё видно", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Parse([]byte(`{"lastSeen":"all","photoVisibility":"all"}`)), privacy.Relation{})
		require.Equal(t, peerChat(), chat)
	})

	t.Run("статус закрыт, фото открыто", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Parse([]byte(`{"lastSeen":"nobody"}`)), privacy.Relation{})
		require.False(t, chat.PeerIsOnline)
		require.Empty(t, chat.PeerLastSeen)
		require.Equal(t, "/api/v2/media/avatar", chat.AvatarURL)
	})

	t.Run("старое contacts закрывает, как nobody", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Parse([]byte(`{"photoVisibility":"contacts"}`)), privacy.Relation{})
		require.Empty(t, chat.AvatarURL)
		require.True(t, chat.PeerIsOnline)
	})

	t.Run("собеседник заблокировал зрителя — не видно ничего", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Parse(nil), privacy.Relation{Blocked: true})
		require.False(t, chat.PeerIsOnline)
		require.Empty(t, chat.PeerLastSeen)
		require.Empty(t, chat.AvatarURL)
	})

	t.Run("повреждённые настройки закрывают", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Parse([]byte(`{broken`)), privacy.Relation{})
		require.False(t, chat.PeerIsOnline)
		require.Empty(t, chat.AvatarURL)
	})
}
