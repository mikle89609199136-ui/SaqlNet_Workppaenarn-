//go:build integration

package chat

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestRemovedMemberSettingsHTTP(t *testing.T) {
	for _, action := range []string{"remove", "ban"} {
		t.Run(action, func(t *testing.T) {
			db := dbtest.Postgres(t)
			const owner = "46200000-0000-4000-8000-000000000001"
			const member = "46200000-0000-4000-8000-000000000002"
			dbtest.User(t, db, owner, "cleanup_owner")
			dbtest.User(t, db, member, "cleanup_member")
			svc := NewService(db, nil, nil)
			group, err := svc.CreateGroup(t.Context(), owner, "Cleanup", "", "", []string{member})
			require.NoError(t, err)
			other, err := svc.CreateGroup(t.Context(), owner, "Other", "", "", []string{member})
			require.NoError(t, err)
			// Заодно проверяем, что очистка не трогает другую пару chat/user.
			for _, pair := range [][2]string{{group, member}, {group, owner}, {other, member}} {
				require.NoError(t, svc.SetFlag(t.Context(), pair[1], pair[0], "pin", true))
				require.NoError(t, svc.SetFlag(t.Context(), pair[1], pair[0], "archive", true))
				require.NoError(t, svc.SetNotificationPreview(t.Context(), pair[1], pair[0], true))
			}
			h := NewHandler(svc)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Здесь HTTP → handler → настоящий PostgreSQL; auth middleware покрыт отдельно.
				h.Chat(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: owner})))
			}))
			t.Cleanup(server.Close)
			request := func(method, path, body string) {
				t.Helper()
				req, err := http.NewRequest(method, server.URL+"/api/v2/chats/"+group+path, strings.NewReader(body))
				require.NoError(t, err)
				req.Header.Set("Content-Type", "application/json")
				res, err := server.Client().Do(req)
				require.NoError(t, err)
				data, err := io.ReadAll(res.Body)
				require.NoError(t, res.Body.Close())
				require.NoError(t, err)
				require.Contains(t, []int{http.StatusOK, http.StatusCreated}, res.StatusCode, string(data))
			}
			if action == "ban" {
				request(http.MethodPost, "/members/"+member+"/ban", `{}`)
			} else {
				request(http.MethodDelete, "/members/"+member, "")
			}
			var count int
			require.NoError(t, db.QueryRow(`SELECT count(*) FROM chats.user_chat_settings WHERE user_id=$1 AND chat_id=$2`, member, group).Scan(&count))
			require.Zero(t, count)
			require.NoError(t, db.QueryRow(`SELECT count(*) FROM chats.members WHERE user_id=$1 AND chat_id=$2`, member, group).Scan(&count))
			require.Zero(t, count)
			require.NoError(t, db.QueryRow(`SELECT count(*) FROM chats.user_chat_settings WHERE (user_id=$1 AND chat_id=$2) OR (user_id=$3 AND chat_id=$4)`, owner, group, member, other).Scan(&count))
			require.Equal(t, 2, count)
			if action == "ban" {
				request(http.MethodPost, "/members/"+member+"/unban", "")
			}
			request(http.MethodPost, "/members", `{"userId":"`+member+`"}`)
			readded, err := svc.Get(t.Context(), member, group)
			require.NoError(t, err)
			require.False(t, readded.IsPinned)
			require.False(t, readded.IsArchived)
			require.False(t, readded.HideNotificationPreview)
			require.False(t, readded.IsMuted)
			archived, err := svc.List(t.Context(), member, true)
			require.NoError(t, err)
			for _, chat := range archived {
				require.NotEqual(t, group, chat.ID)
			}
			normal, err := svc.List(t.Context(), member, false)
			require.NoError(t, err)
			found := false
			for _, chat := range normal {
				if chat.ID == group {
					found = true
				}
			}
			require.True(t, found, "повторно добавленный чат должен быть в обычном списке")
		})
	}
}

func TestMemberSettingsCleanupFailureRollsBack(t *testing.T) {
	for _, action := range []string{"remove", "ban"} {
		t.Run(action, func(t *testing.T) {
			db := dbtest.Postgres(t)
			const owner = "46200000-0000-4000-8000-000000000001"
			const member = "46200000-0000-4000-8000-000000000002"
			dbtest.User(t, db, owner, "rollback_owner")
			dbtest.User(t, db, member, "rollback_member")
			realtime := &recordingRealtime{}
			svc := NewService(db, realtime, nil)
			group, err := svc.CreateGroup(t.Context(), owner, "Rollback", "", "", []string{member})
			require.NoError(t, err)
			require.NoError(t, svc.SetFlag(t.Context(), member, group, "pin", true))
			realtime.broadcasts = nil
			var rotationBefore bool
			require.NoError(t, db.QueryRow(`SELECT key_rotation_needed FROM chats.chats WHERE id=$1`, group).Scan(&rotationBefore))
			_, err = db.Exec(`CREATE FUNCTION fail_settings_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cleanup failure'; END $$;
    CREATE TRIGGER fail_settings_cleanup BEFORE DELETE ON chats.user_chat_settings FOR EACH ROW EXECUTE FUNCTION fail_settings_cleanup()`)
			require.NoError(t, err)
			if action == "ban" {
				err = svc.BanMember(t.Context(), owner, group, member, nil, "test")
			} else {
				err = svc.RemoveMember(t.Context(), owner, group, member)
			}
			require.ErrorContains(t, err, "cleanup failure")
			var members, settings, bans int
			var rotationAfter bool
			require.NoError(t, db.QueryRow(`SELECT (SELECT count(*) FROM chats.members WHERE chat_id=$1 AND user_id=$2), (SELECT count(*) FROM chats.user_chat_settings WHERE chat_id=$1 AND user_id=$2), (SELECT count(*) FROM chats.bans WHERE chat_id=$1 AND user_id=$2), key_rotation_needed FROM chats.chats WHERE id=$1`, group, member).Scan(&members, &settings, &bans, &rotationAfter))
			require.Equal(t, 1, members)
			require.Equal(t, 1, settings)
			require.Zero(t, bans)
			require.Equal(t, rotationBefore, rotationAfter)
			require.Empty(t, realtime.broadcasts, "при откате не должно быть событий удаления/бана")
		})
	}
}
