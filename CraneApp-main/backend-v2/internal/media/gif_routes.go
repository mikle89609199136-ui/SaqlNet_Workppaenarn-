package media

import (
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/httpx"
)

func (h *Handler) HandleGifsRoutes(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/v2/gifs -> parts[0]=api, parts[1]=v2, parts[2]=gifs

	if len(parts) == 3 {
		if r.Method == http.MethodGet {
			h.ListGifs(w, r)
		} else if r.Method == http.MethodPost {
			h.CreateGif(w, r)
		} else {
			httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
		return
	}

	if len(parts) == 4 && parts[3] == "favorites" {
		if r.Method == http.MethodGet {
			h.ListFavoriteGifs(w, r)
		} else {
			httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
		return
	}

	if len(parts) == 5 && parts[4] == "favorite" {
		h.ToggleFavoriteGif(w, r)
		return
	}

	httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "not found")
}
