package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/httpx"
	usernamepolicy "craneapp/backend-v2/internal/platform/username"
)

type QRTokenData struct {
	CreatedAt time.Time
	ExpiresAt time.Time
	// Secret is known only to the device showing the code: it is returned on
	// creation and never drawn into the QR code. Polling, replacing and
	// cancelling the code require it, so a photo of the screen is not enough
	// to pick up the session (#753).
	Secret     string
	PublicKey  string
	DeviceName string
	UserAgent  string
	IPAddress  string
	// ScannedBy is the account that scanned the code first. Nobody else can
	// look at the request or confirm it.
	ScannedBy string
	Confirmed bool
	AuthToken string
	Payload   json.RawMessage
}

type Handler struct {
	service                    *Service
	logoutAllGenerationEnabled bool
	qrTokens                   sync.Map
	qrOffers                   sync.Map
	// qrRotated remembers replaced codes for a while, so a device that
	// scanned a code a moment too late hears "the code changed" rather than
	// a generic error.
	qrRotated sync.Map
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
		Username   string `json:"username"`
		Password   string `json:"password"`
		FirstName  string `json:"firstName"`
		LastName   string `json:"lastName"`
		Language   string `json:"language"`
		DeviceName string `json:"deviceName"`
		DeviceType string `json:"deviceType"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	input.Username = usernamepolicy.Normalize(input.Username)
	if !usernamepolicy.Valid(input.Username) || strings.TrimSpace(input.FirstName) == "" || utf8.RuneCountInString(input.FirstName) > 64 || utf8.RuneCountInString(input.LastName) > 64 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username, firstName or lastName is invalid")
		return
	}
	user, token, err := h.service.Register(
		r.Context(), input.Username, input.Password, input.FirstName, input.LastName, input.Language,
		sessionMetadataFromRequest(r, input.DeviceName, input.DeviceType),
	)
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
	// Токен доступен браузеру только как HttpOnly-cookie (#705).
	authctx.SetSessionCookie(w, token)
	httpx.JSON(w, http.StatusCreated, map[string]any{"user": user})
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
		DeviceName    string `json:"deviceName"`
		DeviceType    string `json:"deviceType"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	user, token, err := h.service.Login(
		r.Context(), input.Username, input.Password, input.TwoFAPassword,
		sessionMetadataFromRequest(r, input.DeviceName, input.DeviceType),
	)
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
	authctx.SetSessionCookie(w, token)
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
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
	// Отзывается токен текущей cookie-сессии.
	token, _ := authctx.TokenFromRequest(r)
	expiresAt := current.ExpiresAt
	if expiresAt.IsZero() {
		// Direct handler tests bypass middleware. Authenticated production
		// requests always carry the verified claim expiry in authctx.User.
		expiresAt = time.Now().Add(authctx.SessionTTL)
	}
	if err := h.service.Logout(r.Context(), current.ID, token, expiresAt); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "logout failed")
		return
	}
	authctx.ClearSessionCookie(w)
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
	authctx.ClearSessionCookie(w)
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) Sessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)
	token, _ := authctx.TokenFromRequest(r)
	sessions, err := h.service.Sessions(r.Context(), current.ID, token)
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
	if errors.Is(err, cryptoclient.ErrUnavailable) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_unavailable", "crypto service is temporarily unavailable")
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
	if errors.Is(err, cryptoclient.ErrUnavailable) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_unavailable", "crypto service is temporarily unavailable")
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
	if errors.Is(err, cryptoclient.ErrUnavailable) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_unavailable", "crypto service is temporarily unavailable")
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
	if errors.Is(err, cryptoclient.ErrUnavailable) {
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_unavailable", "crypto service is temporarily unavailable")
		return
	}
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
//
// A code on a screen can be photographed, so it lives briefly (#753): the
// showing device replaces it every 30 seconds, and the TTL is only a safety
// net for a tab that fell asleep. The first account to scan a code captures
// it; from then on the code stops changing and waits for that account alone.

const (
	qrLoginTTL = 60 * time.Second
	// qrScanTTL is how long a scanned code waits for the confirmation.
	qrScanTTL = 60 * time.Second
	// qrRotatedTTL keeps a replaced code recognisable as replaced.
	qrRotatedTTL          = 2 * time.Minute
	qrSecretHeader        = "X-QR-Secret"
	qrSecretBytes         = 32
	minQRPublicKeyBytes   = 26
	maxQRPublicKeyBytes   = 200
	maxQRDeviceNameRunes  = 64
	maxQRUserAgentRunes   = 256
	maxQRPayloadBytes     = 4 << 10
	maxQRRequestBodyBytes = 16 << 10
)

const clientIPHeader = "X-Crane-Client-IP"

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func sessionMetadataFromRequest(r *http.Request, deviceName, deviceType string) SessionMetadata {
	deviceName = truncateRunes(deviceName, maxQRDeviceNameRunes)
	deviceType = strings.ToLower(strings.TrimSpace(deviceType))
	switch deviceType {
	case "desktop", "mobile", "tablet":
	default:
		deviceType = deviceTypeFromUserAgent(r.UserAgent())
	}
	return SessionMetadata{
		DeviceName: deviceName,
		DeviceType: deviceType,
		IPAddress:  requestClientIP(r),
		UserAgent:  truncateRunes(r.UserAgent(), maxQRUserAgentRunes),
	}
}

func deviceTypeFromUserAgent(userAgent string) string {
	switch {
	case strings.Contains(userAgent, "iPad") || strings.Contains(userAgent, "Tablet"):
		return "tablet"
	case strings.Contains(userAgent, "Android") || strings.Contains(userAgent, "iPhone") || strings.Contains(userAgent, "Mobile"):
		return "mobile"
	case strings.TrimSpace(userAgent) != "":
		return "desktop"
	default:
		return "unknown"
	}
}

func requestClientIP(r *http.Request) string {
	if address, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get(clientIPHeader))); err == nil {
		return address.Unmap().String()
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if address, err := netip.ParseAddr(strings.TrimSpace(host)); err == nil {
		return address.Unmap().String()
	}
	return ""
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

func randomHex(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func newQRSecret() (string, error) {
	buf := make([]byte, qrSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func sameQRSecret(expected, given string) bool {
	return expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(given)) == 1
}

// sweepQR drops expired codes. Nothing else removes a code nobody polls any
// more, and creating codes needs no account. The caller holds qrMu.
func (h *Handler) sweepQR(now time.Time) {
	h.qrTokens.Range(func(key, val any) bool {
		if now.After(val.(*QRTokenData).ExpiresAt) {
			h.qrTokens.Delete(key)
		}
		return true
	})
	h.qrOffers.Range(func(key, val any) bool {
		if now.After(val.(*QROfferData).ExpiresAt) {
			h.qrOffers.Delete(key)
		}
		return true
	})
	h.qrRotated.Range(func(key, val any) bool {
		if now.After(val.(time.Time)) {
			h.qrRotated.Delete(key)
		}
		return true
	})
}

// qrGone answers for a code that is not there: replaced by a newer one, or
// expired and used. The caller holds qrMu.
func (h *Handler) qrGone(w http.ResponseWriter, r *http.Request, token string) {
	if until, ok := h.qrRotated.Load(token); ok && time.Now().Before(until.(time.Time)) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "qr_rotated", "QR code has been replaced by a newer one")
		return
	}
	httpx.ErrorJSON(w, r, http.StatusNotFound, "invalid_token", "QR code expired or already used")
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

// QRToken starts a login or replaces the code shown a moment ago. The
// replacement is authorised by the secret from the previous answer.
func (h *Handler) QRToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	var input struct {
		PublicKey  string `json:"publicKey"`
		DeviceName string `json:"deviceName"`
		Replaces   string `json:"replaces"`
		Secret     string `json:"secret"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if _, ok := decodeQRPublicKey(input.PublicKey); !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "publicKey must be a base64 public key")
		return
	}

	qrToken, err := randomHex(16)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate token")
		return
	}
	secret, err := newQRSecret()
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate token")
		return
	}

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	now := time.Now()
	h.sweepQR(now)

	if input.Replaces != "" {
		if val, ok := h.qrTokens.Load(input.Replaces); ok {
			previous := val.(*QRTokenData)
			if !sameQRSecret(previous.Secret, input.Secret) {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "invalid_secret", "the code can be replaced only by the device showing it")
				return
			}
			// A scanned code waits for its confirmation instead of changing.
			if previous.ScannedBy != "" {
				httpx.ErrorJSON(w, r, http.StatusConflict, "qr_scanned", "the code has been scanned and waits for confirmation")
				return
			}
			h.qrTokens.Delete(input.Replaces)
			h.qrRotated.Store(input.Replaces, now.Add(qrRotatedTTL))
		}
	}

	expiresAt := now.Add(qrLoginTTL)
	h.qrTokens.Store(qrToken, &QRTokenData{
		CreatedAt:  now,
		ExpiresAt:  expiresAt,
		Secret:     secret,
		PublicKey:  input.PublicKey,
		DeviceName: truncateRunes(input.DeviceName, maxQRDeviceNameRunes),
		UserAgent:  truncateRunes(r.UserAgent(), maxQRUserAgentRunes),
		IPAddress:  requestClientIP(r),
	})

	httpx.JSON(w, http.StatusOK, map[string]any{
		"qrToken":   qrToken,
		"secret":    secret,
		"expiresAt": expiresAt.UnixMilli(),
	})
}

// QRCancel withdraws a code when the page showing it goes away.
func (h *Handler) QRCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	var input struct {
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}

	token := r.PathValue("token")
	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	if val, ok := h.qrTokens.Load(token); ok {
		if !sameQRSecret(val.(*QRTokenData).Secret, input.Secret) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "invalid_secret", "the code can be cancelled only by the device showing it")
			return
		}
		h.qrTokens.Delete(token)
	}
	w.WriteHeader(http.StatusNoContent)
}

// QRRequest serves the signed-in device that scanned a code: GET tells it
// which device is asking to log in, DELETE declines the request.
func (h *Handler) QRRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		h.inspectQRLogin(w, r)
	case http.MethodDelete:
		h.declineQRLogin(w, r)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

// inspectQRLogin shows the request so the person can refuse a code they did
// not open themselves. The first look captures the code for this account.
func (h *Handler) inspectQRLogin(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	token := r.PathValue("token")

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	data, ok := h.pendingQRLogin(token)
	if ok && data.ScannedBy != "" && data.ScannedBy != current.ID {
		ok = false
	}
	if !ok {
		h.qrGone(w, r, token)
		return
	}
	if data.ScannedBy == "" {
		data.ScannedBy = current.ID
		data.ExpiresAt = time.Now().Add(qrScanTTL)
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"publicKey":  data.PublicKey,
		"deviceName": data.DeviceName,
		"userAgent":  data.UserAgent,
		"createdAt":  data.CreatedAt.UnixMilli(),
		"expiresAt":  data.ExpiresAt.UnixMilli(),
	})
}

// declineQRLogin drops a code this account scanned; the device showing it
// then sees it expired and draws a new one.
func (h *Handler) declineQRLogin(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	token := r.PathValue("token")

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	if data, ok := h.pendingQRLogin(token); ok && data.ScannedBy == current.ID {
		h.qrTokens.Delete(token)
	}
	w.WriteHeader(http.StatusNoContent)
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
	// The token is drawn into the QR code, the secret is not: without it a
	// photo of the screen would be enough to collect the session.
	if !sameQRSecret(data.Secret, r.Header.Get(qrSecretHeader)) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "invalid_secret", "the status is available only to the device showing the code")
		return
	}

	// The session and the key are handed out once; a second poll finds nothing.
	if data.Confirmed {
		h.qrTokens.Delete(token)
		// Новое устройство получает сессию в cookie (#705).
		authctx.SetSessionCookie(w, data.AuthToken)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":  "confirmed",
			"payload": data.Payload,
		})
		return
	}

	status := "pending"
	if data.ScannedBy != "" {
		status = "scanned"
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"status":    status,
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
	// Only the account that looked at the request and captured the code.
	if data.ScannedBy != current.ID {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "not_scanned", "scan the QR code before confirming it")
		return
	}

	authToken, err := h.service.IssueQRToken(r.Context(), current.ID, current.TokenGeneration, SessionMetadata{
		DeviceName: data.DeviceName,
		DeviceType: deviceTypeFromUserAgent(data.UserAgent),
		IPAddress:  data.IPAddress,
		UserAgent:  data.UserAgent,
	})
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
	return errors.Is(err, ErrTokenGenerationChanged) || errors.Is(err, cryptoclient.ErrTokenGenerationProtocol) || errors.Is(err, cryptoclient.ErrUnavailable)
}
