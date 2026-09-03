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
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrTooBig          = errors.New("file too large")
	ErrBadType         = errors.New("unsupported content type")
	ErrNotFound        = errors.New("upload not found")
	ErrForbidden       = errors.New("access denied")
	ErrObjectNotFound  = errors.New("media object not found")
	ErrStorage         = errors.New("media storage failure")
	ErrResponseStarted = errors.New("media response stream failed")
)

const maxUploadBytes = 100 << 20 // 100 MB

const maxFilenameBytes = 255

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
	Get(ctx context.Context, bucket, key string, options GetOptions) (*ObjectResponse, error)
	PresignGet(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, bucket, key string) error
}

type GetOptions struct {
	Head  bool
	Range string
}

type ObjectResponse struct {
	Body          io.ReadCloser
	StatusCode    int
	ContentLength int64
	ContentRange  string
	AcceptRanges  string
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

func sanitizeFilename(filename string) string {
	// path.Base handles client-provided Windows paths after normalising separators.
	filename = path.Base(strings.ReplaceAll(strings.TrimSpace(filename), `\`, "/"))
	if filename == "." || filename == "/" {
		return ""
	}
	for len(filename) > maxFilenameBytes {
		_, size := utf8.DecodeLastRuneInString(filename)
		filename = filename[:len(filename)-size]
	}
	return filename
}

func (s *Service) UploadRaw(ctx context.Context, userID, filename, contentType string, data []byte, isEncrypted bool, encryptionJSON string) (Upload, error) {
	if int64(len(data)) > maxUploadBytes {
		return Upload{}, ErrTooBig
	}

	filename = sanitizeFilename(filename)
	base := strings.SplitN(contentType, ";", 2)[0]

	ext := filepath.Ext(filename)
	if ext == "" {
		if base == "image/jpeg" {
			ext = ".jpg"
		}
		if base == "image/png" {
			ext = ".png"
		}
		if base == "video/mp4" {
			ext = ".mp4"
		}
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

func (s *Service) UploadEncrypted(ctx context.Context, userID, filename, base64Ciphertext, encryptionJSON, contentType string) (Upload, error) {
	data, err := base64.StdEncoding.DecodeString(base64Ciphertext)
	if err != nil {
		return Upload{}, fmt.Errorf("invalid ciphertext base64: %w", err)
	}
	return s.UploadRaw(ctx, userID, filename, contentType, data, true, encryptionJSON)
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

func (s *Service) ServeProxy(ctx context.Context, uploadID string, w http.ResponseWriter, options GetOptions) error {
	var objectKey, bucket, contentType string
	var sizeBytes int64
	var isEncrypted bool
	var encryptionJSON sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT bucket, object_key, content_type, size_bytes, is_encrypted, encryption_key_id
		FROM media.uploads WHERE id = $1
	`, uploadID).Scan(&bucket, &objectKey, &contentType, &sizeBytes, &isEncrypted, &encryptionJSON)

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
		encryptedOptions := GetOptions{}
		if options.Head {
			encryptedOptions.Head = true
		}
		object, err := s.store.Get(ctx, bucket, objectKey, encryptedOptions)
		if err != nil {
			return storageError(ctx, err)
		}
		defer object.Body.Close()
		switch object.StatusCode {
		case http.StatusOK:
		case http.StatusNotFound:
			return ErrObjectNotFound
		default:
			return ErrStorage
		}
		if options.Head {
			w.Header().Set("Cache-Control", "private, max-age=86400")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			return nil
		}

		// Preserve the existing encrypted JSON/base64 response contract.
		data, err := io.ReadAll(object.Body)
		if err != nil {
			return storageError(ctx, err)
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

	object, err := s.store.Get(ctx, bucket, objectKey, options)
	if err != nil {
		return storageError(ctx, err)
	}
	defer object.Body.Close()

	switch object.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
	case http.StatusNotFound:
		return ErrObjectNotFound
	case http.StatusRequestedRangeNotSatisfiable:
		copyObjectHeader(w.Header(), "Content-Range", object.ContentRange)
		copyObjectHeader(w.Header(), "Accept-Ranges", object.AcceptRanges)
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return nil
	default:
		return ErrStorage
	}

	w.Header().Set("Content-Type", safeContentType(contentType))
	copyObjectHeader(w.Header(), "Content-Range", object.ContentRange)
	copyObjectHeader(w.Header(), "Accept-Ranges", object.AcceptRanges)
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}

	contentLength := sizeBytes
	if object.StatusCode == http.StatusPartialContent {
		contentLength = object.ContentLength
	}
	if contentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	}
	w.WriteHeader(object.StatusCode)

	if options.Head {
		return nil
	}
	if _, err := io.Copy(w, object.Body); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %v", ErrResponseStarted, err)
	}
	return nil
}

func storageError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return fmt.Errorf("%w: %v", ErrStorage, err)
}

func copyObjectHeader(header http.Header, name, value string) {
	if value != "" {
		header.Set(name, value)
	}
}

func safeContentType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil || mediaType == "" {
		return "application/octet-stream"
	}
	return mediaType
}
