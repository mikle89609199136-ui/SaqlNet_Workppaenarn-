package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

// maxTitleLen is the maximum allowed length of a chat title, in runes,
// measured after trimming surrounding whitespace.
const maxTitleLen = 128

// UpdateGroup handles PATCH /api/v2/chats/{chatID}. It updates a group
// chat's title, description, and avatar URL. All fields are optional;
// only the fields present in the request body are updated.
//
// Text fields are trimmed of leading and trailing whitespace before
// validation and before being passed to the service. Length limits
// apply to the trimmed value.
//
// The authenticated user must be the chat owner or an admin. On success
// it returns 200 with the updated chat object.
func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	const method = "UpdateGroup"

	if r.Method != http.MethodPatch {
		methodNotAllowed(w, r)
		return
	}

	current := authctx.MustUser(r)

	chatID := r.PathValue("chatID")
	if chatID == "" {
		slog.WarnContext(r.Context(), "missing chat ID in path",
			"layer", "handler",
			"method", method,
			"path", r.URL.Path,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "chat ID is required")
		return
	}

	// Pointers distinguish "field absent" (nil, do not update) from
	// "field present with empty value" (update to empty).
	var input struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		AvatarURL   *string `json:"avatarUrl"`
	}

	if !decodeStrict(w, r, &input) {
		return // decode logs internally
	}

	if input.Title == nil && input.Description == nil && input.AvatarURL == nil {
		slog.WarnContext(r.Context(), "empty update request",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
			"chat_id", chatID,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "at least one field is required")
		return
	}

	// Normalize every provided field before validating, so that length
	// checks see the same value the service will persist. A title of
	// 128 runes with a stray leading space must pass, not fail.
	input.Title = trimString(input.Title)
	input.Description = trimString(input.Description)
	input.AvatarURL = trimString(input.AvatarURL)

	if input.Title != nil && *input.Title == "" {
		// Caught here rather than in the service so the client gets a
		// specific message instead of the generic "invalid input".
		slog.WarnContext(r.Context(), "title is empty after trimming",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
			"chat_id", chatID,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "title must not be empty")
		return
	}

	if input.Title != nil && utf8.RuneCountInString(*input.Title) > maxTitleLen {
		slog.WarnContext(r.Context(), "title exceeds maximum length",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
			"chat_id", chatID,
			"length", utf8.RuneCountInString(*input.Title),
			"max", maxTitleLen,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("title exceeds maximum length of %d characters", maxTitleLen))
		return
	}

	// All fields are optional, but the request body must be valid JSON.
	// If no fields are provided (all nil), we could either proceed (no-op)
	// or return a 400. Here we treat it as a no-op and return the chat unchanged.

	// Call the service layer with the provided fields.
	// Note: the service expects *string arguments; nil means "do not update".
	updatedChat, err := h.service.UpdateGroup(
		r.Context(),
		current.ID,
		chatID,
		input.Title,
		input.Description,
		input.AvatarURL,
	)

	// Map domain errors to appropriate HTTP status codes.
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat not found")
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
	case errors.Is(err, ErrInvalidChatType):
		// This endpoint updates groups only; direct chats are rejected.
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", "only group chats can be updated")
	case err != nil:
		// The service already logged this error with full context.
		// Logging again here would duplicate the entry in the aggregated logs.
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "update failed")
	default:
		httpx.JSON(w, http.StatusOK, map[string]any{"chat": updatedChat})
	}
}

// trimString trims leading and trailing whitespace from s.
// It returns nil if s is nil, preserving the "absent vs empty" distinction
// that PATCH semantics rely on.
func trimString(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	return &v
}

// decode reads and validates a JSON request body into value.
// It returns true if the body is valid, correctly formed, contains no
// extra data, and contains no unknown fields (strict mode).
// If an error occurs, decode writes an error response and returns false.
func decodeStrict(w http.ResponseWriter, r *http.Request, value any) bool {
	const helper = "decodeStrict"
	// Limit the request body to 256 KiB to prevent memory exhaustion.
	const maxBodySize = 256 << 10 // 256 KiB
	body := http.MaxBytesReader(w, r.Body, maxBodySize)
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(value); err != nil {
		slog.WarnContext(r.Context(), "invalid request body",
			"layer", "handler",
			"helperFunc", helper,
			"err", err,
			"path", r.URL.Path,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}

	// Ensure there is no trailing data after the first JSON value.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		slog.WarnContext(r.Context(), "trailing data in request body",
			"layer", "handler",
			"helperFunc", helper,
			"err", err,
			"path", r.URL.Path,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}

	return true
}

// GetOnlineMembers возвращает UUID online-участников группового чата.
func (h *Handler) GetOnlineMembers(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID := r.PathValue("chatID")

	members, err := h.service.GetOnlineMembers(r.Context(), chatID, current.ID)
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid chat ID")
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat not found")
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
	case errors.Is(err, ErrInvalidChatType):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", "online members are available only for group chats")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to fetch online members")
	default:
		httpx.JSON(w, http.StatusOK, map[string]any{"members": members})
	}
}
