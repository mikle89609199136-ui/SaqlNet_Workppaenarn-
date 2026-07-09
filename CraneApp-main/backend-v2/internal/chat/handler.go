package chat

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r)
		return
	}
	current := authctx.MustUser(r)
	chats, err := h.service.List(r.Context(), current.ID, r.URL.Query().Get("archived") == "true")
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "chat list failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"chats": chats})
}

func (h *Handler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		UserID string `json:"userId"`
	}
	if !decode(w, r, &input) {
		return
	}
	chatID, exists, err := h.service.CreatePrivate(r.Context(), current.ID, input.UserID)
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid participants")
	case errors.Is(err, ErrUserNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
	case errors.Is(err, ErrBlockedByUser):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "blocked_by_user", "you are blocked by this user")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "private chat creation failed")
	default:
		status := http.StatusCreated
		if exists {
			status = http.StatusOK
		}
		httpx.JSON(w, status, map[string]any{"chatId": chatID, "exists": exists})
	}
}

func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		AvatarURL   string   `json:"avatarUrl"`
		Members     []string `json:"members"`
	}
	if !decode(w, r, &input) {
		return
	}
	chatID, err := h.service.CreateGroup(r.Context(), current.ID, input.Title, input.Description, input.AvatarURL, input.Members)
	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "title and members are required")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "group creation failed")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"chatId": chatID, "title": strings.TrimSpace(input.Title)})
}

func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID, suffix := parseChatPath(r.URL.Path)
	switch {
	case chatID == "":
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	case suffix == "" && r.Method == http.MethodGet:
		chat, err := h.service.Get(r.Context(), current.ID, chatID)
		respondChat(w, r, chat, err)
	case suffix == "" && r.Method == http.MethodPatch:
		var input struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			AvatarURL   string `json:"avatarUrl"`
		}
		if !decode(w, r, &input) {
			return
		}
		chat, err := h.service.UpdateChat(r.Context(), current.ID, chatID, input.Title, input.Description, input.AvatarURL)
		respondChat(w, r, chat, err)
	case suffix == "" && r.Method == http.MethodDelete:
		err := h.service.DeleteChat(r.Context(), current.ID, chatID)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "delete failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
	case suffix == "/members" && r.Method == http.MethodGet:
		members, err := h.service.Members(r.Context(), current.ID, chatID)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "members fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"members": members})
	case suffix == "/members" && r.Method == http.MethodPost:
		var input struct {
			UserID string `json:"userId"`
		}
		if !decode(w, r, &input) {
			return
		}
		respondSuccess(w, r, h.service.AddMember(r.Context(), current.ID, chatID, input.UserID))
	case suffix == "/members-online" && r.Method == http.MethodGet:
		ids, err := h.service.MembersOnline(r.Context(), current.ID, chatID)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "fetch failed")
			return
		}
		if ids == nil {
			ids = []string{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"onlineUserIds": ids})
	case suffix == "/bans" && r.Method == http.MethodGet:
		bans, err := h.service.ListBans(r.Context(), current.ID, chatID)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "fetch failed")
			return
		}
		if bans == nil {
			bans = []Ban{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"bans": bans})
	case strings.HasPrefix(suffix, "/members/"):
		memberID, action := parseMemberAction(suffix)
		if memberID == "" {
			methodNotAllowed(w, r)
			return
		}
		if action == "/role" && r.Method == http.MethodPost {
			var input struct {
				Role string `json:"role"`
			}
			if !decode(w, r, &input) {
				return
			}
			respondSuccess(w, r, h.service.SetMemberRole(r.Context(), current.ID, chatID, memberID, input.Role))
			return
		}
		if action == "/ban" && r.Method == http.MethodPost {
			var input struct {
				Reason string `json:"reason"`
			}
			_ = decode(w, r, &input)
			respondSuccess(w, r, h.service.BanMember(r.Context(), current.ID, chatID, memberID, input.Reason))
			return
		}
		if action == "/unban" && r.Method == http.MethodPost {
			respondSuccess(w, r, h.service.UnbanMember(r.Context(), current.ID, chatID, memberID))
			return
		}
		if action == "/mute" && r.Method == http.MethodPost {
			respondSuccess(w, r, h.service.MuteMember(r.Context(), current.ID, chatID, memberID))
			return
		}
		if action == "/unmute" && r.Method == http.MethodPost {
			respondSuccess(w, r, h.service.UnmuteMember(r.Context(), current.ID, chatID, memberID))
			return
		}
		if action == "" && r.Method == http.MethodDelete {
			respondSuccess(w, r, h.service.RemoveMember(r.Context(), current.ID, chatID, memberID))
			return
		}
		methodNotAllowed(w, r)
	case suffix == "/mls-state" && r.Method == http.MethodGet:
		if ok, err := h.service.IsMember(r.Context(), current.ID, chatID); err != nil || !ok {
			if err != nil {
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "membership check failed")
				return
			}
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		epoch, treeState, err := h.service.GetMlsState(r.Context(), chatID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "mls state fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"state": map[string]any{"chatId": chatID, "epoch": epoch, "groupState": treeState}})
	case suffix == "/pin" && (r.Method == http.MethodPost || r.Method == http.MethodDelete):
		respondSuccess(w, r, h.service.SetFlag(r.Context(), current.ID, chatID, "pin", r.Method == http.MethodPost))
	case suffix == "/archive" && (r.Method == http.MethodPost || r.Method == http.MethodDelete):
		respondSuccess(w, r, h.service.SetFlag(r.Context(), current.ID, chatID, "archive", r.Method == http.MethodPost))
	case suffix == "/read" && r.Method == http.MethodPost:
		respondSuccess(w, r, h.service.MarkRead(r.Context(), current.ID, chatID))
	default:
		methodNotAllowed(w, r)
	}
}

func (h *Handler) CallRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	var input struct {
		Type     string `json:"type"`
		ChatID   string `json:"chatId"`
		Title    string `json:"title"`
		CallKind string `json:"callKind"`
	}
	if !decode(w, r, &input) {
		return
	}
	current := authctx.MustUser(r)
	if input.CallKind == "" {
		input.CallKind = "video"
	}
	roomID, err := h.service.CreateCallRoom(r.Context(), current.ID, input.ChatID, input.Type, input.CallKind, input.Title)
	if errors.Is(err, ErrForbidden) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "room creation failed")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"room": map[string]string{
			"id":       roomID,
			"type":     input.Type,
			"chatId":   input.ChatID,
			"title":    input.Title,
			"callKind": input.CallKind,
			"hostId":   current.ID,
		},
		"iceServers":      getIceServers(),
		"maxParticipants": maxCallParticipants,
	})
}

type IceServer struct {
	URLs       interface{} `json:"urls"`
	Username   string      `json:"username,omitempty"`
	Credential string      `json:"credential,omitempty"`
}

func getIceServers() []IceServer {
	servers := []IceServer{
		{URLs: "stun:stun.l.google.com:19302"},
		{URLs: "stun:stun1.l.google.com:19302"},
		{URLs: "stun:stun2.l.google.com:19302"},
	}
	if turnURL := config.Value("TURN_URL", ""); turnURL != "" {
		servers = append(servers, IceServer{
			URLs:       turnURL,
			Username:   config.Value("TURN_USERNAME", ""),
			Credential: config.Value("TURN_CREDENTIAL", ""),
		})
	}
	return servers
}

func (h *Handler) IceServers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r)
		return
	}
	servers := getIceServers()
	hasTurn := false
	for _, s := range servers {
		if str, ok := s.URLs.(string); ok && strings.HasPrefix(str, "turn:") {
			hasTurn = true
			break
		}
	}
	meteredConfigured := config.Value("METERED_API_KEY", "") != "" && config.Value("METERED_DOMAIN", "") != ""
	httpx.JSON(w, http.StatusOK, map[string]any{
		"servers":           servers,
		"hasTurn":           hasTurn,
		"meteredConfigured": meteredConfigured,
		"meteredTest":       nil,
	})
}

func (h *Handler) GetRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r)
		return
	}
	roomID := r.PathValue("id")
	room := h.service.CallRooms().GetRoomPublic(roomID)
	if room == nil {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "room_not_found", "Room not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success":         true,
		"room":            room,
		"iceServers":      getIceServers(),
		"maxParticipants": maxCallParticipants,
	})
}

func (h *Handler) ListRooms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r)
		return
	}
	rooms := h.service.CallRooms().ListRoomsPublic()
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"rooms":   rooms,
	})
}

func respondChat(w http.ResponseWriter, r *http.Request, chat Chat, err error) {
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "chat fetch failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"chat": chat})
}

func respondSuccess(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
		return
	}
	if errors.Is(err, ErrForbidden) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "operation failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) MessagesRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		ChatID     string   `json:"chatId"`
		MessageIDs []string `json:"messageIds"`
	}
	if !decode(w, r, &input) {
		return
	}
	err := h.service.MarkRead(r.Context(), current.ID, input.ChatID)
	respondSuccess(w, r, err)
}

func (h *Handler) Messages(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	// Handle special non-ID routes first.
	if r.URL.Path == "/api/v2/messages/search" && r.Method == http.MethodGet {
		q := r.URL.Query().Get("q")
		if q == "" {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "q parameter required")
			return
		}
		limit := 50
		if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
			limit = l
		}
		msgs, err := h.service.SearchMessages(r.Context(), current.ID, q, limit)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "search failed")
			return
		}
		if msgs == nil {
			msgs = []Message{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"messages": msgs})
		return
	}
	if r.URL.Path == "/api/v2/messages/favorites" && r.Method == http.MethodGet {
		limit, offset := 50, 0
		if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
			limit = l
		}
		if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
			offset = o
		}
		msgs, err := h.service.ListFavorites(r.Context(), current.ID, limit, offset)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "favorites fetch failed")
			return
		}
		if msgs == nil {
			msgs = []Message{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"messages": msgs})
		return
	}

	targetID, suffix := parseMessagePath(r.URL.Path)

	switch {
	case targetID == "":
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	case suffix == "" && r.Method == http.MethodGet:
		limit := 50
		offset := 0
		if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
			limit = l
		}
		if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
			offset = o
		}
		msgs, err := h.service.ListMessages(r.Context(), current.ID, targetID, limit, offset)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list messages")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"messages": msgs})
	case suffix == "" && r.Method == http.MethodPost:
		var input struct {
			Content string  `json:"content"`
			Type    string  `json:"type"`
			ReplyTo *string `json:"replyTo"`
		}
		if !decode(w, r, &input) {
			return
		}
		if input.Type == "" {
			input.Type = "text"
		}
		msg, err := h.service.SendMessage(r.Context(), current.ID, targetID, input.Content, input.Type, input.ReplyTo)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to send message")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"message": msg})
	case suffix == "" && r.Method == http.MethodPut:
		var input struct {
			Content string `json:"content"`
		}
		if !decode(w, r, &input) {
			return
		}
		msg, err := h.service.EditMessage(r.Context(), current.ID, targetID, input.Content)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to edit message")
			return
		}
		httpx.JSON(w, http.StatusOK, msg)
	case suffix == "" && r.Method == http.MethodDelete:
		err := h.service.DeleteMessage(r.Context(), current.ID, targetID)
		respondSuccess(w, r, err)
	case suffix == "/forward" && r.Method == http.MethodPost:
		var input struct {
			TargetChatID string `json:"targetChatId"`
		}
		if !decode(w, r, &input) {
			return
		}
		msg, err := h.service.ForwardMessage(r.Context(), current.ID, targetID, input.TargetChatID)
		if errors.Is(err, ErrNotFound) {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "message not found")
			return
		}
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "forward failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"message": msg})
	case suffix == "/reactions" && r.Method == http.MethodGet:
		reactions, err := h.service.ListReactions(r.Context(), current.ID, targetID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list reactions")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"reactions": reactions})
	case suffix == "/reactions" && r.Method == http.MethodPost:
		var input struct {
			Emoji string `json:"emoji"`
		}
		if !decode(w, r, &input) {
			return
		}
		added, reactions, err := h.service.ToggleReaction(r.Context(), current.ID, targetID, input.Emoji)
		if errors.Is(err, ErrNotFound) {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "message not found")
			return
		}
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "emoji required")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "reaction failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"added": added, "reactions": reactions})
	case suffix == "/favorite" && (r.Method == http.MethodPost || r.Method == http.MethodDelete):
		added, err := h.service.ToggleFavorite(r.Context(), current.ID, targetID)
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "favorite failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"favorited": added})
	default:
		methodNotAllowed(w, r)
	}
}

func (h *Handler) Pins(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID, suffix := parseChatPath(r.URL.Path)
	if chatID == "" || suffix != "/pins" && !strings.HasPrefix(suffix, "/pins/") {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
		return
	}

	if suffix == "/pins" && r.Method == http.MethodGet {
		pins, err := h.service.ListPins(r.Context(), current.ID, chatID)
		if errors.Is(err, ErrForbidden) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			return
		}
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "pins fetch failed")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"pins": pins})
		return
	}

	messageID := strings.TrimPrefix(suffix, "/pins/")
	if messageID == "" || messageID == suffix {
		methodNotAllowed(w, r)
		return
	}
	switch r.Method {
	case http.MethodPost:
		respondSuccess(w, r, h.service.PinMessage(r.Context(), current.ID, chatID, messageID))
	case http.MethodDelete:
		respondSuccess(w, r, h.service.UnpinMessage(r.Context(), current.ID, chatID, messageID))
	default:
		methodNotAllowed(w, r)
	}
}

func parseMessagePath(path string) (string, string) {
	rest := strings.TrimPrefix(path, "/api/v2/messages/")
	if rest == path || rest == "" {
		return "", ""
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], "/" + parts[1]
}

func parseChatPath(path string) (string, string) {
	rest := strings.TrimPrefix(path, "/api/v2/chats/")
	if rest == path || rest == "" {
		return "", ""
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], "/" + parts[1]
}

func parseMemberAction(suffix string) (string, string) {
	rest := strings.TrimPrefix(suffix, "/members/")
	if rest == suffix || rest == "" {
		return "", ""
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], "/" + parts[1]
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(value); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	return true
}

func randomID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "room"
	}
	return hex.EncodeToString(bytes[:])
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}
