package chat

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

type UpdateGroupInput struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	AvatarURL   *string `json:"avatarUrl"`
}

func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID := r.PathValue("chatID")

	var input UpdateGroupInput
	if !decodeUpdateGroup(w, r, &input) {
		return
	}

	if input.Title == nil && input.Description == nil && input.AvatarURL == nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "at least one field is required")
		return
	}

	trimString(input.Title)
	trimString(input.Description)
	trimString(input.AvatarURL)

	updatedChat, err := h.service.UpdateGroup(
		r.Context(),
		current.ID,
		chatID,
		input.Title,
		input.Description,
		input.AvatarURL,
	)

	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid group data",
		)
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(
			w, r,
			http.StatusForbidden,
			"access_denied",
			"access denied",
		)
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(
			w, r,
			http.StatusNotFound,
			"chat_not_found",
			"chat not found",
		)
	case errors.Is(err, ErrInvalidChatType):
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"invalid_chat_type",
			"only group chats can be updated",
		)
	case err != nil:
		httpx.ErrorJSON(
			w, r,
			http.StatusInternalServerError,
			"internal_error",
			"group update failed",
		)
	default:
		httpx.JSON(w, http.StatusOK, map[string]any{
			"chat": updatedChat,
		})
	}
}

func decodeUpdateGroup(w http.ResponseWriter, r *http.Request, input *UpdateGroupInput) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}

	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}

	return true
}

func trimString(value *string) {
	if value != nil {
		*value = strings.TrimSpace(*value)
	}
}
