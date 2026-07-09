package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"time"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v2/admin/users")

	if suffix == "" || suffix == "/" {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, r)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		users, err := h.service.ListUsers(r.Context(), current.ID, r.URL.Query().Get("q"), limit, offset)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "admin access required")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list users")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"users": users})
		return
	}

	parts := strings.SplitN(strings.TrimPrefix(suffix, "/"), "/", 2)
	targetID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "disable":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, r)
			return
		}
		err := h.service.DisableUser(r.Context(), current.ID, targetID)
		respondSuccess(w, r, err)
	case "enable":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, r)
			return
		}
		err := h.service.EnableUser(r.Context(), current.ID, targetID)
		respondSuccess(w, r, err)
	case "mute":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, r)
			return
		}
		var input struct {
			Reason   string `json:"reason"`
			Duration string `json:"duration"` // e.g. "1h", "1d"
		}
		decode(w, r, &input)
		var mutedUntil *time.Time
		if input.Duration != "" {
			d, err := time.ParseDuration(input.Duration)
			if err == nil {
				t := time.Now().Add(d)
				mutedUntil = &t
			}
		}
		err := h.service.MuteUser(r.Context(), current.ID, targetID, input.Reason, mutedUntil)
		respondSuccess(w, r, err)
	case "unmute":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, r)
			return
		}
		err := h.service.UnmuteUser(r.Context(), current.ID, targetID)
		respondSuccess(w, r, err)
	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func (h *Handler) Reports(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v2/admin/reports")

	if suffix == "" || suffix == "/" {
		switch r.Method {
		case http.MethodGet:
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			reports, err := h.service.ListReports(r.Context(), current.ID, r.URL.Query().Get("status"), limit, offset)
			if errors.Is(err, ErrForbidden) {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "admin access required")
				return
			}
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list reports")
				return
			}
			httpx.JSON(w, http.StatusOK, map[string]any{"reports": reports})
		case http.MethodPost:
			var input struct {
				TargetType  string `json:"targetType"`
				TargetID    string `json:"targetId"`
				Reason      string `json:"reason"`
				Description string `json:"description"`
			}
			if !decode(w, r, &input) {
				return
			}
			id, err := h.service.CreateReport(r.Context(), current.ID, input.TargetType, input.TargetID, input.Reason, input.Description)
			if errors.Is(err, ErrInvalidInput) {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "targetType, targetId, and reason are required")
				return
			}
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to create report")
				return
			}
			httpx.JSON(w, http.StatusCreated, map[string]any{"reportId": id})
		default:
			methodNotAllowed(w, r)
		}
		return
	}

	parts := strings.SplitN(strings.TrimPrefix(suffix, "/"), "/", 2)
	reportID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	if action == "" && r.Method == http.MethodGet {
		report, err := h.service.GetReport(r.Context(), current.ID, reportID)
		if errors.Is(err, ErrNotFound) {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "report not found")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get report")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"report": report})
		return
	}
	if action == "resolve" && r.Method == http.MethodPost {
		var input struct {
			Resolution string `json:"resolution"`
		}
		if !decode(w, r, &input) {
			return
		}
		err := h.service.ResolveReport(r.Context(), current.ID, reportID, input.Resolution)
		respondSuccess(w, r, err)
		return
	}
	httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
}

func (h *Handler) SupportRequests(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v2/admin/support/requests")

	if suffix == "" || suffix == "/" {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, r)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		reqs, err := h.service.ListSupportRequests(r.Context(), current.ID, limit, offset)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "admin access required")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list requests")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"requests": reqs})
		return
	}

	parts := strings.SplitN(strings.TrimPrefix(suffix, "/"), "/", 2)
	requestID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "status":
		if r.Method != http.MethodPatch && r.Method != http.MethodPut {
			methodNotAllowed(w, r)
			return
		}
		var input struct {
			Status string `json:"status"`
		}
		if !decode(w, r, &input) {
			return
		}
		err := h.service.UpdateSupportRequestStatus(r.Context(), current.ID, requestID, input.Status)
		respondSuccess(w, r, err)
	case "reply":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, r)
			return
		}
		var input struct {
			Content string `json:"content"`
			Message string `json:"message"` // fallback
		}
		if !decode(w, r, &input) {
			return
		}
		content := input.Content
		if content == "" {
			content = input.Message
		}
		err := h.service.ReplyToSupportRequest(r.Context(), current.ID, requestID, content)
		respondSuccess(w, r, err)
	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func respondSuccess(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "operation failed")
	default:
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(value); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	return true
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}
