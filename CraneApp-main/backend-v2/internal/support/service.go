package support

import (
	"context"
	"database/sql"
	"errors"
)

var ErrNotFound = errors.New("request not found")
var ErrForbidden = errors.New("access denied")

type Request struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Status    string `json:"status"`
	UserID    string `json:"userId"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Message struct {
	ID        string `json:"id"`
	SenderID  string `json:"senderId"`
	IsStaff   bool   `json:"isStaff"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ListRequests(ctx context.Context, userID string) ([]Request, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, subject, status, user_id::text, created_at::text, updated_at::text
		FROM support.requests WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reqs []Request
	for rows.Next() {
		var r Request
		if err := rows.Scan(&r.ID, &r.Subject, &r.Status, &r.UserID, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func (s *Service) CreateRequest(ctx context.Context, userID, subject, firstMessage string) (Request, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Request{}, err
	}
	defer tx.Rollback()
	var r Request
	err = tx.QueryRowContext(ctx, `
		INSERT INTO support.requests (user_id, subject) VALUES ($1, $2)
		RETURNING id::text, subject, status, user_id::text, created_at::text, updated_at::text
	`, userID, subject).Scan(&r.ID, &r.Subject, &r.Status, &r.UserID, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return Request{}, err
	}
	if firstMessage != "" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO support.messages (request_id, sender_id, is_staff, content) VALUES ($1, $2, FALSE, $3)
		`, r.ID, userID, firstMessage)
		if err != nil {
			return Request{}, err
		}
	}
	return r, tx.Commit()
}

func (s *Service) GetRequest(ctx context.Context, userID, requestID string) (Request, error) {
	var r Request
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, subject, status, user_id::text, created_at::text, updated_at::text
		FROM support.requests WHERE id = $1
	`, requestID).Scan(&r.ID, &r.Subject, &r.Status, &r.UserID, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, err
	}
	if r.UserID != userID {
		return Request{}, ErrForbidden
	}
	return r, nil
}

func (s *Service) ListMessages(ctx context.Context, userID, requestID string) ([]Message, error) {
	if _, err := s.GetRequest(ctx, userID, requestID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, COALESCE(sender_id::text, ''), is_staff, content, created_at::text
		FROM support.messages WHERE request_id = $1 ORDER BY created_at ASC
	`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SenderID, &m.IsStaff, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

func (s *Service) Reply(ctx context.Context, userID, requestID, content string, isStaff bool) (Message, error) {
	if _, err := s.GetRequest(ctx, userID, requestID); err != nil {
		return Message{}, err
	}
	var m Message
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO support.messages (request_id, sender_id, is_staff, content)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, COALESCE(sender_id::text, ''), is_staff, content, created_at::text
	`, requestID, userID, isStaff, content).Scan(&m.ID, &m.SenderID, &m.IsStaff, &m.Content, &m.CreatedAt)
	return m, err
}
