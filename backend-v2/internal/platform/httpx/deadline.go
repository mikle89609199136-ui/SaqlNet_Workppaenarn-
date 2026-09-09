package httpx

import (
	"errors"
	"net/http"
	"time"
)

// DisableWriteDeadline removes the server write deadline for a single response.
// Test and adapter ResponseWriters may not expose deadline control; in that case
// callers can continue because there is no net/http server deadline to remove.
func DisableWriteDeadline(w http.ResponseWriter) error {
	err := http.NewResponseController(w).SetWriteDeadline(time.Time{})
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}
