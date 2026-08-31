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
			name:   "forward message",
			method: http.MethodPost,
			path:   "/api/v2/messages/message-id/forward",
			want:   routeGroupMessageWrite,
		},
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
			name:   "forward does not support GET",
			method: http.MethodGet,
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
