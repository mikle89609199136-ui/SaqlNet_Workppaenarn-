package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

// QR login the other way round (#754): the signed-in device shows the code
// and the new device scans it.
//
// The QR code carries the offer token, a one-time ECDH public key of the
// signed-in device and a random MAC key. The last two sit after "#" in the
// link and never reach the server. The new device claims the offer with its
// own one-time public key and an HMAC over it made with that MAC key: the
// server relays the key but cannot swap it for its own without the signed-in
// device noticing. After the person confirms, the server issues the session
// and relays the master key encrypted to the new device.
//
// The same rules as for the code shown by a new device apply (#753): the
// code changes every 30 seconds, lives 60, and the first claim captures it.

const macBytes = 32

type QROfferData struct {
	OwnerID   string
	CreatedAt time.Time
	ExpiresAt time.Time
	// Claimed is set by the first new device; ClaimSecret lets only that
	// device collect the result.
	Claimed     bool
	ClaimSecret string
	PublicKey   string
	MAC         string
	DeviceName  string
	UserAgent   string
	IPAddress   string
	ClaimedAt   time.Time
	Confirmed   bool
	AuthToken   string
	Payload     json.RawMessage
}

func validMAC(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(value, "="))
	return err == nil && len(decoded) == macBytes
}

// liveQROffer returns an offer that has not expired. The caller holds qrMu.
func (h *Handler) liveQROffer(token string) (*QROfferData, bool) {
	val, ok := h.qrOffers.Load(token)
	if !ok {
		return nil, false
	}
	offer := val.(*QROfferData)
	if time.Now().After(offer.ExpiresAt) {
		h.qrOffers.Delete(token)
		return nil, false
	}
	return offer, true
}

// QROfferCreate shows a new code on the signed-in device or replaces the one
// shown a moment ago.
func (h *Handler) QROfferCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)

	var input struct {
		Replaces string `json:"replaces"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}

	token, err := randomHex(16)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate token")
		return
	}

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	now := time.Now()
	h.sweepQR(now)

	if input.Replaces != "" {
		if previous, ok := h.liveQROffer(input.Replaces); ok {
			if previous.OwnerID != current.ID {
				httpx.ErrorJSON(w, r, http.StatusForbidden, "forbidden", "the code belongs to another account")
				return
			}
			// A claimed code waits for the person's decision instead of changing.
			if previous.Claimed {
				httpx.ErrorJSON(w, r, http.StatusConflict, "qr_scanned", "the code has been scanned and waits for confirmation")
				return
			}
			h.qrOffers.Delete(input.Replaces)
			h.qrRotated.Store(input.Replaces, now.Add(qrRotatedTTL))
		}
	}

	expiresAt := now.Add(qrLoginTTL)
	h.qrOffers.Store(token, &QROfferData{OwnerID: current.ID, CreatedAt: now, ExpiresAt: expiresAt})

	httpx.JSON(w, http.StatusOK, map[string]any{
		"offerToken": token,
		"expiresAt":  expiresAt.UnixMilli(),
	})
}

// QROffer serves the owner of the code: GET reports whether a new device
// claimed it, DELETE withdraws the code (page closed, request declined).
func (h *Handler) QROffer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		h.qrOfferState(w, r)
	case http.MethodDelete:
		h.withdrawQROffer(w, r)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (h *Handler) qrOfferState(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	offer, ok := h.liveQROffer(r.PathValue("token"))
	// Somebody else's code looks the same as a missing one.
	if !ok || offer.OwnerID != current.ID {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "expired"})
		return
	}

	switch {
	case offer.Confirmed:
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "confirmed"})
	case offer.Claimed:
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":    "claimed",
			"expiresAt": offer.ExpiresAt.UnixMilli(),
			"claim": map[string]any{
				"publicKey":  offer.PublicKey,
				"mac":        offer.MAC,
				"deviceName": offer.DeviceName,
				"userAgent":  offer.UserAgent,
				"claimedAt":  offer.ClaimedAt.UnixMilli(),
			},
		})
	default:
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "pending", "expiresAt": offer.ExpiresAt.UnixMilli()})
	}
}

func (h *Handler) withdrawQROffer(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	token := r.PathValue("token")

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	if offer, ok := h.liveQROffer(token); ok && offer.OwnerID == current.ID {
		h.qrOffers.Delete(token)
	}
	w.WriteHeader(http.StatusNoContent)
}

// QROfferClaim is called by the new device that scanned the code. The first
// claim captures the code; the answer carries the secret for the status.
func (h *Handler) QROfferClaim(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	var input struct {
		PublicKey  string `json:"publicKey"`
		MAC        string `json:"mac"`
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
	if !validMAC(input.MAC) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "mac must be a base64url HMAC-SHA-256")
		return
	}

	claimSecret, err := newQRSecret()
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to generate secret")
		return
	}

	token := r.PathValue("token")
	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	offer, ok := h.liveQROffer(token)
	if !ok || offer.Claimed {
		h.qrGone(w, r, token)
		return
	}

	now := time.Now()
	offer.Claimed = true
	offer.ClaimSecret = claimSecret
	offer.PublicKey = input.PublicKey
	offer.MAC = input.MAC
	offer.DeviceName = truncateRunes(input.DeviceName, maxQRDeviceNameRunes)
	offer.UserAgent = truncateRunes(r.UserAgent(), maxQRUserAgentRunes)
	offer.IPAddress = requestClientIP(r)
	offer.ClaimedAt = now
	offer.ExpiresAt = now.Add(qrScanTTL)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"claimSecret": claimSecret,
		"expiresAt":   offer.ExpiresAt.UnixMilli(),
	})
}

// QROfferStatus is polled by the new device with its claim secret. The
// session and the key are handed out once.
func (h *Handler) QROfferStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	token := r.PathValue("token")
	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	offer, ok := h.liveQROffer(token)
	if !ok {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "expired"})
		return
	}
	if !offer.Claimed || !sameQRSecret(offer.ClaimSecret, r.Header.Get(qrSecretHeader)) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "invalid_secret", "the status is available only to the device that claimed the code")
		return
	}

	if offer.Confirmed {
		h.qrOffers.Delete(token)
		// Новое устройство получает сессию в cookie (#705).
		authctx.SetSessionCookie(w, offer.AuthToken)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":  "confirmed",
			"payload": offer.Payload,
		})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "pending", "expiresAt": offer.ExpiresAt.UnixMilli()})
}

// QROfferConfirm is the person's yes on the signed-in device: it carries the
// master key encrypted to the claimed public key.
func (h *Handler) QROfferConfirm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)

	var input struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQRRequestBodyBytes)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if !validQRPayload(input.Payload) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "payload must contain senderPublicKey, iv and ct")
		return
	}

	h.qrMu.Lock()
	defer h.qrMu.Unlock()

	offer, ok := h.liveQROffer(r.PathValue("token"))
	if !ok || offer.OwnerID != current.ID {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "invalid_token", "QR code expired or already used")
		return
	}
	if offer.Confirmed {
		httpx.ErrorJSON(w, r, http.StatusConflict, "already_confirmed", "QR login is already confirmed")
		return
	}
	if !offer.Claimed {
		httpx.ErrorJSON(w, r, http.StatusConflict, "not_claimed", "no device has scanned the code yet")
		return
	}

	authToken, err := h.service.IssueQRToken(r.Context(), current.ID, current.TokenGeneration, SessionMetadata{
		DeviceName: offer.DeviceName,
		DeviceType: deviceTypeFromUserAgent(offer.UserAgent),
		IPAddress:  offer.IPAddress,
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

	offer.Confirmed = true
	offer.AuthToken = authToken
	offer.Payload = input.Payload

	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}
