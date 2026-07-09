package user

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

func (h *Handler) EncryptionRoutes(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	path := r.URL.Path

	switch {
	// POST /api/v2/encryption/keys
	case path == "/api/v2/encryption/keys" && r.Method == http.MethodPost:
		h.uploadPublicKey(w, r, current.ID)

	// GET /api/v2/encryption/keys/:userId
	case strings.HasPrefix(path, "/api/v2/encryption/keys/") && r.Method == http.MethodGet:
		targetID := strings.TrimPrefix(path, "/api/v2/encryption/keys/")
		if targetID == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_user_id", "userId is required")
			return
		}
		h.getPublicKey(w, r, current.ID, targetID)

	// GET /api/v2/encryption/chat-keys/:chatId
	case strings.HasPrefix(path, "/api/v2/encryption/chat-keys/") && !strings.Contains(path[len("/api/v2/encryption/chat-keys/"):], "/") && r.Method == http.MethodGet:
		chatID := strings.TrimPrefix(path, "/api/v2/encryption/chat-keys/")
		if chatID == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_chat_id", "chatId is required")
			return
		}
		h.getChatKeys(w, r, current.ID, chatID)

	// POST /api/v2/encryption/chat-keys/:chatId
	case strings.HasPrefix(path, "/api/v2/encryption/chat-keys/") && !strings.Contains(path[len("/api/v2/encryption/chat-keys/"):], "/") && r.Method == http.MethodPost:
		chatID := strings.TrimPrefix(path, "/api/v2/encryption/chat-keys/")
		if chatID == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_chat_id", "chatId is required")
			return
		}
		h.saveChatKeys(w, r, current.ID, chatID)

	// POST /api/v2/encryption/rotate-key/:chatId
	case strings.HasPrefix(path, "/api/v2/encryption/rotate-key/") && r.Method == http.MethodPost:
		chatID := strings.TrimPrefix(path, "/api/v2/encryption/rotate-key/")
		if chatID == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_chat_id", "chatId is required")
			return
		}
		h.rotateChatKey(w, r, current.ID, chatID)

	// GET /api/v2/encryption/my-key/:chatId
	case strings.HasPrefix(path, "/api/v2/encryption/my-key/") && r.Method == http.MethodGet:
		chatID := strings.TrimPrefix(path, "/api/v2/encryption/my-key/")
		if chatID == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_chat_id", "chatId is required")
			return
		}
		h.getMyKey(w, r, current.ID, chatID)

	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func (h *Handler) uploadPublicKey(w http.ResponseWriter, r *http.Request, userID string) {
	var input struct {
		PublicKey   string  `json:"publicKey"`
		KeyID       string  `json:"keyId"`
		PQPublicKey *string `json:"pqPublicKey"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	err := h.service.UpsertPublicKey(r.Context(), userID, PublicKeyData{
		PublicKey:   input.PublicKey,
		KeyID:       input.KeyID,
		PQPublicKey: input.PQPublicKey,
	})
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_key", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) getPublicKey(w http.ResponseWriter, r *http.Request, requesterID, targetID string) {
	data, err := h.service.GetPublicKey(r.Context(), requesterID, targetID)
	if errors.Is(err, ErrKeyNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "key_not_found", "public key not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (h *Handler) getChatKeys(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	keys, err := h.service.GetChatKeys(r.Context(), userID, chatID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		return
	}
	if keys == nil {
		keys = []ChatEncryptedKey{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"keys": keys})
}

func (h *Handler) saveChatKeys(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	var input struct {
		EncryptedKeys []ChatEncryptedKey `json:"encryptedKeys"`
		KeyEpoch      int                `json:"keyEpoch"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if len(input.EncryptedKeys) > 500 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "too_many_keys", "too many keys")
		return
	}
	if err := h.service.SaveChatKeys(r.Context(), userID, chatID, input.EncryptedKeys, input.KeyEpoch); err != nil {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) rotateChatKey(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	var input struct {
		EncryptedKeys []ChatEncryptedKey `json:"encryptedKeys"`
		KeyEpoch      int                `json:"keyEpoch"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	err := h.service.RotateChatKey(r.Context(), userID, chatID, input.EncryptedKeys, input.KeyEpoch)
	if err != nil && strings.Contains(err.Error(), "rate limit") {
		httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", err.Error())
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "keyEpoch": input.KeyEpoch})
}

func (h *Handler) getMyKey(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	key, err := h.service.GetMyKey(r.Context(), userID, chatID)
	if errors.Is(err, ErrKeyNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "key_not_found", "no key found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get key")
		return
	}
	httpx.JSON(w, http.StatusOK, key)
}
