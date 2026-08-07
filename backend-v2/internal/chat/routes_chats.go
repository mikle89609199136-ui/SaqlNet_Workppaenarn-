package chat

import "net/http"

func registerChatRoutes(
	mux *http.ServeMux,
	handler *Handler,
	authenticated Middleware,
) {
	mux.Handle(
		"GET /api/v2/chats",
		authenticated(http.HandlerFunc(handler.List)),
	)

	mux.Handle(
		"POST /api/v2/chats/private",
		authenticated(http.HandlerFunc(handler.CreatePrivate)),
	)

	mux.Handle(
		"POST /api/v2/chats/groups",
		authenticated(http.HandlerFunc(handler.CreateGroup)),
	)

	mux.Handle(
		"PATCH /api/v2/chats/{chatID}",
		authenticated(http.HandlerFunc(handler.UpdateGroup)),
	)

	mux.Handle(
		"GET /api/v2/chats/{chatID}/pins",
		authenticated(http.HandlerFunc(handler.Pins)),
	)

	mux.Handle(
		"POST /api/v2/chats/{chatID}/pins/{messageID}",
		authenticated(http.HandlerFunc(handler.Pins)),
	)

	mux.Handle(
		"DELETE /api/v2/chats/{chatID}/pins/{messageID}",
		authenticated(http.HandlerFunc(handler.Pins)),
	)

	// Старые операции пока в общем обработчике.
	mux.Handle(
		"/api/v2/chats/",
		authenticated(http.HandlerFunc(handler.Chat)),
	)
}
