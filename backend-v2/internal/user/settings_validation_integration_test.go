//go:build integration

package user

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

const settingsOwner = "73000000-0000-4000-8000-000000000001"

type settingsAPI struct {
	db     *sql.DB
	server *httptest.Server
}

func newSettingsAPI(t *testing.T) settingsAPI {
	t.Helper()
	db := dbtest.Postgres(t)
	dbtest.User(t, db, settingsOwner, "settings_owner")
	h := NewHandler(NewService(db), nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/users/settings", h.Settings)
	mux.HandleFunc("/api/v2/users/all-settings", h.AllSettings)
	mux.HandleFunc("/api/v2/users/notifications", h.Preference)
	mux.HandleFunc("/api/v2/users/sounds", h.Preference)
	mux.HandleFunc("/api/v2/users/advanced-settings", h.Preference)
	mux.HandleFunc("/api/v2/users/storage", h.Storage)
	mux.HandleFunc("/api/v2/users/storage/settings", h.Storage)
	mux.HandleFunc("/api/v2/users/export", h.Export)
	// Auth middleware уже проверяется отдельно; здесь HTTP → handler → настоящий
	// PostgreSQL с полными миграциями, с фиксированным владельцем сессии.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: settingsOwner}))
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	return settingsAPI{db: db, server: server}
}

func (api settingsAPI) request(t *testing.T, method, path, body string, status int) map[string]any {
	t.Helper()
	req, err := http.NewRequest(method, api.server.URL+"/api/v2/users/"+path, bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := api.server.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, status, res.StatusCode, string(data))
	var payload map[string]any
	require.NoError(t, json.Unmarshal(data, &payload))
	return payload
}

func (api settingsAPI) snapshot(t *testing.T) string {
	t.Helper()
	var raw string
	require.NoError(t, api.db.QueryRow(`SELECT to_jsonb(s)::text FROM users.settings s WHERE user_id = $1`, settingsOwner).Scan(&raw))
	return raw
}

func TestSettingsValidationHTTPRoundTripOnRealSchema(t *testing.T) {
	api := newSettingsAPI(t)
	for path, section := range map[string]string{
		"settings": "settings", "notifications": "notification_settings", "sounds": "sound_settings",
		"storage/settings": "storage_settings", "advanced-settings": "advanced_settings",
	} {
		body := validSettingsPatches[section]
		payload := api.request(t, http.MethodPut, path, body, http.StatusOK)
		var expected map[string]any
		require.NoError(t, json.Unmarshal([]byte(body), &expected))
		require.Equal(t, expected, payload["settings"], path)
		if path != "settings" {
			require.Equal(t, true, payload["success"])
		}
	}
	api.request(t, http.MethodPut, "all-settings", `{
		"settings":{"theme":"light","accentColor":"#123abc","fontSize":"large"},
		"privacySettings":{"calls":"contacts"},"soundSettings":{"mediaVolume":0},
		"folders":[{"name":"Старые","chatIds":[]},null,1],"passcodeEnabled":true,"passcodeTimeout":0
	}`, http.StatusOK)
	all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
	settings := all["settings"].(map[string]any)
	require.Equal(t, "light", settings["theme"])
	require.Equal(t, "#123abc", settings["accentColor"])
	require.Equal(t, false, settings["callSounds"])
	require.Equal(t, "nobody", all["privacySettings"].(map[string]any)["calls"])
	require.Equal(t, float64(0), all["soundSettings"].(map[string]any)["mediaVolume"])
	require.Len(t, all["folders"], 3)
	require.Equal(t, false, all["passcodeEnabled"])
	require.Equal(t, float64(60), all["passcodeTimeout"])
	canonical := api.request(t, http.MethodGet, "settings", "", http.StatusOK)
	require.NotContains(t, canonical["settings"], "accentColor")
	require.NotContains(t, canonical["settings"], "fontSize")
	exported := api.request(t, http.MethodGet, "export", "", http.StatusOK)
	require.Equal(t, "#123abc", exported["settings"].(map[string]any)["accentColor"])
	require.Equal(t, "large", exported["settings"].(map[string]any)["fontSize"])
	// Partial update сохраняет соседние flags и поля — в том числе false/0.
	api.request(t, http.MethodPut, "settings", `{"theme":"dark"}`, http.StatusOK)
	read := api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, false, read["notifications"])
	require.Equal(t, false, read["sounds"])
	require.Equal(t, "warm", read["palette"])
	api.request(t, http.MethodPut, "sounds", `{"notificationsVolume":100}`, http.StatusOK)
	sound := api.request(t, http.MethodGet, "sounds", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, float64(0), sound["mediaVolume"])
	require.Equal(t, false, sound["messagesSound"])
	api.request(t, http.MethodPut, "all-settings", `{"folders":null}`, http.StatusOK)
	require.Len(t, api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)["folders"], 3)
	api.request(t, http.MethodPut, "all-settings", `{"folders":[]}`, http.StatusOK)
	require.Empty(t, api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)["folders"])
}

func TestInvalidSettingsHaveNoDatabaseSideEffects(t *testing.T) {
	api := newSettingsAPI(t)
	for path, body := range map[string]string{
		"settings":          `{"theme":"dark","notifications":null}`,
		"notifications":     `{"privateChats":true,"calls":"all"}`,
		"sounds":            `{"messagesSound":true,"mediaVolume":100.5}`,
		"storage/settings":  `{"autoDownloadWifi":true,"unknown":true}`,
		"advanced-settings": `{"developerMode":true,"analytics":0}`,
		"all-settings":      `{"settings":{"theme":"light"},"soundSettings":{"mediaVolume":101},"folders":[]}`,
	} {
		payload := api.request(t, http.MethodPut, path, body, http.StatusBadRequest)
		require.Equal(t, "validation_failed", payload["code"])
	}
	var count int
	require.NoError(t, api.db.QueryRow(`SELECT COUNT(*) FROM users.settings WHERE user_id = $1`, settingsOwner).Scan(&count))
	require.Zero(t, count, "невалидный запрос не создаёт даже строку defaults")
	api.request(t, http.MethodPut, "settings", `{"theme":"dark"}`, http.StatusOK)
	before := api.snapshot(t)
	for _, body := range []string{
		`{"settings":{"theme":"light"},"notificationSettings":{"calls":null}}`,
		`{"settings":{"theme":"light"},"soundSettings":{"mediaVolume":-1}}`,
		`{"settings":{"theme":"light"},"storageSettings":{"autoDownloadWifi":"true"}}`,
		`{"settings":{"theme":"light"},"advancedSettings":{"developerMode":[]}}`,
		`{"settings":{"theme":"light"},"privacySettings":{"lastSeen":"friends"}}`,
		`{"settings":{"theme":"light"},"passcodeEnabled":null}`, `{"settings":null,"unknown":{}}`,
	} {
		api.request(t, http.MethodPut, "all-settings", body, http.StatusBadRequest)
		require.Equal(t, before, api.snapshot(t), body)
	}
}

func TestSettingsNormalizeCorruptRowsWithoutReadWrites(t *testing.T) {
	api := newSettingsAPI(t)
	_, err := api.db.Exec(`INSERT INTO users.settings
		(user_id, settings, notification_settings, sound_settings, storage_settings, advanced_settings)
		VALUES ($1, '{"theme":"bad","palette":"warm","notifications":"false","sounds":null,"unknown":1}',
		'[]', 'null', '{"autoDownloadWifi":"yes","deleteMediaAfter":"never"}', 'true')`, settingsOwner)
	require.NoError(t, err)
	before := api.snapshot(t)
	settings := api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, "warm", settings["palette"])
	require.Equal(t, false, settings["notifications"])
	require.Equal(t, false, settings["sounds"])
	require.Equal(t, "dark", settings["theme"])
	require.Equal(t, "letter", settings["avatarShape"])
	require.NotContains(t, settings, "unknown")
	all := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)
	for _, key := range []string{"notificationSettings", "soundSettings", "advancedSettings"} {
		for _, value := range all[key].(map[string]any) {
			require.NotEqual(t, true, value)
		}
	}
	storage := api.request(t, http.MethodGet, "storage", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, false, storage["autoDownloadWifi"])
	require.Equal(t, "never", storage["deleteMediaAfter"])
	api.request(t, http.MethodGet, "notifications", "", http.StatusOK)
	api.request(t, http.MethodGet, "sounds", "", http.StatusOK)
	api.request(t, http.MethodGet, "advanced-settings", "", http.StatusOK)
	require.Equal(t, before, api.snapshot(t), "нормализация GET не переписывает данные")
	for _, body := range []string{`{}`, `{"soundSettings":null}`, `{"notificationSettings":{},"folders":null}`, `{"passcodeTimeout":90}`} {
		api.request(t, http.MethodPut, "all-settings", body, http.StatusOK)
		require.Equal(t, before, api.snapshot(t))
	}
	// Изменение settings не должно затронуть даже повреждённый omitted section.
	api.request(t, http.MethodPut, "all-settings", `{"settings":{"theme":"light"},"soundSettings":{}}`, http.StatusOK)
	var rawSounds, rawNotifications string
	require.NoError(t, api.db.QueryRow(`SELECT sound_settings::text, notification_settings::text FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&rawSounds, &rawNotifications))
	require.Equal(t, "null", rawSounds)
	require.Equal(t, "[]", rawNotifications)
	api.request(t, http.MethodPut, "sounds", `{"mediaVolume":50}`, http.StatusOK)
	sounds := api.request(t, http.MethodGet, "sounds", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, float64(50), sounds["mediaVolume"])
	require.Equal(t, false, sounds["messagesSound"])
	// Повреждение корня JSONB не должно превратить SQL object merge в array append.
	_, err = api.db.Exec(`UPDATE users.settings SET settings='[]' WHERE user_id=$1`, settingsOwner)
	require.NoError(t, err)
	api.request(t, http.MethodPut, "settings", `{"theme":"light"}`, http.StatusOK)
	settings = api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)
	require.Equal(t, "light", settings["theme"])
	require.Equal(t, false, settings["notifications"])
}

func TestBulkDatabaseFailureDoesNotPartiallyUpdateSections(t *testing.T) {
	api := newSettingsAPI(t)
	api.request(t, http.MethodPut, "settings", `{"theme":"dark"}`, http.StatusOK)
	_, err := api.db.Exec(`ALTER TABLE users.settings ADD CONSTRAINT settings_test_storage_failure
		CHECK (storage_settings->>'deleteMediaAfter' IS DISTINCT FROM 'db_failure')`)
	require.NoError(t, err)
	before := api.snapshot(t)
	payload := api.request(t, http.MethodPut, "all-settings", `{
		"settings":{"theme":"light"},"storageSettings":{"deleteMediaAfter":"db_failure"},"folders":[]
	}`, http.StatusInternalServerError)
	require.Equal(t, "internal_error", payload["code"])
	require.Equal(t, before, api.snapshot(t))
}
