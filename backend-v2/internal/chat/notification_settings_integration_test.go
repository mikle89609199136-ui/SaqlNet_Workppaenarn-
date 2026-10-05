//go:build integration

package chat

import (
	"context"
	"testing"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestNotificationSettingsOnRealSchema(t *testing.T) {
	const (
		me       = "56000000-0000-4000-8000-000000000001"
		peer     = "56000000-0000-4000-8000-000000000002"
		outsider = "56000000-0000-4000-8000-000000000003"
	)
	db := dbtest.Postgres(t)
	for id, name := range map[string]string{me: "preview_me", peer: "preview_peer", outsider: "preview_outsider"} {
		dbtest.User(t, db, id, name)
	}
	ctx := context.Background()
	service := NewService(db, nil, nil)
	privateID, _, err := service.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)
	groupID, err := service.CreateGroup(ctx, me, "Preview group", "", "", []string{peer})
	require.NoError(t, err)

	for _, chatID := range []string{privateID, groupID} {
		before, err := service.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.False(t, before.HideNotificationPreview)
		require.ErrorIs(t, service.SetNotificationPreview(ctx, outsider, chatID, true), ErrForbidden)
		require.NoError(t, service.SetFlag(ctx, me, chatID, "pin", true))
		require.NoError(t, service.SetFlag(ctx, me, chatID, "archive", true))
		require.NoError(t, service.SetNotificationPreview(ctx, me, chatID, true))
		require.NoError(t, service.SetNotificationPreview(ctx, me, chatID, true))

		// A new service represents another device reading persistent state.
		otherDevice := NewService(db, nil, nil)
		mine, err := otherDevice.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.True(t, mine.HideNotificationPreview)
		require.True(t, mine.IsPinned)
		require.True(t, mine.IsArchived)
		theirs, err := otherDevice.Get(ctx, peer, chatID)
		require.NoError(t, err)
		require.False(t, theirs.HideNotificationPreview)

		archived, err := otherDevice.List(ctx, me, true)
		require.NoError(t, err)
		found := false
		for _, chat := range archived {
			if chat.ID == chatID {
				found = true
				require.True(t, chat.HideNotificationPreview)
			}
		}
		require.True(t, found)
		require.NoError(t, service.SetNotificationPreview(ctx, me, chatID, false))
		mine, err = otherDevice.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.False(t, mine.HideNotificationPreview)
		require.True(t, mine.IsPinned)
		require.True(t, mine.IsArchived)
	}
}
