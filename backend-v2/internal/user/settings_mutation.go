package user

import (
	"context"

	"craneapp/backend-v2/internal/platform/privacy"
)

const selectAllSettings = `
	SELECT settings, privacy_settings, notification_settings, sound_settings,
	       storage_settings, advanced_settings, folders, passcode_enabled, passcode_timeout
	FROM users.settings WHERE user_id = $1
`

const selectMutableSettings = `
	SELECT settings, privacy_settings, notification_settings, sound_settings,
	       storage_settings, advanced_settings
	FROM users.settings WHERE user_id = $1 FOR UPDATE
`

func scanAllSettings(row interface{ Scan(...any) error }) (AllSettings, error) {
	var folders jsonArray
	var enabled bool
	var timeout int
	out, err := scanSettingsSections(row, true, &folders, &enabled, &timeout)
	if err != nil {
		return AllSettings{}, err
	}
	out.Folders = []any(folders)
	if out.Folders == nil {
		out.Folders = []any{}
	}
	out.PasscodeEnabled, out.PasscodeTimeout = enabled, timeout
	return out, nil
}

func scanSettingsSections(row interface{ Scan(...any) error }, includeDefaults bool, extra ...any) (AllSettings, error) {
	var out AllSettings
	var rawSettings, rawPrivacy, rawNotifications, rawSounds, rawStorage, rawAdvanced []byte
	args := []any{&rawSettings, &rawPrivacy, &rawNotifications, &rawSounds, &rawStorage, &rawAdvanced}
	if err := row.Scan(append(args, extra...)...); err != nil {
		return AllSettings{}, err
	}
	normalize := normalizeSettingsPatchBase
	if includeDefaults {
		normalize = normalizeStoredSettings
	}
	out.Settings = normalize("legacy_settings", rawSettings)
	out.PrivacySettings = privacy.Parse(rawPrivacy).Map()
	out.NotificationSettings = normalize("notification_settings", rawNotifications)
	out.SoundSettings = normalize("sound_settings", rawSounds)
	out.StorageSettings = normalize("storage_settings", rawStorage)
	out.AdvancedSettings = normalize("advanced_settings", rawAdvanced)
	return out, nil
}

// mutateSettings принимает уже проверенный patch. Все read-modify-write writers
// используют один порядок: ensure в tx → актуальная строка FOR UPDATE → merge.
// Будущий resolver #1042 должен вычислять aliases здесь, под той же блокировкой.
func (s *Service) mutateSettings(ctx context.Context, userID string, input AllSettings) (AllSettings, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AllSettings{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO users.settings (user_id) SELECT id FROM auth.users WHERE id = $1
		ON CONFLICT (user_id) DO NOTHING
	`, userID); err != nil {
		return AllSettings{}, err
	}
	current, err := scanSettingsSections(tx.QueryRowContext(ctx, selectMutableSettings, userID), false)
	if err != nil {
		return AllSettings{}, err
	}
	var folders any
	if input.Folders != nil {
		folders = jsonArray(input.Folders)
		current.Folders = input.Folders
	}
	// SQL NULL сохраняет omitted/null/empty sections даже при повреждённом JSON.
	// mergedSettingsSection меняет sparse base, defaults не становятся write keys.
	_, err = tx.ExecContext(ctx, `
		UPDATE users.settings SET
			settings = COALESCE($2::jsonb, settings),
			privacy_settings = COALESCE($3::jsonb, privacy_settings),
			notification_settings = COALESCE($4::jsonb, notification_settings),
			sound_settings = COALESCE($5::jsonb, sound_settings),
			storage_settings = COALESCE($6::jsonb, storage_settings),
			advanced_settings = COALESCE($7::jsonb, advanced_settings),
			folders = COALESCE($8::jsonb, folders),
			updated_at = NOW()
		WHERE user_id = $1
	`, userID,
		mergedSettingsSection(current.Settings, input.Settings),
		mergedSettingsSection(current.PrivacySettings, input.PrivacySettings),
		mergedSettingsSection(current.NotificationSettings, input.NotificationSettings),
		mergedSettingsSection(current.SoundSettings, input.SoundSettings),
		mergedSettingsSection(current.StorageSettings, input.StorageSettings),
		mergedSettingsSection(current.AdvancedSettings, input.AdvancedSettings), folders,
	)
	if err != nil {
		return AllSettings{}, err
	}
	if err := tx.Commit(); err != nil {
		return AllSettings{}, err
	}
	return current, nil
}
