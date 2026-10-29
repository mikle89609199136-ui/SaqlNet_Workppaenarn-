package chat

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/privacy"
)

// Час после последней активности собеседника в peerChat.
var peerPrivacyNow = time.Date(2026, 9, 26, 13, 0, 0, 0, time.UTC)

func peerChat() Chat {
	return Chat{
		Type:         "private",
		AvatarURL:    "/api/v2/media/avatar",
		PeerIsOnline: true,
		PeerLastSeen: "2026-09-26T12:00:00Z",
	}
}

// owner — собеседник с такими настройками; зритель всё открыл.
func owner(settings string, rel privacy.Relation) privacy.Pair {
	return privacy.Pair{Owner: privacy.Parse([]byte(settings)), Viewer: privacy.Parse(nil), OwnerToViewer: rel}
}

func requireHiddenStatus(t *testing.T, chat Chat, approx string) {
	t.Helper()
	require.False(t, chat.PeerIsOnline)
	require.Empty(t, chat.PeerLastSeen)
	require.Equal(t, approx, chat.PeerLastSeenApprox)
}

func TestApplyPeerPrivacy(t *testing.T) {
	t.Run("открытые настройки — всё видно", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{"lastSeen":"all","photoVisibility":"all"}`, privacy.Relation{}), peerPrivacyNow)
		require.Equal(t, peerChat(), chat)
	})

	t.Run("статус закрыт — приблизительное время, фото открыто", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{"lastSeen":"nobody"}`, privacy.Relation{}), peerPrivacyNow)
		requireHiddenStatus(t, chat, privacy.Recently)
		require.Equal(t, "/api/v2/media/avatar", chat.AvatarURL)
	})

	t.Run("старое contacts закрывает, как nobody", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{"photoVisibility":"contacts"}`, privacy.Relation{}), peerPrivacyNow)
		require.Empty(t, chat.AvatarURL)
		require.True(t, chat.PeerIsOnline)
	})

	t.Run("собеседник заблокировал зрителя — «давно» и без фото", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{}`, privacy.Relation{Blocked: true}), peerPrivacyNow)
		requireHiddenStatus(t, chat, privacy.LongAgo)
		require.Empty(t, chat.AvatarURL)
	})

	t.Run("повреждённые настройки закрывают", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{broken`, privacy.Relation{}), peerPrivacyNow)
		requireHiddenStatus(t, chat, privacy.Recently)
		require.Empty(t, chat.AvatarURL)
	})

	t.Run("давно не заходил — промежуток по времени", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{"lastSeen":"nobody"}`, privacy.Relation{}), peerPrivacyNow.Add(10*24*time.Hour))
		requireHiddenStatus(t, chat, privacy.WithinMonth)
	})
}

func TestApplyPeerPrivacyWithExceptions(t *testing.T) {
	t.Run("статус закрыт для всех, но зрителю открыт", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{"lastSeen":"nobody","photoVisibility":"nobody"}`,
			privacy.Relation{Exceptions: map[privacy.Rule]bool{privacy.LastSeen: true}}), peerPrivacyNow)
		require.True(t, chat.PeerIsOnline)
		require.Equal(t, "2026-09-26T12:00:00Z", chat.PeerLastSeen)
		require.Empty(t, chat.PeerLastSeenApprox)
		require.Empty(t, chat.AvatarURL, "фото исключение не открывало")
	})

	t.Run("фото открыто всем, но от зрителя закрыто", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, owner(`{}`,
			privacy.Relation{Exceptions: map[privacy.Rule]bool{privacy.Photo: false}}), peerPrivacyNow)
		require.Empty(t, chat.AvatarURL)
		require.True(t, chat.PeerIsOnline)
	})
}

// Взаимность (#791): скрывший своё время не видит чужого.
func TestApplyPeerPrivacyIsMutual(t *testing.T) {
	open := privacy.Parse([]byte(`{"lastSeen":"all"}`))
	closed := privacy.Parse([]byte(`{"lastSeen":"nobody"}`))

	t.Run("зритель скрыл своё — видит приблизительное, фото видно", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Pair{Owner: open, Viewer: closed}, peerPrivacyNow)
		requireHiddenStatus(t, chat, privacy.Recently)
		require.Equal(t, "/api/v2/media/avatar", chat.AvatarURL, "фото взаимностью не закрывается")
	})

	t.Run("зритель скрыл, но собеседнику «всегда разрешать»", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Pair{
			Owner: open, Viewer: closed,
			ViewerToOwner: privacy.Relation{Exceptions: map[privacy.Rule]bool{privacy.LastSeen: true}},
		}, peerPrivacyNow)
		require.True(t, chat.PeerIsOnline)
	})

	t.Run("зритель заблокировал собеседника — «недавно», не «давно»", func(t *testing.T) {
		chat := peerChat()
		applyPeerPrivacy(&chat, privacy.Pair{Owner: open, Viewer: open, ViewerToOwner: privacy.Relation{Blocked: true}}, peerPrivacyNow)
		requireHiddenStatus(t, chat, privacy.Recently)
	})
}

func TestPeerCanCallUsesPrivacyAndBothBlocks(t *testing.T) {
	for _, tc := range []struct {
		raw      string
		relation privacy.Relation
		ownBlock bool
		want     bool
	}{
		{`{"calls":"all"}`, privacy.Relation{}, false, true},
		{`{"calls":"nobody"}`, privacy.Relation{}, false, false},
		{`{"calls":"nobody"}`, privacy.Relation{Exceptions: map[privacy.Rule]bool{privacy.Calls: true}}, false, true},
		{`{"calls":"all"}`, privacy.Relation{Exceptions: map[privacy.Rule]bool{privacy.Calls: false}}, false, false},
		{`{"calls":"all"}`, privacy.Relation{Blocked: true}, false, false},
		{`{"calls":"all"}`, privacy.Relation{}, true, false},
		{`{broken`, privacy.Relation{}, false, false},
	} {
		c := Chat{Type: "private", PeerID: "peer"}
		applyPeerPrivacy(&c, privacy.Pair{Owner: privacy.Parse([]byte(tc.raw)), OwnerToViewer: tc.relation, ViewerToOwner: privacy.Relation{Blocked: tc.ownBlock}}, peerPrivacyNow)
		require.Equal(t, tc.want, c.CanCall)
	}
}
