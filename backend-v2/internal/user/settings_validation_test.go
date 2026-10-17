package user

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/stretchr/testify/require"
)

var validSettingsPatches = map[string]string{
	"settings":              `{"theme":"system","palette":"warm","accentPreset":"teal","textSize":"large","chatDensity":"compact","showMessageTime":false,"showMessageStatus":false,"showMessageAvatars":false,"groupConsecutiveMessages":false,"avatarShape":"grid","language":"en","notifications":false,"sounds":false,"callSounds":false}`,
	"legacy_settings":       `{"theme":"light","accentColor":"#fF00aA","fontSize":"small"}`,
	"notification_settings": `{"privateChats":false,"groups":false,"channels":false,"calls":false,"videoCalls":false,"inAppNotifications":false,"messagePreview":false,"readReceipts":false,"reactions":false,"newContacts":false}`,
	"sound_settings":        `{"notificationsVolume":0,"mediaVolume":100,"notificationsSound":false,"messagesSound":false,"sendSound":false,"callsSound":false,"vibrateOnCall":false,"notificationSound":"default","messageSound":"legacy-id","ringtone":""}`,
	"storage_settings":      `{"autoDownloadMobile":false,"autoDownloadWifi":false,"autoDownloadRoaming":false,"deleteMediaAfter":"never"}`,
	"advanced_settings":     `{"autoReconnect":false,"fastConnection":false,"connectionType":"auto","dataCompression":false,"saveDrafts":false,"analytics":false,"developerMode":false,"debugLog":false,"hardwareAcceleration":false,"autoplayGifs":false}`,
}

func TestSettingsPatchValidatesEverySection(t *testing.T) {
	for section, data := range validSettingsPatches {
		t.Run(section, func(t *testing.T) {
			var patch map[string]any
			require.NoError(t, json.Unmarshal([]byte(data), &patch))
			require.NoError(t, validateSettingsPatch(section, patch))
			require.NoError(t, validateSettingsPatch(section, map[string]any{}))
			require.ErrorIs(t, validateSettingsPatch(section, nil), ErrInvalidSettings)
			require.ErrorIs(t, validateSettingsPatch(section, map[string]any{"unknown": true}), ErrInvalidSettings)
			for key, valid := range patch {
				t.Run(key, func(t *testing.T) {
					require.NoError(t, validateSettingsPatch(section, map[string]any{key: valid}))
					for _, invalid := range []any{nil, []any{}, map[string]any{}} {
						require.ErrorIs(t, validateSettingsPatch(section, map[string]any{key: invalid}), ErrInvalidSettings)
					}
					var wrong any = true
					if _, boolean := valid.(bool); boolean {
						wrong = "false"
					}
					require.ErrorIs(t, validateSettingsPatch(section, map[string]any{key: wrong}), ErrInvalidSettings)
				})
			}
		})
	}
}

func TestSettingsEnumsRangesAndExactKeys(t *testing.T) {
	for key, allowed := range map[string][]string{
		"theme": {"light", "dark", "system"}, "palette": {"graphite", "midnight", "warm"},
		"accentPreset": {"violet", "plum", "orchid", "indigo", "amber", "teal"},
		"textSize":     {"small", "medium", "large"}, "chatDensity": {"compact", "normal", "large"},
		"avatarShape": {"letter", "grid"}, "language": {"ru", "en"},
	} {
		for _, value := range allowed {
			require.NoError(t, validateSettingsPatch("settings", map[string]any{key: value}))
		}
		for _, value := range []string{"", "unknown", " " + allowed[0], allowed[0] + " "} {
			require.ErrorIs(t, validateSettingsPatch("settings", map[string]any{key: value}), ErrInvalidSettings)
		}
	}
	for _, key := range []string{"Theme", "THEME", "fontSize", "accentColor", "settings", "autoplayGifs", "callsFrom"} {
		require.ErrorIs(t, validateSettingsPatch("settings", map[string]any{key: "light"}), ErrInvalidSettings)
	}
	for _, key := range []string{"notificationsVolume", "mediaVolume"} {
		for _, value := range []any{0, 100, float64(50)} {
			require.NoError(t, validateSettingsPatch("sound_settings", map[string]any{key: value}))
		}
		for _, value := range []any{-1, 101, 0.5, "50", true, json.Number("1e999")} {
			require.ErrorIs(t, validateSettingsPatch("sound_settings", map[string]any{key: value}), ErrInvalidSettings)
		}
	}
	for _, value := range []string{"#abc", "#12345678", "123456", "#gggggg"} {
		require.ErrorIs(t, validateSettingsPatch("legacy_settings", map[string]any{"accentColor": value}), ErrInvalidSettings)
	}
	var absent *bool
	require.ErrorIs(t, validateSettingsPatch("settings", map[string]any{"sounds": absent}), ErrInvalidSettings)
}

func settingsRequest(t *testing.T, handler *Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPut, "/api/v2/users/"+path, bytes.NewBufferString(body))
	r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: "73000000-0000-4000-8000-000000000001"}))
	w := httptest.NewRecorder()
	switch path {
	case "settings":
		handler.Settings(w, r)
	case "all-settings":
		handler.AllSettings(w, r)
	case "storage/settings":
		handler.Storage(w, r)
	default:
		handler.Preference(w, r)
	}
	return w
}

func TestSettingsHandlersRejectInvalidBeforeAnySQL(t *testing.T) {
	// nil DB гарантирует, что даже ensureSettings не вызывается.
	handler := NewHandler(NewService(nil), nil)
	for path, badPatch := range map[string]string{
		"settings": `{"theme":"sepia"}`, "notifications": `{"privateChats":"false"}`,
		"sounds": `{"mediaVolume":101}`, "storage/settings": `{"autoDownloadWifi":0}`,
		"advanced-settings": `{"analytics":null}`,
	} {
		t.Run(path, func(t *testing.T) {
			for _, body := range []string{badPatch, `null`, `[]`, `true`, `1`, `"text"`, `{"unknown":true}`} {
				w := settingsRequest(t, handler, path, body)
				require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
				var payload map[string]any
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &payload))
				require.Equal(t, "validation_failed", payload["code"])
			}
			for _, body := range []string{``, `{`, `{"x":`, `{"x":"` + strings.Repeat("x", 128<<10) + `"}`} {
				w := settingsRequest(t, handler, path, body)
				require.Equal(t, http.StatusBadRequest, w.Code)
				require.Contains(t, w.Body.String(), `"code":"invalid_json"`)
			}
		})
	}
}

func TestBulkValidatesEntireCommandBeforeAnySQL(t *testing.T) {
	handler := NewHandler(NewService(nil), nil)
	for _, body := range []string{
		`null`, `[]`, `"text"`, `{"unknown":{}}`, `{"Settings":{}}`,
		`{"settings":{"theme":"light"},"soundSettings":{"notificationsVolume":-1}}`,
		`{"settings":{"theme":"light"},"notificationSettings":{"calls":null}}`,
		`{"settings":{"theme":"light"},"storageSettings":{"autoDownloadMobile":"yes"}}`,
		`{"settings":{"theme":"light"},"advancedSettings":{"developerMode":1}}`,
		`{"settings":{"theme":"light"},"privacySettings":{"calls":"friends"}}`,
		`{"settings":{"theme":"invalid"},"folders":[]}`,
		`{"settings":true}`, `{"privacySettings":[]}`, `{"notificationSettings":"text"}`,
		`{"soundSettings":1}`, `{"storageSettings":false}`, `{"advancedSettings":[]}`,
		`{"folders":{}}`, `{"folders":"all"}`,
		`{"passcodeEnabled":null}`, `{"passcodeEnabled":"false"}`,
		`{"passcodeTimeout": null }`, `{"passcodeTimeout":false}`, `{"passcodeTimeout":1.5}`,
		`{"settings":{"sounds":false},"soundSettings":{"messagesSound":"false"}}`,
	} {
		w := settingsRequest(t, handler, "all-settings", body)
		require.Equal(t, http.StatusBadRequest, w.Code, body+": "+w.Body.String())
		require.Contains(t, w.Body.String(), `"code":"validation_failed"`)
	}
}

func TestBulkNoopAndReadOnlyFieldsNeedNoSQL(t *testing.T) {
	for _, body := range []string{
		`{}`, `{"settings":null,"privacySettings":{},"soundSettings":null,"folders":null}`,
		`{"settings":{},"notificationSettings":{},"storageSettings":{},"advancedSettings":{}}`,
		`{"passcodeEnabled":true,"passcodeTimeout":-1}`,
	} {
		w := settingsRequest(t, NewHandler(NewService(nil), nil), "all-settings", body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.JSONEq(t, `{"success":true}`, w.Body.String())
	}
}

func TestSettingsServiceCannotBypassValidation(t *testing.T) {
	s := NewService(nil)
	ctx := context.Background()
	_, err := s.UpdateSettings(ctx, "owner", map[string]any{"notifications": 1})
	require.ErrorIs(t, err, ErrInvalidSettings)
	for _, column := range []string{"notification_settings", "sound_settings", "storage_settings", "advanced_settings", "unknown"} {
		_, err := s.UpdatePreference(ctx, "owner", column, map[string]any{"unknown": true})
		require.ErrorIs(t, err, ErrInvalidSettings)
	}
	for _, column := range []string{"settings", "legacy_settings"} {
		_, err := s.UpdatePreference(ctx, "owner", column, map[string]any{"theme": "light"})
		require.ErrorIs(t, err, ErrInvalidSettings)
	}
	require.ErrorIs(t, s.UpdateAllSettings(ctx, "owner", AllSettings{
		Settings: map[string]any{"theme": "dark"}, SoundSettings: map[string]any{"mediaVolume": -1},
	}), ErrInvalidSettings)
}

func TestStoredSettingsNormalization(t *testing.T) {
	for section, raw := range validSettingsPatches {
		var expected map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw), &expected))
		require.Equal(t, expected, normalizeStoredSettings(section, []byte(raw)))
	}
	require.Equal(t, map[string]any{"sounds": false, "notifications": false, "theme": "dark"},
		normalizeStoredSettings("settings", []byte(`{"sounds":null,"notifications":"false","theme":"dark","palette":"bad","unknown":true}`)))
	require.Equal(t, map[string]any{"mediaVolume": 0, "messagesSound": false},
		normalizeStoredSettings("sound_settings", []byte(`{"mediaVolume":101,"messagesSound":[],"ringtone":3}`)))
	for _, data := range []string{`null`, `[]`, `1`, `"text"`, `{invalid`} {
		for section := range validSettingsPatches {
			out := normalizeStoredSettings(section, []byte(data))
			require.NotNil(t, out)
			require.NoError(t, validateSettingsPatch(section, out))
			for _, value := range out {
				require.NotEqual(t, true, value)
			}
		}
	}
	// Чтение не подставляет все defaults и не модифицирует sparse rows (#451).
	require.Empty(t, normalizeStoredSettings("settings", []byte(`{}`)))
}
