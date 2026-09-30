package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	service *Service
}

var validate *validator.Validate

func init() {
	validate = validator.New()
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// List handles GET /api/v2/chats and returns the chats of the
// authenticated user.
//
// The optional "archived" query parameter accepts exactly "true" or
// "false". Any other value, an empty value, or a duplicated parameter
// results in 400 with code "validation_failed".
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	const method = "List"

	if r.Method != http.MethodGet {
		methodNotAllowed(w, r)
		return
	}

	// Safe to call: the route is registered behind the authentication
	// middleware, so the user is always present in the request context.
	current := authctx.MustUser(r)

	archived, err := parseArchived(r.URL.Query())
	if err != nil {
		slog.WarnContext(r.Context(), "invalid archived parameter",
			"layer", "handler",
			"method", method,
			"err", err,
			"user_id", current.ID,
			"raw_query", r.URL.RawQuery,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid archived parameter")
		return
	}

	chats, err := h.service.List(r.Context(), current.ID, archived)
	if err != nil {
		slog.ErrorContext(r.Context(), "list chats failed",
			"layer", "handler",
			"method", method,
			"err", err,
			"user_id", current.ID,
			"archived", archived,
		)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "chat list failed")
		return
	}

	// Return a JSON array even when the list is empty, so the client
	// never has to distinguish between null and [].
	if chats == nil {
		chats = []Chat{}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"chats": chats})
}

// parseArchived extracts and validates the optional "archived" query
// parameter. It returns false when the parameter is absent.
//
// Only the exact lowercase literals "true" and "false" are accepted,
// matching the OpenAPI contract. Alternative boolean representations
// understood by strconv.ParseBool ("1", "t", "TRUE", ...) are rejected
// to keep the contract unambiguous.
func parseArchived(q url.Values) (bool, error) {
	values, ok := q["archived"]
	if !ok {
		return false, nil
	}
	if len(values) != 1 {
		return false, errors.New(`query parameter "archived" must be specified exactly once`)
	}

	switch values[0] {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf(`query parameter "archived" must be "true" or "false", got %q`, values[0])
	}
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

// CreateGroup handles POST /api/v2/chats/groups. It creates a new group
// chat owned by the authenticated user.
//
// The title is trimmed of leading and trailing whitespace before
// validation and storage; an all-whitespace title is rejected. The
// maxTitleLen limit applies to the trimmed value, and the members list
// must not be empty.
//
// On success it returns 201 with the new chat ID and the stored title.
func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	const method = "CreateGroup"

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
		return // decode logs internally
	}

	// Trim before validating: a value that is only too long because of
	// surrounding whitespace must be accepted, and the service must
	// receive the same value that was validated.
	title := strings.TrimSpace(input.Title)
	description := strings.TrimSpace(input.Description)
	avatarUrl := strings.TrimSpace(input.AvatarURL)

	if title == "" {
		slog.WarnContext(r.Context(), "group title is empty after trimming",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "title is required")
		return
	}

	if utf8.RuneCountInString(title) > maxTitleLen {
		slog.WarnContext(r.Context(), "group title exceeds maximum length",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
			"length", utf8.RuneCountInString(title),
			"max", maxTitleLen,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("title exceeds maximum length of %d characters", maxTitleLen))
		return
	}

	if len(input.Members) == 0 {
		slog.WarnContext(r.Context(), "group members list is empty",
			"layer", "handler",
			"method", method,
			"user_id", current.ID,
		)
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "members must not be empty")
		return
	}

	chatID, err := h.service.CreateGroup(
		r.Context(),
		current.ID,
		title,
		description,
		avatarUrl,
		input.Members,
	)

	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
	case err != nil:
		// The service logs the underlying error with full context;
		// logging here would duplicate the entry.
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "group creation failed")
	default:
		httpx.JSON(w, http.StatusCreated, map[string]any{
			"chatId": chatID,
			"title":  title,
		})
	}
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
		member, err := h.service.AddMember(r.Context(), current.ID, chatID, input.UserID)
		switch {
		case errors.Is(err, ErrInvalidInput):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
		case errors.Is(err, ErrNotFound):
			httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", err.Error())
		case errors.Is(err, ErrInvalidChatType):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", err.Error())
		case errors.Is(err, ErrUserNotFound):
			httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", err.Error())
		case errors.Is(err, ErrForbidden):
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		case errors.Is(err, ErrAlreadyMember):
			httpx.ErrorJSON(w, r, http.StatusConflict, "already_member", err.Error())
		case errors.Is(err, ErrUserBanned):
			httpx.ErrorJSON(w, r, http.StatusConflict, "user_banned", err.Error())
		case err != nil:
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to add member")
		default:
			response := MemberAddedEvent{
				Type:   "chat_member_added",
				ChatID: chatID,
				Member: member,
			}
			httpx.JSON(w, http.StatusCreated, response)
		}
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
		if errors.Is(err, ErrInvalidInput) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid input")
			return
		}
		if errors.Is(err, ErrInvalidChatType) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", err.Error())
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
	case suffix == "/leave" && r.Method == http.MethodPost:
		err := h.service.LeaveChat(r.Context(), current.ID, chatID)
		switch {
		case errors.Is(err, ErrInvalidInput):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
		case errors.Is(err, ErrForbidden):
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		case errors.Is(err, ErrOwnershipTransferRequired):
			httpx.ErrorJSON(w, r, http.StatusConflict, "ownership_transfer_required", err.Error())
		case err != nil:
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to leave chat")
		default:
			httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
		}
	// POST /api/v2/chats/{id}/transfer-ownership — передача владения чатом.
	// Разрешена только для групповых чатов (type = 'group')
	case suffix == "/transfer-ownership" && r.Method == http.MethodPost:
		var input struct {
			UserID string `json:"userId"`
		}
		if !decode(w, r, &input) {
			return
		}
		err := h.service.TransferOwnership(r.Context(), current.ID, chatID, input.UserID)
		switch {
		case errors.Is(err, ErrInvalidInput):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
		case errors.Is(err, ErrForbidden):
			httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		case errors.Is(err, ErrNotMember):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "not_member", err.Error())
		case errors.Is(err, ErrNotFound):
			httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", err.Error())
		case errors.Is(err, ErrOwnershipConflict):
			httpx.ErrorJSON(w, r, http.StatusConflict, "ownership_conflict", err.Error())
		// Операция применима только к group chat; private и channel отклоняются (CHAT-B006)
		case errors.Is(err, ErrInvalidChatType):
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", err.Error())
		case err != nil:
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "transfer ownership failed")
		default:
			httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
		}
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
				BannedUntil *time.Time `json:"bannedUntil"`
				Reason      string     `json:"reason"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&input); err != nil {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid ban body")
				return
			}
			respondSuccess(w, r, h.service.BanMember(r.Context(), current.ID, chatID, memberID, input.BannedUntil, input.Reason))
			return
		}
		if action == "/unban" && r.Method == http.MethodPost {
			respondSuccess(w, r, h.service.UnbanMember(r.Context(), current.ID, chatID, memberID))
			return
		}
		if action == "/mute" && r.Method == http.MethodPost {
			var input struct {
				MutedUntil *time.Time `json:"mutedUntil"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&input); err != nil {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid mute body")
				return
			}
			err := h.service.MuteMember(r.Context(), current.ID, chatID, memberID, input.MutedUntil)
			if errors.Is(err, ErrNotFound) {
				httpx.ErrorJSON(w, r, http.StatusNotFound, "member_not_found", "member not found")
				return
			}
			respondSuccess(w, r, err)
			return
		}
		if action == "/unmute" && r.Method == http.MethodPost {
			err := h.service.UnmuteMember(r.Context(), current.ID, chatID, memberID)
			if errors.Is(err, ErrNotFound) {
				httpx.ErrorJSON(w, r, http.StatusNotFound, "member_not_found", "member not found")
				return
			}
			respondSuccess(w, r, err)
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
	case suffix == "/messages/delete" && r.Method == http.MethodPost:
		h.deleteMessages(w, r, current.ID, chatID)
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
	if errors.Is(err, ErrInvalidChatType) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", "calls are not available in self chats")
		return
	}
	if errors.Is(err, ErrBlockedByUser) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "blocked_by_user", "you are blocked by this user")
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
	if metered := fetchMeteredIceServers(); len(metered) > 0 {
		return metered
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

func fetchMeteredIceServers() []IceServer {
	apiKey := config.Value("METERED_API_KEY", "")
	domain := config.Value("METERED_DOMAIN", "")
	if apiKey == "" || domain == "" {
		return nil
	}
	client := http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("https://" + domain + "/api/v2/turn/credentials?apiKey=" + url.QueryEscape(apiKey))
	if err != nil {
		slog.Warn("fetch metered turn credentials failed", "err", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Warn("fetch metered turn credentials failed", "status", resp.StatusCode)
		return nil
	}
	var servers []IceServer
	if err := json.NewDecoder(resp.Body).Decode(&servers); err != nil {
		slog.Warn("decode metered turn credentials failed", "err", err)
		return nil
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
	// Комната — только участнику её чата (#848). Чужому — тот же 404, что
	// и на несуществующую: не раскрываем, что комната есть.
	if room == nil {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "room_not_found", "Room not found")
		return
	}
	current := authctx.MustUser(r)
	if member, err := h.service.IsMember(r.Context(), current.ID, room.ChatID); err != nil || !member {
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
	if errors.Is(err, ErrInvalidChatType) {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_chat_type", "invalid chat type")
		return
	}
	if errors.Is(err, ErrMemberNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "member_not_found", "member not found")
		return
	}
	if errors.Is(err, ErrStateUnchanged) {
		httpx.ErrorJSON(w, r, http.StatusConflict, "state_not_changed", "state was not changed")
		return
	}
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "resource not found")
		return
	}
	if errors.Is(err, ErrCannotModerateTarget) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "cannot_moderate_target", "cannot moderate target")
		return
	}
	if errors.Is(err, ErrUserNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "user_not_found", "user not found")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "operation failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
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
	if targetID == "" {
		httpx.ErrorJSON(
			w, r,
			http.StatusNotFound,
			"route_not_found",
			"route not found",
		)
		return
	}

	if err := validate.Var(targetID, "required,uuid"); err != nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid messageId",
		)
		return
	}

	switch {
	case suffix == "/reactions" && r.Method == http.MethodPost:
		var input struct {
			Emoji string `json:"emoji"`
		}
		if !decode(w, r, &input) {
			return
		}
		// Call the service layer to toggle the user's reaction on the target message.
		// Returns the operation status, the current emoji after toggling, the updated reaction list, and any error.
		status, currentEmoji, reactions, err := h.service.ToggleReaction(r.Context(), current.ID, targetID, input.Emoji)

		if err != nil {
			// Handle known domain errors with appropriate HTTP status codes and user-friendly messages.
			switch {
			case errors.Is(err, ErrNotFound):
				// The target message does not exist or was deleted.
				httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "message not found")
			case errors.Is(err, ErrForbidden):
				// The current user is not a member of the chat, so they cannot react.
				httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
			case errors.Is(err, ErrInvalidInput):
				// The provided emoji is empty or contains invalid characters.
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "emoji required")
			default:
				// Any unexpected error (e.g., database failures) is treated as internal server error.
				log.Printf("[chat-handler-Messages]:unexpected error toggling reaction:%v", err)
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "reaction failed")
			}
			return
		}

		// Success: return the action result, the current emoji (empty if removed), and the aggregated reaction list.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"action":       status,       // "added", "removed", or "replaced"
			"currentEmoji": currentEmoji, // the emoji the user has after the toggle, or "" if removed
			"reactions":    reactions,    // full list of emoji counts with myReaction flags
		})
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

	pinsData := PinsData{ChatID: chatID, MessageID: messageID}

	if err := validate.Struct(pinsData); err != nil {
		if _, ok := err.(validator.ValidationErrors); ok {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_input", "invalid chatId or messageId")
			return
		}
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "validation failed")
		return
	}

	switch r.Method {
	case http.MethodPost:
		respondSuccess(w, r, h.service.PinMessage(r.Context(), current.ID, pinsData.ChatID, pinsData.MessageID))
	case http.MethodDelete:
		respondSuccess(w, r, h.service.UnpinMessage(r.Context(), current.ID, pinsData.ChatID, pinsData.MessageID))
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
	return decodeLimited(w, r, value, 256<<10)
}

// decodeLimited — decode со своим пределом тела: отправке пачкой общего не хватает.
func decodeLimited(w http.ResponseWriter, r *http.Request, value any, limit int64) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(value); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return false
	}
	return true
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}
