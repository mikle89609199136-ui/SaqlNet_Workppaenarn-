package authctx

import (
	"context"
	"errors"
	"net/http"
	"time"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/httpx"
)

type User struct {
	ID              string
	Username        string
	TokenGeneration int64
	ExpiresAt       time.Time
}

type contextKey struct{}

// TokenChecker is implemented by services that maintain a revoked-token store.
type TokenChecker interface {
	IsTokenRevoked(ctx context.Context, token string, claims cryptoclient.TokenClaims) (bool, error)
}

type TokenVerifier interface {
	VerifyToken(ctx context.Context, token string) (cryptoclient.TokenClaims, error)
}

// Middleware always requires a revocation checker. Keeping it mandatory makes
// it impossible to compile a protected service that validates signatures but
// accidentally skips logout/logout-all state.
func Middleware(crypto TokenVerifier, checker TokenChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Сессия браузера хранится только в HttpOnly-cookie (#705).
			token, source := TokenFromRequest(r)
			if source == TokenNone {
				httpx.ErrorJSON(w, r, http.StatusUnauthorized, "missing_token", "session cookie is required")
				return
			}
			claims, err := crypto.VerifyToken(r.Context(), token)
			if err != nil {
				if errors.Is(err, cryptoclient.ErrTokenGenerationProtocol) {
					httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_protocol_not_ready", "crypto token-generation protocol is not ready")
					return
				}
				httpx.ErrorJSON(w, r, http.StatusUnauthorized, "invalid_token", "token is invalid or expired")
				return
			}
			if checker == nil {
				httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "auth_check_unavailable", "token revocation check is unavailable")
				return
			}
			revoked, err := checker.IsTokenRevoked(r.Context(), token, claims)
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "auth_check_unavailable", "token revocation check is unavailable")
				return
			}
			if revoked {
				httpx.ErrorJSON(w, r, http.StatusUnauthorized, "token_revoked", "token has been revoked")
				return
			}
			user := User{
				ID:              claims.Subject,
				Username:        claims.Username,
				TokenGeneration: claims.TokenGeneration,
				ExpiresAt:       time.Unix(claims.Expires, 0).UTC(),
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, user)))
		})
	}
}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(contextKey{}).(User)
	return user, ok
}

func MustUser(r *http.Request) User {
	user, ok := UserFromContext(r.Context())
	if !ok {
		panic("authenticated user missing from context")
	}
	return user
}

func WithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, contextKey{}, user)
}
