package authctx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
)

type middlewareTokenVerifier struct {
	claims cryptoclient.TokenClaims
	err    error
}

func (v middlewareTokenVerifier) VerifyToken(context.Context, string) (cryptoclient.TokenClaims, error) {
	return v.claims, v.err
}

func TestMiddlewareReportsIncompatibleCryptoAsUnavailable(t *testing.T) {
	verifier := middlewareTokenVerifier{err: cryptoclient.ErrTokenGenerationProtocol}
	handler := Middleware(verifier, middlewareTokenChecker{})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler must not run with an incompatible crypto service")
	}))
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: "token"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
}

type middlewareTokenChecker struct {
	revoked bool
	err     error
}

func (c middlewareTokenChecker) IsTokenRevoked(context.Context, string, cryptoclient.TokenClaims) (bool, error) {
	return c.revoked, c.err
}

func TestMiddlewareFailsClosedWhenRevocationCheckFails(t *testing.T) {
	verifier := middlewareTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user-id"}}
	handler := Middleware(verifier, middlewareTokenChecker{err: errors.New("database unavailable")})(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			t.Fatal("protected handler must not run when revocation cannot be checked")
		}),
	)
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: "token"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
}

func TestMiddlewareFailsClosedWhenRevocationCheckerIsNil(t *testing.T) {
	verifier := middlewareTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user-id"}}
	handler := Middleware(verifier, nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler must not run without a revocation checker")
	}))
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: "token"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
}

func TestMiddlewareRejectsRevokedToken(t *testing.T) {
	verifier := middlewareTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user-id"}}
	handler := Middleware(verifier, middlewareTokenChecker{revoked: true})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler must not run for a revoked token")
	}))
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: "token"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

func TestMiddlewareStoresVerifiedTokenGenerationInContext(t *testing.T) {
	expiresAt := time.Unix(1_900_000_123, 0).UTC()
	verifier := middlewareTokenVerifier{claims: cryptoclient.TokenClaims{
		Subject:         "user-id",
		Username:        "ivan",
		TokenGeneration: 9,
		Expires:         expiresAt.Unix(),
	}}
	handler := Middleware(verifier, middlewareTokenChecker{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := MustUser(r)
		if current.TokenGeneration != 9 {
			t.Fatalf("expected token generation 9 in context, got %d", current.TokenGeneration)
		}
		if !current.ExpiresAt.Equal(expiresAt) {
			t.Fatalf("expected expiry %s in context, got %s", expiresAt, current.ExpiresAt)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "craneapp_session", Value: "token"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected %d, got %d", http.StatusNoContent, response.Code)
	}
}

// recordingVerifier запоминает, какой токен проверяли.
type recordingVerifier struct{ token *string }

func (v recordingVerifier) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	*v.token = token
	return cryptoclient.TokenClaims{Subject: "user-id", Username: "ivan"}, nil
}

// Сессия браузера — только в cookie (#705); без неё — 401.
func TestMiddlewareAcceptsSessionCookie(t *testing.T) {
	var verified string
	handler := Middleware(recordingVerifier{token: &verified}, middlewareTokenChecker{})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName(), Value: "cookie-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || verified != "cookie-token" {
		t.Fatalf("cookie: status %d, verified %q", response.Code, verified)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/protected", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status %d, want 401", response.Code)
	}
}

func TestMiddlewareRejectsBearerToken(t *testing.T) {
	handler := Middleware(middlewareTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user-id"}}, middlewareTokenChecker{})(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			t.Fatal("protected handler must not run for a bearer token")
		}))
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected %d, got %d", http.StatusUnauthorized, response.Code)
	}
}
