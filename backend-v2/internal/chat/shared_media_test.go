package chat

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

// Адрес сообщения не UUID — отказ до базы (#1076).
func TestMessageLocationRejectsInvalidIDWithoutDatabase(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	rr := httptest.NewRecorder()

	NewHandler(NewService(db, nil, nil)).
		MessageLocation(rr, sharedRequest("/location", map[string]string{"messageId": "x"}))

	assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

// Место сообщения (#1076): отказ один на все случаи — нет сообщения или
// смотрящий не участник его чата.
func TestMessageLocation(t *testing.T) {
	const messageID = "550e8400-e29b-41d4-a716-446655440043"
	locate := `SELECT m.chat_id::text FROM messages.messages m`
	member := `SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`

	t.Run("участник — чат сообщения", func(t *testing.T) {
		db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(containsQuery)))
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(locate).WithArgs(messageID, messageValidationUserID).
			WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(sharedChatID))
		mock.ExpectQuery(member).WithArgs(messageValidationUserID, sharedChatID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
		rr := httptest.NewRecorder()

		NewHandler(NewService(db, nil, nil)).
			MessageLocation(rr, sharedRequest("/location", map[string]string{"messageId": messageID}))

		require.Equal(t, http.StatusOK, rr.Code)
		require.JSONEq(t, `{"chatId":"`+sharedChatID+`"}`, rr.Body.String())
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("нет сообщения — 404 message_not_found", func(t *testing.T) {
		db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(containsQuery)))
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(locate).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}))
		rr := httptest.NewRecorder()

		NewHandler(NewService(db, nil, nil)).
			MessageLocation(rr, sharedRequest("/location", map[string]string{"messageId": messageID}))

		assertErrorResponse(t, rr, http.StatusNotFound, "message_not_found")
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("не участник — тот же 404", func(t *testing.T) {
		db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(containsQuery)))
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(locate).
			WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(sharedChatID))
		mock.ExpectQuery(member).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
		rr := httptest.NewRecorder()

		NewHandler(NewService(db, nil, nil)).
			MessageLocation(rr, sharedRequest("/location", map[string]string{"messageId": messageID}))

		assertErrorResponse(t, rr, http.StatusNotFound, "message_not_found")
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

// Совпадение по подстроке: запросы многострочные, порядок пробелов не важен.
func containsQuery(expected, actual string) error {
	if strings.Contains(strings.Join(strings.Fields(actual), " "), strings.Join(strings.Fields(expected), " ")) {
		return nil
	}
	return fmt.Errorf("запрос %q не содержит %q", actual, expected)
}
