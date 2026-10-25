package media

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/platform/mediarefs"
)

type Gif struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	UserName  string `json:"userName"`
	CreatedAt string `json:"createdAt"`
}

func (h *Handler) ListGifs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	rows, err := h.service.db.QueryContext(r.Context(), `
		SELECT g.id::text, g.name, g.url, COALESCE(u.username, ''), g.created_at::text
		FROM media.gifs g
		LEFT JOIN auth.users u ON g.user_id = u.id
		ORDER BY g.created_at DESC
		LIMIT 100
	`)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	var gifs []Gif
	for rows.Next() {
		var g Gif
		if err := rows.Scan(&g.ID, &g.Name, &g.URL, &g.UserName, &g.CreatedAt); err != nil {
			continue
		}
		gifs = append(gifs, g)
	}
	if gifs == nil {
		gifs = []Gif{}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"gifs": gifs})
}

func (h *Handler) CreateGif(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	user := authctx.MustUser(r)

	r.Body = http.MaxBytesReader(w, r.Body, gifCreateBodyLimitBytes)
	var req struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := decodeSingleJSON(r.Body, &req); err != nil {
		if isMaxBytesError(err) {
			httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "request_too_large", "request body exceeds 64 KiB limit")
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid json")
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_url", "url is required")
		return
	}

	uploadID, ok := parseGifMediaPath(req.URL)
	if !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_url", "url must be a media upload path")
		return
	}
	name, ok := validateGifName(req.Name)
	if !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "name must contain at most 255 characters and no control characters")
		return
	}

	var contentType string
	var encrypted bool
	err := h.service.db.QueryRowContext(r.Context(), `
		SELECT content_type, is_encrypted
		FROM media.uploads
		WHERE id = $1 AND uploader_id = $2
	`, uploadID, user.ID).Scan(&contentType, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "upload_not_found", "upload not found")
		return
	}
	if err != nil {
		slog.Error("find GIF source upload", "err", err)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	mediaType, valid := normalizeMediaType(contentType)
	if !valid || mediaType != "image/gif" || encrypted {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_gif_source", "source must be an unencrypted GIF upload")
		return
	}

	var gif Gif
	tx, err := h.service.db.BeginTx(r.Context(), nil)
	if err != nil {
		slog.Error("create GIF", "err", err)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	defer func() { _ = tx.Rollback() }()
	err = tx.QueryRowContext(r.Context(), `
		INSERT INTO media.gifs (user_id, name, url)
		VALUES ($1, $2, $3)
		RETURNING id::text, name, url, created_at::text
	`, user.ID, name, req.URL).Scan(&gif.ID, &gif.Name, &gif.URL, &gif.CreatedAt)
	if err == nil {
		err = mediarefs.Add(r.Context(), tx, mediarefs.Ref{Kind: mediarefs.Gif, UploadID: uploadID, GifID: gif.ID})
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		slog.Error("create GIF", "err", err)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	httpx.JSON(w, http.StatusCreated, map[string]any{"success": true, "gif": gif})
}

func (h *Handler) ListFavoriteGifs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	user := authctx.MustUser(r)

	rows, err := h.service.db.QueryContext(r.Context(), `
		SELECT g.id::text, g.name, g.url, COALESCE(u.username, ''), g.created_at::text
		FROM media.favorite_gifs fg
		JOIN media.gifs g ON fg.gif_id = g.id
		LEFT JOIN auth.users u ON g.user_id = u.id
		WHERE fg.user_id = $1
		ORDER BY fg.created_at DESC
		LIMIT 100
	`, user.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	var gifs []Gif
	for rows.Next() {
		var g Gif
		if err := rows.Scan(&g.ID, &g.Name, &g.URL, &g.UserName, &g.CreatedAt); err != nil {
			continue
		}
		gifs = append(gifs, g)
	}
	if gifs == nil {
		gifs = []Gif{}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"gifs": gifs})
}

var gifIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (h *Handler) ToggleFavoriteGif(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	parts := strings.Split(r.URL.Path, "/")
	// /api/v2/gifs/:gifId/favorite
	if len(parts) < 6 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	gifID := parts[4]
	if !gifIDPattern.MatchString(gifID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_gif_id", "invalid GIF id")
		return
	}

	if r.Method == http.MethodPost {
		var gifExists, inserted bool
		err := h.service.db.QueryRowContext(r.Context(), `
			WITH gif AS (
				SELECT id FROM media.gifs WHERE id = $2
			), inserted AS (
				INSERT INTO media.favorite_gifs (user_id, gif_id)
				SELECT $1, id FROM gif
				ON CONFLICT DO NOTHING
				RETURNING 1
			)
			SELECT EXISTS (SELECT 1 FROM gif) AS gif_exists,
			       EXISTS (SELECT 1 FROM inserted) AS inserted
		`, user.ID, gifID).Scan(&gifExists, &inserted)
		if err != nil {
			slog.Error("toggle favorite GIF", "err", err)
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		if !gifExists {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "gif_not_found", "GIF not found")
			return
		}
		status := http.StatusOK
		if inserted {
			status = http.StatusCreated
		}
		httpx.JSON(w, status, map[string]any{"success": true})

	} else if r.Method == http.MethodDelete {
		var gifExists, deleted bool
		err := h.service.db.QueryRowContext(r.Context(), `
			WITH gif AS (
				SELECT id FROM media.gifs WHERE id = $2
			), deleted AS (
				DELETE FROM media.favorite_gifs
				WHERE user_id = $1 AND gif_id IN (SELECT id FROM gif)
				RETURNING 1
			)
			SELECT EXISTS (SELECT 1 FROM gif) AS gif_exists,
			       EXISTS (SELECT 1 FROM deleted) AS deleted
		`, user.ID, gifID).Scan(&gifExists, &deleted)
		if err != nil {
			slog.Error("toggle favorite GIF", "err", err)
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		if !gifExists {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "gif_not_found", "GIF not found")
			return
		}
		slog.Debug("toggle favorite GIF", "deleted", deleted)
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
	} else {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
