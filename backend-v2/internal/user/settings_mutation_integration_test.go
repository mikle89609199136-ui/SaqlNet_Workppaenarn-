//go:build integration

package user

import (
	"context"
	"database/sql"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSettingsMutationMergesTheLockedCurrentState(t *testing.T) {
	api := newSettingsAPI(t)
	svc := NewService(api.db)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, svc.ensureSettings(ctx, settingsOwner))
	bulk := func(patch AllSettings) func(context.Context) error {
		return func(ctx context.Context) error { return svc.UpdateAllSettings(ctx, settingsOwner, patch) }
	}
	preference := func(column string, patch map[string]any) func(context.Context) error {
		return func(ctx context.Context) error {
			_, err := svc.UpdatePreference(ctx, settingsOwner, column, patch)
			return err
		}
	}
	for _, tc := range []struct {
		name   string
		first  string
		second func(context.Context) error
		want   map[string]any
	}{
		{"bulk/canonical disjoint keys", `settings = settings || '{"language":"en"}'`,
			bulk(AllSettings{Settings: map[string]any{"theme": "light"}}),
			map[string]any{"settings": map[string]any{"theme": "light", "language": "en"}}},
		{"bulk/privacy disjoint keys", `privacy_settings = privacy_settings || '{"phoneVisibility":"all"}'`,
			bulk(AllSettings{PrivacySettings: map[string]any{"calls": "nobody"}}),
			map[string]any{"privacySettings": map[string]any{"calls": "nobody", "phoneVisibility": "all"}}},
		{"bulk/legacy disjoint keys", `sound_settings = sound_settings || '{"mediaVolume":17}'`,
			bulk(AllSettings{SoundSettings: map[string]any{"ringtone": "bulk"}}),
			map[string]any{"soundSettings": map[string]any{"mediaVolume": float64(17), "ringtone": "bulk"}}},
		{"legacy/bulk disjoint keys", `sound_settings = sound_settings || '{"ringtone":"first"}'`,
			preference("sound_settings", map[string]any{"mediaVolume": 23}),
			map[string]any{"soundSettings": map[string]any{"mediaVolume": float64(23), "ringtone": "first"}}},
		{"notifications", `notification_settings = notification_settings || '{"groups":false}'`,
			preference("notification_settings", map[string]any{"calls": false}),
			map[string]any{"notificationSettings": map[string]any{"groups": false, "calls": false}}},
		{"storage", `storage_settings = storage_settings || '{"autoDownloadWifi":false}'`,
			preference("storage_settings", map[string]any{"deleteMediaAfter": "week"}),
			map[string]any{"storageSettings": map[string]any{"autoDownloadWifi": false, "deleteMediaAfter": "week"}}},
		{"advanced", `advanced_settings = advanced_settings || '{"saveDrafts":false}'`,
			preference("advanced_settings", map[string]any{"connectionType": "custom"}),
			map[string]any{"advancedSettings": map[string]any{"saveDrafts": false, "connectionType": "custom"}}},
		{"same key last serialized patch wins", `settings = settings || '{"theme":"light"}'`,
			bulk(AllSettings{Settings: map[string]any{"theme": "dark"}}),
			map[string]any{"settings": map[string]any{"theme": "dark"}}},
		{"legacy font patch after canonical size", `settings = settings || '{"textSize":"small"}'`,
			bulk(AllSettings{Settings: map[string]any{"fontSize": "large"}}),
			map[string]any{"settings": map[string]any{"textSize": "large", "fontSize": "large"}}},
		{"folders last serialized replacement wins", `folders = '["first"]'`,
			bulk(AllSettings{Folders: []any{"second"}}), map[string]any{"folders": []any{"second"}}},
		{"folders empty replacement", `folders = '["first"]'`,
			bulk(AllSettings{Folders: []any{}}), map[string]any{"folders": []any{}}},
		{"omitted and empty sections preserve concurrent values", `folders = '["kept"]', sound_settings = '{"mediaVolume":7}'`,
			bulk(AllSettings{Settings: map[string]any{"theme": "light"}, SoundSettings: map[string]any{}}),
			map[string]any{"folders": []any{"kept"}, "soundSettings": map[string]any{"mediaVolume": float64(7)}}},
		{"bulk cannot overwrite parallel passcode", `passcode_enabled = TRUE, passcode_timeout = 123, passcode_hash = 'parallel-hash'`,
			bulk(AllSettings{Settings: map[string]any{"theme": "dark"}, PasscodeTimeout: 999}),
			map[string]any{"passcodeEnabled": true, "passcodeTimeout": float64(123)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx := lockSettings(t, ctx, api.db)
			done := make(chan error, 1)
			go func() { done <- tc.second(ctx) }()
			query := waitForSettingsLock(t, api.db, 1)
			require.Contains(t, query, "FOR UPDATE", "snapshot должен читаться только после получения блокировки")
			_, err := tx.ExecContext(ctx, `UPDATE users.settings SET `+tc.first+` WHERE user_id=$1`, settingsOwner)
			require.NoError(t, err)
			require.NoError(t, tx.Commit())
			require.NoError(t, <-done)
			all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
			for section, want := range tc.want {
				if fields, ok := want.(map[string]any); ok {
					for key, value := range fields {
						require.Equal(t, value, all[section].(map[string]any)[key], section+"."+key)
					}
				} else {
					require.Equal(t, want, all[section], section)
				}
			}
		})
	}
	var hash string
	require.NoError(t, api.db.QueryRow(`SELECT passcode_hash FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&hash))
	require.Equal(t, "parallel-hash", hash)
}

func TestSettingsMutationSerializesWithPublicWriters(t *testing.T) {
	api := newSettingsAPI(t)
	svc := NewService(api.db)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, svc.ensureSettings(ctx, settingsOwner))
	for _, bulkFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "bulk first", false: "section first"}[bulkFirst], func(t *testing.T) {
			_, err := api.db.ExecContext(ctx, `UPDATE users.settings SET settings='{}', privacy_settings='{}', sound_settings='{}' WHERE user_id=$1`, settingsOwner)
			require.NoError(t, err)
			bulk := func() error {
				return svc.UpdateAllSettings(ctx, settingsOwner, AllSettings{
					Settings: map[string]any{"theme": "light"}, PrivacySettings: map[string]any{"calls": "nobody"},
					SoundSettings: map[string]any{"mediaVolume": 31}, Folders: []any{"bulk"},
				})
			}
			section := func() error {
				if _, err := svc.UpdateSettings(ctx, settingsOwner, map[string]any{"language": "en"}); err != nil {
					return err
				}
				if _, err := svc.UpdatePrivacy(ctx, settingsOwner, map[string]any{"phoneVisibility": "all"}); err != nil {
					return err
				}
				if _, err := svc.UpdateStorageSettings(ctx, settingsOwner, map[string]any{"autoDownloadWifi": false}); err != nil {
					return err
				}
				if _, err := svc.UpdatePreference(ctx, settingsOwner, "sound_settings", map[string]any{"ringtone": "section"}); err != nil {
					return err
				}
				if err := svc.UpdateFolders(ctx, settingsOwner, []any{"section"}); err != nil {
					return err
				}
				return svc.UpdatePasscodeTimeout(ctx, settingsOwner, 127)
			}
			first, second := bulk, section
			if !bulkFirst {
				first, second = section, bulk
			}
			tx := lockSettings(t, ctx, api.db)
			one, two := make(chan error, 1), make(chan error, 1)
			go func() { one <- first() }()
			waitForSettingsLock(t, api.db, 1)
			go func() { two <- second() }()
			waitForSettingsLock(t, api.db, 2)
			require.NoError(t, tx.Commit())
			require.NoError(t, <-one)
			require.NoError(t, <-two)
			all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
			require.Equal(t, "light", all["settings"].(map[string]any)["theme"])
			require.Equal(t, "en", all["settings"].(map[string]any)["language"])
			require.Equal(t, "nobody", all["privacySettings"].(map[string]any)["calls"])
			require.Equal(t, "all", all["privacySettings"].(map[string]any)["phoneVisibility"])
			require.Equal(t, float64(31), all["soundSettings"].(map[string]any)["mediaVolume"])
			require.Equal(t, "section", all["soundSettings"].(map[string]any)["ringtone"])
			require.Equal(t, float64(127), all["passcodeTimeout"])
		})
	}
}

func TestSettingsMutationFailureRollsBackRowCreation(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`CREATE FUNCTION fail_settings_update() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected settings update failure'; END $$;
		CREATE TRIGGER fail_settings_update BEFORE UPDATE ON users.settings
		FOR EACH ROW EXECUTE FUNCTION fail_settings_update()`)
	require.NoError(t, err)
	for _, path := range []string{"all-settings", "sounds"} {
		body := `{"ringtone":"new"}`
		if path == "all-settings" {
			body = `{"settings":{"theme":"light"},"soundSettings":{"ringtone":"new"},"folders":[]}`
		}
		payload := api.request(t, http.MethodPut, path, body, http.StatusInternalServerError)
		require.Equal(t, "internal_error", payload["code"])
		var count int
		require.NoError(t, api.db.QueryRow(`SELECT count(*) FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&count))
		require.Zero(t, count, "ошибка UPDATE должна откатить создание строки")
	}
}

func TestSettingsMutationCommitFailureIsNotSuccess(t *testing.T) {
	api := newSettingsAPI(t)
	api.request(t, http.MethodPut, "settings", `{"theme":"dark"}`, http.StatusOK)
	before := api.snapshot(t)
	_, err := api.db.Exec(`CREATE FUNCTION fail_settings_commit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected settings commit failure'; END $$;
		CREATE CONSTRAINT TRIGGER fail_settings_commit AFTER UPDATE ON users.settings
		DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_settings_commit()`)
	require.NoError(t, err)
	for path, body := range map[string]string{
		"all-settings": `{"settings":{"theme":"light"},"soundSettings":{"mediaVolume":1}}`,
		"sounds":       `{"mediaVolume":2}`,
	} {
		payload := api.request(t, http.MethodPut, path, body, http.StatusInternalServerError)
		require.Equal(t, "internal_error", payload["code"])
		require.Equal(t, before, api.snapshot(t), "ошибка COMMIT откатывает все sections")
	}
}

func TestSettingsMutationCanceledWhileWaitingForLock(t *testing.T) {
	api := newSettingsAPI(t)
	svc := NewService(api.db)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	require.NoError(t, svc.ensureSettings(ctx, settingsOwner))
	before := api.snapshot(t)
	tx := lockSettings(t, context.Background(), api.db)
	done := make(chan error, 1)
	go func() {
		done <- svc.UpdateAllSettings(ctx, settingsOwner, AllSettings{Settings: map[string]any{"theme": "light"}})
	}()
	waitForSettingsLock(t, api.db, 1)
	cancel()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("отмена запроса не прервала ожидание блокировки")
	}
	require.NoError(t, tx.Commit())
	require.Equal(t, before, api.snapshot(t))
	// Отменённая транзакция не оставляет соединение/блокировку у следующей записи.
	_, err := svc.UpdatePreference(context.Background(), settingsOwner, "sound_settings", map[string]any{"mediaVolume": 9})
	require.NoError(t, err)
}

func TestSettingsMutationPreservesUnrelatedCorruptFolders(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings(user_id, folders) VALUES ($1, '{"old":"invalid"}')`, settingsOwner)
	require.NoError(t, err)
	api.request(t, http.MethodPut, "sounds", `{"mediaVolume":19}`, http.StatusOK)
	api.request(t, http.MethodPut, "all-settings", `{"settings":{"theme":"light"},"folders":null}`, http.StatusOK)
	var folders string
	require.NoError(t, api.db.QueryRow(`SELECT folders::text FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&folders))
	require.JSONEq(t, `{"old":"invalid"}`, folders)
	api.request(t, http.MethodPut, "all-settings", `{"folders":[]}`, http.StatusOK)
	require.Empty(t, api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)["folders"])
}

func lockSettings(t *testing.T, ctx context.Context, db *sql.DB) *sql.Tx {
	t.Helper()
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	var id string
	require.NoError(t, tx.QueryRowContext(ctx, `SELECT user_id FROM users.settings WHERE user_id=$1 FOR UPDATE`, settingsOwner).Scan(&id))
	return tx
}

// PostgreSQL сам подтверждает, что writers дошли до блокировки. Порядок не
// зависит от Sleep/скорости goroutine: первая транзакция отпускается лишь затем.
func waitForSettingsLock(t *testing.T, db *sql.DB, count int) string {
	t.Helper()
	var query string
	require.Eventually(t, func() bool {
		var waiting int
		err := db.QueryRow(`SELECT count(*), COALESCE(min(query), '') FROM pg_stat_activity
			WHERE datname=current_database() AND pid<>pg_backend_pid()
			AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%users.settings%'`).Scan(&waiting, &query)
		return err == nil && waiting >= count
	}, 5*time.Second, 10*time.Millisecond, "writer не дошёл до блокировки строки")
	return query
}
