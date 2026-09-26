package user

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

const privacyStatusPattern = `(?s)FROM auth\.users.*LEFT JOIN users\.settings.*LEFT JOIN users\.presence.*WHERE auth\.users\.id = \$1`

func statusRows(privacyJSON string, blocked bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"privacy_settings", "blocked", "last_active", "is_online"}).
		AddRow([]byte(privacyJSON), blocked, "2026-09-26T12:00:00Z", true)
}

// Статус глазами зрителя: одна проверка приватности на всё (#783).
func TestStatusFollowsUnifiedPrivacy(t *testing.T) {
	visible := map[string]any{"isOnline": true, "lastSeen": "2026-09-26T12:00:00Z"}
	hidden := map[string]any{"isOnline": false, "lastSeen": "recently"}

	for name, tt := range map[string]struct {
		viewer  string
		privacy string
		blocked bool
		want    map[string]any
	}{
		"открытый статус":                  {viewer: "viewer", privacy: `{"lastSeen":"all"}`, want: visible},
		"закрытый статус":                  {viewer: "viewer", privacy: `{"lastSeen":"nobody"}`, want: hidden},
		"старое contacts — закрыто":        {viewer: "viewer", privacy: `{"lastSeen":"contacts"}`, want: hidden},
		"заблокировал зрителя — закрыто":   {viewer: "viewer", privacy: `{"lastSeen":"all"}`, blocked: true, want: hidden},
		"себе видно при любых настройках":  {viewer: "owner", privacy: `{"lastSeen":"nobody"}`, want: visible},
		"повреждённые настройки — закрыто": {viewer: "viewer", privacy: `{oops`, want: hidden},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			mock.ExpectQuery(privacyStatusPattern).WithArgs("owner", tt.viewer).
				WillReturnRows(statusRows(tt.privacy, tt.blocked))

			status, err := NewService(db).Status(context.Background(), tt.viewer, "owner")

			require.NoError(t, err)
			require.Equal(t, tt.want, status)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func privacyRequest(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPut, "/api/v2/users/privacy", bytes.NewBufferString(body))
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
}

// PUT /users/privacy больше не сохраняет что угодно (#439).
func TestUpdatePrivacyRejectsUnknownKeysAndValues(t *testing.T) {
	for name, body := range map[string]string{
		"незнакомый ключ":      `{"lastSeenn":"all"}`,
		"незнакомое значение":  `{"lastSeen":"friends"}`,
		"число вместо правила": `{"lastSeen":123}`,
		"флаг строкой":         `{"twoFactorAuth":"yes"}`,
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()

			response := httptest.NewRecorder()
			NewHandler(NewService(db), nil).Privacy(response, privacyRequest(body))

			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			var payload map[string]any
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
			require.Equal(t, "validation_failed", payload["code"])
			// До базы дело не дошло.
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestUpdatePrivacyStoresCanonicalValues(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectExec(`INSERT INTO users\.settings`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE users\.settings SET privacy_settings`).
		WithArgs("user-id", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO users\.settings`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT settings, privacy_settings FROM users\.settings`).WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"settings", "privacy_settings"}).
			AddRow([]byte(`{}`), []byte(`{"lastSeen":"nobody","photoVisibility":"all"}`)))

	response := httptest.NewRecorder()
	NewHandler(NewService(db), nil).Privacy(response, privacyRequest(`{"lastSeen":"contacts","photoVisibility":"everyone"}`))

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var payload struct {
		Privacy map[string]any `json:"privacy"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
	require.Equal(t, "nobody", payload.Privacy["lastSeen"])
	require.Equal(t, "all", payload.Privacy["photoVisibility"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateAllSettingsCannotBypassPrivacyCheck(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	request := httptest.NewRequest(http.MethodPut, "/api/v2/users/all-settings",
		bytes.NewBufferString(`{"privacySettings":{"lastSeen":"friends"}}`))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	NewHandler(NewService(db), nil).AllSettings(response, request)

	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}
