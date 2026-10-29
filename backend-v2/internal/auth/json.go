package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"craneapp/backend-v2/internal/platform/httpx"
)

func decodeAuthJSON(w http.ResponseWriter, r *http.Request, value any, limit int64) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	if err := decoder.Decode(value); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	// Проверяем всё ограниченное тело до любых побочных эффектов обработчика.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	return true
}
