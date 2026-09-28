package user

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

const pushUserID = "11111111-1111-4111-8111-111111111111"

func pushRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	return req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: pushUserID}))
}

func pushKeys() (string, string) {
	p256dh := make([]byte, 65)
	p256dh[0] = 0x04
	return base64.RawURLEncoding.EncodeToString(p256dh), base64.RawURLEncoding.EncodeToString(make([]byte, 16))
}

func pushHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return NewHandler(NewService(db), nil), mock
}

// Подписка устройства (#717): запись, повтор, удаление своей.
func TestPushSubscriptionIsSaved(t *testing.T) {
	handler, mock := pushHandler(t)
	p256dh, auth := pushKeys()
	endpoint := "https://fcm.googleapis.com/fcm/send/device-1"

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO users.push_subscriptions`).
		WithArgs(pushUserID, endpoint, p256dh, auth).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("22222222-2222-4222-8222-222222222222"))
	// Сверх предела устройств — старые вытесняются.
	mock.ExpectExec(`DELETE FROM users.push_subscriptions`).
		WithArgs(pushUserID, 20).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	recorder := httptest.NewRecorder()
	handler.PushSubscriptions(recorder, pushRequest(http.MethodPost, "/api/v2/users/push/subscriptions",
		`{"endpoint":"`+endpoint+`","keys":{"p256dh":"`+p256dh+`","auth":"`+auth+`"}}`))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"id":"22222222-2222-4222-8222-222222222222"}`, recorder.Body.String())
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	require.NoError(t, mock.ExpectationsWereMet())
}

// Адрес не известного push-сервиса не записывается: сервер пошёл бы по нему сам.
func TestPushSubscriptionWithForeignEndpointIsRejectedWithoutDatabase(t *testing.T) {
	handler, mock := pushHandler(t)
	p256dh, auth := pushKeys()

	for _, endpoint := range []string{"https://127.0.0.1/x", "http://fcm.googleapis.com/x", "https://chat:8083/api"} {
		recorder := httptest.NewRecorder()
		handler.PushSubscriptions(recorder, pushRequest(http.MethodPost, "/api/v2/users/push/subscriptions",
			`{"endpoint":"`+endpoint+`","keys":{"p256dh":"`+p256dh+`","auth":"`+auth+`"}}`))
		require.Equal(t, http.StatusBadRequest, recorder.Code, endpoint)
		require.Contains(t, recorder.Body.String(), "invalid_push_subscription")
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPushSubscriptionDeleteIsScopedToOwner(t *testing.T) {
	handler, mock := pushHandler(t)
	endpoint := "https://fcm.googleapis.com/fcm/send/device-1"
	mock.ExpectExec(`DELETE FROM users.push_subscriptions WHERE user_id = \$1 AND endpoint = \$2`).
		WithArgs(pushUserID, endpoint).
		WillReturnResult(sqlmock.NewResult(0, 1))

	recorder := httptest.NewRecorder()
	handler.PushSubscriptions(recorder, pushRequest(http.MethodDelete, "/api/v2/users/push/subscriptions", `{"endpoint":"`+endpoint+`"}`))

	require.Equal(t, http.StatusNoContent, recorder.Code)
	require.NoError(t, mock.ExpectationsWereMet())

	recorder = httptest.NewRecorder()
	handler.PushSubscriptions(recorder, pushRequest(http.MethodDelete, "/api/v2/users/push/subscriptions", `{}`))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestPushVAPIDKey(t *testing.T) {
	handler, _ := pushHandler(t)

	t.Setenv("VAPID_PUBLIC_KEY", "")
	recorder := httptest.NewRecorder()
	handler.PushVAPIDKey(recorder, pushRequest(http.MethodGet, "/api/v2/users/push/vapid-key", ""))
	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.Contains(t, recorder.Body.String(), "push_not_configured")

	t.Setenv("VAPID_PUBLIC_KEY", "BPublicKey")
	recorder = httptest.NewRecorder()
	handler.PushVAPIDKey(recorder, pushRequest(http.MethodGet, "/api/v2/users/push/vapid-key", ""))
	require.Equal(t, http.StatusOK, recorder.Code)
	require.JSONEq(t, `{"publicKey":"BPublicKey"}`, recorder.Body.String())
}
