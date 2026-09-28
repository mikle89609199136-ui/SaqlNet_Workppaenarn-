package user

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

const privacyStatusPattern = `(?s)FROM auth\.users.*LEFT JOIN users\.settings.*LEFT JOIN users\.presence.*WHERE auth\.users\.id = \$1`

// statusSide — настройки, блокировка и исключения одной стороны.
type statusSide struct {
	privacy    string
	blocks     bool
	exceptions string
}

func rawOrNil(value string) any {
	if value == "" {
		return nil
	}
	return []byte(value)
}

func statusRows(owner, viewer statusSide, lastActive string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"privacy_settings", "blocked", "exceptions",
		"viewer_privacy", "viewer_blocks", "viewer_exceptions",
		"last_active", "is_online",
	}).AddRow(
		rawOrNil(owner.privacy), owner.blocks, rawOrNil(owner.exceptions),
		rawOrNil(viewer.privacy), viewer.blocks, rawOrNil(viewer.exceptions),
		rawOrNil(lastActive), true,
	)
}

// Статус глазами зрителя: одна проверка приватности на всё (#783, #784),
// в обе стороны и с приблизительным временем вместо скрытого (#791).
func TestStatusFollowsUnifiedPrivacy(t *testing.T) {
	lastActive := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	visible := map[string]any{"isOnline": true, "lastSeen": lastActive}
	approx := func(value string) map[string]any {
		return map[string]any{"isOnline": false, "lastSeen": "", "lastSeenApprox": value}
	}
	recently := approx("recently")
	open := `{"lastSeen":"all"}`
	closed := `{"lastSeen":"nobody"}`

	for name, tt := range map[string]struct {
		viewer        string
		owner, seeing statusSide
		lastActive    string
		want          map[string]any
	}{
		"открытый статус":                  {owner: statusSide{privacy: open}, want: visible},
		"настроек нет — открыто":           {want: visible},
		"закрытый статус":                  {owner: statusSide{privacy: closed}, want: recently},
		"старое contacts — закрыто":        {owner: statusSide{privacy: `{"lastSeen":"contacts"}`}, want: recently},
		"себе видно при любых настройках":  {viewer: "owner", owner: statusSide{privacy: closed}, seeing: statusSide{privacy: closed}, want: visible},
		"повреждённые настройки — закрыто": {owner: statusSide{privacy: `{oops`}, want: recently},
		"«всегда разрешать» открывает":     {owner: statusSide{privacy: closed, exceptions: `{"lastSeen":true}`}, want: visible},
		"«никогда не разрешать» закрывает": {owner: statusSide{privacy: open, exceptions: `{"lastSeen":false}`}, want: recently},
		"исключение на другое правило":     {owner: statusSide{privacy: open, exceptions: `{"photoVisibility":false}`}, want: visible},
		"заблокировал зрителя — «давно»":   {owner: statusSide{privacy: open, blocks: true}, want: approx("long_ago")},
		"блокировка сильнее «всегда»":      {owner: statusSide{privacy: closed, blocks: true, exceptions: `{"lastSeen":true}`}, want: approx("long_ago")},
		"зритель скрыл своё — взаимно":     {owner: statusSide{privacy: open}, seeing: statusSide{privacy: closed}, want: recently},
		"зритель скрыл, но владельцу «всегда»": {
			owner: statusSide{privacy: open}, seeing: statusSide{privacy: closed, exceptions: `{"lastSeen":true}`}, want: visible,
		},
		"зритель поставил владельцу «никогда»": {
			owner: statusSide{privacy: open}, seeing: statusSide{privacy: open, exceptions: `{"lastSeen":false}`}, want: recently,
		},
		"зритель заблокировал владельца — «недавно», не «давно»": {
			owner: statusSide{privacy: open}, seeing: statusSide{blocks: true}, want: recently,
		},
		"скрыто, заходил 10 дней назад": {
			owner:      statusSide{privacy: closed},
			lastActive: time.Now().Add(-10 * 24 * time.Hour).UTC().Format(time.RFC3339),
			want:       approx("within_month"),
		},
		"скрыто, не заходил никогда": {owner: statusSide{privacy: closed}, lastActive: "-", want: approx("long_ago")},
	} {
		t.Run(name, func(t *testing.T) {
			if tt.viewer == "" {
				tt.viewer = "viewer"
			}
			switch tt.lastActive {
			case "":
				tt.lastActive = lastActive
			case "-":
				tt.lastActive = ""
			}
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			mock.ExpectQuery(privacyStatusPattern).WithArgs("owner", tt.viewer).
				WillReturnRows(statusRows(tt.owner, tt.seeing, tt.lastActive))

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
