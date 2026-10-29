//go:build integration

package user

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestCompositeUserAllowedMethods(t *testing.T) {
	db := dbtest.Postgres(t)
	dbtest.User(t, db, settingsOwner, "route_methods")
	server := httptest.NewServer(compositeUserMux(NewHandler(NewService(db), nil)))
	defer server.Close()
	for _, route := range compositeUserRoutes {
		t.Run(route.method+"/"+route.path, func(t *testing.T) {
			req, err := http.NewRequest(route.method, server.URL+"/api/v2/users/"+route.path, strings.NewReader(route.body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			response, err := server.Client().Do(req)
			require.NoError(t, err)
			defer response.Body.Close()
			require.Equal(t, http.StatusOK, response.StatusCode)
			require.Empty(t, response.Header.Get("Allow"))
		})
	}
}
