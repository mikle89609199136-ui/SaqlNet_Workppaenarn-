package user

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
)

var ErrKeyNotFound = errors.New("key not found")

const maxKeyRotationsPerHour = 10

type PublicKeyData struct {
	PublicKey   string  `json:"publicKey"`
	KeyID       string  `json:"keyId"`
	PQPublicKey *string `json:"pqPublicKey,omitempty"`
}

type ChatEncryptedKey struct {
	UserID       string  `json:"userId"`
	EncryptedKey string  `json:"encryptedKey"`
	SenderKeyID  *string `json:"senderKeyId,omitempty"`
	PQCiphertext *string `json:"pqCiphertext,omitempty"`
	KeyEpoch     int     `json:"keyEpoch"`
}

func isValidBase64(s string) bool {
	if len(s) == 0 {
		return false
	}
	_, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		_, err = base64.RawStdEncoding.DecodeString(s)
	}
	return err == nil
}

func (s *Service) UpsertPublicKey(ctx context.Context, userID string, data PublicKeyData) error {
	if !isValidBase64(data.PublicKey) || len(data.KeyID) < 16 || len(data.KeyID) > 128 {
		return errors.New("invalid publicKey or keyId")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO crypto.user_public_keys (user_id, public_key, key_id, pq_public_key, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET public_key = EXCLUDED.public_key, key_id = EXCLUDED.key_id,
		    pq_public_key = EXCLUDED.pq_public_key, updated_at = NOW()
	`, userID, data.PublicKey, data.KeyID, data.PQPublicKey)
	return err
}

func (s *Service) GetPublicKey(ctx context.Context, requesterID, targetUserID string) (PublicKeyData, error) {
	// Requester must share a chat with target (or be the same user).
	if requesterID != targetUserID {
		var dummy int
		err := s.db.QueryRowContext(ctx, `
			SELECT 1 FROM chats.members a
			JOIN chats.members b ON a.chat_id = b.chat_id
			WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1
		`, requesterID, targetUserID).Scan(&dummy)
		if errors.Is(err, sql.ErrNoRows) {
			return PublicKeyData{}, errors.New("access denied")
		}
		if err != nil {
			return PublicKeyData{}, err
		}
	}
	var d PublicKeyData
	err := s.db.QueryRowContext(ctx,
		`SELECT public_key, key_id, pq_public_key FROM crypto.user_public_keys WHERE user_id = $1`,
		targetUserID,
	).Scan(&d.PublicKey, &d.KeyID, &d.PQPublicKey)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicKeyData{}, ErrKeyNotFound
	}
	return d, err
}

func (s *Service) GetChatKeys(ctx context.Context, userID, chatID string) ([]ChatEncryptedKey, error) {
	if err := s.assertChatMember(ctx, chatID, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT cek.user_id::text, cek.encrypted_key, cek.sender_key_id, cek.pq_ciphertext, cek.key_epoch
		FROM chats.members cm
		JOIN crypto.chat_encryption_keys cek ON cm.user_id = cek.user_id AND cek.chat_id = cm.chat_id
		WHERE cm.chat_id = $1
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []ChatEncryptedKey
	for rows.Next() {
		var k ChatEncryptedKey
		if err := rows.Scan(&k.UserID, &k.EncryptedKey, &k.SenderKeyID, &k.PQCiphertext, &k.KeyEpoch); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *Service) SaveChatKeys(ctx context.Context, userID, chatID string, keys []ChatEncryptedKey, epoch int) error {
	if err := s.assertChatMember(ctx, chatID, userID); err != nil {
		return err
	}
	for _, k := range keys {
		if err := s.assertChatMember(ctx, chatID, k.UserID); err != nil {
			continue // skip non-members silently
		}
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO crypto.chat_encryption_keys
			    (chat_id, user_id, encrypted_key, sender_key_id, pq_ciphertext, key_epoch, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			ON CONFLICT (chat_id, user_id) DO UPDATE
			SET encrypted_key = EXCLUDED.encrypted_key,
			    sender_key_id = EXCLUDED.sender_key_id,
			    pq_ciphertext = EXCLUDED.pq_ciphertext,
			    key_epoch     = EXCLUDED.key_epoch,
			    updated_at    = NOW()
			WHERE crypto.chat_encryption_keys.key_epoch <= EXCLUDED.key_epoch
		`, chatID, k.UserID, k.EncryptedKey, k.SenderKeyID, k.PQCiphertext, epoch)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) RotateChatKey(ctx context.Context, userID, chatID string, keys []ChatEncryptedKey, epoch int) error {
	if err := s.assertChatMember(ctx, chatID, userID); err != nil {
		return err
	}
	// Rate limit: max 10 rotations per hour.
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM crypto.audit_log
		WHERE event_type = 'key_rotation' AND chat_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
	`, chatID).Scan(&count); err != nil {
		return err
	}
	if count >= maxKeyRotationsPerHour {
		return errors.New("key rotation rate limit exceeded")
	}
	if err := s.SaveChatKeys(ctx, userID, chatID, keys, epoch); err != nil {
		return err
	}
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO crypto.audit_log (user_id, chat_id, event_type, created_at)
		VALUES ($1, $2, 'key_rotation', NOW())
	`, userID, chatID)
	return nil
}

func (s *Service) GetMyKey(ctx context.Context, userID, chatID string) (ChatEncryptedKey, error) {
	var k ChatEncryptedKey
	err := s.db.QueryRowContext(ctx, `
		SELECT encrypted_key, sender_key_id, pq_ciphertext, key_epoch
		FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID).Scan(&k.EncryptedKey, &k.SenderKeyID, &k.PQCiphertext, &k.KeyEpoch)
	if errors.Is(err, sql.ErrNoRows) {
		return ChatEncryptedKey{}, ErrKeyNotFound
	}
	k.UserID = userID
	return k, err
}

func (s *Service) assertChatMember(ctx context.Context, chatID, userID string) error {
	var dummy int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2`,
		chatID, userID,
	).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("access denied")
	}
	return err
}
