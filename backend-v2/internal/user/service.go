package user

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/privacy"
	"craneapp/backend-v2/internal/platform/profileevent"
	usernamepolicy "craneapp/backend-v2/internal/platform/username"
	"github.com/lib/pq"
)

const UsernameChangeCooldown = 24 * time.Hour

var (
	ErrNotFound              = errors.New("user not found")
	ErrSelfBlock             = errors.New("cannot block yourself")
	ErrAlreadyBlocked        = errors.New("user already blocked")
	ErrInvalidInput          = errors.New("invalid input")
	ErrInvalidPrivacy        = errors.New("invalid privacy settings")
	ErrInvalidUsernameFormat = errors.New("wrong username format")
	ErrUsernameTaken         = errors.New("username already exists")
	ErrUsernameCooldown      = errors.New("username change cooldown is active")
	ErrWrongPasscode         = errors.New("wrong passcode")
	ErrNoPasscodeSet         = errors.New("no passcode set")
)

type UsernameCooldownError struct {
	AvailableAt time.Time
}

func (e *UsernameCooldownError) Error() string { return ErrUsernameCooldown.Error() }
func (e *UsernameCooldownError) Unwrap() error { return ErrUsernameCooldown }

type Profile struct {
	ID        string   `json:"id"`
	Username  string   `json:"username"`
	FirstName string   `json:"firstName"`
	LastName  string   `json:"lastName"`
	Bio       string   `json:"bio"`
	AvatarURL string   `json:"avatarUrl"`
	Badges    []string `json:"badges"`
	IsPremium bool     `json:"isPremium"`
	IsBot     bool     `json:"isBot"`
}

type SearchResult struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	AvatarURL string `json:"avatarUrl"`
}

type BlockedUser struct {
	SearchResult
	BlockedAt string `json:"blockedAt"`
}

type StorageUsage struct {
	Messages int64 `json:"messages"`
	Media    int64 `json:"media"`
	Files    int64 `json:"files"`
	Cache    int64 `json:"cache"`
}

type ExportData struct {
	User       Profile        `json:"user"`
	Chats      []ExportChat   `json:"chats"`
	Settings   map[string]any `json:"settings"`
	Privacy    map[string]any `json:"privacy"`
	ExportedAt string         `json:"exportedAt"`
}

type ExportChat struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Type      string `json:"type"`
	CreatedAt string `json:"createdAt"`
}

type AllSettings struct {
	Settings             map[string]any `json:"settings"`
	PrivacySettings      map[string]any `json:"privacySettings"`
	NotificationSettings map[string]any `json:"notificationSettings"`
	SoundSettings        map[string]any `json:"soundSettings"`
	StorageSettings      map[string]any `json:"storageSettings"`
	AdvancedSettings     map[string]any `json:"advancedSettings"`
	Folders              []any          `json:"folders"`
	PasscodeEnabled      bool           `json:"passcodeEnabled"`
	PasscodeTimeout      int            `json:"passcodeTimeout"`
}

type PasscodeState struct {
	Enabled bool `json:"enabled"`
	Timeout int  `json:"timeout"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Me(ctx context.Context, userID string) (Profile, error) {
	profile, err := s.profileByID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		if err := s.ensureProfile(ctx, userID); err != nil {
			return Profile{}, err
		}
		return s.profileByID(ctx, userID)
	}
	return profile, err
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, firstName, lastName, bio, avatarURL *string) (Profile, error) {
	if err := s.ensureProfile(ctx, userID); err != nil {
		return Profile{}, err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users.profiles SET
			first_name = COALESCE(NULLIF($2, ''), first_name),
			last_name = COALESCE($3, last_name),
			bio = COALESCE($4, bio),
			avatar_url = COALESCE($5, avatar_url),
			updated_at = NOW()
		WHERE user_id = $1
	`, userID, stringOrNil(firstName), stringOrNil(lastName), stringOrNil(bio), stringOrNil(avatarURL))
	if err != nil {
		return Profile{}, err
	}
	return s.profileByID(ctx, userID)
}

// RenameUsername atomically updates the canonical username and appends its old value
// to the audit trail. Locking the user row serializes concurrent rename attempts for
// one account; the username registry arbitrates competing accounts and reserves old names.
func (s *Service) RenameUsername(ctx context.Context, userID, requestedUsername string) (Profile, error) {
	newUsername := usernamepolicy.Normalize(requestedUsername)
	if newUsername == "" {
		return Profile{}, ErrInvalidInput
	}
	if !usernamepolicy.Valid(newUsername) {
		return Profile{}, ErrInvalidUsernameFormat
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var currentUsername string
	err = tx.QueryRowContext(ctx, `
		SELECT username
		FROM auth.users
		WHERE id = $1 AND disabled_at IS NULL
		FOR UPDATE
	`, userID).Scan(&currentUsername)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	if currentUsername == newUsername {
		if err := tx.Commit(); err != nil {
			return Profile{}, err
		}
		return s.profileByID(ctx, userID)
	}

	var lastChanged time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT changed_at
		FROM users.username_changes
		WHERE user_id = $1
		  AND changed_at > NOW() - INTERVAL '24 hours'
		ORDER BY changed_at DESC
		LIMIT 1
	`, userID).Scan(&lastChanged)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Profile{}, err
	}
	if err == nil {
		availableAt := lastChanged.Add(UsernameChangeCooldown)
		return Profile{}, &UsernameCooldownError{AvailableAt: availableAt}
	}

	var claimedUsername string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO auth.username_registry (username, user_id)
		VALUES ($1, $2)
		ON CONFLICT (username) DO UPDATE
		SET user_id = auth.username_registry.user_id
		WHERE auth.username_registry.user_id = EXCLUDED.user_id
		RETURNING username
	`, newUsername, userID).Scan(&claimedUsername)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrUsernameTaken
	}
	if err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Profile{}, ErrUsernameTaken
		}
		return Profile{}, err
	}

	if _, err = tx.ExecContext(ctx, `
		UPDATE auth.users
		SET username = $2, updated_at = NOW()
		WHERE id = $1
	`, userID, newUsername); err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Profile{}, ErrUsernameTaken
		}
		return Profile{}, err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO users.username_changes (user_id, previous_username, new_username)
		VALUES ($1, $2, $3)
	`, userID, currentUsername, newUsername); err != nil {
		return Profile{}, err
	}
	eventPayload, err := json.Marshal(profileevent.UsernameChanged{UserID: userID, Username: newUsername})
	if err != nil {
		return Profile{}, err
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_notify($1, $2)`, profileevent.Channel, string(eventPayload)); err != nil {
		return Profile{}, err
	}
	if err = tx.Commit(); err != nil {
		return Profile{}, err
	}
	return s.profileByID(ctx, userID)
}

func (s *Service) SubscribePremium(ctx context.Context, userID string) error {
	if err := s.ensureProfile(ctx, userID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users.profiles SET
			is_premium = TRUE,
			updated_at = NOW()
		WHERE user_id = $1
	`, userID)
	return err
}

// Search performs a case-insensitive substring search across user records.
// It returns up to 50 results, excluding the current viewer.
// The query may start with '@', which is stripped for convenience.
// Special characters '%' and '_' are escaped to be treated literally.
//
// The search uses the same logic as the SELECT output:
//   - first_name and last_name are taken from users.profiles if present,
//     otherwise from auth.users (via COALESCE). This ensures that search
//     results match what is displayed in the response.
func (s *Service) Search(ctx context.Context, viewerID, query string) ([]SearchResult, error) {
	const method = "Search"

	query = strings.TrimSpace(query)
	slog.DebugContext(ctx, "search request",
		"layer", "service",
		"method", method,
		"user_id", viewerID,
		"query", query,
	)

	if query == "" {
		slog.DebugContext(ctx, "empty query, returning empty result",
			"layer", "service",
			"method", method,
			"user_id", viewerID,
		)
		return []SearchResult{}, nil
	}

	cleanQuery := strings.TrimPrefix(query, "@")
	// If the query consisted only of '@', treat it as empty to avoid
	// listing all users via the '%%' pattern.
	if cleanQuery == "" {
		slog.DebugContext(ctx, "query after stripping '@' is empty, returning empty result",
			"layer", "service",
			"method", method,
			"user_id", viewerID,
		)
		return []SearchResult{}, nil
	}

	escaped := EscapeLike(cleanQuery)
	pattern := "%" + escaped + "%"

	rows, err := s.db.QueryContext(ctx, `
		SELECT au.id::text, au.username,
		       COALESCE(up.first_name, au.first_name),
		       COALESCE(up.last_name, au.last_name),
		       COALESCE(up.avatar_url, '')
		FROM auth.users au
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE au.disabled_at IS NULL
		  AND au.id::text != $2
		  AND (au.username ILIKE $1 OR
		       COALESCE(up.first_name, au.first_name) ILIKE $1 OR
		       COALESCE(up.last_name, au.last_name) ILIKE $1 OR
		       up.bio ILIKE $1)
		ORDER BY au.username
		LIMIT 50
	`, pattern, viewerID)
	if err != nil {
		slog.ErrorContext(ctx, "search query failed",
			"layer", "service",
			"method", method,
			"user_id", viewerID,
			"pattern", pattern,
			"error", err,
		)
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			slog.WarnContext(ctx, "failed to close rows",
				"layer", "service",
				"method", method,
				"user_id", viewerID,
				"error", closeErr,
			)
		}
	}()

	var users []SearchResult
	for rows.Next() {
		var user SearchResult
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.FirstName,
			&user.LastName,
			&user.AvatarURL,
		); err != nil {
			slog.ErrorContext(ctx, "failed to scan row",
				"layer", "service",
				"method", method,
				"user_id", viewerID,
				"error", err,
			)
			return nil, err
		}
		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		slog.ErrorContext(ctx, "rows iteration error",
			"layer", "service",
			"method", method,
			"user_id", viewerID,
			"error", err,
		)
		return nil, err
	}
	// Фото тех, кто закрыл его от ищущего, в выдаче нет (#789).
	if err := privacy.HidePhotos(ctx, s.db, viewerID, photoSlots(users)); err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "search completed successfully",
		"layer", "service",
		"method", method,
		"user_id", viewerID,
		"result_count", len(users),
	)

	return users, nil
}

// EscapeLike escapes special characters for SQL LIKE/ILIKE patterns.
// It escapes backslash first, then percent and underscore.
func EscapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	s = strings.ReplaceAll(s, "_", "\\_")
	return s
}

// IsUsernameAvailable checks whether the given username is available for registration.
// It performs the following validations:
//   - Normalizes surrounding whitespace and letter case.
//   - Ensures the username is not empty.
//   - Validates the canonical username against the allowed pattern.
//   - Queries the canonical registry, which includes current and historical claims.
//
// Returns:
//   - (true, nil)  if the username is syntactically valid and does not exist in DB.
//   - (false, nil) if the username is valid but already exists.
//   - (false, ErrInvalidInput) if the username is empty.
//   - (false, ErrInvalidUsernameFormat) if the username does not match the pattern.
//   - (false, error) for any database or context error.
func (s *Service) IsUsernameAvailable(ctx context.Context, username string) (bool, error) {
	username = usernamepolicy.Normalize(username)
	// Log incoming request (debug level)
	slog.DebugContext(ctx, "[Service-IsUsernameAvailable]:checking username availability",
		"username", username,
	)

	// Check for empty input
	if username == "" {
		slog.DebugContext(ctx, "[Service-IsUsernameAvailable]:empty username, returning invalid input")
		return false, ErrInvalidInput
	}

	// Validate username against the allowed pattern
	if !usernamepolicy.Valid(username) {
		slog.DebugContext(ctx, "[Service-IsUsernameAvailable]:username does not match pattern",
			"username", username,
		)
		return false, ErrInvalidUsernameFormat
	}

	// The registry includes both current and historical claims, preventing an
	// old QR/deep link from being reassigned to a different account.
	var exists bool
	err := s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM auth.username_registry WHERE username = $1)`,
		username).Scan(&exists)

	if err != nil {
		slog.ErrorContext(ctx, "[Service-IsUsernameAvailable]:database query failed",
			"username", username,
			"error", err,
		)
		return false, err
	}

	available := !exists
	slog.InfoContext(ctx, "[Service-IsUsernameAvailable]:availability check completed",
		"username", username,
		"available", available,
	)

	return available, nil
}

// ProfileByID — профиль userID глазами viewerID: фото — по правилу «Фото»
// с блокировкой и исключениями (#440).
func (s *Service) ProfileByID(ctx context.Context, viewerID, userID string) (Profile, error) {
	profile, err := s.profileByID(ctx, userID)
	if err != nil {
		return profile, err
	}
	err = privacy.HidePhotos(ctx, s.db, viewerID, []privacy.PhotoSlot{{OwnerID: profile.ID, URL: &profile.AvatarURL}})
	return profile, err
}

// photoSlots — аватары из списка людей для privacy.HidePhotos.
func photoSlots(people []SearchResult) []privacy.PhotoSlot {
	slots := make([]privacy.PhotoSlot, len(people))
	for i := range people {
		slots[i] = privacy.PhotoSlot{OwnerID: people[i].ID, URL: &people[i].AvatarURL}
	}
	return slots
}

func (s *Service) ProfileByUsername(ctx context.Context, requestedUsername string) (Profile, error) {
	canonical := strings.ToLower(strings.TrimSpace(requestedUsername))
	if canonical == "" {
		return Profile{}, ErrInvalidInput
	}
	if len(canonical) > 64 {
		return Profile{}, ErrNotFound
	}

	var userID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text
		FROM auth.users
		WHERE lower(username) = $1 AND disabled_at IS NULL
	`, canonical).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	return s.profileByID(ctx, userID)
}

// Status — «в сети» и «был(а)» пользователя userID глазами viewerID. Что
// из этого можно показать, решает общая проверка приватности (#783):
// правило «Последняя активность», блокировка и исключения (#784) — в обе
// стороны, как в Telegram (#791). Вместо скрытого точного времени —
// приблизительное: lastSeenApprox.
func (s *Service) Status(ctx context.Context, viewerID, userID string) (map[string]any, error) {
	var ownerPrivacy, ownerExceptions, viewerPrivacy, viewerExceptions []byte
	var ownerBlocks, viewerBlocks bool
	var lastActive sql.NullString
	var online bool
	err := s.db.QueryRowContext(ctx, `
		SELECT settings.privacy_settings,
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = auth.users.id AND b.blocked_user_id = $2),
		       (SELECT jsonb_object_agg(e.rule, e.allow) FROM users.privacy_exceptions e WHERE e.owner_id = auth.users.id AND e.user_id = $2),
		       -- Взаимность (#791): то же о зрителе по отношению к владельцу.
		       (SELECT vs.privacy_settings FROM users.settings vs WHERE vs.user_id = $2),
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = $2 AND b.blocked_user_id = auth.users.id),
		       (SELECT jsonb_object_agg(e.rule, e.allow) FROM users.privacy_exceptions e WHERE e.owner_id = $2 AND e.user_id = auth.users.id),
		       to_char(presence.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       -- «В сети» — живое WebSocket-подключение (#780): отметку ведёт
		       -- чат-сервис, свежей она считается 75 секунд.
		       COALESCE(presence.online AND presence.last_seen_at > NOW() - INTERVAL '75 seconds', FALSE)
		FROM auth.users
		LEFT JOIN users.settings AS settings ON settings.user_id = auth.users.id
		LEFT JOIN users.presence AS presence ON presence.user_id = auth.users.id
		WHERE auth.users.id = $1 AND auth.users.disabled_at IS NULL
	`, userID, viewerID).Scan(&ownerPrivacy, &ownerBlocks, &ownerExceptions,
		&viewerPrivacy, &viewerBlocks, &viewerExceptions, &lastActive, &online)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	pair := privacy.Pair{
		Owner:         privacy.Parse(ownerPrivacy),
		Viewer:        privacy.Parse(viewerPrivacy),
		OwnerToViewer: privacy.Relation{Self: viewerID == userID, Blocked: ownerBlocks, Exceptions: privacy.ParseExceptions(ownerExceptions)},
		ViewerToOwner: privacy.Relation{Blocked: viewerBlocks, Exceptions: privacy.ParseExceptions(viewerExceptions)},
	}
	if view := pair.LastSeen(privacy.ParseLastSeen(lastActive.String), time.Now()); !view.Exact {
		return map[string]any{"isOnline": false, "lastSeen": "", "lastSeenApprox": view.Approx}, nil
	}
	if !lastActive.Valid {
		return map[string]any{"isOnline": false, "lastSeen": ""}, nil
	}
	return map[string]any{"isOnline": online, "lastSeen": lastActive.String}, nil
}

func (s *Service) Settings(ctx context.Context, userID string) (map[string]any, map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, nil, err
	}
	var settings map[string]any
	var rawPrivacy []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT settings, privacy_settings FROM users.settings WHERE user_id = $1
	`, userID).Scan((*jsonMap)(&settings), &rawPrivacy)
	if err != nil {
		return settings, nil, err
	}
	// Отдаём канонический вид: старые «contacts» и «none» — уже «nobody».
	return settings, privacy.Parse(rawPrivacy).Map(), nil
}

func (s *Service) AllSettings(ctx context.Context, userID string) (AllSettings, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return AllSettings{}, err
	}
	var out AllSettings
	var folders jsonArray
	var rawPrivacy []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT settings, privacy_settings, notification_settings, sound_settings,
		       storage_settings, advanced_settings, folders, passcode_enabled, passcode_timeout
		FROM users.settings WHERE user_id = $1
	`, userID).Scan(
		(*jsonMap)(&out.Settings),
		&rawPrivacy,
		(*jsonMap)(&out.NotificationSettings),
		(*jsonMap)(&out.SoundSettings),
		(*jsonMap)(&out.StorageSettings),
		(*jsonMap)(&out.AdvancedSettings),
		&folders,
		&out.PasscodeEnabled,
		&out.PasscodeTimeout,
	)
	out.Folders = []any(folders)
	if err == nil {
		out.PrivacySettings = privacy.Parse(rawPrivacy).Map()
	}
	return out, err
}

func (s *Service) UpdateAllSettings(ctx context.Context, userID string, input AllSettings) error {
	// Тот же вход в настройки приватности, что и PUT /users/privacy: без
	// проверки здесь её можно было бы обойти.
	if input.PrivacySettings != nil {
		normalized, err := privacy.Normalize(input.PrivacySettings)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidPrivacy, err)
		}
		input.PrivacySettings = normalized
	}
	if err := s.ensureSettings(ctx, userID); err != nil {
		return err
	}
	current, err := s.AllSettings(ctx, userID)
	if err != nil {
		return err
	}
	merge := func(base, patch map[string]any) map[string]any {
		if base == nil {
			base = map[string]any{}
		}
		for key, value := range patch {
			base[key] = value
		}
		return base
	}
	current.Settings = merge(current.Settings, input.Settings)
	current.PrivacySettings = merge(current.PrivacySettings, input.PrivacySettings)
	current.NotificationSettings = merge(current.NotificationSettings, input.NotificationSettings)
	current.SoundSettings = merge(current.SoundSettings, input.SoundSettings)
	current.StorageSettings = merge(current.StorageSettings, input.StorageSettings)
	current.AdvancedSettings = merge(current.AdvancedSettings, input.AdvancedSettings)
	if input.Folders != nil {
		current.Folders = input.Folders
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE users.settings SET
			settings = $2::jsonb,
			privacy_settings = $3::jsonb,
			notification_settings = $4::jsonb,
			sound_settings = $5::jsonb,
			storage_settings = $6::jsonb,
			advanced_settings = $7::jsonb,
			folders = $8::jsonb,
			updated_at = NOW()
		WHERE user_id = $1
	`, userID, jsonMap(current.Settings), jsonMap(current.PrivacySettings), jsonMap(current.NotificationSettings), jsonMap(current.SoundSettings), jsonMap(current.StorageSettings), jsonMap(current.AdvancedSettings), jsonArray(current.Folders))
	return err
}

func (s *Service) UpdateSettings(ctx context.Context, userID string, settings map[string]any) (map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users.settings SET settings = settings || $2::jsonb, updated_at = NOW() WHERE user_id = $1
	`, userID, jsonMap(settings))
	if err != nil {
		return nil, err
	}
	next, _, err := s.Settings(ctx, userID)
	return next, err
}

func (s *Service) UpdatePrivacy(ctx context.Context, userID string, patch map[string]any) (map[string]any, error) {
	normalized, err := privacy.Normalize(patch)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPrivacy, err)
	}
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE users.settings SET privacy_settings = privacy_settings || $2::jsonb, updated_at = NOW() WHERE user_id = $1
	`, userID, jsonMap(normalized))
	if err != nil {
		return nil, err
	}
	_, next, err := s.Settings(ctx, userID)
	return next, err
}

func (s *Service) Preference(ctx context.Context, userID, column string, fallback map[string]any) (map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	current, err := s.jsonColumn(ctx, userID, column)
	if err != nil {
		return nil, err
	}
	if len(current) == 0 {
		return fallback, nil
	}
	return current, nil
}

func (s *Service) UpdatePreference(ctx context.Context, userID, column string, patch map[string]any) (map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	current, err := s.jsonColumn(ctx, userID, column)
	if err != nil {
		return nil, err
	}
	for key, value := range patch {
		current[key] = value
	}
	return current, s.updateJsonColumn(ctx, userID, column, current)
}

func (s *Service) Folders(ctx context.Context, userID string) ([]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	var raw []byte
	if err := s.db.QueryRowContext(ctx, `SELECT folders FROM users.settings WHERE user_id = $1`, userID).Scan(&raw); err != nil {
		return nil, err
	}
	var folders []any
	if len(raw) == 0 {
		return []any{}, nil
	}
	if err := json.Unmarshal(raw, &folders); err != nil {
		return nil, err
	}
	if folders == nil {
		folders = []any{}
	}
	return folders, nil
}

func (s *Service) UpdateFolders(ctx context.Context, userID string, folders []any) error {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE users.settings SET folders = $2::jsonb, updated_at = NOW() WHERE user_id = $1`, userID, jsonArray(folders))
	return err
}

func (s *Service) Storage(ctx context.Context, userID string) (StorageUsage, map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return StorageUsage{}, nil, err
	}
	var usage StorageUsage
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(LENGTH(content)), 0)::bigint
		FROM messages.messages
		WHERE sender_id = $1 AND deleted_at IS NULL
	`, userID).Scan(&usage.Messages); err != nil {
		return StorageUsage{}, nil, err
	}
	settings, err := s.jsonColumn(ctx, userID, "storage_settings")
	return usage, settings, err
}

func (s *Service) UpdateStorageSettings(ctx context.Context, userID string, patch map[string]any) (map[string]any, error) {
	return s.UpdatePreference(ctx, userID, "storage_settings", patch)
}

func (s *Service) ClearCache(ctx context.Context, userID string) error {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return err
	}
	return nil
}

func (s *Service) DeleteAllData(ctx context.Context, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM messages.messages WHERE sender_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chats.members WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users.settings WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM public.user_sessions WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users.blocked_users WHERE user_id = $1 OR blocked_user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) Export(ctx context.Context, userID string) (ExportData, error) {
	profile, err := s.Me(ctx, userID)
	if err != nil {
		return ExportData{}, err
	}
	settings, privacy, err := s.Settings(ctx, userID)
	if err != nil {
		return ExportData{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id::text, c.title, c.type, c.created_at::text
		FROM chats.chats c
		JOIN chats.members cm ON cm.chat_id = c.id
		WHERE cm.user_id = $1
		ORDER BY c.created_at DESC
	`, userID)
	if err != nil {
		return ExportData{}, err
	}
	defer func() {
		rows.Close()
	}()
	var chats []ExportChat
	for rows.Next() {
		var chat ExportChat
		if err := rows.Scan(&chat.ID, &chat.Title, &chat.Type, &chat.CreatedAt); err != nil {
			return ExportData{}, err
		}
		chats = append(chats, chat)
	}
	return ExportData{User: profile, Chats: chats, Settings: settings, Privacy: privacy, ExportedAt: time.Now().UTC().Format(time.RFC3339)}, rows.Err()
}

func (s *Service) Blocked(ctx context.Context, userID string) ([]BlockedUser, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT au.id::text, au.username,
		       COALESCE(up.first_name, au.first_name), COALESCE(up.last_name, au.last_name),
		       COALESCE(up.avatar_url, ''), bu.blocked_at::text
		FROM users.blocked_users bu
		JOIN auth.users au ON au.id = bu.blocked_user_id
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE bu.user_id = $1
		ORDER BY bu.blocked_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer func() {
		rows.Close()
	}()
	var blocked []BlockedUser
	for rows.Next() {
		var item BlockedUser
		if err := rows.Scan(&item.ID, &item.Username, &item.FirstName, &item.LastName, &item.AvatarURL, &item.BlockedAt); err != nil {
			return nil, err
		}
		blocked = append(blocked, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slots := make([]privacy.PhotoSlot, len(blocked))
	for i := range blocked {
		slots[i] = privacy.PhotoSlot{OwnerID: blocked[i].ID, URL: &blocked[i].AvatarURL}
	}
	return blocked, privacy.HidePhotos(ctx, s.db, userID, slots)
}

func (s *Service) Block(ctx context.Context, userID, blockedUserID string) error {
	if userID == blockedUserID {
		return ErrSelfBlock
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1)`, blockedUserID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO users.blocked_users (user_id, blocked_user_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, blocked_user_id) DO NOTHING
	`, userID, blockedUserID)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrAlreadyBlocked
	}
	return nil
}

func (s *Service) Unblock(ctx context.Context, userID, blockedUserID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM users.blocked_users WHERE user_id = $1 AND blocked_user_id = $2`, userID, blockedUserID)
	return err
}

func (s *Service) profileByID(ctx context.Context, userID string) (Profile, error) {
	var profile Profile
	var badges pqStringArray
	err := s.db.QueryRowContext(ctx, `
		SELECT au.id::text, au.username,
		       COALESCE(up.first_name, au.first_name), COALESCE(up.last_name, au.last_name),
		       COALESCE(up.bio, ''), COALESCE(up.avatar_url, ''), COALESCE(up.badges, '{}'), COALESCE(up.is_premium, FALSE)
		FROM auth.users au
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE au.id = $1 AND au.disabled_at IS NULL
	`, userID).Scan(&profile.ID, &profile.Username, &profile.FirstName, &profile.LastName, &profile.Bio, &profile.AvatarURL, &badges, &profile.IsPremium)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	profile.Badges = []string(badges)

	for _, badge := range profile.Badges {
		if badge == "bot" {
			profile.IsBot = true
			break
		}
	}
	if profile.IsPremium && !contains(profile.Badges, "premium") {
		profile.Badges = append(profile.Badges, "premium")
	}

	return profile, err
}

func contains(slice []string, val string) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}

func (s *Service) ensureProfile(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO users.profiles (user_id, first_name, last_name)
		SELECT id, first_name, last_name FROM auth.users WHERE id = $1
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	return err
}

func (s *Service) ensureSettings(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO users.settings (user_id) SELECT id FROM auth.users WHERE id = $1 ON CONFLICT (user_id) DO NOTHING
	`, userID)
	return err
}

func (s *Service) jsonColumn(ctx context.Context, userID, column string) (map[string]any, error) {
	var current map[string]any
	var q string
	switch column {
	case "notification_settings":
		q = `SELECT notification_settings FROM users.settings WHERE user_id = $1`
	case "sound_settings":
		q = `SELECT sound_settings FROM users.settings WHERE user_id = $1`
	case "advanced_settings":
		q = `SELECT advanced_settings FROM users.settings WHERE user_id = $1`
	case "storage_settings":
		q = `SELECT storage_settings FROM users.settings WHERE user_id = $1`
	default:
		return nil, ErrInvalidInput
	}
	err := s.db.QueryRowContext(ctx, q, userID).Scan((*jsonMap)(&current))
	return current, err
}

func (s *Service) updateJsonColumn(ctx context.Context, userID, column string, value map[string]any) error {
	var q string
	switch column {
	case "notification_settings":
		q = `UPDATE users.settings SET notification_settings = $2::jsonb, updated_at = NOW() WHERE user_id = $1`
	case "sound_settings":
		q = `UPDATE users.settings SET sound_settings = $2::jsonb, updated_at = NOW() WHERE user_id = $1`
	case "advanced_settings":
		q = `UPDATE users.settings SET advanced_settings = $2::jsonb, updated_at = NOW() WHERE user_id = $1`
	case "storage_settings":
		q = `UPDATE users.settings SET storage_settings = $2::jsonb, updated_at = NOW() WHERE user_id = $1`
	default:
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, q, userID, jsonMap(value))
	return err
}

type Session struct {
	ID         string `json:"id"`
	DeviceName string `json:"deviceName"`
	DeviceType string `json:"deviceType"`
	IPAddress  string `json:"ipAddress"`
	Location   string `json:"location"`
	UserAgent  string `json:"userAgent"`
	LastActive string `json:"lastActive"`
	FirstLogin string `json:"firstLogin"`
	IsCurrent  bool   `json:"isCurrent"`
}

func (s *Service) RegisterDevice(ctx context.Context, userID, deviceName, deviceType, ipAddress, location, userAgent string) (string, error) {
	var sessionID string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM public.user_sessions WHERE user_id = $1 AND user_agent = $2 LIMIT 1`, userID, userAgent).Scan(&sessionID)
	if err == nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE public.user_sessions SET last_active = NOW(), is_current = TRUE WHERE id = $1`, sessionID)
		_, _ = s.db.ExecContext(ctx, `UPDATE public.user_sessions SET is_current = FALSE WHERE user_id = $1 AND id != $2`, userID, sessionID)
		return sessionID, nil
	}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO public.user_sessions (id, user_id, device_name, device_type, ip_address, location, user_agent, last_active, first_login, is_current)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW(), TRUE)
		RETURNING id
	`, userID, deviceName, deviceType, ipAddress, location, userAgent).Scan(&sessionID)
	if err != nil {
		return "", err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE public.user_sessions SET is_current = FALSE WHERE user_id = $1 AND id != $2`, userID, sessionID)
	return sessionID, nil
}

func (s *Service) Devices(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(device_name, ''), COALESCE(device_type, ''), COALESCE(ip_address, ''), COALESCE(location, ''), COALESCE(user_agent, ''), last_active::text, first_login::text, COALESCE(is_current, false)
		FROM public.user_sessions
		WHERE user_id = $1
		ORDER BY last_active DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer func() {
		rows.Close()
	}()
	var sessions []Session
	for rows.Next() {
		var sess Session
		if err := rows.Scan(&sess.ID, &sess.DeviceName, &sess.DeviceType, &sess.IPAddress, &sess.Location, &sess.UserAgent, &sess.LastActive, &sess.FirstLogin, &sess.IsCurrent); err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}

func (s *Service) DeleteDevice(ctx context.Context, userID, sessionID string) error {
	var isCurrent bool
	err := s.db.QueryRowContext(ctx, `SELECT is_current FROM public.user_sessions WHERE id = $1 AND user_id = $2`, sessionID, userID).Scan(&isCurrent)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if isCurrent {
		return errors.New("cannot terminate current session")
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM public.user_sessions WHERE id = $1`, sessionID)
	return err
}

func (s *Service) TerminateAllDevices(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM public.user_sessions WHERE user_id = $1 AND is_current = FALSE`, userID)
	return err
}

func (s *Service) Passcode(ctx context.Context, userID string) (PasscodeState, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return PasscodeState{}, err
	}
	var state PasscodeState
	err := s.db.QueryRowContext(ctx, `
		SELECT passcode_enabled, passcode_timeout FROM users.settings WHERE user_id = $1
	`, userID).Scan(&state.Enabled, &state.Timeout)
	return state, err
}

func (s *Service) SetPasscode(ctx context.Context, userID, passcode string) error {
	if len(strings.TrimSpace(passcode)) < 4 {
		return ErrInvalidInput
	}
	if err := s.ensureSettings(ctx, userID); err != nil {
		return err
	}
	hash, err := hashPasscode(passcode)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE users.settings SET passcode_hash = $2, passcode_enabled = TRUE, updated_at = NOW() WHERE user_id = $1
	`, userID, hash)
	return err
}

func (s *Service) VerifyPasscode(ctx context.Context, userID, passcode string) error {
	hash, err := s.passcodeHash(ctx, userID)
	if err != nil {
		return err
	}
	if hash == "" {
		return ErrNoPasscodeSet
	}
	ok, err := verifyPasscode(passcode, hash)
	if err != nil {
		return err
	}
	if !ok {
		return ErrWrongPasscode
	}
	return nil
}

func (s *Service) DisablePasscode(ctx context.Context, userID, passcode string) error {
	if err := s.VerifyPasscode(ctx, userID, passcode); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users.settings SET passcode_hash = NULL, passcode_enabled = FALSE, updated_at = NOW() WHERE user_id = $1
	`, userID)
	return err
}

func (s *Service) UpdatePasscodeTimeout(ctx context.Context, userID string, timeout int) error {
	if timeout <= 0 {
		timeout = 60
	}
	if err := s.ensureSettings(ctx, userID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users.settings SET passcode_timeout = $2, updated_at = NOW() WHERE user_id = $1
	`, userID, timeout)
	return err
}

func (s *Service) passcodeHash(ctx context.Context, userID string) (string, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return "", err
	}
	var hash sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT passcode_hash FROM users.settings WHERE user_id = $1`, userID).Scan(&hash)
	if err != nil || !hash.Valid {
		return "", err
	}
	return hash.String, nil
}

func stringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func hashPasscode(passcode string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const iterations = 120000
	sum := pbkdf2SHA256([]byte(passcode), salt, iterations, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(sum)), nil
}

func verifyPasscode(passcode, stored string) (bool, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false, nil
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return false, nil
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false, nil
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, nil
	}
	actual := pbkdf2SHA256([]byte(passcode), salt, iterations, len(expected))
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	hLen := sha256.Size
	numBlocks := (keyLen + hLen - 1) / hLen
	out := make([]byte, 0, numBlocks*hLen)
	for block := 1; block <= numBlocks; block++ {
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iterations; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}
