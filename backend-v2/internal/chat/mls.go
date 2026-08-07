package chat

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const maxKeypackagesPerUpload = 20

type MLSKeyPackage struct {
	KeyPackageID    string `json:"keypackageId"`
	KeyPackageBytes string `json:"keypackageBytes"`
}

type MLSGroupState struct {
	Epoch         int64   `json:"epoch"`
	TreeStructure *string `json:"treeStructure"`
}

type mlsValidateResp struct {
	Valid     bool   `json:"valid"`
	KeyID     string `json:"key_id"`
	NextEpoch int64  `json:"next_epoch"`
}

func callRustMLS(ctx context.Context, cryptoURL, path string, body any) (mlsValidateResp, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return mlsValidateResp{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cryptoURL+path, bytes.NewReader(data))
	if err != nil {
		return mlsValidateResp{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return mlsValidateResp{}, fmt.Errorf("crypto service unavailable: %w", err)
	}
	defer resp.Body.Close()
	var result mlsValidateResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return mlsValidateResp{}, err
	}
	return result, nil
}

func (s *Service) MLSUploadKeyPackages(ctx context.Context, userID string, packages []string, cryptoURL string) error {
	if len(packages) == 0 || len(packages) > maxKeypackagesPerUpload {
		return fmt.Errorf("keypackages array must have 1–%d entries", maxKeypackagesPerUpload)
	}
	for _, kpBytes := range packages {
		v, err := callRustMLS(ctx, cryptoURL, "/api/v2/crypto/mls/validate-keypackage", map[string]string{"keypackage_bytes": kpBytes})
		if err != nil {
			return errors.New("crypto service unavailable")
		}
		if !v.Valid {
			return errors.New("invalid keypackage format")
		}
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO crypto.user_mls_keypackages (user_id, keypackage_id, keypackage_bytes, created_at)
			VALUES ($1, $2, $3, NOW())
		`, userID, v.KeyID, kpBytes)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) MLSFetchKeyPackage(ctx context.Context, requesterID, targetUserID string) (MLSKeyPackage, error) {
	var dummy int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM chats.members a
		JOIN chats.members b ON a.chat_id = b.chat_id
		WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1
	`, requesterID, targetUserID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return MLSKeyPackage{}, errors.New("access denied")
	}
	if err != nil {
		return MLSKeyPackage{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MLSKeyPackage{}, err
	}
	defer tx.Rollback()

	var kp MLSKeyPackage
	var id string
	err = tx.QueryRowContext(ctx, `
		SELECT id::text, keypackage_id, keypackage_bytes FROM crypto.user_mls_keypackages
		WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE
	`, targetUserID).Scan(&id, &kp.KeyPackageID, &kp.KeyPackageBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return MLSKeyPackage{}, errors.New("no keypackages available for user")
	}
	if err != nil {
		return MLSKeyPackage{}, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM crypto.user_mls_keypackages WHERE id = $1`, id); err != nil {
		return MLSKeyPackage{}, err
	}
	return kp, tx.Commit()
}

func (s *Service) MLSGetGroupState(ctx context.Context, userID, chatID string) (MLSGroupState, error) {
	if err := s.assertMember(ctx, chatID, userID); err != nil {
		return MLSGroupState{}, err
	}
	var state MLSGroupState
	err := s.db.QueryRowContext(ctx,
		`SELECT epoch, tree_structure FROM crypto.group_mls_state WHERE chat_id = $1`, chatID,
	).Scan(&state.Epoch, &state.TreeStructure)
	if errors.Is(err, sql.ErrNoRows) {
		return MLSGroupState{Epoch: 0}, nil
	}
	return state, err
}

func (s *Service) MLSCommit(ctx context.Context, userID, chatID string, commitBytes string, currentEpoch int64, treeStructure string, cryptoURL string) (int64, error) {
	if err := s.assertMember(ctx, chatID, userID); err != nil {
		return 0, err
	}
	v, err := callRustMLS(ctx, cryptoURL, "/api/v2/crypto/mls/validate-commit", map[string]any{
		"commit_bytes":  commitBytes,
		"current_epoch": currentEpoch,
	})
	if err != nil {
		return 0, errors.New("crypto service unavailable")
	}
	if !v.Valid {
		return 0, errors.New("invalid commit format")
	}
	nextEpoch := v.NextEpoch

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var dbEpoch int64
	errScan := tx.QueryRowContext(ctx,
		`SELECT epoch FROM crypto.group_mls_state WHERE chat_id = $1 FOR UPDATE`, chatID,
	).Scan(&dbEpoch)
	if !errors.Is(errScan, sql.ErrNoRows) && errScan != nil {
		return 0, errScan
	}
	if !errors.Is(errScan, sql.ErrNoRows) && dbEpoch != currentEpoch {
		return 0, fmt.Errorf("epoch conflict: db=%d requested=%d", dbEpoch, currentEpoch)
	}

	if errors.Is(errScan, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO crypto.group_mls_state (chat_id, epoch, tree_structure, updated_at) VALUES ($1, $2, $3, NOW())`,
			chatID, nextEpoch, treeStructure)
	} else {
		_, err = tx.ExecContext(ctx,
			`UPDATE crypto.group_mls_state SET epoch = $1, tree_structure = $2, updated_at = NOW() WHERE chat_id = $3`,
			nextEpoch, treeStructure, chatID)
	}
	if err != nil {
		return 0, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO crypto.group_mls_commits (chat_id, epoch, sender_id, commit_bytes, created_at)
		VALUES ($1, $2, $3, $4, NOW())
	`, chatID, nextEpoch, userID, commitBytes)
	if err != nil {
		return 0, err
	}

	// Clean up processed proposals
	_, err = tx.ExecContext(ctx, `
		DELETE FROM crypto.group_mls_proposals 
		WHERE chat_id = $1 AND epoch <= $2
	`, chatID, currentEpoch)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO crypto.audit_log (user_id, chat_id, event_type, details, created_at)
		VALUES ($1, $2, 'mls_commit', $3, NOW())
	`, userID, chatID, fmt.Sprintf(`{"epoch":%d}`, nextEpoch))
	return nextEpoch, nil
}

func (s *Service) MLSStoreWelcome(ctx context.Context, senderID, chatID, recipientID, welcomeBytes string, epoch int64, cryptoURL string) error {
	if err := s.assertMember(ctx, chatID, senderID); err != nil {
		return err
	}
	if err := s.assertMember(ctx, chatID, recipientID); err != nil {
		return errors.New("recipient is not a group member")
	}
	v, err := callRustMLS(ctx, cryptoURL, "/api/v2/crypto/mls/validate-welcome", map[string]string{"welcome_bytes": welcomeBytes})
	if err != nil {
		return errors.New("crypto service unavailable")
	}
	if !v.Valid {
		return errors.New("invalid welcome format")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO crypto.group_mls_welcome (chat_id, recipient_id, sender_id, epoch, welcome_bytes, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (chat_id, recipient_id) DO UPDATE
		SET sender_id = EXCLUDED.sender_id, epoch = EXCLUDED.epoch, welcome_bytes = EXCLUDED.welcome_bytes, created_at = NOW()
	`, chatID, recipientID, senderID, epoch, welcomeBytes)
	return err
}

func (s *Service) MLSGetWelcome(ctx context.Context, userID, chatID string) (map[string]any, error) {
	var senderID string
	var epoch int64
	var welcomeBytes string
	err := s.db.QueryRowContext(ctx, `
		SELECT sender_id::text, epoch, welcome_bytes FROM crypto.group_mls_welcome
		WHERE chat_id = $1 AND recipient_id = $2
	`, chatID, userID).Scan(&senderID, &epoch, &welcomeBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("no welcome message available")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"senderId": senderID, "epoch": epoch, "welcomeBytes": welcomeBytes}, nil
}

func (s *Service) assertMember(ctx context.Context, chatID, userID string) error {
	var dummy int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, userID,
	).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("access denied")
	}
	return err
}

func (s *Service) MLSAddProposal(ctx context.Context, senderID, chatID, proposalType, proposalBytes string, epoch int64, cryptoURL string) error {
	if err := s.assertMember(ctx, chatID, senderID); err != nil {
		return err
	}

	v, err := callRustMLS(ctx, cryptoURL, "/api/v2/crypto/mls/validate-proposal", map[string]string{
		"proposal_bytes": proposalBytes,
		"proposal_type":  proposalType,
	})
	if err != nil {
		return errors.New("crypto service unavailable")
	}
	if !v.Valid {
		return errors.New("invalid proposal format")
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO crypto.group_mls_proposals (chat_id, sender_id, proposal_type, proposal_bytes, epoch, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
	`, chatID, senderID, proposalType, proposalBytes, epoch)
	return err
}

func (s *Service) MLSGetProposals(ctx context.Context, userID, chatID string) ([]map[string]any, error) {
	if err := s.assertMember(ctx, chatID, userID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, sender_id, proposal_type, proposal_bytes, epoch 
		FROM crypto.group_mls_proposals
		WHERE chat_id = $1
		ORDER BY created_at ASC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var proposals []map[string]any
	for rows.Next() {
		var id, senderID, pType, pBytes string
		var epoch int64
		if err := rows.Scan(&id, &senderID, &pType, &pBytes, &epoch); err != nil {
			return nil, err
		}
		proposals = append(proposals, map[string]any{
			"id":            id,
			"senderId":      senderID,
			"proposalType":  pType,
			"proposalBytes": pBytes,
			"epoch":         epoch,
		})
	}

	if proposals == nil {
		proposals = []map[string]any{}
	}

	return proposals, nil
}
