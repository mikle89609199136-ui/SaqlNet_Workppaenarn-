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
	"unicode/utf8"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/blockevent"
	"craneapp/backend-v2/internal/platform/mediarefs"
	"craneapp/backend-v2/internal/platform/notificationpolicy"
	"craneapp/backend-v2/internal/platform/privacy"
	"craneapp/backend-v2/internal/platform/profileevent"
	usernamepolicy "craneapp/backend-v2/internal/platform/username"

	"github.com/lib/pq"
)

const UsernameChangeCooldown = 24 * time.Hour

var (
	ErrNotFound                      = errors.New("user not found")
	ErrSelfBlock                     = errors.New("cannot block yourself")
	ErrAlreadyBlocked                = errors.New("user already blocked")
	ErrInvalidInput                  = errors.New("invalid input")
	ErrInvalidPrivacy                = errors.New("invalid privacy settings")
	ErrInvalidUsernameFormat         = errors.New("wrong username format")
	ErrUsernameTaken                 = errors.New("username already exists")
	ErrUsernameCooldown              = errors.New("username change cooldown is active")
	ErrWrongPasscode                 = errors.New("wrong passcode")
	ErrNoPasscodeSet                 = errors.New("no passcode set")
	ErrAuthSessionInactive           = errors.New("auth session is no longer active")
	ErrCannotTerminateCurrentSession = errors.New("can not terminate current session")
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
	// PostgreSQL VARCHAR(64) считает кодовые точки Unicode, а не байты UTF-8.
	for _, name := range []*string{firstName, lastName} {
		if name != nil && utf8.RuneCountInString(*name) > 64 {
			return Profile{}, ErrInvalidInput
		}
	}

	if err := s.ensureProfile(ctx, userID); err != nil {
		return Profile{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, err
	}
	defer func() { _ = tx.Rollback() }()
	uploadID := ""
	if avatarURL != nil && strings.HasPrefix(*avatarURL, mediarefs.URLPrefix) {
		var ok bool
		uploadID, ok = mediarefs.UploadIDFromURL(*avatarURL)
		if !ok {
			return Profile{}, ErrInvalidInput
		}
		var owned bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM media.uploads WHERE id = $1 AND uploader_id = $2)`, uploadID, userID).Scan(&owned); err != nil {
			return Profile{}, err
		}
		if !owned {
			return Profile{}, ErrInvalidInput
		}
	}
	_, err = tx.ExecContext(ctx, `
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
	if avatarURL != nil {
		if err := mediarefs.ReplaceOwner(ctx, tx, mediarefs.Avatar, userID, uploadID); err != nil {
			return Profile{}, err
		}
	}
	if err := tx.Commit(); err != nil {
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
	if users == nil {
		users = []SearchResult{}
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
	return s.readSettings(ctx, userID, "settings")
}

func (s *Service) readSettings(ctx context.Context, userID, section string) (map[string]any, map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, nil, err
	}
	var rawSettings []byte
	var rawPrivacy []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT settings, privacy_settings FROM users.settings WHERE user_id = $1
	`, userID).Scan(&rawSettings, &rawPrivacy)
	if err != nil {
		return nil, nil, err
	}
	// Отдаём канонический вид: старые «contacts» и «none» — уже «nobody».
	return normalizeStoredSettings(section, rawSettings), privacy.Parse(rawPrivacy).Map(), nil
}

func (s *Service) AllSettings(ctx context.Context, userID string) (AllSettings, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return AllSettings{}, err
	}
	return scanAllSettings(s.db.QueryRowContext(ctx, selectAllSettings, userID))
}

func (s *Service) UpdateAllSettings(ctx context.Context, userID string, input AllSettings) error {
	// Сначала проверить ВСЕ sections, затем выполнять любой SQL, включая ensure.
	for _, section := range []struct {
		name  string
		patch map[string]any
	}{
		{"legacy_settings", input.Settings},
		{"notification_settings", input.NotificationSettings},
		{"sound_settings", input.SoundSettings},
		{"storage_settings", input.StorageSettings},
		{"advanced_settings", input.AdvancedSettings},
	} {
		if section.patch != nil {
			if err := validateSettingsPatch(section.name, section.patch); err != nil {
				return err
			}
		}
	}
	// Тот же вход в настройки приватности, что и PUT /users/privacy: без
	// проверки здесь её можно было бы обойти.
	if input.PrivacySettings != nil {
		normalized, err := privacy.Normalize(input.PrivacySettings)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidPrivacy, err)
		}
		input.PrivacySettings = normalized
	}
	if len(input.Settings)+len(input.PrivacySettings)+len(input.NotificationSettings)+
		len(input.SoundSettings)+len(input.StorageSettings)+len(input.AdvancedSettings) == 0 && input.Folders == nil {
		return nil
	}
	// Проверены оба поля, включая alias, проигравший canonical textSize.
	input.Settings = appearancePatch(input.Settings)
	input, err := notificationPatch(input)
	if err != nil {
		return err
	}
	_, err = s.mutateSettings(ctx, userID, input)
	return err
}

func (s *Service) UpdateSettings(ctx context.Context, userID string, settings map[string]any) (map[string]any, error) {
	if err := validateSettingsPatch("settings", settings); err != nil {
		return nil, err
	}
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	if len(settings) > 0 {
		_, err := s.db.ExecContext(ctx, `
			UPDATE users.settings SET settings =
				(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE $3::jsonb END) || $2::jsonb,
				updated_at = NOW() WHERE user_id = $1
		`, userID, jsonMap(settings), jsonMap(closedSettings("settings")))
		if err != nil {
			return nil, err
		}
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

func (s *Service) Preference(ctx context.Context, userID, column string) (map[string]any, error) {
	if err := s.ensureSettings(ctx, userID); err != nil {
		return nil, err
	}
	current, err := s.jsonColumn(ctx, userID, column)
	if err != nil {
		return nil, err
	}
	return current, nil
}

func (s *Service) UpdatePreference(ctx context.Context, userID, column string, patch map[string]any) (map[string]any, error) {
	switch column {
	case "notification_settings", "sound_settings", "storage_settings", "advanced_settings":
	default:
		return nil, fmt.Errorf("%w: unknown preference section", ErrInvalidSettings)
	}
	if err := validateSettingsPatch(column, patch); err != nil {
		return nil, err
	}
	if len(patch) == 0 {
		return s.Preference(ctx, userID, column)
	}
	input := AllSettings{}
	var result func(AllSettings) map[string]any
	switch column {
	case "notification_settings":
		input.NotificationSettings = patch
		result = func(state AllSettings) map[string]any { return state.NotificationSettings }
	case "sound_settings":
		input.SoundSettings = patch
		result = func(state AllSettings) map[string]any { return state.SoundSettings }
	case "storage_settings":
		input.StorageSettings = patch
		result = func(state AllSettings) map[string]any { return state.StorageSettings }
	case "advanced_settings":
		input.AdvancedSettings = patch
		result = func(state AllSettings) map[string]any { return state.AdvancedSettings }
	}
	input, err := notificationPatch(input)
	if err != nil {
		return nil, err
	}
	current, err := s.mutateSettings(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	out := withSettingsDefaults(column, result(current))
	if column == "sound_settings" {
		notificationpolicy.FromMap(current.Settings).ProjectSound(out)
	}
	return out, nil
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
	settings, privacy, err := s.readSettings(ctx, userID, "legacy_settings")
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
	if chats == nil {
		chats = []ExportChat{}
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
	if blocked == nil {
		blocked = []BlockedUser{}
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
	// Уведомление — тем же запросом (#760): уходит, только если строка
	// вставлена, и доставляется после коммита.
	result, err := s.db.ExecContext(ctx, `
		WITH inserted AS (
			INSERT INTO users.blocked_users (user_id, blocked_user_id)
			VALUES ($1, $2)
			ON CONFLICT (user_id, blocked_user_id) DO NOTHING
			RETURNING 1
		)
		SELECT pg_notify($3, $4) FROM inserted
	`, userID, blockedUserID, blockevent.Channel, blockEventPayload(userID, blockedUserID, true))
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrAlreadyBlocked
	}
	return nil
}

func blockEventPayload(userID, blockedUserID string, blocked bool) string {
	payload, _ := json.Marshal(blockevent.Changed{UserID: userID, BlockedUserID: blockedUserID, Blocked: blocked})
	return string(payload)
}

func (s *Service) Unblock(ctx context.Context, userID, blockedUserID string) error {
	_, err := s.db.ExecContext(ctx, `
		WITH deleted AS (
			DELETE FROM users.blocked_users WHERE user_id = $1 AND blocked_user_id = $2
			RETURNING 1
		)
		SELECT pg_notify($3, $4) FROM deleted
	`, userID, blockedUserID, blockevent.Channel, blockEventPayload(userID, blockedUserID, false))
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
	var raw []byte
	var q string
	switch column {
	case "notification_settings":
		q = `SELECT notification_settings FROM users.settings WHERE user_id = $1`
	case "sound_settings":
		var settings []byte
		if err := s.db.QueryRowContext(ctx, `SELECT sound_settings, settings FROM users.settings WHERE user_id=$1`, userID).Scan(&raw, &settings); err != nil {
			return nil, err
		}
		out := normalizeStoredSettings(column, raw)
		notificationpolicy.Read(settings).ProjectSound(out)
		return out, nil
	case "advanced_settings":
		q = `SELECT advanced_settings FROM users.settings WHERE user_id = $1`
	case "storage_settings":
		q = `SELECT storage_settings FROM users.settings WHERE user_id = $1`
	default:
		return nil, ErrInvalidInput
	}
	if err := s.db.QueryRowContext(ctx, q, userID).Scan(&raw); err != nil {
		return nil, err
	}
	return normalizeStoredSettings(column, raw), nil
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

// RegisterDevice enriches the caller's existing session. User-Agent is metadata,
// never an identity key: two identical browsers can hold independent sessions.
func (s *Service) RegisterDevice(ctx context.Context, userID, accessTokenHash, deviceName, deviceType, ipAddress, location, userAgent string) (string, error) {
	var sessionID string
	err := s.db.QueryRowContext(ctx, `
		UPDATE auth.sessions s
		SET device_name = $3, device_type = $4, ip_address = $5,
			location = $6, user_agent = $7, last_active = NOW()
		FROM auth.users u
		WHERE s.user_id = $1 AND s.access_token_hash = $2 AND u.id = s.user_id
			AND s.revoked_at IS NULL AND s.expires_at > NOW()
			AND s.token_generation = u.token_generation
			AND NOT EXISTS (SELECT 1 FROM auth.revoked_tokens rt
				WHERE rt.token_hash = s.access_token_hash AND rt.expires_at > NOW())
		RETURNING s.id::text
	`, userID, accessTokenHash, deviceName, deviceType, ipAddress, location, userAgent).Scan(&sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrAuthSessionInactive
	}
	return sessionID, err
}

func (s *Service) Devices(ctx context.Context, userID, currentToken string) ([]Session, error) {
	canonical, err := auth.NewService(s.db, nil).Sessions(ctx, userID, currentToken)
	if err != nil {
		return nil, err
	}
	sessions := make([]Session, 0, len(canonical))
	for _, item := range canonical {
		sessions = append(sessions, Session{
			ID: item.ID, DeviceName: item.DeviceName, DeviceType: item.DeviceType,
			IPAddress: item.IPAddress, Location: item.Location, UserAgent: item.UserAgent,
			LastActive: item.LastActive.Format(time.RFC3339Nano),
			FirstLogin: item.CreatedAt.Format(time.RFC3339Nano), IsCurrent: item.IsCurrent,
		})
	}
	return sessions, nil
}

func (s *Service) DeleteDevice(ctx context.Context, userID, sessionID, currentTokenHash string) error {
	return s.revokeDevices(ctx, userID, sessionID, currentTokenHash)
}

// TerminateAllDevices preserves the caller; /auth/logout-all also revokes it.
func (s *Service) TerminateAllDevices(ctx context.Context, userID, currentTokenHash string) error {
	return s.revokeDevices(ctx, userID, "", currentTokenHash)
}

func (s *Service) revokeDevices(ctx context.Context, userID, sessionID, currentTokenHash string) error {
	if currentTokenHash == "" {
		return ErrAuthSessionInactive
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Serialize with logout-all and issuance's generation check. Session row
	// locks below serialize metadata updates with selective revocation.
	var generation int64
	if err := tx.QueryRowContext(ctx, `SELECT token_generation FROM auth.users WHERE id = $1 FOR UPDATE`, userID).Scan(&generation); err != nil {
		return err
	}
	var callerActive bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM auth.sessions s WHERE s.user_id = $1 AND s.access_token_hash = $2
			AND s.revoked_at IS NULL AND s.expires_at > NOW() AND s.token_generation = $3
			AND NOT EXISTS (SELECT 1 FROM auth.revoked_tokens rt
				WHERE rt.token_hash = s.access_token_hash AND rt.expires_at > NOW())
	)`, userID, currentTokenHash, generation).Scan(&callerActive); err != nil {
		return err
	}
	if !callerActive {
		return ErrAuthSessionInactive
	}
	var hashes []string
	if sessionID != "" {
		var hash string
		err := tx.QueryRowContext(ctx, `
			SELECT access_token_hash FROM auth.sessions
			WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
				AND expires_at > NOW() AND token_generation = $3 AND access_token_hash IS NOT NULL
			FOR UPDATE
		`, sessionID, userID, generation).Scan(&hash)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if hash == currentTokenHash {
			return ErrCannotTerminateCurrentSession
		}
		hashes = append(hashes, hash)
	} else {
		rows, err := tx.QueryContext(ctx, `
			SELECT access_token_hash FROM auth.sessions
			WHERE user_id = $1 AND access_token_hash != $2 AND revoked_at IS NULL
				AND expires_at > NOW() AND token_generation = $3
			FOR UPDATE
		`, userID, currentTokenHash, generation)
		if err != nil {
			return err
		}
		for rows.Next() {
			var hash string
			if err := rows.Scan(&hash); err != nil {
				_ = rows.Close()
				return err
			}
			hashes = append(hashes, hash)
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return err
		}
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(ctx, `
			WITH revoked AS (
				UPDATE auth.sessions SET revoked_at = NOW()
				WHERE user_id = $1 AND access_token_hash = $2 AND revoked_at IS NULL
				RETURNING access_token_hash, user_id, expires_at
			)
			INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at)
			SELECT access_token_hash, user_id, expires_at FROM revoked
			ON CONFLICT DO NOTHING
		`, userID, hash); err != nil {
			return err
		}
		if err := authctx.NotifyRevocation(ctx, tx, authctx.RevocationEvent{UserID: userID, TokenHash: hash}); err != nil {
			return err
		}
	}
	return tx.Commit()
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
	if timeout < 0 {
		// Handler валидирует timeout раньше; через API отрицательное значение недостижимо.
		return ErrInvalidInput
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
