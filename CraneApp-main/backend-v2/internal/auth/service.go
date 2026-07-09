package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/lib/pq"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUsernameTaken      = errors.New("username already exists")
	ErrWrongPassword      = errors.New("wrong password")
	ErrTwoFANotEnabled    = errors.New("2fa not enabled")
	ErrTwoFARequired      = errors.New("2fa required")
	ErrInvalidTwoFA       = errors.New("invalid 2fa")
)

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

type Service struct {
	db     *sql.DB
	crypto *cryptoclient.Client
}

func NewService(db *sql.DB, crypto *cryptoclient.Client) *Service {
	return &Service{db: db, crypto: crypto}
}

func (s *Service) Register(ctx context.Context, username, password, firstName, lastName, language string) (User, string, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	hash, err := s.crypto.HashPassword(ctx, password)
	if err != nil {
		return User{}, "", err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback()

	var user User
	var disc int
	inserted := false
	// Try up to 20 random discriminators (0–999) before giving up.
	for attempt := 0; attempt < 20; attempt++ {
		var buf [2]byte
		if _, err := rand.Read(buf[:]); err != nil {
			return User{}, "", err
		}
		disc = int(binary.BigEndian.Uint16(buf[:])) % 1000

		err = tx.QueryRowContext(ctx, `
			INSERT INTO auth.users (username, username_discriminator, password_hash, first_name, last_name)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id::text, username, first_name, last_name
		`, username, disc, hash, strings.TrimSpace(firstName), strings.TrimSpace(lastName)).Scan(
			&user.ID, &user.Username, &user.FirstName, &user.LastName,
		)
		if err == nil {
			inserted = true
			break
		}
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Constraint == "auth_users_username_discriminator_key" {
			continue
		}
		return User{}, "", err
	}
	if !inserted {
		return User{}, "", ErrUsernameTaken
	}
	user.Username = fmt.Sprintf("%s.%d", user.Username, disc)

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
		VALUES ($1, $2, '{"lastSeen":"all","phoneVisibility":"contacts","photoVisibility":"all","messagesFromStrangers":true,"groupsAdd":"all","twoFactorAuth":false,"autoDeleteAccount":true}', '{"privateChats":true,"groups":true,"channels":true,"calls":true,"videoCalls":true,"inAppNotifications":true,"messagePreview":true,"readReceipts":false,"reactions":true,"newContacts":true}', '{"notificationsVolume":80,"mediaVolume":100,"notificationsSound":true,"messagesSound":true,"sendSound":true,"callsSound":true,"vibrateOnCall":true,"notificationSound":"default","messageSound":"default","ringtone":"default"}', '{"autoDownloadMobile":true,"autoDownloadWifi":true,"autoDownloadRoaming":false,"deleteMediaAfter":"never"}', '{"autoReconnect":true,"fastConnection":true,"connectionType":"auto","dataCompression":true,"saveDrafts":true,"analytics":false,"developerMode":false,"debugLog":false,"hardwareAcceleration":true,"autoplayGifs":true}', '[]')
	`, user.ID, defaultSettings)
	if err != nil {
		return User{}, "", err
	}

	if err := tx.Commit(); err != nil {
		return User{}, "", err
	}

	token, err := s.crypto.IssueToken(ctx, user.ID, user.Username)
	return user, token, err
}

func (s *Service) Login(ctx context.Context, username, password, twoFAPassword string) (User, string, error) {
	username = strings.ToLower(strings.TrimSpace(username))

	// Parse "base.discriminator" format (e.g. "alex.247").
	baseUsername := username
	disc := -1
	if idx := strings.LastIndex(username, "."); idx > 0 {
		if d, err := strconv.Atoi(username[idx+1:]); err == nil && d >= 0 && d <= 999 {
			baseUsername = username[:idx]
			disc = d
		}
	}

	var user User
	var scanDisc int
	var err error
	if disc >= 0 {
		err = s.db.QueryRowContext(ctx, `
			SELECT u.id::text, u.username, u.username_discriminator, u.first_name, u.last_name, u.password_hash,
			       COALESCE(p.bio, ''), COALESCE(p.avatar_url, '')
			FROM auth.users u
			LEFT JOIN users.profiles p ON p.user_id = u.id
			WHERE u.username = $1 AND u.username_discriminator = $2 AND u.disabled_at IS NULL
		`, baseUsername, disc).Scan(
			&user.ID, &user.Username, &scanDisc, &user.FirstName, &user.LastName, &user.PasswordHash,
			&user.Bio, &user.AvatarUrl,
		)
	} else {
		// Fallback: match by base username alone (takes first match).
		err = s.db.QueryRowContext(ctx, `
			SELECT u.id::text, u.username, u.username_discriminator, u.first_name, u.last_name, u.password_hash,
			       COALESCE(p.bio, ''), COALESCE(p.avatar_url, '')
			FROM auth.users u
			LEFT JOIN users.profiles p ON p.user_id = u.id
			WHERE u.username = $1 AND u.disabled_at IS NULL
			LIMIT 1
		`, baseUsername).Scan(
			&user.ID, &user.Username, &scanDisc, &user.FirstName, &user.LastName, &user.PasswordHash,
			&user.Bio, &user.AvatarUrl,
		)
	}
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
	_ = s.db.QueryRowContext(ctx, `SELECT two_fa_enabled, two_fa_hash FROM auth.users WHERE id = $1`, user.ID).Scan(&twoFAEnabled, &twoFAHash)

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

	user.Username = fmt.Sprintf("%s.%d", user.Username, scanDisc)
	token, err := s.crypto.IssueToken(ctx, user.ID, user.Username)
	return user, token, err
}

func (s *Service) SavePublicKey(ctx context.Context, userID, publicKey string) error {
	publicKey = strings.TrimSpace(publicKey)
	if publicKey == "" {
		return errors.New("public key is required")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth.public_keys (user_id, public_key, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = NOW()
	`, userID, publicKey)
	return err
}

// IssueQRToken issues a new token for the given user ID, used for QR login confirmation.
func (s *Service) IssueQRToken(ctx context.Context, userID string) (string, error) {
	var username string
	var disc int
	err := s.db.QueryRowContext(ctx, `SELECT username, username_discriminator FROM auth.users WHERE id = $1`, userID).Scan(&username, &disc)
	if err != nil {
		return "", err
	}
	fullUsername := fmt.Sprintf("%s.%d", username, disc)
	return s.crypto.IssueToken(ctx, userID, fullUsername)
}

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// IsTokenRevoked returns true if the token has been revoked.
func (s *Service) IsTokenRevoked(ctx context.Context, token string) bool {
	var dummy int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM auth.revoked_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
		tokenHash(token),
	).Scan(&dummy)
	return err == nil
}

// Logout revokes the given token.
func (s *Service) Logout(ctx context.Context, userID, token string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, tokenHash(token), userID, expiresAt)
	return err
}

// LogoutAll revokes all tokens for a user by inserting a sentinel with far future expiry.
// Tokens issued before revoked_all_at are considered invalid.
func (s *Service) LogoutAll(ctx context.Context, userID string) error {
	// Mark all existing sessions as revoked.
	_, err := s.db.ExecContext(ctx, `
		UPDATE auth.sessions SET revoked_at = NOW()
		WHERE user_id = $1 AND revoked_at IS NULL
	`, userID)
	return err
}

// RevokedAllBefore returns the timestamp of the last logout-all for a user (or zero).
func (s *Service) RevokedAllBefore(ctx context.Context, userID string) (time.Time, error) {
	var t time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(revoked_at), '1970-01-01') FROM auth.sessions WHERE user_id = $1
	`, userID).Scan(&t)
	return t, err
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
	defer rows.Close()
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
