package admin

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrForbidden   = errors.New("access denied")
	ErrInvalidInput = errors.New("invalid input")
)

type UserSummary struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	Phone       string `json:"phone"`
	Email       string `json:"email"`
	DisabledAt  string `json:"disabledAt,omitempty"`
	CreatedAt   string `json:"createdAt"`
}

type Report struct {
	ID           string `json:"id"`
	ReporterID   string `json:"reporterId"`
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	Reason       string `json:"reason"`
	Description  string `json:"description,omitempty"`
	Status       string `json:"status"`
	CreatedAt    string `json:"createdAt"`
	ResolvedAt   string `json:"resolvedAt,omitempty"`
	ResolvedBy   string `json:"resolvedBy,omitempty"`
}

type SupportRequest struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Subject   string `json:"subject"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) isAdmin(ctx context.Context, userID string) (bool, error) {
	var ok bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1 AND role = 'admin' AND disabled_at IS NULL)`, userID).Scan(&ok)
	return ok, err
}

func (s *Service) requireAdmin(ctx context.Context, userID string) error {
	ok, err := s.isAdmin(ctx, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

func (s *Service) ListUsers(ctx context.Context, adminID, search string, limit, offset int) ([]UserSummary, error) {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if strings.TrimSpace(search) != "" {
		pattern := "%" + strings.TrimSpace(search) + "%"
		rows, err = s.db.QueryContext(ctx, `
			SELECT id::text, username, COALESCE(phone,''), COALESCE(email,''),
			       COALESCE(disabled_at::text,''), created_at::text
			FROM auth.users
			WHERE username ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
			ORDER BY created_at DESC LIMIT $2 OFFSET $3
		`, pattern, limit, offset)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id::text, username, COALESCE(phone,''), COALESCE(email,''),
			       COALESCE(disabled_at::text,''), created_at::text
			FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2
		`, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []UserSummary
	for rows.Next() {
		var u UserSummary
		if err := rows.Scan(&u.ID, &u.Username, &u.Phone, &u.Email, &u.DisabledAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Service) DisableUser(ctx context.Context, adminID, targetID string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	if targetID == adminID {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, `UPDATE auth.users SET disabled_at = NOW() WHERE id = $1 AND disabled_at IS NULL`, targetID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}

	// Auto-resolve reports targeting this user
	_, _ = s.db.ExecContext(ctx, `
		UPDATE admin.reports SET status = 'resolved', resolved_at = NOW(), resolved_by = $1, resolution = 'User disabled'
		WHERE target_type = 'user' AND target_id = $2 AND status = 'open'
	`, adminID, targetID)

	return nil
}

func (s *Service) EnableUser(ctx context.Context, adminID, targetID string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE auth.users SET disabled_at = NULL WHERE id = $1`, targetID)
	return err
}

func (s *Service) MuteUser(ctx context.Context, adminID, targetID, reason string, mutedUntil *time.Time) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	if targetID == adminID {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, `UPDATE auth.users SET muted_until = $1, mute_reason = $2 WHERE id = $3`, mutedUntil, reason, targetID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}

	// Auto-resolve reports targeting this user
	_, _ = s.db.ExecContext(ctx, `
		UPDATE admin.reports SET status = 'resolved', resolved_at = NOW(), resolved_by = $1, resolution = 'User muted'
		WHERE target_type = 'user' AND target_id = $2 AND status = 'open'
	`, adminID, targetID)

	return nil
}

func (s *Service) UnmuteUser(ctx context.Context, adminID, targetID string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE auth.users SET muted_until = NULL, mute_reason = NULL WHERE id = $1`, targetID)
	return err
}

func (s *Service) ListReports(ctx context.Context, adminID, status string, limit, offset int) ([]Report, error) {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if status != "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id::text, reporter_id::text, target_type, target_id::text, reason, description, status,
			       created_at::text, COALESCE(resolved_at::text,''), COALESCE(resolved_by::text,'')
			FROM admin.reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
		`, status, limit, offset)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id::text, reporter_id::text, target_type, target_id::text, reason, description, status,
			       created_at::text, COALESCE(resolved_at::text,''), COALESCE(resolved_by::text,'')
			FROM admin.reports ORDER BY created_at DESC LIMIT $1 OFFSET $2
		`, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reports []Report
	for rows.Next() {
		var r Report
		if err := rows.Scan(&r.ID, &r.ReporterID, &r.TargetType, &r.TargetID, &r.Reason, &r.Description, &r.Status, &r.CreatedAt, &r.ResolvedAt, &r.ResolvedBy); err != nil {
			return nil, err
		}
		reports = append(reports, r)
	}
	return reports, rows.Err()
}

func (s *Service) GetReport(ctx context.Context, adminID, reportID string) (Report, error) {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return Report{}, err
	}
	var r Report
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, reporter_id::text, target_type, target_id::text, reason, description, status,
		       created_at::text, COALESCE(resolved_at::text,''), COALESCE(resolved_by::text,'')
		FROM admin.reports WHERE id = $1
	`, reportID).Scan(&r.ID, &r.ReporterID, &r.TargetType, &r.TargetID, &r.Reason, &r.Description, &r.Status, &r.CreatedAt, &r.ResolvedAt, &r.ResolvedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, err
	}
	return r, nil
}

func (s *Service) CreateReport(ctx context.Context, reporterID, targetType, targetID, reason, description string) (string, error) {
	if targetType == "" || targetID == "" || strings.TrimSpace(reason) == "" {
		return "", ErrInvalidInput
	}
	var id string
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO admin.reports (reporter_id, target_type, target_id, reason, description, status)
		VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id::text
	`, reporterID, targetType, targetID, strings.TrimSpace(reason), description).Scan(&id)
	return id, err
}

func (s *Service) ResolveReport(ctx context.Context, adminID, reportID, resolution string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE admin.reports SET status = 'resolved', resolved_at = NOW(), resolved_by = $1, resolution = $2
		WHERE id = $3 AND status = 'open'
	`, adminID, resolution, reportID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) ListSupportRequests(ctx context.Context, adminID string, limit, offset int) ([]SupportRequest, error) {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 { limit = 50 }
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, user_id::text, subject, status, created_at::text
		FROM support.requests ORDER BY created_at DESC LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reqs []SupportRequest
	for rows.Next() {
		var r SupportRequest
		if err := rows.Scan(&r.ID, &r.UserID, &r.Subject, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func (s *Service) UpdateSupportRequestStatus(ctx context.Context, adminID, requestID, status string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, "UPDATE support.requests SET status = $1, updated_at = NOW() WHERE id = $2", status, requestID)
	return err
}

func (s *Service) ReplyToSupportRequest(ctx context.Context, adminID, requestID, content string) error {
	if err := s.requireAdmin(ctx, adminID); err != nil {
		return err
	}
	var userID string
	err := s.db.QueryRowContext(ctx, "SELECT user_id::text FROM support.requests WHERE id = $1", requestID).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO support.messages (request_id, sender_id, is_staff, content)
		VALUES ($1, $2, TRUE, $3)
	`, requestID, adminID, content)
	if err != nil {
		return err
	}
	var botID string
	err = s.db.QueryRowContext(ctx, "SELECT id::text FROM auth.users WHERE username = 'craneapp_bot'").Scan(&botID)
	if err == nil {
		var chatID string
		err = s.db.QueryRowContext(ctx, `
			SELECT c.id::text FROM chats.chats c
			JOIN chats.members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
			JOIN chats.members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
			WHERE c.type = 'private' LIMIT 1
		`, userID, botID).Scan(&chatID)
		if err == nil {
			_, _ = s.db.ExecContext(ctx, `
				INSERT INTO messages.messages (chat_id, sender_id, content, type)
				VALUES ($1, $2, $3, 'text')
			`, chatID, botID, content)
		}
	}
	_, _ = s.db.ExecContext(ctx, "UPDATE support.requests SET status = 'closed', updated_at = NOW() WHERE id = $1", requestID)
	return nil
}
