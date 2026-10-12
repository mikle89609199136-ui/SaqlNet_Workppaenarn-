package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

type StickerPack struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	IconUrl      string `json:"iconUrl"`
	StickerCount int    `json:"stickerCount"`
	CreatedAt    string `json:"createdAt"`
}

type Sticker struct {
	ID        string `json:"id"`
	ImageUrl  string `json:"imageUrl"`
	CreatedAt string `json:"createdAt"`
}

type uploadedStickerObject struct {
	URL       string
	Bucket    string
	ObjectKey string
}

func (h *Handler) uploadBase64(ctx context.Context, userID string, b64 string) (uploadedStickerObject, error) {
	if !strings.HasPrefix(b64, "data:") {
		return uploadedStickerObject{}, fmt.Errorf("invalid data url")
	}
	parts := strings.SplitN(b64, ",", 2)
	if len(parts) != 2 {
		return uploadedStickerObject{}, fmt.Errorf("invalid data url")
	}
	header := parts[0]
	b64Data := parts[1]

	mimeType := "application/octet-stream"
	if strings.Contains(header, ";base64") {
		mimeType = strings.TrimPrefix(header, "data:")
		mimeType = strings.TrimSuffix(mimeType, ";base64")
	}

	data, err := decodeBase64Payload(b64Data, h.service.maxUploadBytes)
	if err != nil {
		return uploadedStickerObject{}, err
	}

	objectKey := fmt.Sprintf("%s/stickers/%d", userID, time.Now().UnixNano())
	if err := h.service.store.Put(ctx, h.service.bucket, objectKey, bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
		return uploadedStickerObject{}, err
	}

	url, err := h.service.store.PresignGet(ctx, h.service.bucket, objectKey, 365*24*time.Hour)
	if err != nil {
		_ = h.service.store.Delete(ctx, h.service.bucket, objectKey)
		return uploadedStickerObject{}, err
	}
	return uploadedStickerObject{URL: url, Bucket: h.service.bucket, ObjectKey: objectKey}, nil
}

func (h *Handler) ListStickerPacks(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)

	rows, err := h.service.db.QueryContext(r.Context(), `
		SELECT sp.id::text, sp.name, sp.description, CASE WHEN sp.icon_bucket <> '' AND sp.icon_object_key <> '' THEN '/api/v2/media/' || sp.id::text ELSE '' END,
			   (SELECT COUNT(*) FROM media.stickers WHERE pack_id = sp.id),
			   sp.created_at::text
		FROM media.sticker_packs sp
		WHERE sp.user_id = $1
		ORDER BY sp.created_at DESC
	`, user.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	var packs []StickerPack
	for rows.Next() {
		var p StickerPack
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.IconUrl, &p.StickerCount, &p.CreatedAt); err != nil {
			continue
		}
		packs = append(packs, p)
	}
	if packs == nil {
		packs = []StickerPack{}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"packs": packs})
}

func (h *Handler) CreateStickerPack(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, h.jsonBodyLimit())
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Icon        string `json:"icon"` // base64
	}
	if err := decodeSingleJSON(r.Body, &req); err != nil {
		if isMaxBytesError(err) {
			httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "request_too_large", requestLimitMessage(h.jsonBodyLimit()))
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid json")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}

	var icon uploadedStickerObject
	var err error
	if req.Icon != "" {
		icon, err = h.uploadBase64(r.Context(), user.ID, req.Icon)
		if err != nil {
			if errors.Is(err, ErrTooBig) {
				httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "file_too_large", uploadLimitMessage(h.service.maxUploadBytes))
				return
			}
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "upload_error", err.Error())
			return
		}
	}
	var iconBucket, iconObjectKey any
	if icon.ObjectKey != "" {
		iconBucket = icon.Bucket
		iconObjectKey = icon.ObjectKey
	}

	var p StickerPack
	err = h.service.db.QueryRowContext(r.Context(), `
		INSERT INTO media.sticker_packs (user_id, name, description, icon_url, icon_bucket, icon_object_key)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id::text, name, description, COALESCE(icon_url, ''), created_at::text
	`, user.ID, name, req.Description, icon.URL, iconBucket, iconObjectKey).Scan(&p.ID, &p.Name, &p.Description, &p.IconUrl, &p.CreatedAt)
	if err != nil {
		if icon.ObjectKey != "" {
			_ = h.service.store.Delete(r.Context(), icon.Bucket, icon.ObjectKey)
		}
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	if icon.ObjectKey != "" {
		p.IconUrl = "/api/v2/media/" + p.ID
	}
	p.StickerCount = 0
	httpx.JSON(w, http.StatusCreated, map[string]any{"success": true, "pack": p})
}

func (h *Handler) GetStickers(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	packID := parts[4]

	rows, err := h.service.db.QueryContext(r.Context(), `
		SELECT id::text, CASE WHEN bucket <> '' AND object_key <> '' THEN '/api/v2/media/' || id::text ELSE '' END, created_at::text
		FROM media.stickers
		WHERE pack_id = $1
		ORDER BY created_at DESC
	`, packID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	var stickers []Sticker
	for rows.Next() {
		var s Sticker
		if err := rows.Scan(&s.ID, &s.ImageUrl, &s.CreatedAt); err != nil {
			continue
		}
		stickers = append(stickers, s)
	}
	if stickers == nil {
		stickers = []Sticker{}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"stickers": stickers})
}

func (h *Handler) AddSticker(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	packID := parts[4]

	r.Body = http.MaxBytesReader(w, r.Body, h.jsonBodyLimit())
	var req struct {
		Image string `json:"image"`
	}
	if err := decodeSingleJSON(r.Body, &req); err != nil {
		if isMaxBytesError(err) {
			httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "request_too_large", requestLimitMessage(h.jsonBodyLimit()))
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid json")
		return
	}
	if req.Image == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_image", "image is required")
		return
	}

	// Verify pack ownership
	var ownerID string
	err := h.service.db.QueryRowContext(r.Context(), `SELECT user_id::text FROM media.sticker_packs WHERE id = $1`, packID).Scan(&ownerID)
	if err != nil || ownerID != user.ID {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "pack not found")
		return
	}

	image, err := h.uploadBase64(r.Context(), user.ID, req.Image)
	if err != nil {
		if errors.Is(err, ErrTooBig) {
			httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "file_too_large", uploadLimitMessage(h.service.maxUploadBytes))
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "upload_error", err.Error())
		return
	}

	var s Sticker
	err = h.service.db.QueryRowContext(r.Context(), `
		INSERT INTO media.stickers (pack_id, image_url, bucket, object_key)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, image_url, created_at::text
	`, packID, image.URL, image.Bucket, image.ObjectKey).Scan(&s.ID, &s.ImageUrl, &s.CreatedAt)
	if err != nil {
		_ = h.service.store.Delete(r.Context(), image.Bucket, image.ObjectKey)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	s.ImageUrl = "/api/v2/media/" + s.ID
	httpx.JSON(w, http.StatusCreated, map[string]any{"success": true, "sticker": s})
}

func (h *Handler) DeleteSticker(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	stickerID := parts[4]

	err := h.service.DeleteSticker(r.Context(), user.ID, stickerID)
	if errors.Is(err, errStickerNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "sticker not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) DeleteStickerPack(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	packID := parts[4]

	err := h.service.DeleteStickerPack(r.Context(), user.ID, packID)
	if errors.Is(err, errPackNotFound) {
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) HandleStickersRoutes(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/v2/stickers -> parts[0]=api, parts[1]=v2, parts[2]=stickers

	if len(parts) >= 4 && parts[3] == "packs" {
		if len(parts) == 4 {
			if r.Method == http.MethodGet {
				h.ListStickerPacks(w, r)
			} else if r.Method == http.MethodPost {
				h.CreateStickerPack(w, r)
			} else {
				httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			}
			return
		}
		if len(parts) == 5 {
			if r.Method == http.MethodGet {
				h.GetStickers(w, r)
			} else if r.Method == http.MethodPost {
				h.AddSticker(w, r)
			} else if r.Method == http.MethodDelete {
				h.DeleteStickerPack(w, r)
			} else {
				httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			}
			return
		}
	}

	if len(parts) == 4 && r.Method == http.MethodDelete {
		// /api/v2/stickers/:stickerId
		r.URL.Path = "/api/v2/stickers/" + parts[3]
		h.DeleteSticker(w, r)
		return
	}

	httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "not found")
}
