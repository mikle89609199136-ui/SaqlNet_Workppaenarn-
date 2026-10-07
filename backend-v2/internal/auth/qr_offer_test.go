package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A base64url HMAC-SHA-256; the server only checks the size.
var qrMAC = strings.Repeat("M", 43)

func offerPath(token, suffix string) string {
	return "/api/v2/auth/qr-offer/" + token + suffix
}

func createOffer(t *testing.T, handler *Handler, userID, replaces string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{}`
	if replaces != "" {
		body = `{"replaces":"` + replaces + `"}`
	}
	return qrCall(handler.QROfferCreate, http.MethodPost, "/api/v2/auth/qr-offer", "", body, userID)
}

func startOffer(t *testing.T, handler *Handler, userID string) string {
	t.Helper()
	recorder := createOffer(t, handler, userID, "")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	return decodeJSON(t, recorder)["offerToken"].(string)
}

func claimOffer(handler *Handler, token, body string) *httptest.ResponseRecorder {
	return qrCall(handler.QROfferClaim, http.MethodPost, offerPath(token, "/claim"), token, body, "")
}

func claimBody(publicKey string) string {
	return `{"publicKey":"` + publicKey + `","mac":"` + qrMAC + `","deviceName":" iPhone "}`
}

func claim(t *testing.T, handler *Handler, token string) string {
	t.Helper()
	recorder := claimOffer(handler, token, claimBody(qrPublicKey))
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	return decodeJSON(t, recorder)["claimSecret"].(string)
}

func offerState(t *testing.T, handler *Handler, token, userID string) map[string]any {
	t.Helper()
	recorder := qrCall(handler.QROffer, http.MethodGet, offerPath(token, ""), token, "", userID)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	return decodeJSON(t, recorder)
}

func offerStatus(handler *Handler, token, secret string) *httptest.ResponseRecorder {
	return qrServe(handler.QROfferStatus, qrRequest{
		method: http.MethodGet, target: offerPath(token, "/status"), pathToken: token, secret: secret,
	})
}

func confirmOffer(handler *Handler, token, userID string) *httptest.ResponseRecorder {
	return qrCall(handler.QROfferConfirm, http.MethodPost, offerPath(token, "/confirm"), token, `{"payload":`+qrPayload+`}`, userID)
}

func TestQROfferHandsOverSessionAndPayloadOnce(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	require.Equal(t, "pending", offerState(t, handler, token, "user-1")["status"])

	secret := claim(t, handler, token)
	pending := offerStatus(handler, token, secret)
	require.Equal(t, http.StatusOK, pending.Code, pending.Body.String())
	require.Equal(t, "pending", decodeJSON(t, pending)["status"])

	// The owner sees the claimed key and its MAC to check against the QR code.
	state := offerState(t, handler, token, "user-1")
	require.Equal(t, "claimed", state["status"])
	details := state["claim"].(map[string]any)
	require.Equal(t, qrPublicKey, details["publicKey"])
	require.Equal(t, qrMAC, details["mac"])
	require.Equal(t, "iPhone", details["deviceName"])
	require.Equal(t, "Mozilla/5.0 Test", details["userAgent"])

	expectIssueToken(mock, "user-1")
	confirm := confirmOffer(handler, token, "user-1")
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())

	status := offerStatus(handler, token, secret)
	require.Equal(t, "no-store", status.Header().Get("Cache-Control"))
	confirmed := decodeJSON(t, status)
	require.Equal(t, "confirmed", confirmed["status"])
	require.NotContains(t, confirmed, "authToken")
	// Новое устройство получает сессию в cookie (#705).
	require.Equal(t, "token", sessionCookieValue(t, status))
	payload, err := json.Marshal(confirmed["payload"])
	require.NoError(t, err)
	require.JSONEq(t, qrPayload, string(payload))

	require.Equal(t, map[string]any{"status": "expired"}, decodeJSON(t, offerStatus(handler, token, secret)))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQROfferIsCapturedByTheFirstClaim(t *testing.T) {
	handler, _ := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	val, _ := handler.qrOffers.Load(token)
	val.(*QROfferData).ExpiresAt = time.Now().Add(time.Second)

	secret := claim(t, handler, token)
	require.WithinDuration(t, time.Now().Add(qrScanTTL), val.(*QROfferData).ExpiresAt, time.Second)

	second := claimOffer(handler, token, claimBody(strings.Repeat("B", 122)))
	require.Equal(t, http.StatusNotFound, second.Code)
	require.Equal(t, "invalid_token", decodeJSON(t, second)["code"])
	require.Equal(t, qrPublicKey, offerState(t, handler, token, "user-1")["claim"].(map[string]any)["publicKey"])

	// Only the claiming device may look at the result.
	for name, guess := range map[string]string{"missing": "", "wrong": "guess"} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, http.StatusForbidden, offerStatus(handler, token, guess).Code)
		})
	}
	require.Equal(t, http.StatusOK, offerStatus(handler, token, secret).Code)
}

func TestQROfferBelongsToItsOwner(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	claim(t, handler, token)

	require.Equal(t, map[string]any{"status": "expired"}, offerState(t, handler, token, "user-2"))

	foreign := confirmOffer(handler, token, "user-2")
	require.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())

	withdrawn := qrCall(handler.QROffer, http.MethodDelete, offerPath(token, ""), token, "", "user-2")
	require.Equal(t, http.StatusNoContent, withdrawn.Code)
	require.Equal(t, "claimed", offerState(t, handler, token, "user-1")["status"])

	replaced := createOffer(t, handler, "user-2", token)
	require.Equal(t, http.StatusForbidden, replaced.Code, replaced.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQROfferConfirmNeedsAClaim(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startOffer(t, handler, "user-1")

	recorder := confirmOffer(handler, token, "user-1")

	require.Equal(t, http.StatusConflict, recorder.Code, recorder.Body.String())
	require.Equal(t, "not_claimed", decodeJSON(t, recorder)["code"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQROfferRotation(t *testing.T) {
	handler, _ := qrHandler(t)
	previous := startOffer(t, handler, "user-1")

	replaced := createOffer(t, handler, "user-1", previous)
	require.Equal(t, http.StatusOK, replaced.Code, replaced.Body.String())
	next := decodeJSON(t, replaced)["offerToken"].(string)
	require.NotEqual(t, previous, next)

	late := claimOffer(handler, previous, claimBody(qrPublicKey))
	require.Equal(t, http.StatusNotFound, late.Code)
	require.Equal(t, "qr_rotated", decodeJSON(t, late)["code"])

	// A claimed code waits for the decision instead of changing.
	claim(t, handler, next)
	frozen := createOffer(t, handler, "user-1", next)
	require.Equal(t, http.StatusConflict, frozen.Code, frozen.Body.String())
	require.Equal(t, "qr_scanned", decodeJSON(t, frozen)["code"])
}

func TestQROfferWithdrawEndsTheClaim(t *testing.T) {
	handler, _ := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	secret := claim(t, handler, token)

	withdrawn := qrCall(handler.QROffer, http.MethodDelete, offerPath(token, ""), token, "", "user-1")
	require.Equal(t, http.StatusNoContent, withdrawn.Code)

	require.Equal(t, map[string]any{"status": "expired"}, decodeJSON(t, offerStatus(handler, token, secret)))
	require.Equal(t, http.StatusNotFound, claimOffer(handler, token, claimBody(qrPublicKey)).Code)
}

func TestQROfferExpires(t *testing.T) {
	handler, _ := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	val, _ := handler.qrOffers.Load(token)
	require.WithinDuration(t, time.Now().Add(qrLoginTTL), val.(*QROfferData).ExpiresAt, time.Second)
	val.(*QROfferData).ExpiresAt = time.Now().Add(-time.Second)

	require.Equal(t, http.StatusNotFound, claimOffer(handler, token, claimBody(qrPublicKey)).Code)
	require.Equal(t, "expired", offerState(t, handler, token, "user-1")["status"])
}

func TestQROfferClaimValidatesKeyAndMAC(t *testing.T) {
	for name, body := range map[string]string{
		"no key":      `{"mac":"` + qrMAC + `"}`,
		"short key":   `{"publicKey":"AAAA","mac":"` + qrMAC + `"}`,
		"no mac":      `{"publicKey":"` + qrPublicKey + `"}`,
		"short mac":   `{"publicKey":"` + qrPublicKey + `","mac":"AAAA"}`,
		"invalid mac": `{"publicKey":"` + qrPublicKey + `","mac":"` + strings.Repeat("!", 43) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			handler, _ := qrHandler(t)
			token := startOffer(t, handler, "user-1")

			recorder := claimOffer(handler, token, body)

			require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
			require.Equal(t, "pending", offerState(t, handler, token, "user-1")["status"])
		})
	}
}

func TestQROfferConfirmRejectsInvalidPayload(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startOffer(t, handler, "user-1")
	claim(t, handler, token)

	recorder := qrCall(handler.QROfferConfirm, http.MethodPost, offerPath(token, "/confirm"), token,
		`{"payload":{"iv":"aXY=","ct":"Y3Q="}}`, "user-1")

	require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	require.Equal(t, "claimed", offerState(t, handler, token, "user-1")["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}
