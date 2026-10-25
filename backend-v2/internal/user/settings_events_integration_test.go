//go:build integration

package user

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/settingsevent"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestSettingsInvalidationsAreCommittedAndCoverEveryWriter(t *testing.T) {
	db, url := dbtest.PostgresURL(t)
	dbtest.User(t, db, settingsOwner, "settings_event_owner")
	ctx := context.Background()
	svc := NewService(db)
	require.NoError(t, svc.ensureSettings(ctx, settingsOwner))
	listener := pq.NewListener(url, time.Millisecond*10, time.Second, nil)
	t.Cleanup(func() { _ = listener.Close() })
	require.NoError(t, listener.Listen(settingsevent.Channel))
	noEvent := func() {
		t.Helper()
		select {
		case event := <-listener.Notify:
			t.Fatalf("unexpected event: %+v", event)
		case <-time.After(100 * time.Millisecond):
		}
	}
	wantEvent := func() {
		t.Helper()
		select {
		case event := <-listener.Notify:
			require.NotNil(t, event)
			var payload map[string]any
			require.NoError(t, json.Unmarshal([]byte(event.Extra), &payload))
			require.Equal(t, map[string]any{"userId": settingsOwner, "version": float64(1)}, payload)
		case <-time.After(3 * time.Second):
			t.Fatal("committed update emitted no invalidation")
		}
	}
	// Uncommitted and rolled-back writes are never visible to LISTEN.
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	_, err = tx.Exec(`UPDATE users.settings SET settings = settings || '{"theme":"light"}' WHERE user_id=$1`, settingsOwner)
	require.NoError(t, err)
	noEvent()
	require.NoError(t, tx.Rollback())
	noEvent()
	for _, write := range []func() error{
		func() error {
			_, err := svc.UpdateSettings(ctx, settingsOwner, map[string]any{"theme": "light"})
			return err
		},
		func() error {
			_, err := svc.UpdatePrivacy(ctx, settingsOwner, map[string]any{"calls": "nobody"})
			return err
		},
		func() error {
			return svc.UpdateAllSettings(ctx, settingsOwner, AllSettings{Settings: map[string]any{"palette": "warm", "textSize": "large"}})
		},
		func() error {
			_, err := svc.UpdatePreference(ctx, settingsOwner, "sound_settings", map[string]any{"messagesSound": false})
			return err
		},
	} {
		require.NoError(t, write())
		wantEvent()
		noEvent()
	}
	_, err = svc.UpdateSettings(ctx, settingsOwner, map[string]any{"theme": "invalid"})
	require.Error(t, err)
	noEvent()
	// Read, no-op, and unrelated device security fields do not generate false updates.
	_, _, err = svc.Settings(ctx, settingsOwner)
	require.NoError(t, err)
	_, err = svc.UpdateSettings(ctx, settingsOwner, map[string]any{"theme": "light"})
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE users.settings SET passcode_timeout=123 WHERE user_id=$1`, settingsOwner)
	require.NoError(t, err)
	noEvent()
}
