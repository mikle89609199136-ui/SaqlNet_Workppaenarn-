//go:build integration

package user

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"testing"
	"time"

	"craneapp/backend-v2/internal/auth"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/settingsdefaults"
	migrationsql "craneapp/backend-v2/migrations"
	"github.com/stretchr/testify/require"
)

type defaultsCrypto struct{}

func (defaultsCrypto) HashPassword(context.Context, string) (string, error)         { return "hash", nil }
func (defaultsCrypto) VerifyPassword(context.Context, string, string) (bool, error) { return true, nil }
func (defaultsCrypto) IssueToken(_ context.Context, _, username string, _ int64) (cryptoclient.IssuedToken, error) {
	return cryptoclient.IssuedToken{Token: "test-token-" + username, ExpiresAt: time.Now().Add(time.Hour)}, nil
}

func TestRegisteredRecoveredAndDatabaseDefaultsAgree(t *testing.T) {
	api := newSettingsAPI(t)
	svc := NewService(api.db)
	ctx := context.Background()
	registered, _, err := auth.NewService(api.db, defaultsCrypto{}).Register(ctx, "registered_defaults", "Password1!", "Имя", "", "")
	require.NoError(t, err)
	api.assertPhysicalDefaults(t, registered.ID)
	before, err := svc.AllSettings(ctx, registered.ID)
	require.NoError(t, err)
	_, err = api.db.Exec(`DELETE FROM users.settings WHERE user_id=$1`, registered.ID)
	require.NoError(t, err)
	recovered, err := svc.AllSettings(ctx, registered.ID)
	require.NoError(t, err)
	require.Equal(t, before, recovered)
	for section := range settingsPatchTypes {
		require.NoError(t, validateSettingsPatch(section, settingsdefaults.Object(section)))
	}
	api.assertPhysicalDefaults(t, registered.ID)
	english, _, err := auth.NewService(api.db, defaultsCrypto{}).Register(ctx, "english_defaults", "Password1!", "Имя", "", "en")
	require.NoError(t, err)
	prefs, _, err := svc.Settings(ctx, english.ID)
	require.NoError(t, err)
	require.Equal(t, "en", prefs["language"])
	require.Equal(t, "letter", prefs["avatarShape"])
}

func TestSparseSettingsDefaultsAgreeAcrossHTTPViews(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings
		(user_id, settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders)
		VALUES ($1, '{}', '{}', '{}', '{}', '{}', '{}', 'null')`, settingsOwner)
	require.NoError(t, err)
	before := api.snapshot(t)
	all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
	canonical := api.request(t, http.MethodGet, "settings", "", http.StatusOK)
	require.Equal(t, settingsdefaults.Object("settings"), canonical["settings"])
	require.Equal(t, settingsdefaults.Object("privacy_settings"), canonical["privacy"])
	require.Equal(t, canonical["settings"], all["settings"])
	require.Equal(t, canonical["privacy"], all["privacySettings"])
	for path, key := range map[string]string{"notifications": "notificationSettings", "sounds": "soundSettings", "advanced-settings": "advancedSettings", "storage": "storageSettings"} {
		section := api.request(t, http.MethodGet, path, "", http.StatusOK)["settings"]
		require.Equal(t, all[key], section, path)
	}
	require.Equal(t, []any{}, all["folders"])
	require.Equal(t, before, api.snapshot(t), "GET не backfill-ит существующую строку")
	// Повторное применение ALTER DEFAULT не обновляет legacy строки.
	sql, err := fs.ReadFile(migrationsql.FS, "0040_settings_defaults.sql")
	require.NoError(t, err)
	_, err = api.db.Exec(string(sql))
	require.NoError(t, err)
	require.Equal(t, before, api.snapshot(t))
}

func TestDefaultProjectionDoesNotPersistMissingFlagsDuringPatches(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings
		(user_id, settings, privacy_settings, sound_settings, storage_settings, advanced_settings)
		VALUES ($1, '{"theme":"light","language":"en","notifications":false}',
		'{"autoDeleteAccount":false,"calls":"nobody"}',
		'{"messagesSound":false,"mediaVolume":0}',
		'{"autoDownloadWifi":false}', '{"analytics":false}')`, settingsOwner)
	require.NoError(t, err)
	all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
	require.Equal(t, "en", all["settings"].(map[string]any)["language"])
	require.Equal(t, "light", all["settings"].(map[string]any)["theme"])
	require.Equal(t, false, all["settings"].(map[string]any)["notifications"])
	require.Equal(t, true, all["settings"].(map[string]any)["callSounds"])
	require.Equal(t, false, all["privacySettings"].(map[string]any)["autoDeleteAccount"])
	require.Equal(t, float64(0), all["soundSettings"].(map[string]any)["mediaVolume"])
	require.Equal(t, false, all["storageSettings"].(map[string]any)["autoDownloadWifi"])
	api.request(t, http.MethodPut, "all-settings", `{"settings":{"theme":"dark"}}`, http.StatusOK)
	api.request(t, http.MethodPut, "sounds", `{"ringtone":"custom"}`, http.StatusOK)
	var hasSounds, hasCallSounds, hasNotificationAlias bool
	require.NoError(t, api.db.QueryRow(`SELECT settings ? 'sounds', settings ? 'callSounds',
		sound_settings ? 'notificationsSound' FROM users.settings WHERE user_id=$1`, settingsOwner).
		Scan(&hasSounds, &hasCallSounds, &hasNotificationAlias))
	require.False(t, hasSounds, "default не должен стать canonical winner для миграции #1042")
	require.False(t, hasCallSounds)
	require.False(t, hasNotificationAlias)
	result := api.request(t, http.MethodGet, "sounds", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, false, result["messagesSound"])
	require.Equal(t, true, result["notificationsSound"])
	require.Equal(t, "custom", result["ringtone"])
	require.Equal(t, float64(0), result["mediaVolume"])
}

func (api settingsAPI) assertPhysicalDefaults(t *testing.T, userID string) {
	t.Helper()
	// Сверяется физическая строка, не только заполненная defaults проекция GET.
	var raw []byte
	require.NoError(t, api.db.QueryRow(`SELECT to_jsonb(s) FROM users.settings s WHERE user_id=$1`, userID).Scan(&raw))
	var stored map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &stored))
	for key, expected := range settingsdefaults.Values() {
		require.JSONEq(t, string(expected), string(stored[key]), key)
	}
}
