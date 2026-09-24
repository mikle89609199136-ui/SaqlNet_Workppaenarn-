package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// A P-256 SPKI public key is 91 bytes; the server only checks the size.
var qrPublicKey = strings.Repeat("A", 122)

const qrPayload = `{"senderPublicKey":"c2VuZGVy","iv":"aXY=","ct":"Y3Q="}`

func qrHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return NewHandler(NewService(db, handlerCryptoStub{})), mock
}

func qrCall(handler http.HandlerFunc, method, target, pathToken, body, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("User-Agent", "Mozilla/5.0 Test")
	if pathToken != "" {
		req.SetPathValue("token", pathToken)
	}
	if userID != "" {
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID}))
	}
	recorder := httptest.NewRecorder()
	handler(recorder, req)
	return recorder
}

func decodeJSON(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body), recorder.Body.String())
	return body
}

func startQRLogin(t *testing.T, handler *Handler) string {
	t.Helper()
	recorder := qrCall(handler.QRToken, http.MethodPost, "/api/v2/auth/qr-token", "",
		`{"publicKey":"`+qrPublicKey+`","deviceName":"  Chrome on Windows  "}`, "")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	body := decodeJSON(t, recorder)
	require.NotContains(t, body, "qrImage")
	return body["qrToken"].(string)
}

func expectIssueToken(mock sqlmock.Sqlmock, userID string) {
	mock.ExpectQuery(`SELECT username, token_generation.*FROM auth\.users.*WHERE id = \$1`).WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("anna", 0))
	mock.ExpectQuery(`SELECT token_generation.*FROM auth\.users.*WHERE id = \$1`).WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(0))
}

func TestQRLoginHandsOverSessionAndPayloadOnce(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startQRLogin(t, handler)

	request := qrCall(handler.QRRequest, http.MethodGet, "/api/v2/auth/qr-request/"+token, token, "", "user-1")
	require.Equal(t, http.StatusOK, request.Code, request.Body.String())
	require.Equal(t, "no-store", request.Header().Get("Cache-Control"))
	details := decodeJSON(t, request)
	require.Equal(t, qrPublicKey, details["publicKey"])
	require.Equal(t, "Chrome on Windows", details["deviceName"])
	require.Equal(t, "Mozilla/5.0 Test", details["userAgent"])

	pending := qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", "")
	require.Equal(t, "pending", decodeJSON(t, pending)["status"])

	expectIssueToken(mock, "user-1")
	confirm := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, "user-1")
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())

	status := qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", "")
	require.Equal(t, "no-store", status.Header().Get("Cache-Control"))
	confirmed := decodeJSON(t, status)
	require.Equal(t, "confirmed", confirmed["status"])
	require.Equal(t, "token", confirmed["authToken"])
	payload, err := json.Marshal(confirmed["payload"])
	require.NoError(t, err)
	require.JSONEq(t, qrPayload, string(payload))

	again := qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", "")
	require.Equal(t, map[string]any{"status": "expired"}, decodeJSON(t, again))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRConfirmRejectsSecondConfirmation(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startQRLogin(t, handler)

	expectIssueToken(mock, "user-1")
	first := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, "user-1")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())

	second := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, "user-2")
	require.Equal(t, http.StatusConflict, second.Code, second.Body.String())
	require.Equal(t, "already_confirmed", decodeJSON(t, second)["code"])

	request := qrCall(handler.QRRequest, http.MethodGet, "/api/v2/auth/qr-request/"+token, token, "", "user-2")
	require.Equal(t, http.StatusNotFound, request.Code)

	status := decodeJSON(t, qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", ""))
	require.Equal(t, "confirmed", status["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRConfirmCannotCrossLogoutAll(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startQRLogin(t, handler)

	// The request context represents a generation-0 access token, while a
	// concurrent logout-all has already advanced the user to generation 1.
	mock.ExpectQuery(`SELECT username, token_generation.*FROM auth\.users.*WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("anna", 1))

	confirm := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, "user-1")
	require.Equal(t, http.StatusUnauthorized, confirm.Code, confirm.Body.String())
	require.Equal(t, "token_revoked", decodeJSON(t, confirm)["code"])

	status := decodeJSON(t, qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", ""))
	require.Equal(t, "pending", status["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRLoginExpires(t *testing.T) {
	handler, mock := qrHandler(t)
	token := startQRLogin(t, handler)
	val, _ := handler.qrTokens.Load(token)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(-time.Second)

	request := qrCall(handler.QRRequest, http.MethodGet, "/api/v2/auth/qr-request/"+token, token, "", "user-1")
	require.Equal(t, http.StatusNotFound, request.Code)

	token = startQRLogin(t, handler)
	val, _ = handler.qrTokens.Load(token)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(-time.Second)

	confirm := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, "user-1")
	require.Equal(t, http.StatusBadRequest, confirm.Code)
	require.Equal(t, "invalid_token", decodeJSON(t, confirm)["code"])

	status := decodeJSON(t, qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", ""))
	require.Equal(t, "expired", status["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRTokenRequiresPublicKey(t *testing.T) {
	for name, body := range map[string]string{
		"missing":    `{}`,
		"not base64": `{"publicKey":"not a key!"}`,
		"too short":  `{"publicKey":"AAAA"}`,
		"too long":   `{"publicKey":"` + strings.Repeat("A", 400) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			handler, _ := qrHandler(t)

			recorder := qrCall(handler.QRToken, http.MethodPost, "/api/v2/auth/qr-token", "", body, "")

			require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
			require.Equal(t, "validation_failed", decodeJSON(t, recorder)["code"])
		})
	}
}

func TestQRTokenTruncatesDeviceName(t *testing.T) {
	handler, _ := qrHandler(t)
	recorder := qrCall(handler.QRToken, http.MethodPost, "/api/v2/auth/qr-token", "",
		`{"publicKey":"`+qrPublicKey+`","deviceName":"`+strings.Repeat("я", 100)+`"}`, "")
	token := decodeJSON(t, recorder)["qrToken"].(string)

	val, _ := handler.qrTokens.Load(token)
	require.Equal(t, strings.Repeat("я", maxQRDeviceNameRunes), val.(*QRTokenData).DeviceName)
}

func TestQRConfirmRejectsInvalidPayloadWithoutConfirming(t *testing.T) {
	for name, payload := range map[string]string{
		"missing":          `null`,
		"not an object":    `"payload"`,
		"no sender key":    `{"iv":"aXY=","ct":"Y3Q="}`,
		"empty ciphertext": `{"senderPublicKey":"c2VuZGVy","iv":"aXY=","ct":""}`,
		"too large":        `{"senderPublicKey":"c2VuZGVy","iv":"aXY=","ct":"` + strings.Repeat("A", maxQRPayloadBytes) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			handler, mock := qrHandler(t)
			token := startQRLogin(t, handler)

			recorder := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
				`{"qrToken":"`+token+`","payload":`+payload+`}`, "user-1")

			require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
			status := decodeJSON(t, qrCall(handler.QRStatus, http.MethodGet, "/api/v2/auth/qr-status/"+token, token, "", ""))
			require.Equal(t, "pending", status["status"])
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
