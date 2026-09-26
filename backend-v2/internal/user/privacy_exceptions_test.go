package user

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

const (
	exceptionOwner  = "11111111-1111-4111-8111-111111111111"
	exceptionTarget = "22222222-2222-4222-8222-222222222222"
)

var exceptionColumns = []string{"id", "username", "first_name", "last_name", "avatar_url", "rule", "allow", "created_at"}

func exceptionRequest(method, path, body string) *http.Request {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: exceptionOwner}))
}

func serveExceptions(t *testing.T, request *http.Request, expect func(sqlmock.Sqlmock)) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	if expect != nil {
		expect(mock)
	}

	response := httptest.NewRecorder()
	NewHandler(NewService(db), nil).PrivacyExceptions(response, request)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload), response.Body.String())
	// Всё, что ожидалось, выполнено; без ожиданий — до базы дело не дошло.
	require.NoError(t, mock.ExpectationsWereMet())
	return response, payload
}

func TestPrivacyExceptionsList(t *testing.T) {
	t.Run("по правилу", func(t *testing.T) {
		response, payload := serveExceptions(t,
			exceptionRequest(http.MethodGet, "/api/v2/users/privacy/exceptions?rule=lastSeen", ""),
			func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`FROM users\.privacy_exceptions e`).WithArgs(exceptionOwner, "lastSeen").
					WillReturnRows(sqlmock.NewRows(exceptionColumns).
						AddRow(exceptionTarget, "target", "Target", "", "", "lastSeen", false, "2026-09-26T12:00:00Z"))
			})

		require.Equal(t, http.StatusOK, response.Code)
		require.Equal(t, []any{map[string]any{
			"id": exceptionTarget, "username": "target", "firstName": "Target", "lastName": "", "avatarUrl": "",
			"rule": "lastSeen", "mode": "deny", "createdAt": "2026-09-26T12:00:00Z",
		}}, payload["exceptions"])
	})

	t.Run("без правила — все, пустой список — []", func(t *testing.T) {
		response, payload := serveExceptions(t,
			exceptionRequest(http.MethodGet, "/api/v2/users/privacy/exceptions", ""),
			func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`FROM users\.privacy_exceptions e`).WithArgs(exceptionOwner, "").
					WillReturnRows(sqlmock.NewRows(exceptionColumns))
			})

		require.Equal(t, http.StatusOK, response.Code)
		require.Equal(t, []any{}, payload["exceptions"])
	})

	t.Run("незнакомое правило — 400", func(t *testing.T) {
		response, payload := serveExceptions(t,
			exceptionRequest(http.MethodGet, "/api/v2/users/privacy/exceptions?rule=friends", ""), nil)

		require.Equal(t, http.StatusBadRequest, response.Code)
		require.Equal(t, "validation_failed", payload["code"])
	})
}

func TestPrivacyExceptionsSet(t *testing.T) {
	path := "/api/v2/users/privacy/exceptions/lastSeen/" + exceptionTarget

	t.Run("добавляет и возвращает запись", func(t *testing.T) {
		response, payload := serveExceptions(t,
			exceptionRequest(http.MethodPut, path, `{"mode":"allow"}`),
			func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s)INSERT INTO users\.privacy_exceptions.*ON CONFLICT \(owner_id, user_id, rule\)`).
					WithArgs(exceptionOwner, exceptionTarget, "lastSeen", true).
					WillReturnRows(sqlmock.NewRows(exceptionColumns).
						AddRow(exceptionTarget, "target", "Target", "", "", "lastSeen", true, "2026-09-26T12:00:00Z"))
			})

		require.Equal(t, http.StatusOK, response.Code)
		exception := payload["exception"].(map[string]any)
		require.Equal(t, "allow", exception["mode"])
		require.Equal(t, exceptionTarget, exception["id"])
	})

	t.Run("несуществующий пользователь — 404", func(t *testing.T) {
		response, payload := serveExceptions(t,
			exceptionRequest(http.MethodPut, path, `{"mode":"deny"}`),
			func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`INSERT INTO users\.privacy_exceptions`).
					WithArgs(exceptionOwner, exceptionTarget, "lastSeen", false).
					WillReturnRows(sqlmock.NewRows(exceptionColumns))
			})

		require.Equal(t, http.StatusNotFound, response.Code)
		require.Equal(t, "user_not_found", payload["code"])
	})

	for name, tt := range map[string]struct {
		path, body string
		status     int
		code       string
	}{
		"себя — нельзя": {
			"/api/v2/users/privacy/exceptions/lastSeen/" + exceptionOwner, `{"mode":"allow"}`, http.StatusBadRequest, "self_exception",
		},
		"незнакомое правило": {
			"/api/v2/users/privacy/exceptions/friends/" + exceptionTarget, `{"mode":"allow"}`, http.StatusBadRequest, "validation_failed",
		},
		"у «сообщений от незнакомых» исключений нет": {
			"/api/v2/users/privacy/exceptions/messagesFromStrangers/" + exceptionTarget, `{"mode":"allow"}`, http.StatusBadRequest, "validation_failed",
		},
		"не UUID": {
			"/api/v2/users/privacy/exceptions/lastSeen/someone", `{"mode":"allow"}`, http.StatusBadRequest, "validation_failed",
		},
		"незнакомый вид": {path, `{"mode":"always"}`, http.StatusBadRequest, "validation_failed"},
		"без вида":       {path, `{}`, http.StatusBadRequest, "validation_failed"},
		"лишний сегмент": {path + "/extra", `{"mode":"allow"}`, http.StatusNotFound, "route_not_found"},
	} {
		t.Run(name, func(t *testing.T) {
			response, payload := serveExceptions(t, exceptionRequest(http.MethodPut, tt.path, tt.body), nil)

			require.Equal(t, tt.status, response.Code, response.Body.String())
			require.Equal(t, tt.code, payload["code"])
		})
	}
}

func TestPrivacyExceptionsRemove(t *testing.T) {
	response, payload := serveExceptions(t,
		exceptionRequest(http.MethodDelete, "/api/v2/users/privacy/exceptions/photoVisibility/"+exceptionTarget, ""),
		func(mock sqlmock.Sqlmock) {
			mock.ExpectExec(`DELETE FROM users\.privacy_exceptions`).
				WithArgs(exceptionOwner, exceptionTarget, "photoVisibility").
				WillReturnResult(sqlmock.NewResult(0, 0))
		})

	require.Equal(t, http.StatusOK, response.Code, "удалять уже удалённое — не ошибка")
	require.Equal(t, true, payload["success"])
}

func TestPrivacyExceptionsMethods(t *testing.T) {
	for _, request := range []*http.Request{
		exceptionRequest(http.MethodPost, "/api/v2/users/privacy/exceptions", `{}`),
		exceptionRequest(http.MethodPost, "/api/v2/users/privacy/exceptions/lastSeen/"+exceptionTarget, `{"mode":"allow"}`),
	} {
		response, _ := serveExceptions(t, request, nil)
		require.Equal(t, http.StatusMethodNotAllowed, response.Code, request.URL.Path)
	}
}
