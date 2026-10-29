package user

import (
	"errors"
	"net/http"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/push"
)

const maxPushSubscriptionBodyBytes = 8 << 10

// PushVAPIDKey — публичный ключ VAPID для PushManager.subscribe (#717).
// Ключа нет — push на этом сервере выключен.
func (h *Handler) PushVAPIDKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	key := config.Value("VAPID_PUBLIC_KEY", "")
	if key == "" {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "push_not_configured", "push notifications are not configured")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"publicKey": key})
}

// PushSubscriptions — подписка устройства: POST — записать (повтор того же
// endpoint обновляет ключи), DELETE — удалить свою.
func (h *Handler) PushSubscriptions(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	current := authctx.MustUser(r)
	switch r.Method {
	case http.MethodPost:
		var sub push.Subscription
		if !decodeSingleJSON(w, r, &sub, maxPushSubscriptionBodyBytes) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
			return
		}
		id, err := push.Save(r.Context(), h.service.db, current.ID, sub)
		if errors.Is(err, push.ErrInvalidSubscription) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_push_subscription", "invalid push subscription")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to save push subscription")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"id": id})
	case http.MethodDelete:
		var input struct {
			Endpoint string `json:"endpoint"`
		}
		if !decodeSingleJSON(w, r, &input, maxPushSubscriptionBodyBytes) || input.Endpoint == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "endpoint is required")
			return
		}
		if err := push.Delete(r.Context(), h.service.db, current.ID, input.Endpoint); err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to delete push subscription")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
