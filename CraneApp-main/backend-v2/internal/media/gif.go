package media

import (
	"encoding/json"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
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

	var req struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid json")
		return
	}
	if req.URL == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_url", "url is required")
		return
	}

	var gif Gif
	err := h.service.db.QueryRowContext(r.Context(), `
		INSERT INTO media.gifs (user_id, name, url)
		VALUES ($1, $2, $3)
		RETURNING id::text, name, url, created_at::text
	`, user.ID, req.Name, req.URL).Scan(&gif.ID, &gif.Name, &gif.URL, &gif.CreatedAt)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
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

func (h *Handler) ToggleFavoriteGif(w http.ResponseWriter, r *http.Request) {
	user := authctx.MustUser(r)
	parts := strings.Split(r.URL.Path, "/")
	// /api/v2/gifs/:gifId/favorite
	if len(parts) < 6 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_path", "invalid path")
		return
	}
	gifID := parts[4]

	if r.Method == http.MethodPost {
		_, err := h.service.db.ExecContext(r.Context(), `
			INSERT INTO media.favorite_gifs (user_id, gif_id)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, user.ID, gifID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"success": true})

	} else if r.Method == http.MethodDelete {
		_, err := h.service.db.ExecContext(r.Context(), `
			DELETE FROM media.favorite_gifs
			WHERE user_id = $1 AND gif_id = $2
		`, user.ID, gifID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
	} else {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
