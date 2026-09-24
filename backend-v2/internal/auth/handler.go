package auth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/httpx"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]{3,32}$`)

type QRTokenData struct {
	CreatedAt  time.Time
	ExpiresAt  time.Time
	PublicKey  string
	DeviceName string
	UserAgent  string
	Confirmed  bool
	AuthToken  string
	Payload    json.RawMessage
}

type Handler struct {
	service                    *Service
	logoutAllGenerationEnabled bool
	qrTokens                   sync.Map
	// qrMu makes each QR state change atomic: confirm-once and hand-out-once.
	qrMu sync.Mutex
}

type HandlerOption func(*Handler)

// WithLogoutAllGenerationEnabled enables the generation-changing logout-all
// operation. It must only be enabled after every token issuer and validator in
// the deployment understands token generations.
func WithLogoutAllGenerationEnabled(enabled bool) HandlerOption {
	return func(handler *Handler) {
		handler.logoutAllGenerationEnabled = enabled
	}
}

func NewHandler(service *Service, options ...HandlerOption) *Handler {
	handler := &Handler{service: service}
	for _, option := range options {
		option(handler)
	}
	return handler
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var input struct {
		Username  string `json:"username"`
		Password  string `json:"password"`
		FirstName string `json:"firstName"`
		LastName  string `json:"lastName"`
		Language  string `json:"language"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if !usernamePattern.MatchString(input.Username) || strings.TrimSpace(input.FirstName) == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username or firstName is invalid")
		return
	}
	user, token, err := h.service.Register(r.Context(), input.Username, input.Password, input.FirstName, input.LastName, input.Language)
	if errors.Is(err, ErrInvalidPassword) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "weak_password", "password does not meet security requirements")
		return
	}
	if errors.Is(err, ErrUsernameTaken) {
		httpx.ErrorJSON(w, r, http.StatusConflict, "username_taken", "username already exists")
		return
	}
	if tokenIssuanceUnavailable(err) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "token_issuer_not_ready", "token issuer is not ready")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "registration failed")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"user": user, "token": token})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var input struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		TwoFAPassword string `json:"twoFAPassword"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	user, token, err := h.service.Login(r.Context(), input.Username, input.Password, input.TwoFAPassword)
	if errors.Is(err, ErrTwoFARequired) {
		httpx.JSON(w, http.StatusOK, map[string]any{"twoFARequired": true, "userId": user.ID})
		return
	}
	if errors.Is(err, ErrInvalidTwoFA) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "invalid_2fa", "invalid 2fa password")
		return
	}
	if errors.Is(err, ErrInvalidCredentials) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "invalid_credentials", "invalid username or password")
		return
	}
	if tokenIssuanceUnavailable(err) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "token_issuer_not_ready", "token issuer is not ready")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "login failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user, "token": token})
}

func (h *Handler) PublicKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		PublicKey string `json:"publicKey"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if err := h.service.SavePublicKey(r.Context(), current.ID, input.PublicKey); errors.Is(err, ErrUserNotFound) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "invalid_session", "authenticated user no longer exists")
		return
	} else if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_public_key", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	// Token from Rust service expires in 30 days; store hash for that duration.
	if err := h.service.Logout(r.Context(), current.ID, token, time.Now().Add(30*24*time.Hour)); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "logout failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	if !h.logoutAllGenerationEnabled {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "logout_all_unavailable", "logout from all devices is not enabled yet")
		return
	}
	current := authctx.MustUser(r)
	if err := h.service.LogoutAll(r.Context(), current.ID); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "logout failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) Sessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	sessions, err := h.service.Sessions(r.Context(), current.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get sessions")
		return
	}
	if sessions == nil {
		sessions = []Session{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	err := h.service.ChangePassword(r.Context(), current.ID, input.CurrentPassword, input.NewPassword)
	if errors.Is(err, ErrInvalidPassword) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "weak_password", "password does not meet security requirements")
		return
	}
	if errors.Is(err, ErrWrongPassword) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "wrong_password", "current password is incorrect")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "change password failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) TwoFAStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	enabled, err := h.service.TwoFAStatus(r.Context(), current.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to get 2fa status")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (h *Handler) TwoFAEnable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	err := h.service.TwoFAEnable(r.Context(), current.ID, input.Password)
	if errors.Is(err, ErrInvalidPassword) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "weak_password", "password does not meet security requirements")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to enable 2fa")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) TwoFADisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	err := h.service.TwoFADisable(r.Context(), current.ID, input.Password)
	if errors.Is(err, ErrTwoFANotEnabled) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "two_fa_not_enabled", "2FA is not enabled")
		return
	}
	if errors.Is(err, ErrWrongPassword) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "wrong_password", "incorrect 2FA password")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to disable 2fa")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) TwoFAVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	required, ok, err := h.service.TwoFAVerify(r.Context(), current.ID, input.Password)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "verification failed")
		return
	}
	if required && !ok {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "wrong_password", "incorrect 2FA password")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "required": required})
}

// QR login with key hand-off (#741).
//
// The new device shows a QR code with a token and a one-time ECDH public key.
// A device that is already signed in scans it, checks which device is asking,
// and confirms with the backup master key encrypted to that public key. The
// server only relays the ciphertext and issues the session; it cannot read the
// key. The QR code is drawn by the client, so nothing here depends on Host.

const (
	qrLoginTTL            = 5 * time.Minute
	minQRPublicKeyBytes   = 26
	maxQRPublicKeyBytes   = 200
	maxQRDeviceNameRunes  = 64
	maxQRUserAgentRunes   = 256
	maxQRPayloadBytes     = 4 << 10
	maxQRRequestBodyBytes = 16 << 10
)

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func decodeQRPublicKey(value string) ([]byte, bool) {
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.StdEncoding, base64.RawStdEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, len(decoded) >= minQRPublicKeyBytes && len(decoded) <= maxQRPublicKeyBytes
		}
	}
	return nil, false
}

// validQRPayload accepts the encrypted hand-off {senderPublicKey, iv, ct}. The
// server cannot check the cryptography, only that the shape is sane.
func validQRPayload(payload json.RawMessage) bool {
	if len(payload) == 0 || len(payload) > maxQRPayloadBytes {
		return false
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		return false
	}
	for _, name := range []string{"senderPublicKey", "iv", "ct"} {
		if value, ok := fields[name].(string); !ok || value == "" {
			return false
		}
	}
	return true
}

// pendingQRLogin returns a live, unconfirmed login. The caller holds qrMu.
func (h *Handler) pendingQRLogin(token string) (*QRTokenData, bool) {
	val, ok := h.qrTokens.Load(token)
	if !ok {
		return nil, false
	}
	data := val.(*QRTokenData)
	if time.Now().After(data.ExpiresAt) {
		h.qrTokens.Delete(token)
		return nil, false
	}
	return data, !data.Confirmed
}

func (h *Handler) QRToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	var input struct {
		PublicKey  string `json:"publicKey"`
		DeviceName string `json:"deviceName"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if _, ok := decodeQRPublicKey(input.PublicKey); !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "publicKey must be a base64 public key")
		return
	}

	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate token")
		return
	}
	qrToken := hex.EncodeToString(buf[:])
	now := time.Now()
	expiresAt := now.Add(qrLoginTTL)

	h.qrTokens.Store(qrToken, &QRTokenData{
		CreatedAt:  now,
		ExpiresAt:  expiresAt,
		PublicKey:  input.PublicKey,
		DeviceName: truncateRunes(input.DeviceName, maxQRDeviceNameRunes),
		UserAgent:  truncateRunes(r.UserAgent(), maxQRUserAgentRunes),
	})

	httpx.JSON(w, http.StatusOK, map[string]any{
		"qrToken":   qrToken,
		"expiresAt": expiresAt.UnixMilli(),
	})
}

// QRRequest tells the signed-in device which device is asking to log in, so
// the person can refuse a code they did not open themselves.
func (h *Handler) QRRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	h.qrMu.Lock()
	data, ok := h.pendingQRLogin(r.PathValue("token"))
	var request map[string]any
	if ok {
		request = map[string]any{
			"publicKey":  data.PublicKey,
			"deviceName": data.DeviceName,
			"userAgent":  data.UserAgent,
			"createdAt":  data.CreatedAt.UnixMilli(),
			"expiresAt":  data.ExpiresAt.UnixMilli(),
		}
	}
	h.qrMu.Unlock()

	if !ok {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "invalid_token", "QR code expired or already used")
		return
	}
	httpx.JSON(w, http.StatusOK, request)
}

func (h *Handler) QRStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	token := r.PathValue("token")
	if token == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_request", "token required")
		return
	}

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	val, ok := h.qrTokens.Load(token)
	if !ok {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "expired"})
		return
	}

	data := val.(*QRTokenData)
	if time.Now().After(data.ExpiresAt) {
		h.qrTokens.Delete(token)
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "expired"})
		return
	}

	// The session and the key are handed out once; a second poll finds nothing.
	if data.Confirmed {
		h.qrTokens.Delete(token)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":    "confirmed",
			"authToken": data.AuthToken,
			"payload":   data.Payload,
		})
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"status":    "pending",
		"expiresAt": data.ExpiresAt.UnixMilli(),
	})
}

func (h *Handler) QRConfirm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	current := authctx.MustUser(r)

	var input struct {
		QRToken string          `json:"qrToken"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}

	if input.QRToken == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_request", "qrToken required")
		return
	}
	if !validQRPayload(input.Payload) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "payload must contain senderPublicKey, iv and ct")
		return
	}

	// Held across token issue: a code confirmed twice, possibly by two
	// different accounts, must not end up with the second one's session (#412).
	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	val, ok := h.qrTokens.Load(input.QRToken)
	if !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_token", "QR connection expired or invalid")
		return
	}
	data := val.(*QRTokenData)
	if time.Now().After(data.ExpiresAt) {
		h.qrTokens.Delete(input.QRToken)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_token", "QR connection expired or invalid")
		return
	}
	if data.Confirmed {
		httpx.ErrorJSON(w, r, http.StatusConflict, "already_confirmed", "QR login is already confirmed")
		return
	}

	authToken, err := h.service.IssueQRToken(r.Context(), current.ID, current.TokenGeneration)
	if errors.Is(err, ErrAuthorizationRevoked) {
		httpx.ErrorJSON(w, r, http.StatusUnauthorized, "token_revoked", "authorization token has been revoked")
		return
	}
	if tokenIssuanceUnavailable(err) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "token_issuer_not_ready", "token issuer is not ready")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to issue token")
		return
	}

	data.Confirmed = true
	data.AuthToken = authToken
	data.Payload = input.Payload

	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func tokenIssuanceUnavailable(err error) bool {
	return errors.Is(err, ErrTokenGenerationChanged) || errors.Is(err, cryptoclient.ErrTokenGenerationProtocol)
}
