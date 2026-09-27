package user

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"craneapp/backend-v2/internal/platform/httpx"
)

const maxKeyBackupBodyBytes = 256 << 10

// Everything under /encryption/backup belongs to the requester only, and the
// responses carry key material, so no intermediary may cache them.
func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func (h *Handler) keyBackupRoutes(w http.ResponseWriter, r *http.Request, userID string) {
	noStore(w)
	switch r.Method {
	case http.MethodGet:
		h.getKeyBackup(w, r, userID)
	case http.MethodPut:
		h.putKeyBackup(w, r, userID)
	case http.MethodDelete:
		h.deleteKeyBackup(w, r, userID)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) backupChatKeyRoutes(w http.ResponseWriter, r *http.Request, userID string) {
	noStore(w)
	switch r.Method {
	case http.MethodGet:
		h.listBackupChatKeys(w, r, userID)
	case http.MethodPost:
		h.saveBackupChatKeys(w, r, userID)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) getKeyBackup(w http.ResponseWriter, r *http.Request, userID string) {
	backup, err := h.service.GetKeyBackup(r.Context(), userID)
	if errors.Is(err, ErrBackupNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "backup_not_found", "key backup not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get key backup")
		return
	}
	httpx.JSON(w, http.StatusOK, backup)
}

func (h *Handler) putKeyBackup(w http.ResponseWriter, r *http.Request, userID string) {
	var input struct {
		ExpectedVersion int64           `json:"expectedVersion"`
		FormatVersion   int             `json:"formatVersion"`
		Identity        string          `json:"identity"`
		Slots           json.RawMessage `json:"slots"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxKeyBackupBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	version, err := h.service.PutKeyBackup(r.Context(), userID, input.ExpectedVersion, input.FormatVersion, input.Identity, input.Slots)
	if errors.Is(err, ErrInvalidBackup) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid key backup")
		return
	}
	if errors.Is(err, ErrBackupVersionConflict) {
		httpx.ErrorJSON(w, r, http.StatusConflict, "version_conflict", "key backup was changed on another device")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to save key backup")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int64{"version": version})
}

func (h *Handler) deleteKeyBackup(w http.ResponseWriter, r *http.Request, userID string) {
	if err := h.service.DeleteKeyBackup(r.Context(), userID); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to delete key backup")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) saveBackupChatKeys(w http.ResponseWriter, r *http.Request, userID string) {
	var input struct {
		Keys []BackupChatKey `json:"keys"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxKeyBackupBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	stored, err := h.service.SaveBackupChatKeys(r.Context(), userID, input.Keys)
	if errors.Is(err, ErrInvalidBackup) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid chat keys")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to save chat keys")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"stored": stored})
}

func (h *Handler) listBackupChatKeys(w http.ResponseWriter, r *http.Request, userID string) {
	query := r.URL.Query()
	limit := 0
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid limit")
			return
		}
		limit = parsed
	}
	keys, next, err := h.service.ListBackupChatKeys(r.Context(), userID, query.Get("chatId"), query.Get("after"), limit)
	if errors.Is(err, ErrInvalidBackup) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid chatId or cursor")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list chat keys")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"keys": keys, "next": next})
}
