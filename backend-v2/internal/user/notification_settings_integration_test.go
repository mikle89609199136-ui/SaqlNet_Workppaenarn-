//go:build integration

package user

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"testing"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/notificationpolicy"
	migrationsql "craneapp/backend-v2/migrations"
	"github.com/stretchr/testify/require"
)

func applyNotificationMigration(t *testing.T, api settingsAPI) {
	t.Helper()
	data, err := fs.ReadFile(migrationsql.FS, "0042_notification_settings_model.sql")
	require.NoError(t, err)
	_, err = api.db.Exec(string(data))
	require.NoError(t, err)
}

func TestNotificationMigrationPriorityReplayAndRollback(t *testing.T) {
	api := newSettingsAPI(t)
	for i, tc := range []struct {
		settings, sounds string
		want             notificationpolicy.Flags
	}{
		{`{}`, `{}`, notificationpolicy.Flags{Notifications: true, Sounds: true, CallSounds: true}},
		{`{"sounds":false,"callSounds":true}`, `{"messagesSound":true,"notificationsSound":true,"callsSound":false}`, notificationpolicy.Flags{Notifications: true, Sounds: false, CallSounds: true}},
		{`{"notifications":false,"sounds":true,"callSounds":false}`, `{"messagesSound":false,"notificationsSound":false,"callsSound":true}`, notificationpolicy.Flags{Notifications: false, Sounds: true, CallSounds: false}},
		{`{}`, `{"messagesSound":false}`, notificationpolicy.Flags{Notifications: true, Sounds: false, CallSounds: true}},
		{`{}`, `{"messagesSound":true,"notificationsSound":false}`, notificationpolicy.Flags{Notifications: true, Sounds: false, CallSounds: true}},
		{`{}`, `{"messagesSound":true,"notificationsSound":true}`, notificationpolicy.Flags{Notifications: true, Sounds: true, CallSounds: true}},
		{`{}`, `{"callsSound":false}`, notificationpolicy.Flags{Notifications: true, Sounds: true, CallSounds: false}},
		{`{"notifications":null,"sounds":"true","callSounds":1}`, `{"messagesSound":true,"callsSound":true}`, notificationpolicy.Flags{}},
		{`{}`, `{"messagesSound":"false","callsSound":null}`, notificationpolicy.Flags{Notifications: true, Sounds: false, CallSounds: false}},
		{`[]`, `{"messagesSound":true}`, notificationpolicy.Flags{}},
		{`{}`, `null`, notificationpolicy.Flags{Notifications: true, Sounds: false, CallSounds: false}},
		{`{"sounds":true,"callSounds":true}`, `null`, notificationpolicy.Flags{Notifications: true, Sounds: true, CallSounds: true}},
	} {
		t.Run(fmt.Sprintf("case_%d", i), func(t *testing.T) {
			id := fmt.Sprintf("10420000-0000-4000-8000-%012d", i+1)
			dbtest.User(t, api.db, id, fmt.Sprintf("notification_migration_%d", i))
			_, err := api.db.Exec(`INSERT INTO users.settings(user_id,settings,sound_settings,notification_model_version,
				notification_settings,privacy_settings,folders) VALUES($1,$2,$3,0,'{"privateChats":false}',
				'{"calls":"nobody"}','["kept"]')`, id, tc.settings, tc.sounds)
			require.NoError(t, err)
			var untouched string
			require.NoError(t, api.db.QueryRow(`SELECT (to_jsonb(s)-'settings'-'notification_model_version')::text
				FROM users.settings s WHERE user_id=$1`, id).Scan(&untouched))
			applyNotificationMigration(t, api)
			var raw, backupSettings, backupSounds []byte
			var version int
			require.NoError(t, api.db.QueryRow(`SELECT settings,notification_model_version FROM users.settings WHERE user_id=$1`, id).Scan(&raw, &version))
			require.Equal(t, 1, version)
			require.Equal(t, tc.want, notificationpolicy.Read(raw))
			require.NoError(t, api.db.QueryRow(`SELECT settings,sound_settings FROM users.notification_settings_backup_v1
				WHERE user_id=$1`, id).Scan(&backupSettings, &backupSounds))
			require.JSONEq(t, tc.settings, string(backupSettings))
			require.JSONEq(t, tc.sounds, string(backupSounds))
			var after string
			require.NoError(t, api.db.QueryRow(`SELECT (to_jsonb(s)-'settings'-'notification_model_version')::text
				FROM users.settings s WHERE user_id=$1`, id).Scan(&after))
			require.JSONEq(t, untouched, after)
			// Пользователь переопределил старый false: replay не применяет aliases снова.
			_, err = NewService(api.db).UpdateSettings(context.Background(), id, map[string]any{"sounds": true})
			require.NoError(t, err)
			applyNotificationMigration(t, api)
			require.NoError(t, api.db.QueryRow(`SELECT settings FROM users.settings WHERE user_id=$1`, id).Scan(&raw))
			require.True(t, notificationpolicy.Read(raw).Sounds)
			// Rollback snapshot действительно восстанавливает исходные JSON; проверка
			// в отдельной транзакции, без отката пользовательского состояния теста.
			tx, err := api.db.Begin()
			require.NoError(t, err)
			defer func() { _ = tx.Rollback() }()
			_, err = tx.Exec(`UPDATE users.settings s SET settings=b.settings,sound_settings=b.sound_settings,
				notification_model_version=0 FROM users.notification_settings_backup_v1 b
				WHERE s.user_id=b.user_id AND s.user_id=$1`, id)
			require.NoError(t, err)
			require.NoError(t, tx.QueryRow(`SELECT settings,sound_settings FROM users.settings WHERE user_id=$1`, id).Scan(&raw, &backupSounds))
			require.JSONEq(t, tc.settings, string(raw))
			require.JSONEq(t, tc.sounds, string(backupSounds))
			_, err = tx.Exec(`DELETE FROM users.notification_settings_backup_v1 WHERE user_id=$1`, id)
			require.NoError(t, err)
			var snapshots int
			require.NoError(t, tx.QueryRow(`SELECT count(*) FROM users.notification_settings_backup_v1 WHERE user_id=$1`, id).Scan(&snapshots))
			require.Zero(t, snapshots, "повторный rollout сможет сохранить свежий snapshot")
			require.NoError(t, tx.Rollback())
		})
	}
}

func TestNotificationAliasesAcrossHTTPReadersAndWriters(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings(user_id,settings,sound_settings,notification_model_version)
		VALUES($1,'{"theme":"light","language":"en"}',
		'{"messagesSound":false,"callsSound":true,"mediaVolume":0,"ringtone":"old"}',0)`, settingsOwner)
	require.NoError(t, err)
	applyNotificationMigration(t, api)
	assertFlags := func(n, s, c bool) {
		t.Helper()
		before := api.snapshot(t)
		canonical := api.request(t, "GET", "settings", "", 200)["settings"].(map[string]any)
		for key, want := range (notificationpolicy.Flags{Notifications: n, Sounds: s, CallSounds: c}).Map() {
			require.Equal(t, want, canonical[key])
		}
		require.Equal(t, "light", canonical["theme"])
		require.Equal(t, "en", canonical["language"])
		all := api.request(t, "GET", "all-settings", "", 200)
		sound := api.request(t, "GET", "sounds", "", 200)["settings"].(map[string]any)
		require.Equal(t, all["soundSettings"], sound)
		require.Equal(t, s, sound["messagesSound"])
		require.Equal(t, s, sound["notificationsSound"])
		require.Equal(t, c, sound["callsSound"])
		require.Equal(t, float64(0), sound["mediaVolume"])
		require.Equal(t, "old", sound["ringtone"])
		exported := api.request(t, "GET", "export", "", 200)["settings"].(map[string]any)
		require.Equal(t, s, exported["sounds"])
		require.NotContains(t, canonical, "notification_model_version")
		require.Equal(t, before, api.snapshot(t), "GET не повторяет миграцию/не обновляет marker")
	}
	assertFlags(true, false, true)
	for _, tc := range []struct {
		path, body string
		n, s, c    bool
	}{
		{"sounds", `{"messagesSound":true}`, true, true, true},
		{"sounds", `{"notificationsSound":false}`, true, false, true},
		{"sounds", `{"callsSound":false}`, true, false, false},
		{"settings", `{"sounds":true}`, true, true, false},
		{"settings", `{"notifications":false}`, false, true, false},
		{"notifications", `{"inAppNotifications":false,"privateChats":false}`, false, true, false},
		{"settings", `{"notifications":true}`, true, true, false},
		{"all-settings", `{"settings":{"sounds":false,"callSounds":true},"soundSettings":{"messagesSound":true,"notificationsSound":false,"callsSound":false}}`, true, false, true},
	} {
		response := api.request(t, "PUT", tc.path, tc.body, 200)
		if tc.path == "sounds" {
			require.Equal(t, tc.s, response["settings"].(map[string]any)["messagesSound"])
			require.Equal(t, tc.c, response["settings"].(map[string]any)["callsSound"])
		}
		assertFlags(tc.n, tc.s, tc.c)
	}
	before := api.snapshot(t)
	for path, body := range map[string]string{
		"sounds": `{"messagesSound":true,"notificationsSound":false,"mediaVolume":99}`,
		"all-settings": `{"settings":{"theme":"dark"},"privacySettings":{"calls":"nobody"},
		"soundSettings":{"messagesSound":true,"notificationsSound":false},"folders":[]}`,
	} {
		payload := api.request(t, "PUT", path, body, 400)
		require.Equal(t, "validation_failed", payload["code"])
		require.Equal(t, before, api.snapshot(t))
	}
	// Ошибка compatibility части не должна сохранить canonical alias patch.
	_, err = api.db.Exec(`ALTER TABLE users.settings ADD CONSTRAINT fail_sound_alias_test
		CHECK(sound_settings->>'ringtone' IS DISTINCT FROM 'db_failure')`)
	require.NoError(t, err)
	api.request(t, http.MethodPut, "sounds", `{"messagesSound":true,"ringtone":"db_failure"}`, 500)
	require.Equal(t, before, api.snapshot(t))
	// Оригинальные конфликтующие aliases остаются доступны для rollback, а не
	// перезаписываются проекцией; internal marker не является writable key.
	var raw []byte
	require.NoError(t, api.db.QueryRow(`SELECT sound_settings FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&raw))
	var original map[string]any
	require.NoError(t, json.Unmarshal(raw, &original))
	require.Equal(t, false, original["messagesSound"])
	require.NotContains(t, original, "notificationsSound")
}

func TestNotificationMigrationFailureRollsBackSnapshotAndMarker(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings(user_id,settings,notification_model_version)
		VALUES($1,'{}',0)`, settingsOwner)
	require.NoError(t, err)
	_, err = api.db.Exec(`ALTER TABLE users.settings ADD CONSTRAINT fail_notification_migration_test CHECK(NOT(settings ? 'sounds'))`)
	require.NoError(t, err)
	before := api.snapshot(t)
	data, err := fs.ReadFile(migrationsql.FS, "0042_notification_settings_model.sql")
	require.NoError(t, err)
	_, err = api.db.Exec(string(data))
	require.Error(t, err)
	require.Equal(t, before, api.snapshot(t))
	var backups int
	require.NoError(t, api.db.QueryRow(`SELECT count(*) FROM users.notification_settings_backup_v1 WHERE user_id=$1`, settingsOwner).Scan(&backups))
	require.Zero(t, backups)
}
