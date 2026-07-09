package auth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]{3,32}$`)

type QRTokenData struct {
	ExpiresAt time.Time
	Confirmed bool
	AuthToken string
}

type Handler struct {
	service  *Service
	qrTokens sync.Map
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
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
	if !usernamePattern.MatchString(input.Username) || len(input.Password) < 10 || strings.TrimSpace(input.FirstName) == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "username, password or firstName is invalid")
		return
	}
	user, token, err := h.service.Register(r.Context(), input.Username, input.Password, input.FirstName, input.LastName, input.Language)
	if errors.Is(err, ErrUsernameTaken) {
		httpx.ErrorJSON(w, r, http.StatusConflict, "username_taken", "username already exists")
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
	if err := h.service.SavePublicKey(r.Context(), current.ID, input.PublicKey); err != nil {
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
	if len(input.NewPassword) < 10 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "new password must be at least 10 characters")
		return
	}
	err := h.service.ChangePassword(r.Context(), current.ID, input.CurrentPassword, input.NewPassword)
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
	if len(input.Password) < 6 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "password too short")
		return
	}
	if err := h.service.TwoFAEnable(r.Context(), current.ID, input.Password); err != nil {
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

func (h *Handler) QRToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate token")
		return
	}
	qrToken := hex.EncodeToString(buf[:])
	expiresAt := time.Now().Add(5 * time.Minute)

	h.qrTokens.Store(qrToken, &QRTokenData{
		ExpiresAt: expiresAt,
		Confirmed: false,
	})

	host := r.Host
	protocol := r.Header.Get("X-Forwarded-Proto")
	if protocol == "" {
		if r.TLS != nil {
			protocol = "https"
		} else {
			protocol = "http"
		}
	}

	qrUrl := fmt.Sprintf("%s://%s/api/v2/auth/qr-confirm?token=%s", protocol, host, qrToken)
	png, err := qrcode.Encode(qrUrl, qrcode.Medium, 256)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate qr code")
		return
	}
	qrImage := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"qrToken":   qrToken,
		"qrImage":   qrImage,
		"expiresAt": expiresAt.UnixMilli(),
	})
}

func (h *Handler) QRStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	token := r.PathValue("token")
	if token == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_request", "token required")
		return
	}

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

	if data.Confirmed {
		authToken := data.AuthToken
		h.qrTokens.Delete(token)
		httpx.JSON(w, http.StatusOK, map[string]string{
			"status":    "confirmed",
			"authToken": authToken,
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
		QRToken string `json:"qrToken"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}

	if input.QRToken == "" {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_request", "qrToken required")
		return
	}

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

	authToken, err := h.service.IssueQRToken(r.Context(), current.ID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to issue token")
		return
	}

	h.qrTokens.Store(input.QRToken, &QRTokenData{
		ExpiresAt: data.ExpiresAt,
		Confirmed: true,
		AuthToken: authToken,
	})

	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}
