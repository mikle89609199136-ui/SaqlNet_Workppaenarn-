package user

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"

	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/platform/notificationpolicy"
	"craneapp/backend-v2/internal/platform/settingsdefaults"
)

var ErrInvalidSettings = errors.New("invalid settings")

// Указатели отличают omission от false/0/пустой строки. Null проверяется до
// декодирования: для leaf это ошибка, а не команда сброса (#453/#495).
type SettingsPatch struct {
	Theme                    *string `json:"theme,omitempty" validate:"omitempty,oneof=light dark system"`
	Palette                  *string `json:"palette,omitempty" validate:"omitempty,oneof=graphite midnight warm"`
	AccentPreset             *string `json:"accentPreset,omitempty" validate:"omitempty,oneof=violet plum orchid indigo amber teal"`
	TextSize                 *string `json:"textSize,omitempty" validate:"omitempty,oneof=small medium large"`
	ChatDensity              *string `json:"chatDensity,omitempty" validate:"omitempty,oneof=compact normal large"`
	ShowMessageTime          *bool   `json:"showMessageTime,omitempty"`
	ShowMessageStatus        *bool   `json:"showMessageStatus,omitempty"`
	ShowMessageAvatars       *bool   `json:"showMessageAvatars,omitempty"`
	GroupConsecutiveMessages *bool   `json:"groupConsecutiveMessages,omitempty"`
	AvatarShape              *string `json:"avatarShape,omitempty" validate:"omitempty,oneof=letter grid"`
	Language                 *string `json:"language,omitempty" validate:"omitempty,oneof=ru en"`
	Notifications            *bool   `json:"notifications,omitempty"`
	Sounds                   *bool   `json:"sounds,omitempty"`
	CallSounds               *bool   `json:"callSounds,omitempty"`
}

type LegacySettingsPatch struct {
	SettingsPatch
	AccentColor *string `json:"accentColor,omitempty" validate:"omitempty,len=7,hexcolor"`
	FontSize    *string `json:"fontSize,omitempty" validate:"omitempty,oneof=small medium large"`
}

type NotificationSettingsPatch struct {
	PrivateChats       *bool `json:"privateChats,omitempty"`
	Groups             *bool `json:"groups,omitempty"`
	Channels           *bool `json:"channels,omitempty"`
	Calls              *bool `json:"calls,omitempty"`
	VideoCalls         *bool `json:"videoCalls,omitempty"`
	InAppNotifications *bool `json:"inAppNotifications,omitempty"`
	MessagePreview     *bool `json:"messagePreview,omitempty"`
	ReadReceipts       *bool `json:"readReceipts,omitempty"`
	Reactions          *bool `json:"reactions,omitempty"`
	NewContacts        *bool `json:"newContacts,omitempty"`
}

type SoundSettingsPatch struct {
	NotificationsVolume *int    `json:"notificationsVolume,omitempty" validate:"omitempty,gte=0,lte=100"`
	MediaVolume         *int    `json:"mediaVolume,omitempty" validate:"omitempty,gte=0,lte=100"`
	NotificationsSound  *bool   `json:"notificationsSound,omitempty"`
	MessagesSound       *bool   `json:"messagesSound,omitempty"`
	SendSound           *bool   `json:"sendSound,omitempty"`
	CallsSound          *bool   `json:"callsSound,omitempty"`
	VibrateOnCall       *bool   `json:"vibrateOnCall,omitempty"`
	NotificationSound   *string `json:"notificationSound,omitempty"`
	MessageSound        *string `json:"messageSound,omitempty"`
	Ringtone            *string `json:"ringtone,omitempty"`
}

type StorageSettingsPatch struct {
	AutoDownloadMobile  *bool   `json:"autoDownloadMobile,omitempty"`
	AutoDownloadWifi    *bool   `json:"autoDownloadWifi,omitempty"`
	AutoDownloadRoaming *bool   `json:"autoDownloadRoaming,omitempty"`
	DeleteMediaAfter    *string `json:"deleteMediaAfter,omitempty"`
}

type AdvancedSettingsPatch struct {
	AutoReconnect        *bool   `json:"autoReconnect,omitempty"`
	FastConnection       *bool   `json:"fastConnection,omitempty"`
	ConnectionType       *string `json:"connectionType,omitempty"`
	DataCompression      *bool   `json:"dataCompression,omitempty"`
	SaveDrafts           *bool   `json:"saveDrafts,omitempty"`
	Analytics            *bool   `json:"analytics,omitempty"`
	DeveloperMode        *bool   `json:"developerMode,omitempty"`
	DebugLog             *bool   `json:"debugLog,omitempty"`
	HardwareAcceleration *bool   `json:"hardwareAcceleration,omitempty"`
	AutoplayGifs         *bool   `json:"autoplayGifs,omitempty"`
}

var settingsPatchTypes = map[string]reflect.Type{
	"settings":              reflect.TypeFor[SettingsPatch](),
	"legacy_settings":       reflect.TypeFor[LegacySettingsPatch](),
	"notification_settings": reflect.TypeFor[NotificationSettingsPatch](),
	"sound_settings":        reflect.TypeFor[SoundSettingsPatch](),
	"storage_settings":      reflect.TypeFor[StorageSettingsPatch](),
	"advanced_settings":     reflect.TypeFor[AdvancedSettingsPatch](),
}

func jsonFields(dto reflect.Type) map[string]reflect.StructField {
	fields := make(map[string]reflect.StructField)
	for i := 0; i < dto.NumField(); i++ {
		field := dto.Field(i)
		if field.Anonymous {
			for key, embedded := range jsonFields(field.Type) {
				fields[key] = embedded
			}
			continue
		}
		fields[strings.Split(field.Tag.Get("json"), ",")[0]] = field
	}
	return fields
}

func validateSettingsPatch(section string, patch map[string]any) error {
	dtoType, ok := settingsPatchTypes[section]
	if !ok || patch == nil {
		return fmt.Errorf("%w: %s must be an object", ErrInvalidSettings, section)
	}
	fields := jsonFields(dtoType)
	keys := make([]string, 0, len(patch))
	for key := range patch {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		// encoding/json допускает case-insensitive имена полей; контракт — нет.
		if _, known := fields[key]; !known {
			return fmt.Errorf("%w: unknown %s key %s", ErrInvalidSettings, section, key)
		}
		value := reflect.ValueOf(patch[key])
		if !value.IsValid() || ((value.Kind() == reflect.Pointer || value.Kind() == reflect.Map || value.Kind() == reflect.Slice) && value.IsNil()) {
			return fmt.Errorf("%w: %s.%s must not be null", ErrInvalidSettings, section, key)
		}
	}
	data, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("%w: %s is not JSON", ErrInvalidSettings, section)
	}
	dto := reflect.New(dtoType).Interface()
	if err := json.Unmarshal(data, dto); err != nil {
		return fmt.Errorf("%w: %s: %v", ErrInvalidSettings, section, err)
	}
	if err := validate.Struct(dto); err != nil {
		return fmt.Errorf("%w: %s: %v", ErrInvalidSettings, section, err)
	}
	return nil
}

// Defaults — проекция для ответа. Mutation base остаётся sparse: иначе
// unrelated patch не должен превращать missing flags в новый canonical выбор.
func normalizeStoredSettings(section string, data []byte) map[string]any {
	if section == "settings" || section == "legacy_settings" {
		out := storedAppearance(section, data)
		for key, value := range notificationpolicy.Read(data).Map() {
			out[key] = value
		}
		return out
	}
	return withSettingsDefaults(section, normalizeSettingsPatchBase(section, data))
}

func withSettingsDefaults(section string, stored map[string]any) map[string]any {
	out := settingsdefaults.Object(section)
	for key, value := range stored {
		out[key] = value
	}
	return out
}

// Повреждённые boolean/volume закрываются в false/0, неизвестные keys и
// неверные enums/строки опускаются. Валидные значения не меняются.
func normalizeSettingsPatchBase(section string, data []byte) map[string]any {
	var stored map[string]any
	if json.Unmarshal(data, &stored) != nil || stored == nil {
		return closedSettings(section)
	}
	out := make(map[string]any)
	fields := jsonFields(settingsPatchTypes[section])
	for key, value := range stored {
		field, known := fields[key]
		if !known {
			continue
		}
		if validateSettingsPatch(section, map[string]any{key: value}) == nil {
			out[key] = value
			continue
		}
		switch field.Type.Elem().Kind() {
		case reflect.Bool:
			out[key] = false
		case reflect.Int:
			out[key] = 0
		}
	}
	return out
}

func closedSettings(section string) map[string]any {
	if section == "settings" || section == "legacy_settings" {
		return map[string]any{"notifications": false, "sounds": false, "callSounds": false}
	}
	out := make(map[string]any)
	for key, field := range jsonFields(settingsPatchTypes[section]) {
		switch field.Type.Elem().Kind() {
		case reflect.Bool:
			out[key] = false
		case reflect.Int:
			out[key] = 0
		}
	}
	return out
}

func decodeSettingsObject(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	var data json.RawMessage
	if !decode(w, r, &data) {
		return nil, false
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || object == nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "settings must be an object")
		return nil, false
	}
	return object, true
}

func decodeSettingsPatch(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	object, ok := decodeSettingsObject(w, r)
	if !ok {
		return nil, false
	}
	patch := make(map[string]any, len(object))
	for key, raw := range object {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid settings value")
			return nil, false
		}
		patch[key] = value
	}
	return patch, true
}

func decodeSettingsBulkPatch(w http.ResponseWriter, r *http.Request) (AllSettings, bool) {
	object, ok := decodeSettingsObject(w, r)
	if !ok {
		return AllSettings{}, false
	}
	fields := jsonFields(reflect.TypeFor[AllSettings]())
	for key, raw := range object {
		if _, known := fields[key]; !known {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "unknown bulk settings key: "+key)
			return AllSettings{}, false
		}
		if (key == "passcodeEnabled" || key == "passcodeTimeout") && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", key+" must not be null")
			return AllSettings{}, false
		}
	}
	data, err := json.Marshal(object)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid bulk settings")
		return AllSettings{}, false
	}
	var input AllSettings
	if err := json.Unmarshal(data, &input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid bulk section or read-only field type")
		return AllSettings{}, false
	}
	return input, true
}

// jsonMap(nil) сериализуется как {}; SQL NULL нужен отдельно, чтобы bulk
// не переписывал omitted/null/empty sections нормализованным snapshot.
func mergedSettingsSection(base, patch map[string]any) any {
	if len(patch) == 0 {
		return nil
	}
	for key, value := range patch {
		base[key] = value
	}
	return jsonMap(base)
}
