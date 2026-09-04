package chat

import (
	"errors"
	"log"
	"net/http"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

// UpdateGroup handles PATCH /api/v2/chats/{chatID}.
// It allows updating a group chat's title, description, and avatar URL.
// All fields are optional; only provided fields will be updated.
// The authenticated user must be the chat owner or an admin.
//
// On success, it returns 200 OK with the updated chat object.
func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	log.Println("UpdateGroup called")
	// Enforce HTTP method – only PATCH is allowed.
	if r.Method != http.MethodPatch {
		methodNotAllowed(w, r)
		return
	}

	// Retrieve the authenticated user from the request context.
	current := authctx.MustUser(r)

	// Extract the chat ID from the URL path (Go 1.22+ syntax).
	chatID := r.PathValue("chatID")

	// Если не получилось, пробуем из контекста (для тестов)
	if chatID == "" {
		if val := r.Context().Value("chatID"); val != nil {
			if id, ok := val.(string); ok {
				chatID = id
			}
		}
	}

	if chatID == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "chat ID is required")
		return
	}

	// Define the request body structure with pointer fields.
	// Using pointers allows us to distinguish between:
	//   - field not provided (nil) – do not update
	//   - field provided with empty string – update to empty string
	var input struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		AvatarURL   *string `json:"avatarUrl"`
	}

	// Decode the JSON body. If the body is malformed or empty, decode returns false
	// and has already written a 400 response.
	if !decode(w, r, &input) {
		log.Println("decode returned false")
		return
	}

	log.Println("decode returned true, input:", input)

	if input.Title == nil && input.Description == nil && input.AvatarURL == nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "at least one field is required")
		return
	}

	// Validate title length only if it was provided.
	const maxTitleLen = 128
	if input.Title != nil && len(*input.Title) > maxTitleLen {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed",
			"title exceeds maximum length of 128 characters")
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
		// This could happen if the chat is not a group, or if a provided
		// title is empty (if the service enforces non-empty on update).
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
	case errors.Is(err, ErrNotFound):
		// Chat not found or user not a member.
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat not found")
	case errors.Is(err, ErrForbidden):
		// User is not owner/admin and cannot update.
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
	case errors.Is(err, ErrInvalidChatType):
		// Only groups can be updated through this endpoint.
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", "only group chats can be updated")
	case err != nil:
		// Any other unexpected error (database, etc.).
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "update failed")
	default:
		// Success: return the updated chat object.
		httpx.JSON(w, http.StatusOK, map[string]any{"chat": updatedChat})
	}
}
