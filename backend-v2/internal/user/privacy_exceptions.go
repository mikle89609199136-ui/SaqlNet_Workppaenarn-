package user

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/platform/privacy"
)

// Исключения из правил приватности по людям (#784): «всегда разрешать» и
// «никогда не разрешать». Как они участвуют в решении — в
// internal/platform/privacy.

const privacyExceptionsPath = "/api/v2/users/privacy/exceptions"

var ErrSelfException = errors.New("cannot add yourself to privacy exceptions")

// PrivacyException — человек в списке исключений правила.
type PrivacyException struct {
	SearchResult
	Rule      string       `json:"rule"`
	Mode      privacy.Mode `json:"mode"`
	CreatedAt string       `json:"createdAt"`
}

const privacyExceptionColumns = `
	au.id::text, au.username,
	COALESCE(up.first_name, au.first_name), COALESCE(up.last_name, au.last_name),
	COALESCE(up.avatar_url, ''), e.rule, e.allow,
	to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

func scanPrivacyException(row interface{ Scan(...any) error }) (PrivacyException, error) {
	var item PrivacyException
	var allow bool
	err := row.Scan(&item.ID, &item.Username, &item.FirstName, &item.LastName, &item.AvatarURL, &item.Rule, &allow, &item.CreatedAt)
	item.Mode = privacy.ModeOf(allow)
	return item, err
}

// PrivacyExceptions — исключения владельца, новые сверху. Пустое rule —
// по всем правилам.
func (s *Service) PrivacyExceptions(ctx context.Context, ownerID string, rule privacy.Rule) ([]PrivacyException, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+privacyExceptionColumns+`
		FROM users.privacy_exceptions e
		JOIN auth.users au ON au.id = e.user_id
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE e.owner_id = $1 AND ($2 = '' OR e.rule = $2)
		ORDER BY e.created_at DESC, au.username
	`, ownerID, string(rule))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	exceptions := []PrivacyException{}
	for rows.Next() {
		item, err := scanPrivacyException(rows)
		if err != nil {
			return nil, err
		}
		exceptions = append(exceptions, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slots := make([]privacy.PhotoSlot, len(exceptions))
	for i := range exceptions {
		slots[i] = privacy.PhotoSlot{OwnerID: exceptions[i].ID, URL: &exceptions[i].AvatarURL}
	}
	return exceptions, privacy.HidePhotos(ctx, s.db, ownerID, slots)
}

// SetPrivacyException добавляет человека в исключения правила или
// переводит из одного списка в другой. Повторный запрос с тем же видом
// ничего не меняет.
func (s *Service) SetPrivacyException(ctx context.Context, ownerID string, rule privacy.Rule, userID string, allow bool) (PrivacyException, error) {
	if ownerID == userID {
		return PrivacyException{}, ErrSelfException
	}
	item, err := scanPrivacyException(s.db.QueryRowContext(ctx, `
		WITH saved AS (
			INSERT INTO users.privacy_exceptions AS existing (owner_id, user_id, rule, allow)
			SELECT $1::uuid, au.id, $3::text, $4::boolean FROM auth.users au WHERE au.id = $2::uuid AND au.disabled_at IS NULL
			ON CONFLICT (owner_id, user_id, rule) DO UPDATE
			SET allow = EXCLUDED.allow,
			    -- Переход в другой список поднимает человека наверх в нём.
			    created_at = CASE WHEN existing.allow = EXCLUDED.allow THEN existing.created_at ELSE NOW() END
			RETURNING user_id, rule, allow, created_at
		)
		SELECT `+privacyExceptionColumns+`
		FROM saved e
		JOIN auth.users au ON au.id = e.user_id
		LEFT JOIN users.profiles up ON up.user_id = au.id
	`, ownerID, userID, string(rule), allow))
	if errors.Is(err, sql.ErrNoRows) {
		return PrivacyException{}, ErrNotFound
	}
	if err != nil {
		return PrivacyException{}, err
	}
	err = privacy.HidePhotos(ctx, s.db, ownerID, []privacy.PhotoSlot{{OwnerID: item.ID, URL: &item.AvatarURL}})
	return item, err
}

// RemovePrivacyException убирает человека из исключений правила. Его уже
// нет — не ошибка.
func (s *Service) RemovePrivacyException(ctx context.Context, ownerID string, rule privacy.Rule, userID string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM users.privacy_exceptions WHERE owner_id = $1 AND user_id = $2 AND rule = $3
	`, ownerID, userID, string(rule))
	return err
}

// PrivacyExceptions обслуживает
//
//	GET    /users/privacy/exceptions[?rule=…]
//	PUT    /users/privacy/exceptions/{rule}/{userId}  {"mode": "allow" | "deny"}
//	DELETE /users/privacy/exceptions/{rule}/{userId}
func (h *Handler) PrivacyExceptions(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	if r.URL.Path == privacyExceptionsPath {
		if r.Method != http.MethodGet {
			httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		var rule privacy.Rule
		if name := r.URL.Query().Get("rule"); name != "" {
			var ok bool
			if rule, ok = privacy.ExceptionRule(name); !ok {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "unknown privacy rule")
				return
			}
		}
		exceptions, err := h.service.PrivacyExceptions(r.Context(), current.ID, rule)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "privacy exceptions fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"exceptions": exceptions})
		return
	}

	parts := strings.Split(strings.TrimPrefix(r.URL.Path, privacyExceptionsPath+"/"), "/")
	if len(parts) != 2 {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		return
	}
	rule, ok := privacy.ExceptionRule(parts[0])
	if !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "unknown privacy rule")
		return
	}
	userID := parts[1]
	if !isValidUUID(userID) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid userId")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var input struct {
			Mode string `json:"mode"`
		}
		if !decode(w, r, &input) {
			return
		}
		allow, ok := privacy.ParseMode(input.Mode)
		if !ok {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "mode must be allow or deny")
			return
		}
		exception, err := h.service.SetPrivacyException(r.Context(), current.ID, rule, userID, allow)
		switch {
		case errors.Is(err, ErrSelfException):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "self_exception", "cannot add yourself to privacy exceptions")
		case errors.Is(err, ErrNotFound):
			httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		case err != nil:
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "privacy exception save failed")
		default:
			httpx.JSON(w, http.StatusOK, map[string]any{"exception": exception})
		}
	case http.MethodDelete:
		if err := h.service.RemovePrivacyException(r.Context(), current.ID, rule, userID); err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "privacy exception removal failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
