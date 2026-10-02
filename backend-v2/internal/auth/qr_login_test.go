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

type qrRequest struct {
	method    string
	target    string
	pathToken string
	body      string
	userID    string
	secret    string
}

func qrServe(handler http.HandlerFunc, call qrRequest) *httptest.ResponseRecorder {
	req := httptest.NewRequest(call.method, call.target, strings.NewReader(call.body))
	req.Header.Set("User-Agent", "Mozilla/5.0 Test")
	if call.pathToken != "" {
		req.SetPathValue("token", call.pathToken)
	}
	if call.secret != "" {
		req.Header.Set(qrSecretHeader, call.secret)
	}
	if call.userID != "" {
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: call.userID}))
	}
	recorder := httptest.NewRecorder()
	handler(recorder, req)
	return recorder
}

func qrCall(handler http.HandlerFunc, method, target, pathToken, body, userID string) *httptest.ResponseRecorder {
	return qrServe(handler, qrRequest{method: method, target: target, pathToken: pathToken, body: body, userID: userID})
}

func decodeJSON(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body), recorder.Body.String())
	return body
}

type qrCode struct {
	token  string
	secret string
}

func createQRCode(t *testing.T, handler *Handler, extra string) *httptest.ResponseRecorder {
	t.Helper()
	return qrCall(handler.QRToken, http.MethodPost, "/api/v2/auth/qr-token", "",
		`{"publicKey":"`+qrPublicKey+`","deviceName":"  Chrome on Windows  "`+extra+`}`, "")
}

func startQRLogin(t *testing.T, handler *Handler) qrCode {
	t.Helper()
	recorder := createQRCode(t, handler, "")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	body := decodeJSON(t, recorder)
	require.NotContains(t, body, "qrImage")
	require.NotEmpty(t, body["secret"])
	return qrCode{token: body["qrToken"].(string), secret: body["secret"].(string)}
}

func qrStatus(t *testing.T, handler *Handler, code qrCode) map[string]any {
	t.Helper()
	recorder := qrServe(handler.QRStatus, qrRequest{
		method: http.MethodGet, target: "/api/v2/auth/qr-status/" + code.token, pathToken: code.token, secret: code.secret,
	})
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	return decodeJSON(t, recorder)
}

func scanQR(handler *Handler, token, userID string) *httptest.ResponseRecorder {
	return qrCall(handler.QRRequest, http.MethodGet, "/api/v2/auth/qr-request/"+token, token, "", userID)
}

func confirmQR(handler *Handler, token, userID string) *httptest.ResponseRecorder {
	return qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+token+`","payload":`+qrPayload+`}`, userID)
}

func expectIssueToken(mock sqlmock.Sqlmock, userID string) {
	mock.ExpectQuery(`SELECT username, token_generation.*FROM auth\.users.*WHERE id = \$1`).WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("anna", 0))
	mock.ExpectQuery(`SELECT token_generation.*FROM auth\.users.*WHERE id = \$1`).WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(0))
	mock.ExpectExec("INSERT INTO auth.sessions").
		WithArgs(userID, sqlmock.AnyArg(), int64(0), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func TestQRLoginHandsOverSessionAndPayloadOnce(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)

	require.Equal(t, "pending", qrStatus(t, handler, code)["status"])

	request := scanQR(handler, code.token, "user-1")
	require.Equal(t, http.StatusOK, request.Code, request.Body.String())
	require.Equal(t, "no-store", request.Header().Get("Cache-Control"))
	details := decodeJSON(t, request)
	require.Equal(t, qrPublicKey, details["publicKey"])
	require.Equal(t, "Chrome on Windows", details["deviceName"])
	require.Equal(t, "Mozilla/5.0 Test", details["userAgent"])

	require.Equal(t, "scanned", qrStatus(t, handler, code)["status"])

	expectIssueToken(mock, "user-1")
	confirm := confirmQR(handler, code.token, "user-1")
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())

	status := qrServe(handler.QRStatus, qrRequest{
		method: http.MethodGet, target: "/api/v2/auth/qr-status/" + code.token, pathToken: code.token, secret: code.secret,
	})
	require.Equal(t, "no-store", status.Header().Get("Cache-Control"))
	confirmed := decodeJSON(t, status)
	require.Equal(t, "confirmed", confirmed["status"])
	require.Equal(t, "token", confirmed["authToken"])
	// Новое устройство получает сессию в cookie (#705).
	require.Equal(t, "token", sessionCookieValue(t, status))
	payload, err := json.Marshal(confirmed["payload"])
	require.NoError(t, err)
	require.JSONEq(t, qrPayload, string(payload))

	require.Equal(t, map[string]any{"status": "expired"}, qrStatus(t, handler, code))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRStatusRequiresTheSecretFromCreation(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)
	scanQR(handler, code.token, "user-1")
	expectIssueToken(mock, "user-1")
	require.Equal(t, http.StatusOK, confirmQR(handler, code.token, "user-1").Code)

	// Someone who photographed the code knows the token, but not the secret.
	for name, secret := range map[string]string{"missing": "", "wrong": "not-the-secret"} {
		t.Run(name, func(t *testing.T) {
			recorder := qrServe(handler.QRStatus, qrRequest{
				method: http.MethodGet, target: "/api/v2/auth/qr-status/" + code.token, pathToken: code.token, secret: secret,
			})
			require.Equal(t, http.StatusForbidden, recorder.Code, recorder.Body.String())
			require.NotContains(t, recorder.Body.String(), "authToken")
		})
	}

	require.Equal(t, "confirmed", qrStatus(t, handler, code)["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRCodeIsReplacedWithTheSecret(t *testing.T) {
	handler, _ := qrHandler(t)
	previous := startQRLogin(t, handler)

	forged := createQRCode(t, handler, `,"replaces":"`+previous.token+`","secret":"guess"`)
	require.Equal(t, http.StatusForbidden, forged.Code, forged.Body.String())
	require.Equal(t, "pending", qrStatus(t, handler, previous)["status"])

	replaced := createQRCode(t, handler, `,"replaces":"`+previous.token+`","secret":"`+previous.secret+`"`)
	require.Equal(t, http.StatusOK, replaced.Code, replaced.Body.String())
	next := decodeJSON(t, replaced)
	require.NotEqual(t, previous.token, next["qrToken"])
	require.NotEqual(t, previous.secret, next["secret"])

	require.Equal(t, "expired", qrStatus(t, handler, previous)["status"])
	late := scanQR(handler, previous.token, "user-1")
	require.Equal(t, http.StatusNotFound, late.Code)
	require.Equal(t, "qr_rotated", decodeJSON(t, late)["code"])
}

func TestQRCodeStopsChangingOnceScanned(t *testing.T) {
	handler, _ := qrHandler(t)
	code := startQRLogin(t, handler)
	require.Equal(t, http.StatusOK, scanQR(handler, code.token, "user-1").Code)

	replaced := createQRCode(t, handler, `,"replaces":"`+code.token+`","secret":"`+code.secret+`"`)
	require.Equal(t, http.StatusConflict, replaced.Code, replaced.Body.String())
	require.Equal(t, "qr_scanned", decodeJSON(t, replaced)["code"])
	require.Equal(t, "scanned", qrStatus(t, handler, code)["status"])
}

func TestQRCodeIsCapturedByTheFirstScan(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)
	val, _ := handler.qrTokens.Load(code.token)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(time.Second)

	require.Equal(t, http.StatusOK, scanQR(handler, code.token, "user-1").Code)
	// The capture gives the person time to confirm, whatever was left.
	require.WithinDuration(t, time.Now().Add(qrScanTTL), val.(*QRTokenData).ExpiresAt, time.Second)

	// The same person may look again, somebody else may not.
	require.Equal(t, http.StatusOK, scanQR(handler, code.token, "user-1").Code)
	other := scanQR(handler, code.token, "user-2")
	require.Equal(t, http.StatusNotFound, other.Code)
	require.Equal(t, "invalid_token", decodeJSON(t, other)["code"])

	stolen := confirmQR(handler, code.token, "user-2")
	require.Equal(t, http.StatusForbidden, stolen.Code, stolen.Body.String())
	require.Equal(t, "not_scanned", decodeJSON(t, stolen)["code"])

	expectIssueToken(mock, "user-1")
	require.Equal(t, http.StatusOK, confirmQR(handler, code.token, "user-1").Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRConfirmRequiresAScan(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)

	recorder := confirmQR(handler, code.token, "user-1")

	require.Equal(t, http.StatusForbidden, recorder.Code, recorder.Body.String())
	require.Equal(t, "pending", qrStatus(t, handler, code)["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRDeclineDropsTheCode(t *testing.T) {
	handler, _ := qrHandler(t)
	code := startQRLogin(t, handler)
	require.Equal(t, http.StatusOK, scanQR(handler, code.token, "user-1").Code)

	// Somebody else's decline changes nothing.
	other := qrCall(handler.QRRequest, http.MethodDelete, "/api/v2/auth/qr-request/"+code.token, code.token, "", "user-2")
	require.Equal(t, http.StatusNoContent, other.Code)
	require.Equal(t, "scanned", qrStatus(t, handler, code)["status"])

	declined := qrCall(handler.QRRequest, http.MethodDelete, "/api/v2/auth/qr-request/"+code.token, code.token, "", "user-1")
	require.Equal(t, http.StatusNoContent, declined.Code)
	require.Equal(t, "expired", qrStatus(t, handler, code)["status"])
}

func TestQRCancelNeedsTheSecret(t *testing.T) {
	handler, _ := qrHandler(t)
	code := startQRLogin(t, handler)

	forged := qrCall(handler.QRCancel, http.MethodDelete, "/api/v2/auth/qr-token/"+code.token, code.token, `{"secret":"guess"}`, "")
	require.Equal(t, http.StatusForbidden, forged.Code)
	require.Equal(t, "pending", qrStatus(t, handler, code)["status"])

	cancelled := qrCall(handler.QRCancel, http.MethodDelete, "/api/v2/auth/qr-token/"+code.token, code.token, `{"secret":"`+code.secret+`"}`, "")
	require.Equal(t, http.StatusNoContent, cancelled.Code)
	require.Equal(t, "expired", qrStatus(t, handler, code)["status"])

	scan := scanQR(handler, code.token, "user-1")
	require.Equal(t, http.StatusNotFound, scan.Code)
	require.Equal(t, "invalid_token", decodeJSON(t, scan)["code"])
}

func TestQRConfirmRejectsSecondConfirmation(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)
	scanQR(handler, code.token, "user-1")

	expectIssueToken(mock, "user-1")
	first := confirmQR(handler, code.token, "user-1")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())

	second := confirmQR(handler, code.token, "user-2")
	require.Equal(t, http.StatusConflict, second.Code, second.Body.String())
	require.Equal(t, "already_confirmed", decodeJSON(t, second)["code"])

	require.Equal(t, http.StatusNotFound, scanQR(handler, code.token, "user-2").Code)
	require.Equal(t, "confirmed", qrStatus(t, handler, code)["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRConfirmCannotCrossLogoutAll(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)
	require.Equal(t, http.StatusOK, scanQR(handler, code.token, "user-1").Code)

	// The request context represents a generation-0 access token, while a
	// concurrent logout-all has already advanced the user to generation 1.
	mock.ExpectQuery(`SELECT username, token_generation.*FROM auth\.users.*WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("anna", 1))

	confirm := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
		`{"qrToken":"`+code.token+`","payload":`+qrPayload+`}`, "user-1")
	require.Equal(t, http.StatusUnauthorized, confirm.Code, confirm.Body.String())
	require.Equal(t, "token_revoked", decodeJSON(t, confirm)["code"])

	status := qrStatus(t, handler, code)
	require.Equal(t, "scanned", status["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRLoginExpires(t *testing.T) {
	handler, mock := qrHandler(t)
	code := startQRLogin(t, handler)
	val, _ := handler.qrTokens.Load(code.token)
	require.WithinDuration(t, time.Now().Add(qrLoginTTL), val.(*QRTokenData).ExpiresAt, time.Second)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(-time.Second)

	require.Equal(t, http.StatusNotFound, scanQR(handler, code.token, "user-1").Code)

	code = startQRLogin(t, handler)
	scanQR(handler, code.token, "user-1")
	val, _ = handler.qrTokens.Load(code.token)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(-time.Second)

	confirm := confirmQR(handler, code.token, "user-1")
	require.Equal(t, http.StatusBadRequest, confirm.Code)
	require.Equal(t, "invalid_token", decodeJSON(t, confirm)["code"])

	require.Equal(t, "expired", qrStatus(t, handler, code)["status"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQRTokenSweepsExpiredCodes(t *testing.T) {
	handler, _ := qrHandler(t)
	stale := startQRLogin(t, handler)
	val, _ := handler.qrTokens.Load(stale.token)
	val.(*QRTokenData).ExpiresAt = time.Now().Add(-time.Second)

	startQRLogin(t, handler)

	_, ok := handler.qrTokens.Load(stale.token)
	require.False(t, ok)
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
			code := startQRLogin(t, handler)
			scanQR(handler, code.token, "user-1")

			recorder := qrCall(handler.QRConfirm, http.MethodPost, "/api/v2/auth/qr-confirm", "",
				`{"qrToken":"`+code.token+`","payload":`+payload+`}`, "user-1")

			require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
			require.Equal(t, "scanned", qrStatus(t, handler, code)["status"])
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
