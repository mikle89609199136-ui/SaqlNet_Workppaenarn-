package chat

import "net/http"

type Middleware func(http.Handler) http.Handler

func RegisterRoutes(
	mux *http.ServeMux,
	handler *Handler,
	authenticated Middleware,
) {
	registerChatRoutes(mux, handler, authenticated)
}
