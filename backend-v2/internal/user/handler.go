package user

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/skip2/go-qrcode"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

var validate = validator.New()

type SignalRegistrationValidator interface {
	ValidateSignalRegistration(ctx context.Context, identityKey, signedPreKey, signature string) (bool, error)
}

type Handler struct {
	service *Service
	crypto  SignalRegistrationValidator
}

func NewHandler(service *Service, crypto SignalRegistrationValidator) *Handler {
	return &Handler{service: service, crypto: crypto}
}

func (h *Handler) SubscribePremium(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	if err := h.service.SubscribePremium(r.Context(), current.ID); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "subscription failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) QRCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	requestedUsername := r.URL.Query().Get("username")
	if requestedUsername == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username is required")
		return
	}
	profile, err := h.service.ProfileByUsername(r.Context(), requestedUsername)
	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username is invalid")
		return
	}
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "profile lookup failed")
		return
	}

	host := r.Host
	protocol := r.Header.Get("X-Forwarded-Proto")
	if protocol == "" {
		protocol = "http"
	}

	url := fmt.Sprintf("%s://%s/user/@%s", protocol, host, profile.Username)
	png, err := qrcode.Encode(url, qrcode.Medium, 256)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "qr generation failed")
		return
	}

	base64Encoded := base64.StdEncoding.EncodeToString(png)
	dataURL := fmt.Sprintf("data:image/png;base64,%s", base64Encoded)

	httpx.JSON(w, http.StatusOK, map[string]string{"qrCode": dataURL})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		current := authctx.MustUser(r)
		profile, err := h.service.Me(r.Context(), current.ID)
		respondProfile(w, r, profile, err)
	case http.MethodPut:
		current := authctx.MustUser(r)
		var input struct {
			FirstName *string `json:"firstName"`
			LastName  *string `json:"lastName"`
			Bio       *string `json:"bio"`
			AvatarURL *string `json:"avatarUrl"`
		}
		if !decode(w, r, &input) {
			return
		}
		profile, err := h.service.UpdateProfile(r.Context(), current.ID, input.FirstName, input.LastName, input.Bio, input.AvatarURL)
		respondProfile(w, r, profile, err)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) Username(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Username string `json:"username"`
	}
	if !decode(w, r, &input) {
		return
	}
	profile, err := h.service.RenameUsername(r.Context(), current.ID, input.Username)
	if errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrInvalidUsernameFormat) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username is invalid")
		return
	}
	if errors.Is(err, ErrUsernameTaken) {
		httpx.ErrorJSON(w, r, http.StatusConflict, "username_taken", "username already exists")
		return
	}
	var cooldown *UsernameCooldownError
	if errors.As(err, &cooldown) {
		w.Header().Set("Retry-After", strconv.FormatInt(max(1, int64(time.Until(cooldown.AvailableAt).Seconds())), 10))
		httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "username_change_cooldown", "username can only be changed once every 24 hours")
		return
	}
	respondProfile(w, r, profile, err)
}

func (h *Handler) Avatar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Avatar    *string `json:"avatar"`
		AvatarURL *string `json:"avatarUrl"`
	}
	if !decode(w, r, &input) {
		return
	}
	avatar := input.AvatarURL
	if avatar == nil {
		avatar = input.Avatar
	}
	profile, err := h.service.UpdateProfile(r.Context(), current.ID, nil, nil, nil, avatar)
	respondProfile(w, r, profile, err)
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	users, err := h.service.Search(r.Context(), current.ID, r.URL.Query().Get("q"))
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "search failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": users})
}

// CheckUsername handles GET /api/v2/users/check-username endpoint.
// It validates the provided username against the allowed pattern and checks
// its availability in the database. Returns:
//   - 200 OK with {"available": true/false} on success
//   - 400 Bad Request with "validation_failed" for empty or malformed username
//   - 405 Method Not Allowed for non-GET requests
//   - 500 Internal Server Error for unexpected failures
func (h *Handler) CheckUsername(w http.ResponseWriter, r *http.Request) {
	// Ensure only GET method is allowed
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	// Delegate to service for availability check
	available, err := h.service.IsUsernameAvailable(r.Context(), r.URL.Query().Get("username"))

	// Handle specific validation errors with 400 Bad Request
	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username is required")
		return
	}
	if errors.Is(err, ErrInvalidUsernameFormat) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username - wrong format")
		return
	}

	// Handle unexpected errors as 500 Internal Server Error
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "username check failed")
		return
	}

	// Return successful response with availability flag
	httpx.JSON(w, http.StatusOK, map[string]bool{"available": available})
}

func (h *Handler) PublicProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	userID, suffix := parseUserSubroute(r.URL.Path)
	if userID == "" || suffix != "profile" {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		return
	}
	if !isValidUUID(userID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid userId")
		return
	}
	p, err := h.service.ProfileByID(r.Context(), authctx.MustUser(r).ID, userID)
	respondProfile(w, r, p, err)
}

func (h *Handler) PublicStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	userID, suffix := parseUserSubroute(r.URL.Path)
	if userID == "" || suffix != "status" {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		return
	}
	if !isValidUUID(userID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid userId")
		return
	}
	// Статус зависит от того, кто смотрит: блокировка и правило приватности.
	viewer, _ := authctx.UserFromContext(r.Context())
	status, err := h.service.Status(r.Context(), viewer.ID, userID)
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "status fetch failed")
		return
	}
	httpx.JSON(w, http.StatusOK, status)
}

func (h *Handler) Settings(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	switch r.Method {
	case http.MethodGet:
		settings, privacy, err := h.service.Settings(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "settings fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"settings": settings, "privacy": privacy})
	case http.MethodPut:
		body, ok := decodeSettingsPatch(w, r)
		if !ok {
			return
		}
		settings, err := h.service.UpdateSettings(r.Context(), current.ID, body)
		if errors.Is(err, ErrInvalidSettings) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "settings update failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"settings": settings})
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) AllSettings(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	switch r.Method {
	case http.MethodGet:
		settings, err := h.service.AllSettings(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "all settings fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, settings)
	case http.MethodPut:
		input, ok := decodeSettingsBulkPatch(w, r)
		if !ok {
			return
		}
		if err := h.service.UpdateAllSettings(r.Context(), current.ID, input); err != nil {
			if errors.Is(err, ErrInvalidPrivacy) || errors.Is(err, ErrInvalidSettings) {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
				return
			}
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "all settings update failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) Privacy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}
	privacy, err := h.service.UpdatePrivacy(r.Context(), current.ID, body)
	if errors.Is(err, ErrInvalidPrivacy) {
		// Текст — от проверки: какой ключ или значение не подошли.
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "privacy update failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"privacy": privacy})
}

func (h *Handler) Preference(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	spec, ok := preferenceSpec(r.URL.Path)
	if !ok {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := h.service.Preference(r.Context(), current.ID, spec.column)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "preference fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{spec.key: settings})
	case http.MethodPut:
		body, ok := decodeSettingsPatch(w, r)
		if !ok {
			return
		}
		settings, err := h.service.UpdatePreference(r.Context(), current.ID, spec.column, body)
		if errors.Is(err, ErrInvalidSettings) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "preference update failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true, spec.key: settings})
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) Folders(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	switch r.Method {
	case http.MethodGet:
		folders, err := h.service.Folders(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "folders fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"folders": folders})
	case http.MethodPut:
		var input struct {
			Folders []any `json:"folders"`
		}
		if !decode(w, r, &input) {
			return
		}
		if input.Folders == nil {
			input.Folders = []any{}
		}
		if err := h.service.UpdateFolders(r.Context(), current.ID, input.Folders); err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "folders update failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) Storage(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	path := r.URL.Path
	switch {
	case path == "/api/v2/users/storage" && r.Method == http.MethodGet:
		usage, settings, err := h.service.Storage(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "storage fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"storage": usage, "settings": settings})
	case path == "/api/v2/users/storage/settings" && r.Method == http.MethodPut:
		body, ok := decodeSettingsPatch(w, r)
		if !ok {
			return
		}
		settings, err := h.service.UpdateStorageSettings(r.Context(), current.ID, body)
		if errors.Is(err, ErrInvalidSettings) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "storage settings update failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "settings": settings})
	case path == "/api/v2/users/storage/cache" && r.Method == http.MethodDelete:
		if err := h.service.ClearCache(r.Context(), current.ID); err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "cache clear failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	case path == "/api/v2/users/storage/all" && r.Method == http.MethodDelete:
		if err := h.service.DeleteAllData(r.Context(), current.ID); err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "data delete failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	data, err := h.service.Export(r.Context(), current.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "export failed")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="craneapp_data.json"`)
	httpx.JSON(w, http.StatusOK, data)
}

func (h *Handler) Blocked(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		current := authctx.MustUser(r)
		blocked, err := h.service.Blocked(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "blocked users fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"blocked": blocked})
	case http.MethodPost:
		current := authctx.MustUser(r)
		var input struct {
			UserID string `json:"userId"`
		}
		if !decode(w, r, &input) {
			return
		}
		if strings.TrimSpace(input.UserID) == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "userId is required")
			return
		}
		if !isValidUUID(input.UserID) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid userId")
			return
		}
		err := h.service.Block(r.Context(), current.ID, input.UserID)
		switch {
		case errors.Is(err, ErrSelfBlock):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "self_block", "cannot block yourself")
		case errors.Is(err, ErrAlreadyBlocked):
			httpx.ErrorJSON(w, r, http.StatusConflict, "already_blocked", "user is already blocked")
		case errors.Is(err, ErrNotFound):
			httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		case err != nil:
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "block failed")
		default:
			httpx.JSON(w, http.StatusCreated, map[string]bool{"success": true})
		}
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) Unblock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	blockedUserID := strings.TrimPrefix(r.URL.Path, "/api/v2/users/blocked/")
	if blockedUserID == "" || blockedUserID == r.URL.Path {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "blocked user id is required")
		return
	}
	if !isValidUUID(blockedUserID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid userId")
		return
	}
	if err := h.service.Unblock(r.Context(), current.ID, blockedUserID); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "unblock failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func respondProfile(w http.ResponseWriter, r *http.Request, profile Profile, err error) {
	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid profile input")
		return
	}
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "profile operation failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": profile})
}

func (h *Handler) Devices(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	if r.Method == http.MethodGet {
		token, _ := authctx.TokenFromRequest(r)
		devices, err := h.service.Devices(r.Context(), current.ID, token)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to fetch devices")
			return
		}
		if devices == nil {
			devices = []Session{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"devices": devices})
		return
	}
	httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}

func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		DeviceName string `json:"deviceName"`
		DeviceType string `json:"deviceType"`
		UserAgent  string `json:"userAgent"`
		ClientIP   string `json:"clientIP"`
	}
	if !decode(w, r, &input) {
		return
	}
	token, _ := authctx.TokenFromRequest(r)
	var tokenHash string
	if token != "" {
		tokenHash = authctx.TokenHash(token)
	}
	sessionID, err := h.service.RegisterDevice(
		r.Context(), current.ID, tokenHash,
		input.DeviceName, input.DeviceType, input.ClientIP, "Unknown", input.UserAgent,
	)
	if errors.Is(err, ErrAuthSessionInactive) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "token_revoked", "authorization token has been revoked")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to register device")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "sessionId": sessionID})
}

func (h *Handler) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	const method = "DeleteDevice"
	if r.Method != http.MethodDelete {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	sessionID := strings.TrimPrefix(r.URL.Path, "/api/v2/users/devices/")
	if sessionID == "" || sessionID == r.URL.Path {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_request", "missing session id")
		return
	}
	if !isValidUUID(sessionID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid sessionId")
		return
	}
	token, _ := authctx.TokenFromRequest(r)
	err := h.service.DeleteDevice(r.Context(), current.ID, sessionID, authctx.TokenHash(token))
	switch {
	case errors.Is(err, ErrAuthSessionInactive):
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "token_revoked", "authorization token has been revoked")
		return
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "session not found")
		return
	case errors.Is(err, ErrCannotTerminateCurrentSession):
		httpx.ErrorJSON(w, r, http.StatusConflict, "conflict_current_session", "cannot terminate current session")
		return
	case err != nil:
		slog.ErrorContext(r.Context(), "failed to delete device session",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
			"session_id", sessionID,
			"error", err,
		)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "operation failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) TerminateAllDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	token, _ := authctx.TokenFromRequest(r)
	err := h.service.TerminateAllDevices(r.Context(), current.ID, authctx.TokenHash(token))
	if errors.Is(err, ErrAuthSessionInactive) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "token_revoked", "authorization token has been revoked")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to terminate devices")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) Passcode(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	path := r.URL.Path
	switch {
	case path == "/api/v2/users/passcode" && r.Method == http.MethodGet:
		state, err := h.service.Passcode(r.Context(), current.ID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "passcode fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, state)
	case path == "/api/v2/users/passcode/set" && r.Method == http.MethodPost:
		var input struct {
			Passcode string `json:"passcode"`
		}
		if !decode(w, r, &input) {
			return
		}
		err := h.service.SetPasscode(r.Context(), current.ID, input.Passcode)
		respondPasscode(w, r, err)
	case path == "/api/v2/users/passcode/verify" && r.Method == http.MethodPost:
		var input struct {
			Passcode string `json:"passcode"`
		}
		if !decode(w, r, &input) {
			return
		}
		respondPasscode(w, r, h.service.VerifyPasscode(r.Context(), current.ID, input.Passcode))
	case path == "/api/v2/users/passcode/disable" && r.Method == http.MethodPost:
		var input struct {
			Passcode string `json:"passcode"`
		}
		if !decode(w, r, &input) {
			return
		}
		respondPasscode(w, r, h.service.DisablePasscode(r.Context(), current.ID, input.Passcode))
	case path == "/api/v2/users/passcode/timeout" && r.Method == http.MethodPut:
		var input struct {
			Timeout int `json:"timeout"`
		}
		if !decode(w, r, &input) {
			return
		}
		respondPasscode(w, r, h.service.UpdatePasscodeTimeout(r.Context(), current.ID, input.Timeout))
	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func respondPasscode(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "passcode must be at least 4 characters")
	case errors.Is(err, ErrNoPasscodeSet):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "no_passcode_set", "no passcode set")
	case errors.Is(err, ErrWrongPasscode):
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "wrong_passcode", "wrong passcode")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "passcode operation failed")
	default:
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func parseUserSubroute(path string) (string, string) {
	rest := strings.TrimPrefix(path, "/api/v2/users/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		return "", ""
	}
	return parts[0], parts[1]
}

func isValidUUID(value string) bool {
	return validate.Var(value, "required,uuid") == nil
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
	if err := dec.Decode(value); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	// Reject trailing data after the first JSON value.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	return true
}

type preferenceRouteSpec struct {
	column string
	key    string
}

func preferenceSpec(path string) (preferenceRouteSpec, bool) {
	var column string
	switch path {
	case "/api/v2/users/notifications":
		column = "notification_settings"
	case "/api/v2/users/sounds":
		column = "sound_settings"
	case "/api/v2/users/advanced-settings":
		column = "advanced_settings"
	default:
		return preferenceRouteSpec{}, false
	}
	return preferenceRouteSpec{column: column, key: "settings"}, true
}
