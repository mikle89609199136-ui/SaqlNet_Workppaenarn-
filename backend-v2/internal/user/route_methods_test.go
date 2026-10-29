package user

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/stretchr/testify/require"
)

var compositeUserRoutes = []struct{ path, method, body string }{
	{"storage", http.MethodGet, ""},
	{"storage/settings", http.MethodPut, `{"autoDownloadWifi":false}`},
	{"storage/cache", http.MethodDelete, ""},
	{"storage/all", http.MethodDelete, ""},
	{"passcode", http.MethodGet, ""},
	{"passcode/set", http.MethodPost, `{"passcode":"1234"}`},
	{"passcode/verify", http.MethodPost, `{"passcode":"1234"}`},
	{"passcode/disable", http.MethodPost, `{"passcode":"1234"}`},
	{"passcode/timeout", http.MethodPut, `{"timeout":30}`},
}

func compositeUserMux(h *Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/users/storage", h.Storage)
	mux.HandleFunc("/api/v2/users/storage/", h.Storage)
	mux.HandleFunc("/api/v2/users/passcode", h.Passcode)
	mux.HandleFunc("/api/v2/users/passcode/", h.Passcode)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: "73000000-0000-4000-8000-000000000001"})))
	})
}

func TestCompositeUserRouteMethods(t *testing.T) {
	// nil service доказывает, что неверный метод не доходит до SQL/изменений.
	server := httptest.NewServer(compositeUserMux(NewHandler(nil, nil)))
	defer server.Close()
	methods := []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodTrace}
	for _, route := range compositeUserRoutes {
		for _, method := range methods {
			if method == route.method {
				continue
			}
			t.Run(method+"/"+route.path, func(t *testing.T) {
				// Неверный JSON не должен менять результат на 400: метод проверяется первым.
				req, err := http.NewRequest(method, server.URL+"/api/v2/users/"+route.path+"?test=1", strings.NewReader("{invalid"))
				require.NoError(t, err)
				response, err := server.Client().Do(req)
				require.NoError(t, err)
				defer response.Body.Close()
				require.Equal(t, http.StatusMethodNotAllowed, response.StatusCode)
				require.Equal(t, route.method, response.Header.Get("Allow"))
				if method != http.MethodHead {
					var body map[string]any
					require.NoError(t, json.NewDecoder(response.Body).Decode(&body))
					require.Equal(t, "method_not_allowed", body["code"])
				}
			})
		}
	}
	for _, path := range []string{"storage/unknown", "storage/", "storage/settings/extra", "passcode/unknown", "passcode/", "passcode/set/extra"} {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
			t.Run(method+"/"+path, func(t *testing.T) {
				req, err := http.NewRequest(method, server.URL+"/api/v2/users/"+path, nil)
				require.NoError(t, err)
				response, err := server.Client().Do(req)
				require.NoError(t, err)
				defer response.Body.Close()
				require.Equal(t, http.StatusNotFound, response.StatusCode)
				require.Empty(t, response.Header.Get("Allow"))
				var body map[string]any
				require.NoError(t, json.NewDecoder(response.Body).Decode(&body))
				require.Equal(t, "route_not_found", body["code"])
			})
		}
	}
}
