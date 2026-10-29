package crypto

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestVerifyTokenClassifiesHTTPFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"invalid", 401, `{"code":"invalid_token","message":"bad signature"}`, ErrInvalidToken},
		{"expired", 401, `{"code":"token_expired"}`, ErrInvalidToken},
		{"proxy auth failure", 401, `{"code":"proxy_credentials_missing"}`, ErrUnavailable},
		{"proxy html", 401, `<html>proxy secret</html>`, ErrUnavailable},
		{"malformed rejection", 401, `{"code":"invalid_token"}{}`, ErrUnavailable},
		{"unexpected client error", 400, `{"code":"invalid_token"}`, ErrUnavailable},
		{"dependency down", 503, `{"code":"invalid_token"}`, ErrUnavailable},
		{"internal error", 500, `internal secret`, ErrUnavailable},
		{"malformed success", 200, `not json`, ErrUnavailable},
		{"empty success", 200, ``, ErrUnavailable},
		{"missing claims", 200, `{"token_generation":0}`, ErrUnavailable},
		{"legacy protocol", 200, `{"subject":"id","expires_at":2000000000}`, ErrTokenGenerationProtocol},
		{"trailing document", 200, `{"subject":"id","expires_at":2000000000,"token_generation":0}{}`, ErrUnavailable},
		{"verified", 200, `{"subject":"id","username":"user","expires_at":2000000000,"token_generation":0}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/internal/v1/token/verify", r.URL.Path)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			claims, err := NewClient(server.URL).VerifyToken(t.Context(), "credential")
			require.ErrorIs(t, err, tc.want)
			if tc.want == nil {
				require.Equal(t, "id", claims.Subject)
			} else {
				require.Empty(t, claims.Subject)
			}
		})
	}
}

func TestCryptoTransportTimeoutAndRefusedConnection(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	client := NewClient(server.URL)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err := client.VerifyToken(ctx, "credential")
	close(release)
	require.ErrorIs(t, err, ErrUnavailable)
	require.True(t, errors.Is(err, context.DeadlineExceeded))
	server.Close()
	_, err = client.VerifyToken(t.Context(), "credential")
	require.ErrorIs(t, err, ErrUnavailable)
}
