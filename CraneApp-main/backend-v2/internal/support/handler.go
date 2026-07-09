package support

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Routes(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	path := r.URL.Path

	switch {
	case path == "/api/v2/support/requests" && r.Method == http.MethodGet:
		reqs, err := h.service.ListRequests(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list requests")
			return
		}
		if reqs == nil {
			reqs = []Request{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"requests": reqs})

	case path == "/api/v2/support/requests" && r.Method == http.MethodPost:
		var input struct {
			Subject string `json:"subject"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
			return
		}
		if strings.TrimSpace(input.Subject) == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "subject is required")
			return
		}
		req, err := h.service.CreateRequest(r.Context(), current.ID, input.Subject, input.Message)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to create request")
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"request": req})

	case strings.HasPrefix(path, "/api/v2/support/requests/"):
		rest := strings.TrimPrefix(path, "/api/v2/support/requests/")
		parts := strings.SplitN(rest, "/", 2)
		requestID := parts[0]
		sub := ""
		if len(parts) == 2 {
			sub = "/" + parts[1]
		}

		switch {
		case sub == "" && r.Method == http.MethodGet:
			req, err := h.service.GetRequest(r.Context(), current.ID, requestID)
			if errors.Is(err, ErrNotFound) {
				httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "request not found")
				return
			}
			if errors.Is(err, ErrForbidden) {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
				return
			}
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get request")
				return
			}
			httpx.JSON(w, http.StatusOK, map[string]any{"request": req})

		case sub == "/messages" && r.Method == http.MethodGet:
			msgs, err := h.service.ListMessages(r.Context(), current.ID, requestID)
			if errors.Is(err, ErrNotFound) {
				httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "request not found")
				return
			}
			if errors.Is(err, ErrForbidden) {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
				return
			}
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list messages")
				return
			}
			if msgs == nil {
				msgs = []Message{}
			}
			httpx.JSON(w, http.StatusOK, map[string]any{"messages": msgs})

		case sub == "/reply" && r.Method == http.MethodPost:
			var input struct {
				Content string `json:"content"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
				return
			}
			if strings.TrimSpace(input.Content) == "" {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "content is required")
				return
			}
			msg, err := h.service.Reply(r.Context(), current.ID, requestID, input.Content, false)
			if errors.Is(err, ErrNotFound) {
				httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "request not found")
				return
			}
			if errors.Is(err, ErrForbidden) {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
				return
			}
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "reply failed")
				return
			}
			httpx.JSON(w, http.StatusCreated, map[string]any{"message": msg})

		default:
			httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		}

	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}
