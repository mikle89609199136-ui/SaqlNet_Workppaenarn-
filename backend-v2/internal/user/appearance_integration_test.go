//go:build integration

package user

import (
	"encoding/json"
	"maps"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAppearanceIndividualPatchesPreserveOtherSettings(t *testing.T) {
	api := newSettingsAPI(t)
	api.request(t, http.MethodPut, "all-settings", `{
		"settings":{"theme":"light","language":"en","notifications":false,"sounds":false,
		"callSounds":false,"accentColor":"#123abc","fontSize":"small"},
		"privacySettings":{"calls":"nobody"},"soundSettings":{"mediaVolume":0},"folders":["kept"]
	}`, http.StatusOK)
	var untouched string
	require.NoError(t, api.db.QueryRow(`SELECT (to_jsonb(s)-'settings'-'updated_at')::text
		FROM users.settings s WHERE user_id=$1`, settingsOwner).Scan(&untouched))
	for _, path := range []string{"settings", "all-settings"} {
		for key, values := range map[string][]any{
			"theme": {"system", "dark", "light"}, "palette": {"warm", "midnight", "graphite"},
			"accentPreset": {"teal", "plum", "orchid", "indigo", "amber", "violet"},
			"textSize":     {"large", "medium", "small"}, "chatDensity": {"large", "compact", "normal"},
			"avatarShape": {"grid", "letter"}, "showMessageTime": {false, true},
			"showMessageStatus": {false, true}, "showMessageAvatars": {false, true},
			"groupConsecutiveMessages": {false, true},
		} {
			for _, value := range values {
				t.Run(path+"/"+key+"/"+appearanceJSON(t, value), func(t *testing.T) {
					before := api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)
					expected := maps.Clone(before)
					expected[key] = value
					var body any = map[string]any{key: value}
					if path == "all-settings" {
						body = map[string]any{"settings": body}
					}
					response := api.request(t, http.MethodPut, path, appearanceJSON(t, body), http.StatusOK)
					if path == "settings" {
						require.Equal(t, expected, response["settings"])
					}
					canonical := api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"]
					require.Equal(t, expected, canonical, "patch одного поля сохраняет все соседние значения")
					legacy := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)["settings"].(map[string]any)
					require.Equal(t, expected["textSize"], legacy["fontSize"])
					require.Equal(t, "#123abc", legacy["accentColor"])
					delete(legacy, "fontSize")
					delete(legacy, "accentColor")
					require.Equal(t, canonical, legacy)
				})
			}
		}
	}
	var after string
	require.NoError(t, api.db.QueryRow(`SELECT (to_jsonb(s)-'settings'-'updated_at')::text
		FROM users.settings s WHERE user_id=$1`, settingsOwner).Scan(&after))
	require.JSONEq(t, untouched, after, "privacy, legacy sections, folders и passcode не меняются")
}

func TestAppearanceLegacyReadsPreserveChoiceWithoutBackfill(t *testing.T) {
	api := newSettingsAPI(t)
	for _, tc := range []struct {
		name, raw, size string
	}{
		{"legacy size", `{"fontSize":"large"}`, "large"},
		{"canonical wins", `{"fontSize":"large","textSize":"small"}`, "small"},
		{"invalid canonical falls back to legacy", `{"fontSize":"large","textSize":"bad"}`, "large"},
		{"invalid legacy", `{"fontSize":12}`, "medium"},
		{"missing size", `{}`, "medium"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := api.db.Exec(`INSERT INTO users.settings(user_id, settings)
				VALUES ($1, '{"theme":"light","language":"en","avatarShape":"grid","notifications":false,
				"sounds":false,"accentColor":"#FF007F"}'::jsonb || $2::jsonb)
				ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings`, settingsOwner, tc.raw)
			require.NoError(t, err)
			before := api.snapshot(t)
			canonical := api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)
			require.Equal(t, tc.size, canonical["textSize"])
			require.Equal(t, "light", canonical["theme"])
			require.Equal(t, "en", canonical["language"])
			require.Equal(t, "grid", canonical["avatarShape"])
			require.Equal(t, false, canonical["notifications"])
			require.Equal(t, false, canonical["sounds"])
			require.Equal(t, "violet", canonical["accentPreset"])
			require.NotContains(t, canonical, "fontSize")
			require.NotContains(t, canonical, "accentColor")
			for _, path := range []string{"all-settings", "export"} {
				legacy := api.request(t, http.MethodGet, path, "", http.StatusOK)["settings"].(map[string]any)
				require.Equal(t, tc.size, legacy["textSize"])
				require.Equal(t, tc.size, legacy["fontSize"])
				require.Equal(t, "#FF007F", legacy["accentColor"])
			}
			require.Equal(t, before, api.snapshot(t), "GET не переписывает legacy data")
		})
	}
	// Unrelated canonical и bulk patches не превращают read projection в backfill.
	_, err := api.db.Exec(`UPDATE users.settings SET settings='{"fontSize":"large","accentColor":"#FF007F"}' WHERE user_id=$1`, settingsOwner)
	require.NoError(t, err)
	api.request(t, http.MethodPut, "settings", `{"palette":"warm"}`, http.StatusOK)
	api.request(t, http.MethodPut, "all-settings", `{"settings":{"theme":"system"}}`, http.StatusOK)
	var hasTextSize, hasSounds, hasCallSounds bool
	require.NoError(t, api.db.QueryRow(`SELECT settings ? 'textSize', settings ? 'sounds', settings ? 'callSounds'
		FROM users.settings WHERE user_id=$1`, settingsOwner).Scan(&hasTextSize, &hasSounds, &hasCallSounds))
	require.False(t, hasTextSize)
	require.False(t, hasSounds)
	require.False(t, hasCallSounds)
	require.Equal(t, "large", api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)["textSize"])
}

func TestAppearanceLegacyWritesRespectPatchPriority(t *testing.T) {
	api := newSettingsAPI(t)
	for _, tc := range []struct{ path, body, size string }{
		{"all-settings", `{"settings":{"fontSize":"small"}}`, "small"},
		{"settings", `{"textSize":"large"}`, "large"},
		{"all-settings", `{"settings":{"fontSize":"medium"}}`, "medium"},
		{"all-settings", `{"settings":{"fontSize":"small","textSize":"large"}}`, "large"},
	} {
		api.request(t, http.MethodPut, tc.path, tc.body, http.StatusOK)
		require.Equal(t, tc.size, api.request(t, http.MethodGet, "settings", "", http.StatusOK)["settings"].(map[string]any)["textSize"])
		legacy := api.request(t, http.MethodGet, "all-settings", "", http.StatusOK)["settings"].(map[string]any)
		require.Equal(t, tc.size, legacy["fontSize"])
		require.Equal(t, tc.size, legacy["textSize"])
	}
	before := api.snapshot(t)
	for _, invalid := range []string{
		`{"settings":{"fontSize":null,"textSize":"large"},"privacySettings":{"calls":"nobody"}}`,
		`{"settings":{"fontSize":"bad","textSize":"large"}}`,
		`{"settings":{"fontSize":"small","textSize":"bad"}}`,
		`{"settings":{"fontSize":"small","accentColor":"invalid"}}`,
	} {
		payload := api.request(t, http.MethodPut, "all-settings", invalid, http.StatusBadRequest)
		require.Equal(t, "validation_failed", payload["code"])
		require.Equal(t, before, api.snapshot(t), "проигравшие aliases тоже проходят validation")
	}
}

func appearanceJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return string(data)
}
