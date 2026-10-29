//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/user"
	"github.com/stretchr/testify/require"
)

func TestProfileNameLengthHTTPOnRealSchema(t *testing.T) {
	db := dbtest.Postgres(t)
	hashCalls := 0
	registration := auth.NewHandler(auth.NewService(db, &mockCrypto{
		hashFunc:       func(context.Context, string) (string, error) { hashCalls++; return "hash", nil },
		issueTokenFunc: func(context.Context, string, string, int64) (string, error) { return "test-token", nil },
	}))
	const owner = "41600000-0000-4000-8000-000000000001"
	dbtest.User(t, db, owner, "profile_owner")
	profile := user.NewHandler(user.NewService(db), nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/register" {
			registration.Register(w, r)
			return
		}
		profile.Me(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: owner})))
	}))
	defer server.Close()
	snapshot := func() string {
		var value string
		require.NoError(t, db.QueryRow(`SELECT json_build_array(
   (SELECT json_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),
   (SELECT json_agg(to_jsonb(p) ORDER BY user_id) FROM users.profiles p),
   (SELECT count(*) FROM auth.sessions),
   (SELECT count(*) FROM auth.username_registry),
   (SELECT count(*) FROM users.settings))::text`).Scan(&value))
		return value
	}
	index := 0
	for _, route := range []string{"register", "profile"} {
		for _, field := range []string{"firstName", "lastName"} {
			for _, symbol := range []string{"a", "Я", "😀", "e\u0301"} {
				// Комбинируемые знаки считаются отдельно, как в PostgreSQL VARCHAR.
				for _, length := range []int{64, 65} {
					index++
					value := strings.Repeat(symbol, length)
					if symbol == "e\u0301" {
						value = strings.Repeat(symbol, length/2) + strings.Repeat("e", length%2)
					}
					t.Run(fmt.Sprintf("%s/%s/%s/%d", route, field, symbol, length), func(t *testing.T) {
						body := map[string]string{"firstName": "Name", "lastName": "Surname", "username": fmt.Sprintf("name_%d", index), "password": "parolproba1!"}
						body[field] = value
						data, err := json.Marshal(body)
						require.NoError(t, err)
						before, calls := snapshot(), hashCalls
						method, okStatus := http.MethodPost, http.StatusCreated
						if route == "profile" {
							method, okStatus = http.MethodPut, http.StatusOK
						}
						req, err := http.NewRequest(method, server.URL+"/"+route, bytes.NewReader(data))
						require.NoError(t, err)
						res, err := server.Client().Do(req)
						require.NoError(t, err)
						defer res.Body.Close()
						var payload map[string]any
						require.NoError(t, json.NewDecoder(res.Body).Decode(&payload))
						if length > 64 {
							require.Equal(t, http.StatusBadRequest, res.StatusCode, payload)
							require.Contains(t, fmt.Sprint(payload), "validation_failed")
							require.Equal(t, before, snapshot(), "невалидные имена не должны менять данные")
							require.Equal(t, calls, hashCalls, "невалидные имена не должны вызывать crypto")
							require.Empty(t, res.Cookies())
						} else {
							require.Equal(t, okStatus, res.StatusCode, payload)
							var stored string
							if route == "register" {
								err = db.QueryRow("SELECT first_name || '/' || last_name FROM auth.users WHERE username=$1", body["username"]).Scan(&stored)
							} else {
								err = db.QueryRow("SELECT first_name || '/' || last_name FROM users.profiles WHERE user_id=$1", owner).Scan(&stored)
							}
							require.NoError(t, err)
							require.Equal(t, body["firstName"]+"/"+body["lastName"], stored)
						}
					})
				}
			}
		}
	}
	for _, route := range []string{"register", "profile"} {
		for _, first := range []string{"", " \t", " Name "} {
			for _, last := range []string{"", " \t"} {
				index++
				body := map[string]string{"username": fmt.Sprintf("empty_%d", index), "password": "parolproba1!", "firstName": first, "lastName": last}
				data, err := json.Marshal(body)
				require.NoError(t, err)
				var previous string
				require.NoError(t, db.QueryRow("SELECT first_name FROM users.profiles WHERE user_id=$1", owner).Scan(&previous))
				before := snapshot()
				method := http.MethodPost
				if route == "profile" {
					method = http.MethodPut
				}
				req, err := http.NewRequest(method, server.URL+"/"+route, bytes.NewReader(data))
				require.NoError(t, err)
				res, err := server.Client().Do(req)
				require.NoError(t, err)
				require.NoError(t, res.Body.Close())
				if route == "register" && strings.TrimSpace(first) == "" {
					require.Equal(t, http.StatusBadRequest, res.StatusCode)
					require.Equal(t, before, snapshot())
					continue
				}
				var storedFirst, storedLast string
				if route == "register" {
					require.Equal(t, http.StatusCreated, res.StatusCode)
					require.NoError(t, db.QueryRow("SELECT first_name,last_name FROM auth.users WHERE username=$1", body["username"]).Scan(&storedFirst, &storedLast))
					require.Equal(t, strings.TrimSpace(first), storedFirst)
					require.Equal(t, strings.TrimSpace(last), storedLast)
				} else {
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.NoError(t, db.QueryRow("SELECT first_name,last_name FROM users.profiles WHERE user_id=$1", owner).Scan(&storedFirst, &storedLast))
					expected := first
					if first == "" {
						expected = previous
					}
					require.Equal(t, expected, storedFirst)
					require.Equal(t, last, storedLast)
				}
			}
		}
	}
}
