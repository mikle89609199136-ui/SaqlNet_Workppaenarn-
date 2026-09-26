package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	usernamepolicy "craneapp/backend-v2/internal/platform/username"
	"github.com/lib/pq"
)

var (
	ErrInvalidCredentials     = errors.New("invalid credentials")
	ErrUsernameTaken          = errors.New("username already exists")
	ErrWrongPassword          = errors.New("wrong password")
	ErrTwoFANotEnabled        = errors.New("2fa not enabled")
	ErrTwoFARequired          = errors.New("2fa required")
	ErrInvalidTwoFA           = errors.New("invalid 2fa")
	ErrUserNotFound           = errors.New("user not found")
	ErrTokenGenerationChanged = errors.New("token generation kept changing during issuance")
	ErrAuthorizationRevoked   = errors.New("authorization token was revoked during issuance")
)

const tokenIssueMaxAttempts = 3

type Session struct {
	ID         string    `json:"id"`
	DeviceName string    `json:"deviceName"`
	DeviceType string    `json:"deviceType"`
	IPAddress  string    `json:"ipAddress"`
	LastActive time.Time `json:"lastActive"`
	CreatedAt  time.Time `json:"createdAt"`
}

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Bio          string `json:"bio"`
	AvatarUrl    string `json:"avatarUrl"`
	PasswordHash string `json:"-"`
}

type CryptoClient interface {
	HashPassword(ctx context.Context, password string) (string, error)
	VerifyPassword(ctx context.Context, password, hash string) (bool, error)
	IssueToken(ctx context.Context, userID, username string, tokenGeneration int64) (string, error)
}

type Service struct {
	db     *sql.DB
	crypto CryptoClient
}

func NewService(db *sql.DB, crypto CryptoClient) *Service {
	return &Service{db: db, crypto: crypto}
}

func (s *Service) Register(ctx context.Context, username, password, firstName, lastName, language string) (User, string, error) {
	username = usernamepolicy.Normalize(username)
	if err := ValidatePassword(password); err != nil {
		return User{}, "", err
	}
	hash, err := s.crypto.HashPassword(ctx, password)
	if err != nil {
		return User{}, "", err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, "", err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var user User
	var tokenGeneration int64
	err = tx.QueryRowContext(ctx, `
		WITH claimed AS (
			INSERT INTO auth.username_registry (username, user_id)
			VALUES ($1, gen_random_uuid())
			RETURNING user_id
		)
		INSERT INTO auth.users (id, username, password_hash, first_name, last_name)
		SELECT user_id, $1, $2, $3, $4 FROM claimed
		RETURNING id::text, username, first_name, last_name, token_generation
	`, username, hash, strings.TrimSpace(firstName), strings.TrimSpace(lastName)).Scan(
		&user.ID,
		&user.Username,
		&user.FirstName,
		&user.LastName,
		&tokenGeneration,
	)
	if err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, "", ErrUsernameTaken
		}
		return User{}, "", err
	}

	user.Bio = ""
	user.AvatarUrl = ""

	_, err = tx.ExecContext(ctx, `
		INSERT INTO users.profiles (user_id, first_name, last_name, bio, avatar_url)
		VALUES ($1, $2, $3, '', '')
	`, user.ID, user.FirstName, user.LastName)
	if err != nil {
		return User{}, "", err
	}

	lang := language
	if lang == "" {
		lang = "ru"
	}
	langJSON, _ := json.Marshal(lang)
	defaultSettings := `{"theme":"dark","notifications":true,"sounds":true,"language":` + string(langJSON) + `}`

	_, err = tx.ExecContext(ctx, `
		INSERT INTO users.settings (user_id, settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders)
		VALUES ($1, $2,
			'{"lastSeen":"all","phoneVisibility":"contacts","photoVisibility":"all","messagesFromStrangers":true,"groupsAdd":"all","twoFactorAuth":false,"autoDeleteAccount":true}',
			'{"privateChats":true,"groups":true,"channels":true,"calls":true,"videoCalls":true,"inAppNotifications":true,"messagePreview":true,"readReceipts":false,"reactions":true,"newContacts":true}',
			'{"notificationsVolume":80,"mediaVolume":100,"notificationsSound":true,"messagesSound":true,"sendSound":true,"callsSound":true,"vibrateOnCall":true,"notificationSound":"default","messageSound":"default","ringtone":"default"}',
			'{"autoDownloadMobile":true,"autoDownloadWifi":true,"autoDownloadRoaming":false,"deleteMediaAfter":"never"}',
			'{"autoReconnect":true,"fastConnection":true,"connectionType":"auto","dataCompression":true,"saveDrafts":true,"analytics":false,"developerMode":false,"debugLog":false,"hardwareAcceleration":true,"autoplayGifs":true}', '[]')
	`, user.ID, defaultSettings)
	if err != nil {
		return User{}, "", err
	}

	// Issue before commit so a protocol/crypto failure rolls the registration
	// back instead of leaving an account that received no usable first token.
	// The uncommitted user row cannot be logged out concurrently, so the
	// generation returned by INSERT remains current through this issuance.
	token, err := s.crypto.IssueToken(ctx, user.ID, user.Username, tokenGeneration)
	if err != nil {
		return User{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return User{}, "", err
	}

	return user, token, nil
}

func (s *Service) Login(ctx context.Context, username, password, twoFAPassword string) (User, string, error) {
	username = usernamepolicy.Normalize(username)

	var user User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id::text, u.username,
			COALESCE(p.first_name, u.first_name), COALESCE(p.last_name, u.last_name),
			u.password_hash,
			COALESCE(p.bio, ''), COALESCE(p.avatar_url, '')
		FROM auth.users u
		LEFT JOIN users.profiles p ON p.user_id = u.id
		WHERE lower(u.username) = lower($1) AND u.disabled_at IS NULL
	`, username).Scan(&user.ID, &user.Username, &user.FirstName, &user.LastName, &user.PasswordHash, &user.Bio, &user.AvatarUrl)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", err
	}

	valid, err := s.crypto.VerifyPassword(ctx, password, user.PasswordHash)
	if err != nil {
		return User{}, "", err
	}
	if !valid {
		return User{}, "", ErrInvalidCredentials
	}

	var twoFAEnabled bool
	var twoFAHash sql.NullString
	var tokenGeneration int64
	if err := s.db.QueryRowContext(ctx, `
		SELECT two_fa_enabled, two_fa_hash, token_generation
		FROM auth.users
		WHERE id = $1
	`, user.ID).Scan(&twoFAEnabled, &twoFAHash, &tokenGeneration); err != nil {
		return User{}, "", err
	}

	if twoFAEnabled {
		if twoFAPassword == "" {
			return user, "", ErrTwoFARequired
		}
		if twoFAHash.Valid {
			valid2FA, err := s.crypto.VerifyPassword(ctx, twoFAPassword, twoFAHash.String)
			if err != nil {
				return User{}, "", err
			}
			if !valid2FA {
				return User{}, "", ErrInvalidTwoFA
			}
		}
	}

	token, err := s.issueTokenWithStableGeneration(ctx, user.ID, user.Username, tokenGeneration)
	return user, token, err
}

func (s *Service) SavePublicKey(ctx context.Context, userID, publicKey string) error {
	publicKey = strings.TrimSpace(publicKey)
	if publicKey == "" {
		return errors.New("public key is required")
	}
	var userExists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1)`, userID).Scan(&userExists); err != nil {
		return err
	}
	if !userExists {
		return ErrUserNotFound
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth.public_keys (user_id, public_key, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = NOW()
	`, userID, publicKey)
	if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23503" {
		return ErrUserNotFound
	}
	return err
}

// IssueQRToken issues a token for QR login only while the token authorizing
// this confirmation still belongs to the user's current generation. Unlike a
// password login, an in-flight QR confirmation must not cross logout-all and
// regain access with the newly incremented generation.
func (s *Service) IssueQRToken(ctx context.Context, userID string, authorizedGeneration int64) (string, error) {
	var username string
	var currentGeneration int64
	err := s.db.QueryRowContext(ctx, `
		SELECT username, token_generation
		FROM auth.users
		WHERE id = $1
	`, userID).Scan(&username, &currentGeneration)
	if err != nil {
		return "", err
	}
	if currentGeneration != authorizedGeneration {
		return "", ErrAuthorizationRevoked
	}

	token, err := s.crypto.IssueToken(ctx, userID, username, authorizedGeneration)
	if err != nil {
		return "", err
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT token_generation
		FROM auth.users
		WHERE id = $1
	`, userID).Scan(&currentGeneration); err != nil {
		return "", err
	}
	if currentGeneration != authorizedGeneration {
		return "", ErrAuthorizationRevoked
	}
	return token, nil
}

// issueTokenWithStableGeneration prevents a concurrent logout-all from making
// a newly returned token stale. The successful generation re-read is the
// issuance linearization point: a logout-all committed before it forces a
// retry, while one committed afterwards logically revokes this issuance.
func (s *Service) issueTokenWithStableGeneration(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
	for attempt := 0; attempt < tokenIssueMaxAttempts; attempt++ {
		token, err := s.crypto.IssueToken(ctx, userID, username, tokenGeneration)
		if err != nil {
			return "", err
		}

		var currentGeneration int64
		if err := s.db.QueryRowContext(ctx, `
			SELECT token_generation
			FROM auth.users
			WHERE id = $1
		`, userID).Scan(&currentGeneration); err != nil {
			return "", err
		}
		if currentGeneration == tokenGeneration {
			return token, nil
		}
		tokenGeneration = currentGeneration
	}

	return "", ErrTokenGenerationChanged
}

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// IsTokenRevoked returns true if this token was revoked explicitly or was
// issued before the user's most recent logout-all operation.
func (s *Service) IsTokenRevoked(ctx context.Context, token string, claims cryptoclient.TokenClaims) (bool, error) {
	return authctx.NewDBTokenChecker(s.db).IsTokenRevoked(ctx, token, claims)
}

// Logout revokes the given token.
func (s *Service) Logout(ctx context.Context, userID, token string, expiresAt time.Time) error {
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, tokenHash(token), userID, expiresAt); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE public.user_sessions
		SET is_current = FALSE, last_active = NOW() - INTERVAL '6 minutes'
		WHERE user_id = $1
	`, userID)
	return err
}

// LogoutAll revokes all tokens issued for a user up to the current moment.
func (s *Service) LogoutAll(ctx context.Context, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var tokenGeneration int64
	if err := tx.QueryRowContext(ctx, `
		UPDATE auth.users
		SET token_generation = token_generation + 1
		WHERE id = $1
		RETURNING token_generation
	`, userID).Scan(&tokenGeneration); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE auth.sessions SET revoked_at = NOW()
		WHERE user_id = $1 AND revoked_at IS NULL
	`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE public.user_sessions
		SET is_current = FALSE, last_active = NOW() - INTERVAL '6 minutes'
		WHERE user_id = $1
	`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// ChangePassword verifies the current password and replaces the hash.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash FROM auth.users WHERE id = $1`, userID).Scan(&hash)
	if err != nil {
		return err
	}
	valid, err := s.crypto.VerifyPassword(ctx, currentPassword, hash)
	if err != nil {
		return err
	}
	if !valid {
		return ErrWrongPassword
	}
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	newHash, err := s.crypto.HashPassword(ctx, newPassword)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE auth.users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, newHash, userID)
	return err
}

// TwoFAStatus returns whether 2FA is enabled for the user.
func (s *Service) TwoFAStatus(ctx context.Context, userID string) (bool, error) {
	var enabled bool
	err := s.db.QueryRowContext(ctx, `SELECT two_fa_enabled FROM auth.users WHERE id = $1`, userID).Scan(&enabled)
	return enabled, err
}

// TwoFAEnable enables 2FA with a secondary password.
func (s *Service) TwoFAEnable(ctx context.Context, userID, password string) error {
	if err := ValidatePassword(password); err != nil {
		return err
	}
	hash, err := s.crypto.HashPassword(ctx, password)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE auth.users SET two_fa_hash = $1, two_fa_enabled = TRUE, updated_at = NOW() WHERE id = $2
	`, hash, userID)
	return err
}

// TwoFADisable disables 2FA after verifying the 2FA password.
func (s *Service) TwoFADisable(ctx context.Context, userID, password string) error {
	var hash sql.NullString
	if err := s.db.QueryRowContext(ctx, `SELECT two_fa_hash FROM auth.users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return err
	}
	if !hash.Valid {
		return ErrTwoFANotEnabled
	}
	valid, err := s.crypto.VerifyPassword(ctx, password, hash.String)
	if err != nil {
		return err
	}
	if !valid {
		return ErrWrongPassword
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE auth.users SET two_fa_hash = NULL, two_fa_enabled = FALSE, updated_at = NOW() WHERE id = $1
	`, userID)
	return err
}

// TwoFAVerify verifies the 2FA password. Returns (required, ok, error).
func (s *Service) TwoFAVerify(ctx context.Context, userID, password string) (required, ok bool, err error) {
	var enabled bool
	var hash sql.NullString
	if err = s.db.QueryRowContext(ctx, `SELECT two_fa_enabled, two_fa_hash FROM auth.users WHERE id = $1`, userID).Scan(&enabled, &hash); err != nil {
		return
	}
	if !enabled || !hash.Valid {
		return false, true, nil
	}
	ok, err = s.crypto.VerifyPassword(ctx, password, hash.String)
	return true, ok, err
}

// Sessions lists active (non-revoked) sessions for a user.
func (s *Service) Sessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, device_name, device_type, ip_address, last_active, created_at
		FROM auth.sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
		ORDER BY last_active DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()
	var sessions []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.DeviceName, &s.DeviceType, &s.IPAddress, &s.LastActive, &s.CreatedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}
