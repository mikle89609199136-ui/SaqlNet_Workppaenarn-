package chat

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

const sharedChatID = "550e8400-e29b-41d4-a716-446655440042"

func sharedRequest(target string, pathValues map[string]string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for key, value := range pathValues {
		req.SetPathValue(key, value)
	}
	return req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: messageValidationUserID}))
}

// Неверные параметры выдачи общего (#842) отсекаются до базы.
func TestListSharedRejectsInvalidParamsWithoutDatabase(t *testing.T) {
	cases := map[string]string{
		"вид не указан":   "/shared",
		"вид неизвестен":  "/shared?kind=stickers",
		"курсор не UUID":  "/shared?kind=media&before=abc",
		"лимит ноль":      "/shared?kind=media&limit=0",
		"лимит больше 60": "/shared?kind=media&limit=61",
		"лимит не число":  "/shared?kind=media&limit=ten",
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			rr := httptest.NewRecorder()

			NewHandler(NewService(db, nil, nil)).ListShared(rr, sharedRequest(target, map[string]string{"chatID": sharedChatID}))

			assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet(), "в базу не ходили")
		})
	}
}

func TestMessagePositionRejectsInvalidIDsWithoutDatabase(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"чат не UUID":       {"chatID": "x", "messageID": sharedChatID},
		"сообщение не UUID": {"chatID": sharedChatID, "messageID": "x"},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			rr := httptest.NewRecorder()

			NewHandler(NewService(db, nil, nil)).MessagePosition(rr, sharedRequest("/position", values))

			assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// Новые маршруты не конфликтуют с уже зарегистрированными: ServeMux
// паникует при регистрации пересекающихся шаблонов.
func TestSharedRoutesRegisterWithoutConflicts(t *testing.T) {
	passthrough := func(next http.Handler) http.Handler { return next }
	require.NotPanics(t, func() {
		registerChatRoutes(http.NewServeMux(), NewHandler(NewService(nil, nil, nil)), passthrough)
	})
}
