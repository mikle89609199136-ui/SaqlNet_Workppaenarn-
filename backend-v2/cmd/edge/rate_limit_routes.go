package main

import (
	"net/http"
	"strings"
)

type routeGroup string

// allRouteGroups — группы, в которые классификатор может отнести маршрут.
// routeGroupGlobal сюда не входит: глобальная корзина не привязана к маршруту и
// проверяется для каждого запроса дополнительно к групповой.
var allRouteGroups = []routeGroup{
	routeGroupLoginRegister,
	routeGroupPassword2FA,
	routeGroupOtherAuth,
	routeGroupUsernameCheck,
	routeGroupMessageWrite,
	routeGroupMessageRead,
	routeGroupMediaUpload,
	routeGroupOtherAPI,
	routeGroupWebSocket,
}

const (
	routeGroupNone          routeGroup = ""
	routeGroupLoginRegister routeGroup = "login-register"
	routeGroupPassword2FA   routeGroup = "password-2fa"
	routeGroupOtherAuth     routeGroup = "other-auth"
	routeGroupUsernameCheck routeGroup = "username-check"
	routeGroupMessageWrite  routeGroup = "message-write"
	routeGroupMessageRead   routeGroup = "message-read"
	routeGroupMediaUpload   routeGroup = "media-upload"
	routeGroupOtherAPI      routeGroup = "other-api"
	routeGroupWebSocket     routeGroup = "websocket"
	// routeGroupGlobal не возвращается классификатором: это имя глобальной
	// корзины, нужное конфигурации и логам.
	routeGroupGlobal routeGroup = "global"
)

func classifyRoute(method, path string) routeGroup {
	switch {
	case method == http.MethodPost && (path == "/api/v2/auth/login" || path == "/api/v2/auth/register"):
		return routeGroupLoginRegister
	case method == http.MethodPost && path == "/api/v2/auth/change-password":
		return routeGroupPassword2FA
	case method == http.MethodPost && path == "/api/v2/auth/2fa/enable":
		return routeGroupPassword2FA
	case method == http.MethodPost && path == "/api/v2/auth/2fa/disable":
		return routeGroupPassword2FA
	case method == http.MethodPost && path == "/api/v2/auth/2fa/verify":
		return routeGroupPassword2FA
	case strings.HasPrefix(path, "/api/v2/auth/"):
		return routeGroupOtherAuth
	case strings.HasPrefix(path, "/api/v2/messages/"):
		return classifyMessageRoute(method, path)
	// Публичный эндпоинт, отвечающий, существует ли аккаунт. Быстрые ответы на
	// него позволяют перечислить пользователей, поэтому лимит свой и строгий,
	// а не общий для остальных API.
	case method == http.MethodGet && path == "/api/v2/users/check-username":
		return routeGroupUsernameCheck
	case method == http.MethodPost && path == "/api/v2/media":
		return routeGroupMediaUpload
	case method == http.MethodPost && strings.HasPrefix(path, "/api/v2/chats/") && strings.HasSuffix(path, "/read"):
		return routeGroupMessageWrite
	case method == http.MethodGet && strings.HasPrefix(path, "/api/v2/chats/") && strings.HasSuffix(path, "/pins"):
		return routeGroupMessageRead
	case (method == http.MethodDelete || method == http.MethodPost) && strings.HasPrefix(path, "/api/v2/chats/") &&
		strings.Contains(path, "/pins/"):
		return routeGroupMessageWrite
	case method == http.MethodGet && path == "/ws":
		return routeGroupWebSocket
	case strings.HasPrefix(path, "/api/v2/"):
		return routeGroupOtherAPI
	default:
		return routeGroupNone
	}
}

func classifyMessageRoute(method, path string) routeGroup {
	const prefix = "/api/v2/messages/"

	rest := strings.TrimPrefix(path, prefix)

	switch rest {
	case "read":
		if method == http.MethodPost {
			return routeGroupMessageWrite
		}
		return routeGroupOtherAPI
	case "search", "favorites":
		if method == http.MethodGet {
			return routeGroupMessageRead
		}
		return routeGroupOtherAPI
	}

	parts := strings.Split(rest, "/")
	if len(parts) == 1 && parts[0] != "" {
		switch method {
		case http.MethodGet:
			return routeGroupMessageRead
		case http.MethodPost, http.MethodPut, http.MethodDelete:
			return routeGroupMessageWrite
		}
	}

	if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
		switch parts[1] {
		case "forward":
			if method == http.MethodPost {
				return routeGroupMessageWrite
			}
		case "reactions":
			switch method {
			case http.MethodGet:
				return routeGroupMessageRead
			case http.MethodPost:
				return routeGroupMessageWrite
			}
		case "favorite":
			if method == http.MethodPost || method == http.MethodDelete {
				return routeGroupMessageWrite
			}
		}
	}

	return routeGroupOtherAPI
}

func isRateLimitExempt(method, path string) bool {
	switch {
	case method == http.MethodOptions:
		return true
	case path == "/health/live":
		return true
	case method != http.MethodGet && method != http.MethodHead:
		return false
	case path == "/docs" || strings.HasPrefix(path, "/docs/"):
		return false
	case strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws"):
		return false
	default:
		return true
	}
}
