package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"github.com/stretchr/testify/require"
)

func TestRegisterRejectsInvalidNamesBeforeService(t *testing.T) {
	for _, names := range [][2]string{{"", ""}, {" \t\n", ""}, {strings.Repeat(" ", 65), ""}, {strings.Repeat("a", 65), ""}, {"Name", strings.Repeat("😀", 65)}} {
		body, err := json.Marshal(map[string]string{"username": "valid_user", "firstName": names[0], "lastName": names[1]})
		require.NoError(t, err)
		response := httptest.NewRecorder()
		auth.NewHandler(nil).Register(response, httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(string(body))))
		require.Equal(t, http.StatusBadRequest, response.Code)
		require.Contains(t, response.Body.String(), "validation_failed")
	}
}
