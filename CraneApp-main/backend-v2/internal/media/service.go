package media

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrTooBig       = errors.New("file too large")
	ErrBadType      = errors.New("unsupported content type")
	ErrNotFound     = errors.New("upload not found")
	ErrForbidden    = errors.New("access denied")
)

const maxUploadBytes = 100 << 20 // 100 MB

var allowedTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/gif":       true,
	"image/webp":      true,
	"video/mp4":       true,
	"video/webm":      true,
	"audio/mpeg":      true,
	"audio/ogg":       true,
	"audio/webm":      true,
	"application/pdf": true,
	"text/plain":      true,
}

// Store abstracts object storage (MinIO / S3-compatible).
type Store interface {
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error
	PresignGet(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, bucket, key string) error
}

type Upload struct {
	ID          string `json:"id"`
	UploaderID  string `json:"uploaderId"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	URL         string `json:"url,omitempty"`
	CreatedAt   string `json:"createdAt"`
}

type Service struct {
	db     *sql.DB
	store  Store
	bucket string
}

func NewService(db *sql.DB, store Store, bucket string) *Service {
	return &Service{db: db, store: store, bucket: bucket}
}

func (s *Service) UploadRaw(ctx context.Context, userID, filename, contentType string, data []byte, isEncrypted bool, encryptionJSON string) (Upload, error) {
	if int64(len(data)) > maxUploadBytes {
		return Upload{}, ErrTooBig
	}

	base := strings.SplitN(contentType, ";", 2)[0]

	ext := filepath.Ext(filename)
	if ext == "" {
		if base == "image/jpeg" { ext = ".jpg" }
		if base == "image/png" { ext = ".png" }
		if base == "video/mp4" { ext = ".mp4" }
	}
	objectKey := fmt.Sprintf("%s/%d%s", userID, time.Now().UnixNano(), ext)

	if err := s.store.Put(ctx, s.bucket, objectKey, bytes.NewReader(data), int64(len(data)), base); err != nil {
		return Upload{}, err
	}

	var up Upload
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO media.uploads (uploader_id, bucket, object_key, filename, content_type, size_bytes, is_encrypted, encryption_key_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id::text, uploader_id::text, filename, content_type, size_bytes, created_at::text
	`, userID, s.bucket, objectKey, filename, base, len(data), isEncrypted, encryptionJSON).
		Scan(&up.ID, &up.UploaderID, &up.Filename, &up.ContentType, &up.SizeBytes, &up.CreatedAt)
	if err != nil {
		_ = s.store.Delete(ctx, s.bucket, objectKey)
		return Upload{}, err
	}

	up.URL, _ = s.store.PresignGet(ctx, s.bucket, objectKey, 24*time.Hour)
	return up, nil
}

func (s *Service) UploadEncrypted(ctx context.Context, userID, base64Ciphertext, encryptionJSON, contentType string) (Upload, error) {
	data, err := base64.StdEncoding.DecodeString(base64Ciphertext)
	if err != nil {
		return Upload{}, fmt.Errorf("invalid ciphertext base64: %w", err)
	}
	return s.UploadRaw(ctx, userID, "", contentType, data, true, encryptionJSON)
}

func (s *Service) Upload(ctx context.Context, userID string, fh *multipart.FileHeader) (Upload, error) {
	if fh.Size > maxUploadBytes {
		return Upload{}, ErrTooBig
	}
	ct := fh.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	base := strings.SplitN(ct, ";", 2)[0]
	if !allowedTypes[base] {
		return Upload{}, ErrBadType
	}

	f, err := fh.Open()
	if err != nil {
		return Upload{}, err
	}
	defer f.Close()

	data, err := io.ReadAll(io.LimitReader(f, maxUploadBytes+1))
	if err != nil {
		return Upload{}, err
	}

	return s.UploadRaw(ctx, userID, fh.Filename, base, data, false, "")
}

func (s *Service) Get(ctx context.Context, userID, uploadID string) (Upload, error) {
	var up Upload
	var objectKey string
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, uploader_id::text, bucket, object_key, filename, content_type, size_bytes, created_at::text
		FROM media.uploads WHERE id = $1
	`, uploadID).Scan(&up.ID, &up.UploaderID, &objectKey, &up.Filename, &up.ContentType, &up.SizeBytes, &up.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Upload{}, ErrNotFound
	}
	if err != nil {
		return Upload{}, err
	}

	var bucket string
	_ = s.db.QueryRowContext(ctx, `SELECT bucket FROM media.uploads WHERE id = $1`, uploadID).Scan(&bucket)
	up.URL, _ = s.store.PresignGet(ctx, bucket, objectKey, time.Hour)
	return up, nil
}

func (s *Service) ServeProxy(ctx context.Context, uploadID string, w http.ResponseWriter) error {
	var objectKey, bucket, contentType string
	var isEncrypted bool
	var encryptionJSON sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT bucket, object_key, content_type, is_encrypted, encryption_key_id 
		FROM media.uploads WHERE id = $1
	`, uploadID).Scan(&bucket, &objectKey, &contentType, &isEncrypted, &encryptionJSON)
	
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "22P02" {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if isEncrypted {
		// Download object, encode as base64, return JSON
		url, err := s.store.PresignGet(ctx, bucket, objectKey, 5*time.Minute)
		if err != nil {
			return err
		}
		
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		
		var encMeta map[string]any
		if encryptionJSON.Valid && encryptionJSON.String != "" {
			_ = json.Unmarshal([]byte(encryptionJSON.String), &encMeta)
		} else {
			encMeta = map[string]any{}
		}
		encMeta["encrypted"] = true
		encMeta["ciphertext"] = base64.StdEncoding.EncodeToString(data)
		
		if encMeta["mimeType"] == nil {
			encMeta["mimeType"] = contentType
		}
		if encMeta["sizeBytes"] == nil {
			encMeta["sizeBytes"] = len(data)
		}

		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(encMeta)
		return nil
	}

	url, err := s.store.PresignGet(ctx, bucket, objectKey, 5*time.Minute)
	if err != nil {
		return err
	}
	w.Header().Set("Location", url)
	w.WriteHeader(http.StatusTemporaryRedirect)
	return nil
}
