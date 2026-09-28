package main

import (
	"net/http"
	"testing"
)

func TestClassifyRouteLoginRegister(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "login",
			method: http.MethodPost,
			path:   "/api/v2/auth/login",
			want:   routeGroupLoginRegister,
		},
		{
			name:   "register",
			method: http.MethodPost,
			path:   "/api/v2/auth/register",
			want:   routeGroupLoginRegister,
		},
		{
			name:   "sessions",
			method: http.MethodGet,
			path:   "/api/v2/auth/sessions",
			want:   routeGroupOtherAuth,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRoutePassword2FA(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "change password",
			method: http.MethodPost,
			path:   "/api/v2/auth/change-password",
			want:   routeGroupPassword2FA,
		},
		{
			name:   "enable 2FA",
			method: http.MethodPost,
			path:   "/api/v2/auth/2fa/enable",
			want:   routeGroupPassword2FA,
		},
		{
			name:   "disable 2FA",
			method: http.MethodPost,
			path:   "/api/v2/auth/2fa/disable",
			want:   routeGroupPassword2FA,
		},
		{
			name:   "verify 2FA",
			method: http.MethodPost,
			path:   "/api/v2/auth/2fa/verify",
			want:   routeGroupPassword2FA,
		},
		{
			name:   "2FA status belongs to other auth",
			method: http.MethodGet,
			path:   "/api/v2/auth/2fa/status",
			want:   routeGroupOtherAuth,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteMessageByID(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "send message",
			method: http.MethodPost,
			path:   "/api/v2/messages/chat-id",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "list chat messages",
			method: http.MethodGet,
			path:   "/api/v2/messages/chat-id",
			want:   routeGroupMessageRead,
		},
		{
			name:   "edit message",
			method: http.MethodPut,
			path:   "/api/v2/messages/message-id",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "delete message",
			method: http.MethodDelete,
			path:   "/api/v2/messages/message-id",
			want:   routeGroupMessageWrite,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteOperationSpecificMessage(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "reaction to message",
			method: http.MethodPost,
			path:   "/api/v2/messages/message-id/reactions",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "get message reactions",
			method: http.MethodGet,
			path:   "/api/v2/messages/message-id/reactions",
			want:   routeGroupMessageRead,
		},
		{
			name:   "favorite message",
			method: http.MethodPost,
			path:   "/api/v2/messages/message-id/favorite",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "unfavorite message",
			method: http.MethodDelete,
			path:   "/api/v2/messages/message-id/favorite",
			want:   routeGroupMessageWrite,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteSpecialMessagePaths(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "mark messages as read",
			method: http.MethodPost,
			path:   "/api/v2/messages/read",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "search messages",
			method: http.MethodGet,
			path:   "/api/v2/messages/search",
			want:   routeGroupMessageRead,
		},
		{
			name:   "list favorite messages",
			method: http.MethodGet,
			path:   "/api/v2/messages/favorites",
			want:   routeGroupMessageRead,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteChatMessageOperations(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "mark chat messages as read",
			method: http.MethodPost,
			path:   "/api/v2/chats/chat-id/read",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "list pinned messages",
			method: http.MethodGet,
			path:   "/api/v2/chats/chat-id/pins",
			want:   routeGroupMessageRead,
		},
		{
			name:   "pin message",
			method: http.MethodPost,
			path:   "/api/v2/chats/chat-id/pins/message-id",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "unpin message",
			method: http.MethodDelete,
			path:   "/api/v2/chats/chat-id/pins/message-id",
			want:   routeGroupMessageWrite,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteMedia(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "upload media",
			method: http.MethodPost,
			path:   "/api/v2/media",
			want:   routeGroupMediaUpload,
		},
		{
			name:   "download media belongs to other API",
			method: http.MethodGet,
			path:   "/api/v2/media/file-id",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteWebSocketAndOtherAPI(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "Websocket handshake",
			method: http.MethodGet,
			path:   "/ws",
			want:   routeGroupWebSocket,
		},
		{
			name:   "non-GET WebSocket request",
			method: http.MethodPost,
			path:   "/ws",
			want:   routeGroupNone,
		},
		{
			name:   "other API routes",
			method: http.MethodGet,
			path:   "/api/v2/users/me",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestClassifyRouteUnsupportedMessageOperations(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			// Эндпоинт forward убран в dev (#808): пересылка стала обычным
			// сообщением с forwardedFrom. Отдельного правила у него больше нет,
			// поэтому путь попадает в общую группу любым методом.
			name:   "forward no longer exists",
			method: http.MethodPost,
			path:   "/api/v2/messages/message-id/forward",
			want:   routeGroupOtherAPI,
		},
		{
			name:   "search does not support POST",
			method: http.MethodPost,
			path:   "/api/v2/messages/search",
			want:   routeGroupOtherAPI,
		},
		{
			name:   "reactions do not support DELETE",
			method: http.MethodDelete,
			path:   "/api/v2/messages/message-id/reactions",
			want:   routeGroupOtherAPI,
		},
		{
			name:   "mark as read does not support GET",
			method: http.MethodGet,
			path:   "/api/v2/messages/read",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestIsRateLimitExempt(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   bool
	}{
		{
			name:   "health check",
			method: http.MethodGet,
			path:   "/health/live",
			want:   true,
		},
		{
			name:   "CORS preflight",
			method: http.MethodOptions,
			path:   "/api/v2/messages/chat-id",
			want:   true,
		},
		{
			name:   "frontend asset",
			method: http.MethodGet,
			path:   "/assets/app.js",
			want:   true,
		},
		{
			name:   "frontend page",
			method: http.MethodGet,
			path:   "/chats",
			want:   true,
		},
		{
			name:   "API request",
			method: http.MethodGet,
			path:   "/api/v2/users/me",
			want:   false,
		},
		{
			name:   "documentation uses global limit",
			method: http.MethodGet,
			path:   "/docs/",
			want:   false,
		},
		{
			name:   "WebSocket handshake",
			method: http.MethodGet,
			path:   "/ws",
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRateLimitExempt(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("isRateLimitExempt(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestNewLimiterSetHasBucketForEveryRouteGroup(t *testing.T) {
	limiterSet := newLimiterSet(rateLimitConfig{})
	for _, group := range allRouteGroups {
		if _, exists := limiterSet.groups[group]; !exists {
			t.Fatalf("expected limiter set to have a bucket for route group %q", group)
		}
	}

	if len(limiterSet.groups) != len(allRouteGroups) {
		t.Fatalf("expected limiter set to have %d buckets, got %d", len(allRouteGroups), len(limiterSet.groups))
	}
}

// GET /api/v2/users/check-username отвечает, существует ли аккаунт, и доступен
// без авторизации. Быстрые ответы на него позволяют перечислить пользователей,
// поэтому маршрут обязан попадать в свою строгую группу, а не в other-api.
func TestClassifyRouteUsernameCheck(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "username availability check",
			method: http.MethodGet,
			path:   "/api/v2/users/check-username",
			want:   routeGroupUsernameCheck,
		},
		{
			// Сервис users отвечает на такой запрос 405, но edge не знает о
			// методах сервиса, поэтому запрос идёт в общую группу.
			name:   "the same path with another method",
			method: http.MethodPost,
			path:   "/api/v2/users/check-username",
			want:   routeGroupOtherAPI,
		},
		{
			// Правило должно совпадать по полному пути, а не по префиксу:
			// иначе соседние маршруты получили бы строгий лимит случайно.
			name:   "another users route",
			method: http.MethodGet,
			path:   "/api/v2/users/search",
			want:   routeGroupOtherAPI,
		},
		{
			name:   "path that only starts the same",
			method: http.MethodGet,
			path:   "/api/v2/users/check-username-history",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

// Создание комнаты звонка пишет строку в calls.rooms и запись в памяти процесса
// на каждый вызов, поэтому группа своя, а не общая с остальными API.
func TestClassifyRouteCalls(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "create a call room",
			method: http.MethodPost,
			path:   "/api/v2/calls/rooms",
			want:   routeGroupCalls,
		},
		{
			name:   "list call rooms",
			method: http.MethodGet,
			path:   "/api/v2/calls/rooms",
			want:   routeGroupCalls,
		},
		{
			name:   "one call room",
			method: http.MethodGet,
			path:   "/api/v2/calls/rooms/room-id",
			want:   routeGroupCalls,
		},
		{
			name:   "ICE servers",
			method: http.MethodGet,
			path:   "/api/v2/calls/ice-servers",
			want:   routeGroupCalls,
		},
		{
			// Правило совпадает по префиксу с завершающей косой чертой, поэтому
			// маршрут, который лишь начинается так же, в группу не попадает.
			name:   "path that only starts the same",
			method: http.MethodGet,
			path:   "/api/v2/calls-history",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

// Пакетное удаление сообщений — операция записи, поэтому группа та же, что у
// остальной записи, а не общая для прочих API.
func TestClassifyRouteBatchMessageDelete(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "batch delete",
			method: http.MethodPost,
			path:   "/api/v2/chats/chat-id/messages/delete",
			want:   routeGroupMessageWrite,
		},
		{
			name:   "batch delete does not support GET",
			method: http.MethodGet,
			path:   "/api/v2/chats/chat-id/messages/delete",
			want:   routeGroupOtherAPI,
		},
		{
			// Соседние операции над чатом остаются в общей группе: своей
			// причины быть ограниченными строже у них нет.
			name:   "pin chat stays in the general group",
			method: http.MethodPost,
			path:   "/api/v2/chats/chat-id/pin",
			want:   routeGroupOtherAPI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}
