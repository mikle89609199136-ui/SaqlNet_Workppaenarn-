package user

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Key backup storage (#740).
//
// The client encrypts its identity and chat keys with a master key that never
// leaves its devices, and opens that master key with a cloud password, a
// passkey or a QR hand-off. Everything stored here is opaque: the server only
// checks sizes and shapes, never the contents.

var (
	ErrBackupNotFound        = errors.New("key backup not found")
	ErrBackupVersionConflict = errors.New("key backup version conflict")
	ErrInvalidBackup         = errors.New("invalid key backup")
)

const (
	maxBackupIdentityBytes    = 16 << 10
	maxBackupSlots            = 8
	maxBackupSlotsBytes       = 32 << 10
	maxBackupChatKeyBytes     = 1 << 10
	maxBackupChatKeysPerBatch = 500
	defaultBackupChatKeysPage = 200
	maxBackupChatKeysPage     = 1000
)

// zeroUUID sorts before every real chat ID and starts pagination.
const zeroUUID = "00000000-0000-0000-0000-000000000000"

type KeyBackup struct {
	Version       int64           `json:"version"`
	FormatVersion int             `json:"formatVersion"`
	Identity      string          `json:"identity"`
	Slots         json.RawMessage `json:"slots"`
	UpdatedAt     string          `json:"updatedAt"`
}

type BackupChatKey struct {
	ChatID       string `json:"chatId"`
	Epoch        int    `json:"epoch"`
	EncryptedKey string `json:"encryptedKey"`
}

func validateBackupSlots(slots json.RawMessage) error {
	if len(slots) == 0 || len(slots) > maxBackupSlotsBytes {
		return ErrInvalidBackup
	}
	var items []json.RawMessage
	if err := json.Unmarshal(slots, &items); err != nil {
		return ErrInvalidBackup
	}
	if len(items) == 0 || len(items) > maxBackupSlots {
		return ErrInvalidBackup
	}
	for _, item := range items {
		if !bytes.HasPrefix(bytes.TrimSpace(item), []byte("{")) {
			return ErrInvalidBackup
		}
	}
	return nil
}

func (s *Service) GetKeyBackup(ctx context.Context, userID string) (KeyBackup, error) {
	var backup KeyBackup
	var slots []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT version, format_version, identity, slots, updated_at::text
		FROM crypto.key_backups WHERE user_id = $1
	`, userID).Scan(&backup.Version, &backup.FormatVersion, &backup.Identity, &slots, &backup.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return KeyBackup{}, ErrBackupNotFound
	}
	if err != nil {
		return KeyBackup{}, err
	}
	backup.Slots = slots
	return backup, nil
}

// PutKeyBackup creates the backup when expectedVersion is 0 and replaces it
// otherwise. Two devices editing slots at once must not silently drop each
// other's changes, so a stale expectedVersion yields ErrBackupVersionConflict.
func (s *Service) PutKeyBackup(ctx context.Context, userID string, expectedVersion int64, formatVersion int, identity string, slots json.RawMessage) (int64, error) {
	if expectedVersion < 0 || formatVersion < 1 || len(identity) > maxBackupIdentityBytes || !isValidBase64(identity) {
		return 0, ErrInvalidBackup
	}
	if err := validateBackupSlots(slots); err != nil {
		return 0, err
	}

	var version int64
	var err error
	if expectedVersion == 0 {
		err = s.db.QueryRowContext(ctx, `
			INSERT INTO crypto.key_backups (user_id, version, format_version, identity, slots, updated_at)
			VALUES ($1, 1, $2, $3, $4, NOW())
			ON CONFLICT (user_id) DO NOTHING
			RETURNING version
		`, userID, formatVersion, identity, []byte(slots)).Scan(&version)
	} else {
		err = s.db.QueryRowContext(ctx, `
			UPDATE crypto.key_backups
			SET version = version + 1, format_version = $3, identity = $4, slots = $5, updated_at = NOW()
			WHERE user_id = $1 AND version = $2
			RETURNING version
		`, userID, expectedVersion, formatVersion, identity, []byte(slots)).Scan(&version)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrBackupVersionConflict
	}
	return version, err
}

// DeleteKeyBackup removes the backup together with every chat key in it.
func (s *Service) DeleteKeyBackup(ctx context.Context, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM crypto.chat_key_backups WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM crypto.key_backups WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func validateBackupChatKey(key BackupChatKey) error {
	if !isValidUUID(key.ChatID) || key.Epoch < 1 || len(key.EncryptedKey) > maxBackupChatKeyBytes || !isValidBase64(key.EncryptedKey) {
		return ErrInvalidBackup
	}
	return nil
}

// SaveBackupChatKeys stores chat keys and returns how many were new. An epoch
// already in the backup is left as is, and keys of chats that no longer exist
// are skipped: a client retrying after a chat was deleted must not get stuck.
func (s *Service) SaveBackupChatKeys(ctx context.Context, userID string, keys []BackupChatKey) (int, error) {
	if len(keys) == 0 || len(keys) > maxBackupChatKeysPerBatch {
		return 0, ErrInvalidBackup
	}
	for _, key := range keys {
		if err := validateBackupChatKey(key); err != nil {
			return 0, err
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	stored := 0
	for _, key := range keys {
		result, err := tx.ExecContext(ctx, `
			INSERT INTO crypto.chat_key_backups (user_id, chat_id, key_epoch, encrypted_key, created_at)
			SELECT $1, $2, $3, $4, NOW()
			WHERE EXISTS (SELECT 1 FROM chats.chats WHERE id = $2)
			ON CONFLICT (user_id, chat_id, key_epoch) DO NOTHING
		`, userID, key.ChatID, key.Epoch, key.EncryptedKey)
		if err != nil {
			return 0, err
		}
		if affected, err := result.RowsAffected(); err == nil {
			stored += int(affected)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return stored, nil
}

func encodeBackupCursor(key BackupChatKey) string {
	return fmt.Sprintf("%s:%d", key.ChatID, key.Epoch)
}

func decodeBackupCursor(cursor string) (string, int, error) {
	if cursor == "" {
		return zeroUUID, 0, nil
	}
	chatID, epochText, ok := strings.Cut(cursor, ":")
	epoch, err := strconv.Atoi(epochText)
	if !ok || err != nil || epoch < 0 || !isValidUUID(chatID) {
		return "", 0, ErrInvalidBackup
	}
	return chatID, epoch, nil
}

// ListBackupChatKeys pages through the backup in (chat, epoch) order. chatID
// narrows the list to one chat; an empty next means the list is complete.
func (s *Service) ListBackupChatKeys(ctx context.Context, userID, chatID, after string, limit int) ([]BackupChatKey, string, error) {
	if chatID != "" && !isValidUUID(chatID) {
		return nil, "", ErrInvalidBackup
	}
	if limit <= 0 {
		limit = defaultBackupChatKeysPage
	}
	if limit > maxBackupChatKeysPage {
		limit = maxBackupChatKeysPage
	}
	afterChat, afterEpoch, err := decodeBackupCursor(after)
	if err != nil {
		return nil, "", err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT chat_id::text, key_epoch, encrypted_key
		FROM crypto.chat_key_backups
		WHERE user_id = $1
		  AND ($2 = '' OR chat_id = NULLIF($2, '')::uuid)
		  AND (chat_id, key_epoch) > ($3::uuid, $4)
		ORDER BY chat_id, key_epoch
		LIMIT $5
	`, userID, chatID, afterChat, afterEpoch, limit+1)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	keys := []BackupChatKey{}
	for rows.Next() {
		var key BackupChatKey
		if err := rows.Scan(&key.ChatID, &key.Epoch, &key.EncryptedKey); err != nil {
			return nil, "", err
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	next := ""
	if len(keys) > limit {
		keys = keys[:limit]
		next = encodeBackupCursor(keys[len(keys)-1])
	}
	return keys, next, nil
}
