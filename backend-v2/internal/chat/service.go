package chat

import (
	"context"
	"craneapp/backend-v2/internal/presence"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"log/slog"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrNotFound                  = errors.New("chat not found")
	ErrForbidden                 = errors.New("access denied")
	ErrInvalidInput              = errors.New("invalid input")
	ErrUserNotFound              = errors.New("user not found")
	ErrBlockedByUser             = errors.New("blocked by user")
	ErrInvalidChatType           = errors.New("invalid chat type")
	ErrAlreadyMember             = errors.New("user already in group")
	ErrUserBanned                = errors.New("user is banned")
	ErrOwnershipTransferRequired = errors.New("ownership transfer required")
	ErrNotMember                 = errors.New("user is not a member")
	ErrOwnershipConflict         = errors.New("ownership changed concurrently")
	ErrMemberNotFound            = errors.New("member not found")
	ErrStateUnchanged            = errors.New("state unchanged")
	ErrMemberMuted               = errors.New("member is muted")
	ErrCannotModerateTarget      = errors.New("cannot moderate target")
	ErrStickerCannotBeEdited     = errors.New("sticker cannot be edited")
)

type Chat struct {
	ID            string              `json:"id"`
	Type          string              `json:"type"`
	Title         string              `json:"title"`
	Description   string              `json:"description"`
	AvatarURL     string              `json:"avatarUrl"`
	PeerPublicKey string              `json:"peerPublicKey,omitempty"`
	PeerID        string              `json:"peerId,omitempty"`
	PeerIsOnline  bool                `json:"peerIsOnline,omitempty"`
	PeerLastSeen  string              `json:"peerLastSeen,omitempty"`
	OwnerID       string              `json:"ownerId"`
	Role          string              `json:"role"`
	IsPinned      bool                `json:"isPinned"`
	IsArchived    bool                `json:"isArchived"`
	LastReadAt    string              `json:"lastReadAt,omitempty"`
	CreatedAt     string              `json:"createdAt"`
	UpdatedAt     string              `json:"updatedAt"`
	MemberCount   int                 `json:"memberCount"`
	LastMessageAt string              `json:"lastMessageAt,omitempty"`
	UnreadCount   int                 `json:"unreadCount"`
	LastMessage   *LastMessagePreview `json:"lastMessage,omitempty"`
}

type LastMessagePreview struct {
	ID         string     `json:"id"`
	Content    string     `json:"content"`
	Type       string     `json:"type"`
	SenderID   string     `json:"senderId,omitempty"`
	SenderName string     `json:"senderName"`
	Reactions  []Reaction `json:"reactions"`
}

type Member struct {
	ID          string         `json:"id"`
	Username    string         `json:"username"`
	FirstName   string         `json:"firstName"`
	LastName    string         `json:"lastName"`
	AvatarURL   string         `json:"avatarUrl"`
	Role        string         `json:"role"`
	Permissions map[string]any `json:"permissions"`
	MutedUntil  string         `json:"mutedUntil,omitempty"`
	MutedAt     string         `json:"mutedAt,omitempty"`
	JoinedAt    string         `json:"joinedAt"`
}

type Message struct {
	ID                  string         `json:"id"`
	ChatID              string         `json:"chatId"`
	SenderID            string         `json:"senderId"`
	SenderName          string         `json:"senderName,omitempty"`
	SenderFirstName     string         `json:"senderFirstName"`
	SenderAvatar        string         `json:"senderAvatar,omitempty"`
	Content             string         `json:"content"`
	Type                string         `json:"type"`
	ReplyTo             *string        `json:"replyTo,omitempty"`
	ReplyToMessageID    *string        `json:"replyToMessageId,omitempty"`
	ReplySenderName     string         `json:"replySenderName,omitempty"`
	ReplyToSenderName   string         `json:"replyToSenderName,omitempty"`
	Reactions           []Reaction     `json:"reactions"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	IsForwarded         bool           `json:"isForwarded"`
	ForwardedSenderName string         `json:"forwardedSenderName,omitempty"`
	IsPinned            bool           `json:"isPinned"`
	IsEdited            bool           `json:"isEdited"`
	CreatedAt           string         `json:"createdAt"`
	UpdatedAt           string         `json:"updatedAt"`
	DeletedAt           *string        `json:"deletedAt,omitempty"`
}

type Service struct {
	db *sql.DB
	ws realtimeServer
	// presence — единый источник online-состояния (Redis Store); nil, если presence не используется.
	presence presence.Store
}

type realtimeServer interface {
	CallRooms() *CallRoomManager
	IsUserConnected(userID string) bool
	BroadcastToChat(chatID string, message []byte, excludeUserID string)
	BroadcastToUsers(userIDs []string, message []byte)
}

const (
	maxMediaFilenameBytes = 255
	maxMediaSizeBytes     = 100 << 20
)

func sanitizeMediaFilename(filename string) string {
	filename = path.Base(strings.ReplaceAll(strings.TrimSpace(filename), `\`, "/"))
	if filename == "." || filename == "/" {
		return ""
	}
	for len(filename) > maxMediaFilenameBytes {
		_, size := utf8.DecodeLastRuneInString(filename)
		filename = filename[:len(filename)-size]
	}
	return filename
}

// ValidateMediaMetadata canonicalises client metadata and verifies local,
// unencrypted uploads against the media record before it is put in a message.
func (s *Service) ValidateMediaMetadata(ctx context.Context, mediaURL, fileName string, sizeBytes int64, encrypted bool) (string, int64, error) {
	if sizeBytes < 0 || sizeBytes > maxMediaSizeBytes {
		return "", 0, ErrInvalidInput
	}
	fileName = sanitizeMediaFilename(fileName)
	uploadID := strings.TrimPrefix(mediaURL, "/api/v2/media/")
	if uploadID == mediaURL || uploadID == "" || strings.Contains(uploadID, "/") {
		return fileName, sizeBytes, nil
	}

	var storedName string
	var storedSize int64
	var storedEncrypted bool
	err := s.db.QueryRowContext(ctx, `
		SELECT filename, size_bytes, is_encrypted
		FROM media.uploads WHERE id = $1
	`, uploadID).Scan(&storedName, &storedSize, &storedEncrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrInvalidInput
	}
	if err != nil {
		return "", 0, err
	}
	storedName = sanitizeMediaFilename(storedName)
	if storedName != "" {
		if fileName != "" && fileName != storedName {
			return "", 0, ErrInvalidInput
		}
		fileName = storedName
	}
	if !storedEncrypted && !encrypted {
		// A zero value keeps older clients working; the canonical stored size is
		// still used. Any explicitly supplied non-zero value must match exactly.
		if sizeBytes != 0 && sizeBytes != storedSize {
			return "", 0, ErrInvalidInput
		}
		sizeBytes = storedSize
	}
	return fileName, sizeBytes, nil
}

func NewService(db *sql.DB, ws realtimeServer, presence presence.Store) *Service {
	return &Service{db: db, ws: ws, presence: presence}
}

func (s *Service) hydrateMessageFields(ctx context.Context, msg *Message) error {
	msg.SenderFirstName = msg.SenderName
	if msg.ReplyTo != nil {
		msg.ReplyToMessageID = msg.ReplyTo
		var name string
		err := s.db.QueryRowContext(ctx, `
				SELECT COALESCE(up.first_name, au.first_name, au.username, '')
				FROM messages.messages m
				LEFT JOIN auth.users au ON au.id = m.sender_id
				LEFT JOIN users.profiles up ON up.user_id = m.sender_id
				WHERE m.id = $1 AND m.chat_id = $2 AND m.deleted_at IS NULL
			`, *msg.ReplyTo, msg.ChatID).Scan(&name)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		msg.ReplySenderName = name
		msg.ReplyToSenderName = name
	}
	if msg.Metadata != nil {
		if forwardedFrom, ok := msg.Metadata["forwardedFrom"].(string); ok && forwardedFrom != "" {
			msg.IsForwarded = true
			if name, ok := msg.Metadata["forwardedSenderName"].(string); ok {
				msg.ForwardedSenderName = name
			}
			if msg.ForwardedSenderName == "" {
				_ = s.db.QueryRowContext(ctx, `
					SELECT COALESCE(up.first_name, au.first_name, au.username, '')
					FROM messages.messages m
					LEFT JOIN auth.users au ON au.id = m.sender_id
					LEFT JOIN users.profiles up ON up.user_id = m.sender_id
					WHERE m.id::text = $1
				`, forwardedFrom).Scan(&msg.ForwardedSenderName)
			}
		}
	}
	return nil
}

func (s *Service) hydrateMessagesFields(ctx context.Context, messages []Message) error {
	for i := range messages {
		if err := s.hydrateMessageFields(ctx, &messages[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadReactionsByMessageIDs(ctx context.Context, userID string, messageIDs []string) (map[string][]Reaction, error) {
	reactionsByMessageID := make(map[string][]Reaction, len(messageIDs))

	if len(messageIDs) == 0 {
		return reactionsByMessageID, nil
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT message_id::text,
		       emoji,
		       COUNT(*) AS cnt,
		       BOOL_OR(user_id = $2) AS my_reaction
		FROM messages.reactions
		WHERE message_id = ANY($1::uuid[])
		GROUP BY message_id, emoji
		ORDER BY message_id, cnt DESC, emoji
	`, pq.Array(messageIDs), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var messageID string
		var reaction Reaction

		if err := rows.Scan(
			&messageID,
			&reaction.Emoji,
			&reaction.Count,
			&reaction.MyReaction,
		); err != nil {
			return nil, err
		}

		reactionsByMessageID[messageID] = append(reactionsByMessageID[messageID], reaction)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return reactionsByMessageID, nil
}

func (s *Service) hydrateMessagesReactions(ctx context.Context, userID string, messages []Message) error {
	messageIDs := make([]string, 0, len(messages))

	for i := range messages {
		messages[i].Reactions = []Reaction{}
		messageIDs = append(messageIDs, messages[i].ID)
	}

	reactionsByMessageID, err := s.loadReactionsByMessageIDs(ctx, userID, messageIDs)
	if err != nil {
		return err
	}

	for i := range messages {
		reactions, ok := reactionsByMessageID[messages[i].ID]
		if ok {
			messages[i].Reactions = reactions
		}
	}

	return nil
}

func (s *Service) hydrateChatsLastMessageReactions(ctx context.Context, userID string, chats []Chat) error {
	messageIDs := make([]string, 0, len(chats))

	for i := range chats {
		lastMessage := chats[i].LastMessage
		if lastMessage != nil && lastMessage.ID != "" {
			lastMessage.Reactions = []Reaction{}
			messageIDs = append(messageIDs, lastMessage.ID)
		}
	}

	reactionsByMessageID, err := s.loadReactionsByMessageIDs(ctx, userID, messageIDs)
	if err != nil {
		return err
	}

	for i := range chats {
		lastMessage := chats[i].LastMessage
		if lastMessage != nil && lastMessage.ID != "" {
			reactions, ok := reactionsByMessageID[lastMessage.ID]
			if ok {
				lastMessage.Reactions = reactions
			}
		}
	}
	return nil
}

func (s *Service) CallRooms() *CallRoomManager {
	return s.ws.CallRooms()
}

func (s *Service) List(ctx context.Context, userID string, archived bool) ([]Chat, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id::text, c.type,
		       CASE WHEN c.type = 'private' THEN
		         COALESCE(
		           NULLIF(TRIM(COALESCE(peer.first_name,'') ||
		             CASE WHEN COALESCE(peer.last_name,'') != '' THEN ' ' || peer.last_name ELSE '' END), ''),
		           peer.display_username
		         )
		       ELSE c.title END,
		       c.description,
		       CASE WHEN c.type = 'private' THEN COALESCE(peer.avatar_url, '') ELSE COALESCE(c.avatar_url, '') END,
		       c.owner_id::text, cm.role,
		       COALESCE(cs.is_pinned, FALSE), COALESCE(cs.is_archived, FALSE),
			       COALESCE(cs.last_read_at::text, ''), c.created_at::text, c.updated_at::text,
			       COUNT(DISTINCT cm_all.user_id)::int, COALESCE(MAX(m.created_at)::text, ''),
			       COALESCE(peer.peer_id, ''),
			       COALESCE(peer.is_online, FALSE), COALESCE(peer.last_seen, ''),
			       COUNT(DISTINCT m.id) FILTER (
			         WHERE (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
			           AND (m.sender_id IS NULL OR m.sender_id <> $1)
		       )::int,
		       COALESCE(lm.id::text, ''), COALESCE(lm.sender_id::text, ''), lm.content, lm.type, COALESCE(lm_up.first_name, lm_au.first_name, lm_au.username, '')
		FROM chats.chats c
		JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = $1
		LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = $1
		LEFT JOIN chats.members cm_all ON cm_all.chat_id = c.id
		LEFT JOIN messages.messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
		LEFT JOIN LATERAL (
		  SELECT au.id::text AS peer_id,
			         COALESCE(up.first_name, au.first_name, '') AS first_name,
			         COALESCE(up.last_name,  au.last_name,  '') AS last_name,
			         -- Приватность собеседника (#463): закрытые фото, статус и время
			         -- активности не раскрываются. «contacts» скрывает так же, как
			         -- «nobody» — контактов у нас нет; так же считает /users/{id}/status.
			         CASE WHEN COALESCE(ps.privacy_settings->>'photoVisibility', '') IN ('', 'all', 'everyone')
			              THEN COALESCE(up.avatar_url, '') ELSE '' END AS avatar_url,
			         au.username AS display_username,
			         -- «В сети» — живое WebSocket-подключение (#780): отметка свежее
			         -- presence.LeaseTTL (75 секунд).
			         COALESCE(ps.privacy_settings->>'lastSeen', '') IN ('', 'all', 'everyone')
			           AND COALESCE(pr.online AND pr.last_seen_at > NOW() - INTERVAL '75 seconds', FALSE) AS is_online,
			         CASE WHEN COALESCE(ps.privacy_settings->>'lastSeen', '') IN ('', 'all', 'everyone')
			              THEN COALESCE(to_char(pr.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
			              ELSE '' END AS last_seen
			  FROM chats.members pm
			  JOIN auth.users au ON au.id = pm.user_id
			  LEFT JOIN users.profiles up ON up.user_id = pm.user_id
			  LEFT JOIN users.settings ps ON ps.user_id = pm.user_id
			  LEFT JOIN users.presence pr ON pr.user_id = pm.user_id
		  WHERE pm.chat_id = c.id AND pm.user_id != $1
		  LIMIT 1
		) peer ON c.type = 'private'
		LEFT JOIN LATERAL (
		  SELECT id, sender_id, content, type
		  FROM messages.messages
		  WHERE chat_id = c.id AND deleted_at IS NULL
		  ORDER BY created_at DESC
		  LIMIT 1
		) lm ON TRUE
		LEFT JOIN auth.users lm_au ON lm_au.id = lm.sender_id
		LEFT JOIN users.profiles lm_up ON lm_up.user_id = lm.sender_id
			WHERE COALESCE(cs.is_archived, FALSE) = $2
			GROUP BY c.id, cm.role, cs.is_pinned, cs.is_archived, cs.last_read_at,
			         peer.peer_id, peer.first_name, peer.last_name, peer.avatar_url, peer.display_username,
			         peer.is_online, peer.last_seen,
			         lm.id, lm.sender_id, lm.content, lm.type, lm_up.first_name, lm_au.first_name, lm_au.username
		ORDER BY COALESCE(cs.is_pinned, FALSE) DESC, MAX(m.created_at) DESC NULLS LAST, c.updated_at DESC
	`, userID, archived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	chats, err := scanChats(rows)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateChatsLastMessageReactions(ctx, userID, chats); err != nil {
		return nil, err
	}
	return chats, nil
}

func (s *Service) Get(ctx context.Context, userID, chatID string) (Chat, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id::text, c.type,
		       CASE WHEN c.type = 'private' THEN
		         COALESCE(
		           NULLIF(TRIM(COALESCE(peer.first_name,'') ||
		             CASE WHEN COALESCE(peer.last_name,'') != '' THEN ' ' || peer.last_name ELSE '' END), ''),
		           peer.display_username
		         )
		       ELSE c.title END,
		       c.description,
		       CASE WHEN c.type = 'private' THEN COALESCE(peer.avatar_url, '') ELSE COALESCE(c.avatar_url, '') END,
		       c.owner_id::text, cm.role,
		       COALESCE(cs.is_pinned, FALSE), COALESCE(cs.is_archived, FALSE),
			       COALESCE(cs.last_read_at::text, ''), c.created_at::text, c.updated_at::text,
			       COUNT(DISTINCT cm_all.user_id)::int, COALESCE(MAX(m.created_at)::text, ''),
			       COALESCE(peer.peer_id, ''),
			       COALESCE(peer.is_online, FALSE), COALESCE(peer.last_seen, ''),
			       COUNT(DISTINCT m.id) FILTER (
			         WHERE (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
			           AND (m.sender_id IS NULL OR m.sender_id <> $1)
		       )::int,
		       COALESCE(lm.id::text, ''), COALESCE(lm.sender_id::text, ''), lm.content, lm.type, COALESCE(lm_up.first_name, lm_au.first_name, lm_au.username, '')
		FROM chats.chats c
		JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = $1
		LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = $1
		LEFT JOIN chats.members cm_all ON cm_all.chat_id = c.id
		LEFT JOIN messages.messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
		LEFT JOIN LATERAL (
		  SELECT au.id::text AS peer_id,
			         COALESCE(up.first_name, au.first_name, '') AS first_name,
			         COALESCE(up.last_name,  au.last_name,  '') AS last_name,
			         -- Приватность собеседника (#463): закрытые фото, статус и время
			         -- активности не раскрываются. «contacts» скрывает так же, как
			         -- «nobody» — контактов у нас нет; так же считает /users/{id}/status.
			         CASE WHEN COALESCE(ps.privacy_settings->>'photoVisibility', '') IN ('', 'all', 'everyone')
			              THEN COALESCE(up.avatar_url, '') ELSE '' END AS avatar_url,
			         au.username AS display_username,
			         -- «В сети» — живое WebSocket-подключение (#780): отметка свежее
			         -- presence.LeaseTTL (75 секунд).
			         COALESCE(ps.privacy_settings->>'lastSeen', '') IN ('', 'all', 'everyone')
			           AND COALESCE(pr.online AND pr.last_seen_at > NOW() - INTERVAL '75 seconds', FALSE) AS is_online,
			         CASE WHEN COALESCE(ps.privacy_settings->>'lastSeen', '') IN ('', 'all', 'everyone')
			              THEN COALESCE(to_char(pr.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
			              ELSE '' END AS last_seen
			  FROM chats.members pm
			  JOIN auth.users au ON au.id = pm.user_id
			  LEFT JOIN users.profiles up ON up.user_id = pm.user_id
			  LEFT JOIN users.settings ps ON ps.user_id = pm.user_id
			  LEFT JOIN users.presence pr ON pr.user_id = pm.user_id
		  WHERE pm.chat_id = c.id AND pm.user_id != $1
		  LIMIT 1
		) peer ON c.type = 'private'
		LEFT JOIN LATERAL (
		  SELECT id, sender_id, content, type
		  FROM messages.messages
		  WHERE chat_id = c.id AND deleted_at IS NULL
		  ORDER BY created_at DESC
		  LIMIT 1
		) lm ON TRUE
		LEFT JOIN auth.users lm_au ON lm_au.id = lm.sender_id
		LEFT JOIN users.profiles lm_up ON lm_up.user_id = lm.sender_id
			WHERE c.id = $2
			GROUP BY c.id, cm.role, cs.is_pinned, cs.is_archived, cs.last_read_at,
			         peer.peer_id, peer.first_name, peer.last_name, peer.avatar_url, peer.display_username,
			         peer.is_online, peer.last_seen,
			         lm.id, lm.sender_id, lm.content, lm.type, lm_up.first_name, lm_au.first_name, lm_au.username
	`, userID, chatID)
	if err != nil {
		return Chat{}, err
	}
	defer rows.Close()
	chats, err := scanChats(rows)
	if err != nil {
		return Chat{}, err
	}
	if len(chats) == 0 {
		return Chat{}, ErrNotFound
	}
	if err := s.hydrateChatsLastMessageReactions(ctx, userID, chats); err != nil {
		return Chat{}, err
	}
	chat := chats[0]
	if chat.Type == "private" {
		chat.PeerPublicKey, err = s.peerPublicKey(ctx, userID, chatID)
		if err != nil {
			return Chat{}, err
		}
	}
	return chat, nil
}

func (s *Service) getChatInfo(ctx context.Context, userID, chatID string) (string, string, error) {
	var chatType, role string
	err := s.db.QueryRowContext(ctx, `SELECT c.type, cm.role
	FROM chats.chats c JOIN chats.members cm ON cm.chat_id = c.id WHERE c.id = $2 AND cm.user_id = $1`, userID, chatID).Scan(&chatType, &role)

	return chatType, role, err
}

func (s *Service) CreatePrivate(ctx context.Context, userID, peerID string) (string, bool, error) {
	if peerID == "" || peerID == userID {
		return "", false, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return "", false, err
	}
	defer func() { _ = tx.Rollback() }()

	var peerExists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1 AND disabled_at IS NULL)`, peerID).Scan(&peerExists); err != nil {
		return "", false, err
	}
	if !peerExists {
		return "", false, ErrUserNotFound
	}
	var blocked bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users.blocked_users WHERE user_id = $1 AND blocked_user_id = $2)`, peerID, userID).Scan(&blocked); err != nil {
		return "", false, err
	}
	if blocked {
		return "", false, ErrBlockedByUser
	}

	var existingID string
	err = tx.QueryRowContext(ctx, `
		SELECT c.id::text FROM chats.chats c
		JOIN chats.members a ON a.chat_id = c.id AND a.user_id = $1
		JOIN chats.members b ON b.chat_id = c.id AND b.user_id = $2
		WHERE c.type = 'private'
		LIMIT 1
	`, userID, peerID).Scan(&existingID)
	if err == nil {
		return existingID, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}

	var chatID string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO chats.chats (type, title, owner_id)
		VALUES ('private', 'Private chat', $1)
		RETURNING id::text
	`, userID).Scan(&chatID); err != nil {
		return "", false, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO chats.members (chat_id, user_id, role)
		VALUES ($1, $2, 'owner'), ($1, $3, 'member')
	`, chatID, userID, peerID); err != nil {
		return "", false, err
	}
	return chatID, false, tx.Commit()
}

// CreateGroup creates a new group chat owned by ownerID and adds the
// given members. The owner is inserted with role "owner"; other members
// with role "member".
//
// All text fields (title, description, avatarURL) are trimmed of
// surrounding whitespace before validation and storage. An
// all-whitespace title, a title longer than maxTitleLen runes, or an
// empty members list results in ErrInvalidInput.
//
// All inserts run in a single transaction. On success it returns the ID
// of the newly created chat.
func (s *Service) CreateGroup(ctx context.Context, ownerID, title, description, avatarURL string, members []string) (string, error) {
	const method = "CreateGroup"

	title = strings.TrimSpace(title)
	description = strings.TrimSpace(description)
	avatarURL = strings.TrimSpace(avatarURL)

	// Duplicated in the handler, but kept here because the service is a
	// public boundary: callers other than the HTTP handler must not be
	// able to create a group with an invalid title or no members.
	if title == "" || len(members) == 0 {
		return "", ErrInvalidInput
	}
	if utf8.RuneCountInString(title) > maxTitleLen {
		return "", ErrInvalidInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		slog.ErrorContext(ctx, "failed to begin transaction",
			"layer", "service",
			"method", method,
			"err", err,
			"owner_id", ownerID,
		)
		return "", err
	}
	// Rollback is a no-op after Commit, so an explicit error check is
	// not useful here.
	defer func() { _ = tx.Rollback() }()

	var chatID string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO chats.chats (type, title, description, avatar_url, owner_id)
		VALUES ('group', $1, $2, $3, $4)
		RETURNING id::text
	`, title, description, avatarURL, ownerID).Scan(&chatID); err != nil {
		slog.ErrorContext(ctx, "failed to insert group chat",
			"layer", "service",
			"method", method,
			"err", err,
			"owner_id", ownerID,
		)
		return "", err
	}

	// The owner is always a member; tracking seen IDs here prevents
	// duplicates and lets the loop below skip ownerID if it appears in
	// the members slice.
	seen := map[string]bool{ownerID: true}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, $3)`,
		chatID, ownerID, "owner",
	); err != nil {
		slog.ErrorContext(ctx, "failed to insert owner as member",
			"layer", "service",
			"method", method,
			"err", err,
			"chat_id", chatID,
			"owner_id", ownerID,
		)
		return "", err
	}

	// The SELECT filters out unknown and disabled users; ON CONFLICT
	// covers a race with a concurrent insert of the same membership.
	for _, memberID := range members {
		if memberID == "" || seen[memberID] {
			continue
		}
		seen[memberID] = true

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO chats.members (chat_id, user_id, role)
			SELECT $1, id, $3 FROM auth.users WHERE id = $2 AND disabled_at IS NULL
			ON CONFLICT DO NOTHING
		`, chatID, memberID, "member"); err != nil {
			slog.ErrorContext(ctx, "failed to insert member into group",
				"layer", "service",
				"method", method,
				"err", err,
				"chat_id", chatID,
				"member_id", memberID,
			)
			return "", err
		}
	}

	if err := tx.Commit(); err != nil {
		slog.ErrorContext(ctx, "failed to commit transaction",
			"layer", "service",
			"method", method,
			"err", err,
			"chat_id", chatID,
			"owner_id", ownerID,
		)
		return "", err
	}

	return chatID, nil
}

// UpdateGroup updates the title, description, and/or avatar URL of a group
// chat. Nil arguments mean "leave unchanged"; non-nil values overwrite the
// stored value.
//
// The caller must be the chat owner or an admin. Returns ErrNotFound if the
// chat does not exist or the actor is not a member, ErrInvalidChatType if
// the chat is not a group, ErrForbidden if the actor lacks permission, and
// ErrInvalidInput if a provided field fails validation.
//
// On success it broadcasts a "chat_updated" event to all chat members when
// the WebSocket hub is configured.
func (s *Service) UpdateGroup(ctx context.Context, actorID, chatID string, title, description, avatarURL *string) (Chat, error) {
	const method = "UpdateGroup"

	var chatType, role string

	// Fetch chat type and the actor's role in a single round trip: both
	// are needed before any mutation, and combining them avoids a second
	// query that could race against concurrent membership changes.
	err := s.db.QueryRowContext(ctx, `
		SELECT c.type, m.role
		FROM chats.chats c
		JOIN chats.members m ON m.chat_id = c.id
		WHERE c.id = $1
		AND m.user_id = $2
	`, chatID, actorID).Scan(&chatType, &role)

	if errors.Is(err, sql.ErrNoRows) {
		// The join yields no rows both when the chat is missing and when
		// the actor is not a member; both cases map to ErrNotFound so we
		// do not leak chat existence to non-members.
		return Chat{}, ErrNotFound
	}

	if err != nil {
		slog.ErrorContext(ctx, "failed to query chat and role",
			"layer", "service",
			"method", method,
			"err", err,
			"chat_id", chatID,
			"actor_id", actorID,
		)
		return Chat{}, err
	}

	if title == nil && description == nil && avatarURL == nil {
		return Chat{}, ErrInvalidInput
	}

	// Normalize before validating. The handler already does this for
	// its own length check, but the service is a public boundary:
	// workers and scripts may call it directly and must not bypass
	// the invariant "no stored value has surrounding whitespace".
	title = trimString(title)
	description = trimString(description)
	avatarURL = trimString(avatarURL)

	if title != nil && *title == "" {
		return Chat{}, ErrInvalidInput
	}
	if title != nil && utf8.RuneCountInString(*title) > maxTitleLen {
		return Chat{}, ErrInvalidInput
	}

	if chatType != "group" {
		return Chat{}, ErrInvalidChatType
	}
	if role != "owner" && role != "admin" {
		return Chat{}, ErrForbidden
	}

	// COALESCE keeps the update idempotent for absent fields without
	// building dynamic SQL: a nil pointer becomes SQL NULL, which makes
	// COALESCE fall back to the existing column value.
	_, err = s.db.ExecContext(ctx, `
		UPDATE chats.chats
		SET title = COALESCE($1::text, title),
			description = COALESCE($2::text, description),
			avatar_url = COALESCE($3::text, avatar_url),
			updated_at = NOW()
		WHERE id = $4
		AND type = 'group'
	`, title, description, avatarURL, chatID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to update group chat",
			"layer", "service",
			"method", method,
			"err", err,
			"chat_id", chatID,
			"actor_id", actorID,
		)
		return Chat{}, err
	}

	updatedChat, err := s.Get(ctx, actorID, chatID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to reload chat after update",
			"layer", "service",
			"method", method,
			"err", err,
			"chat_id", chatID,
			"actor_id", actorID,
		)
		return Chat{}, err
	}

	if s.ws != nil {
		payload, err := json.Marshal(map[string]any{
			"type":   "chat_updated",
			"chatId": chatID,
			"chat":   updatedChat,
		})
		if err != nil {
			// Marshaling failure is non-fatal: the DB is already updated,
			// and rolling back here would only hide the real problem.
			// The event is dropped and the error is logged for visibility.
			slog.WarnContext(ctx, "failed to marshal chat_updated event",
				"layer", "service",
				"method", method,
				"err", err,
				"chat_id", chatID,
			)
		} else {
			s.ws.BroadcastToChat(chatID, payload, "")
		}
	}

	return updatedChat, nil
}

func (s *Service) DeleteChat(ctx context.Context, actorID, chatID string) error {
	role, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return ErrForbidden
	}

	_, err = s.db.ExecContext(ctx, `DELETE FROM chats.chats WHERE id = $1`, chatID)
	return err
}

func (s *Service) Members(ctx context.Context, userID, chatID string) ([]Member, error) {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT au.id::text, au.username, COALESCE(up.first_name, au.first_name), COALESCE(up.last_name, au.last_name),
		       COALESCE(up.avatar_url, ''), cm.role, cm.permissions, COALESCE(cm.muted_until::text, ''), COALESCE(cm.muted_at::text, ''), cm.joined_at::text
		FROM chats.members cm
		JOIN auth.users au ON au.id = cm.user_id
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE cm.chat_id = $1
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, au.username
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var members []Member
	for rows.Next() {
		var member Member
		var permissions jsonMap
		if err := rows.Scan(&member.ID, &member.Username, &member.FirstName, &member.LastName, &member.AvatarURL, &member.Role, &permissions, &member.MutedUntil, &member.MutedAt, &member.JoinedAt); err != nil {
			return nil, err
		}
		member.Permissions = map[string]any(permissions)
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Service) SetMemberRole(ctx context.Context, actorID, chatID, memberID, role string) error {
	if role != "admin" && role != "member" {
		return ErrInvalidInput
	}
	if actorID == memberID {
		return ErrForbidden
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" {
		return ErrForbidden
	}

	var memberRole string
	err = s.db.QueryRowContext(ctx, `
		SELECT role FROM chats.members
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, memberID).Scan(&memberRole)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMemberNotFound
	}
	if err != nil {
		return err
	}
	if memberRole == "owner" {
		return ErrForbidden
	}
	if memberRole == role {
		return nil
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE chats.members SET role = $1
		WHERE chat_id = $2 AND user_id = $3 AND role = $4
	`, role, chatID, memberID, memberRole)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrStateUnchanged
	}

	if s.ws != nil {
		payload, err := json.Marshal(MemberRoleUpdatedEvent{
			Type:   "chat_member_role_updated",
			ChatID: chatID,
			UserID: memberID,
			Role:   role,
		})
		if err != nil {
			slog.Error("failed to marshal member role event", "err", err, "chatID", chatID, "userID", memberID)
		} else {
			s.ws.BroadcastToChat(chatID, payload, "")
		}
	}
	return nil
}

func (s *Service) RemoveMember(ctx context.Context, actorID, chatID, memberID string) error {
	if actorID == memberID {
		return ErrForbidden
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}

	var memberRole string
	err = s.db.QueryRowContext(ctx, `
		SELECT role FROM chats.members
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, memberID).Scan(&memberRole)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMemberNotFound
	}
	if err != nil {
		return err
	}
	if memberRole == "owner" {
		return ErrForbidden
	}
	if actorRole == "admin" && memberRole != "member" {
		return ErrForbidden
	}

	result, err := s.db.ExecContext(ctx, `
		DELETE FROM chats.members
		WHERE chat_id = $1 AND user_id = $2 AND role = $3
	`, chatID, memberID, memberRole)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrStateUnchanged
	}

	if s.ws != nil {
		payload, err := json.Marshal(MemberRemovedEvent{
			Type:   "chat_member_removed",
			ChatID: chatID,
			UserID: memberID,
		})
		if err != nil {
			slog.Error("failed to marshal member removed event", "err", err, "chatID", chatID, "userID", memberID)
		} else {
			s.ws.BroadcastToChat(chatID, payload, "")
		}
	}
	return nil
}

func (s *Service) SetFlag(ctx context.Context, userID, chatID, flag string, value bool) error {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return err
		}
		return ErrForbidden
	}
	column := "is_pinned"
	timestampColumn := "pinned_at"
	if flag == "archive" {
		column = "is_archived"
		timestampColumn = "archived_at"
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO chats.user_chat_settings (user_id, chat_id, `+column+`, `+timestampColumn+`)
		VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END)
		ON CONFLICT (user_id, chat_id) DO UPDATE SET
			`+column+` = EXCLUDED.`+column+`,
			`+timestampColumn+` = EXCLUDED.`+timestampColumn+`
	`, userID, chatID, value)
	return err
}

func (s *Service) MarkRead(ctx context.Context, userID, chatID string) error {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return err
		}
		return ErrForbidden
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO chats.user_chat_settings (user_id, chat_id, last_read_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id, chat_id) DO UPDATE SET last_read_at = NOW()
	`, userID, chatID)
	return err
}

type Ban struct {
	UserID      string  `json:"userId"`
	Username    string  `json:"username"`
	FirstName   string  `json:"firstName"`
	Reason      string  `json:"reason"`
	BannedUntil *string `json:"bannedUntil,omitempty"`
	CreatedAt   string  `json:"createdAt"`
}

type MemberAddedEvent struct {
	Type   string  `json:"type"`
	ChatID string  `json:"chatId"`
	Member *Member `json:"member"`
}

type MemberRoleUpdatedEvent struct {
	Type   string `json:"type"`
	ChatID string `json:"chatId"`
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type addMemberInput struct {
	ChatID string `validate:"required,uuid"`
	UserID string `validate:"required,uuid"`
}

type muteMemberInput struct {
	ActorID string `validate:"required,uuid"`
	ChatID  string `validate:"required,uuid"`
	UserID  string `validate:"required,uuid"`
}

type MemberMuteEvent struct {
	Type       string     `json:"type"`
	ChatID     string     `json:"chatId"`
	UserID     string     `json:"userId"`
	ByUserID   string     `json:"byUserId"`
	MutedUntil *time.Time `json:"mutedUntil"`
}

// MemberBanEvent — событие ban/unban участника; Type различает
// (chat_member_banned / chat_member_unbanned). При unban поля Reason и
// BannedUntil пустые ("" и null) — клиенты должны их игнорировать.
type MemberBanEvent struct {
	Type        string     `json:"type"`
	ChatID      string     `json:"chatId"`
	UserID      string     `json:"userId"`
	ByUserID    string     `json:"byUserId"`
	Reason      string     `json:"reason"`
	BannedUntil *time.Time `json:"bannedUntil"`
}

func (s *Service) AddMember(ctx context.Context, actorID, chatID, userID string) (*Member, error) {
	// 1. Валидация входных данных
	input := addMemberInput{ChatID: chatID, UserID: userID}
	if err := validate.Struct(input); err != nil {
		return nil, ErrInvalidInput
	}

	// 2. Проверка прав актора
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return nil, err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return nil, ErrForbidden
	}

	// 3. Проверка типа чата
	var chatType string
	err = s.db.QueryRowContext(ctx, `SELECT type FROM chats.chats WHERE id = $1`, chatID).Scan(&chatType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if chatType != "group" {
		return nil, ErrInvalidChatType
	}

	// 4. Проверка существования и активности пользователя
	var exists bool
	err = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1 AND disabled_at IS NULL)`, userID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrUserNotFound
	}

	// 5. Транзакция: согласованная блокировка пары (chat, user) — та же
	// формула, что в BanMember, чтобы исключить гонку add/ban.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var lockDummy any
	if err := tx.QueryRowContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, chatID, userID).Scan(&lockDummy); err != nil {
		return nil, err
	}

	// 6. Условная вставка: не выполняется при активном бане или существующем
	// membership. Пред-проверки не нужны — финальная истина в RowsAffected.
	res, err := tx.ExecContext(ctx, `
		INSERT INTO chats.members (chat_id, user_id, role)
		SELECT $1, $2, 'member'
		WHERE NOT EXISTS(
			SELECT 1 FROM chats.bans
			WHERE chat_id = $1 AND user_id = $2 AND (banned_until IS NULL OR banned_until > NOW())
		)
		ON CONFLICT DO NOTHING
	`, chatID, userID)
	if err != nil {
		return nil, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		// Различаем причину отказа: активный бан, затем membership.
		var banned bool
		if err := tx.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM chats.bans WHERE chat_id = $1 AND user_id = $2 AND (banned_until IS NULL OR banned_until > NOW()))`,
			chatID, userID).Scan(&banned); err != nil {
			return nil, err
		}
		if banned {
			return nil, ErrUserBanned
		}
		var isMember bool
		if err := tx.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`,
			chatID, userID).Scan(&isMember); err != nil {
			return nil, err
		}
		if isMember {
			return nil, ErrAlreadyMember
		}
		return nil, errors.New("member insert conflict without known reason")
	}

	// 8. Получение и возврат объекта Member
	var permissions jsonMap
	var m Member
	err = tx.QueryRowContext(ctx, `
		SELECT au.id::text, au.username, COALESCE(up.first_name, au.first_name), COALESCE(up.last_name, au.last_name),
		COALESCE(up.avatar_url, ''), cm.role, cm.permissions, COALESCE(cm.muted_until::text, ''), COALESCE(cm.muted_at::text, ''), cm.joined_at::text
		FROM auth.users au
		JOIN chats.members cm ON cm.user_id = au.id
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE cm.chat_id = $1 AND au.id = $2
		`, chatID, userID).Scan(
		&m.ID,
		&m.Username,
		&m.FirstName,
		&m.LastName,
		&m.AvatarURL,
		&m.Role,
		&permissions,
		&m.MutedUntil,
		&m.MutedAt,
		&m.JoinedAt,
	)
	m.Permissions = map[string]any(permissions)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("added member not found after insertion")
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// 9. Рассылка WebSocket-события
	if s.ws != nil {
		event := MemberAddedEvent{
			Type:   "chat_member_added",
			ChatID: chatID,
			Member: &m,
		}
		payload, err := json.Marshal(event)
		if err != nil {
			slog.Error("failed to marshal member_added event", "err", err, "chatID", chatID, "userID", userID)
		} else {
			s.ws.BroadcastToChat(chatID, payload, "")
		}
	}

	return &m, nil
}

// BanMember банит пользователя в групповом чате. Если цель — текущий
// участник, он удаляется из чата в той же транзакции. Не-участника можно
// забанить превентивно (он обязан существовать в auth.users).
//
// Гонки: первым запросом внутри транзакции берётся pg_advisory_xact_lock
// по паре (chat_id, user_id) — тот же lock берёт AddMember, поэтому
// параллельные add/ban одной пары сериализуются. Membership и существующий
// ban перечитываются уже после lock, внутри транзакции.
//
// Иерархия: owner банит admin/member, admin — только member (AssertCanModerate).
// Валидация (UUID, bannedUntil в прошлом, reason длиннее 500 рун) — до любого SQL.
// Повторный активный ban с теми же bannedUntil и reason — no-op без записей
// и событий; другие параметры или истёкший ban — upsert chats.bans и событие.
//
// WS-события при успехе: chat_member_banned в чат — всегда;
// chat_member_removed (reason "banned") в чат и адресное chat_member_banned
// забаненному — только если DELETE membership фактически удалил строку
// (RowsAffected == 1): при гонке с RemoveMember/LeaveChat ложных событий нет.
func (s *Service) BanMember(ctx context.Context, actorID, chatID, userID string, bannedUntil *time.Time, reason string) error {
	input := muteMemberInput{ActorID: actorID, ChatID: chatID, UserID: userID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}
	if bannedUntil != nil && !bannedUntil.After(time.Now()) {
		return ErrInvalidInput
	}
	if utf8.RuneCountInString(reason) > 500 {
		return ErrInvalidInput
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}

	// Пользователь обязан существовать — и для ban участника, и для
	// превентивного ban не-участника.
	var userExists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1)`, userID).Scan(&userExists); err != nil {
		return err
	}
	if !userExists {
		return ErrUserNotFound
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Согласованная блокировка пары (chat, user): AddMember берёт тот же
	// lock до проверок membership/ban — гонка add/ban исключена.
	var lockDummy any
	if err := tx.QueryRowContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, chatID, userID).Scan(&lockDummy); err != nil {
		return err
	}

	// Membership перечитываем внутри транзакции, после lock.
	memberToRemove := false
	var targetRole string
	err = tx.QueryRowContext(ctx, `
		SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2
		`, userID, chatID).Scan(&targetRole)
	switch {
	case err == nil:
		if err := AssertCanModerate(actorRole, targetRole); err != nil {
			return err
		}
		memberToRemove = true
	case errors.Is(err, sql.ErrNoRows):
		// Цель не участник — превентивный ban.
	default:
		return err
	}

	// Существующий ban тоже перечитываем внутри транзакции (идемпотентность).
	var existingBannedUntil sql.NullTime
	var existingReason string
	err = tx.QueryRowContext(ctx, `
		SELECT banned_until, reason FROM chats.bans WHERE chat_id = $1 AND user_id = $2
		`, chatID, userID).Scan(&existingBannedUntil, &existingReason)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		active := !existingBannedUntil.Valid || existingBannedUntil.Time.After(time.Now())
		same := existingReason == reason && ((!existingBannedUntil.Valid && bannedUntil == nil) || (existingBannedUntil.Valid && bannedUntil != nil && existingBannedUntil.Time.Equal(*bannedUntil)))
		if active && same {
			return nil // повтор с тем же состоянием: ни записи, ни событий
		}
	}

	// Участника удаляем из чата; факт удаления определяет состав событий.
	memberRemoved := false
	if memberToRemove {
		res, err := tx.ExecContext(ctx, `DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
		if err != nil {
			return err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return err
		}
		memberRemoved = affected == 1
	}

	// Единый upsert: атомарен при гонке ban/unban, всегда затрагивает строку.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO chats.bans (chat_id, user_id, banned_by, reason, banned_until) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (chat_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, banned_until = $5, created_at = NOW()
		`, chatID, userID, actorID, reason, bannedUntil); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	if s.ws != nil {
		payload, _ := json.Marshal(MemberBanEvent{
			Type: "chat_member_banned", ChatID: chatID, UserID: userID,
			ByUserID: actorID, Reason: reason, BannedUntil: bannedUntil,
		})
		s.ws.BroadcastToChat(chatID, payload, "")
		if memberRemoved {
			removedPayload, _ := json.Marshal(MemberRemovedEvent{
				Type:   "chat_member_removed",
				ChatID: chatID,
				UserID: userID,
				Reason: "banned",
			})
			s.ws.BroadcastToChat(chatID, removedPayload, "")
			s.ws.BroadcastToUsers([]string{userID}, payload)
		}
	}
	return nil
}

func (s *Service) UnbanMember(ctx context.Context, actorID, chatID, userID string) error {
	input := muteMemberInput{ActorID: actorID, ChatID: chatID, UserID: userID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}

	var exists bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1)
		`, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrUserNotFound
	}

	// Идемпотентность: событие шлём только если бан реально существовал и удалён
	res, err := s.db.ExecContext(ctx, `DELETE FROM chats.bans WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return nil
	}
	if s.ws != nil {
		payload, _ := json.Marshal(MemberBanEvent{
			Type: "chat_member_unbanned", ChatID: chatID, UserID: userID, ByUserID: actorID,
		})
		s.ws.BroadcastToChat(chatID, payload, "")
	}
	return nil
}

func (s *Service) ListBans(ctx context.Context, actorID, chatID string) ([]Ban, error) {
	input := leaveChatInput{ChatID: chatID}
	if err := validate.Struct(input); err != nil {
		return nil, ErrInvalidInput
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrForbidden
	}
	if err != nil {
		return nil, err
	}
	if chatType != "group" {
		return nil, ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.user_id::text, u.username, u.first_name, b.reason,
		       CASE WHEN b.banned_until IS NOT NULL THEN b.banned_until::text END, b.created_at::text
		FROM chats.bans b
		JOIN auth.users u ON u.id = b.user_id
		WHERE b.chat_id = $1 AND (b.banned_until IS NULL OR b.banned_until > NOW())
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var bans []Ban
	for rows.Next() {
		var b Ban
		if err := rows.Scan(&b.UserID, &b.Username, &b.FirstName, &b.Reason, &b.BannedUntil, &b.CreatedAt); err != nil {
			return nil, err
		}
		bans = append(bans, b)
	}
	return bans, rows.Err()
}

func (s *Service) MuteMember(ctx context.Context, actorID, chatID, userID string, mutedUntil *time.Time) error {
	input := muteMemberInput{ActorID: actorID, ChatID: chatID, UserID: userID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}
	if mutedUntil != nil && !mutedUntil.After(time.Now()) {
		return ErrInvalidInput
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	var targetRole string
	var mutedAt sql.NullTime
	var currentMutedUntil sql.NullTime
	err = s.db.QueryRowContext(ctx, `
		SELECT role, muted_at, muted_until FROM chats.members WHERE user_id = $1 AND chat_id = $2
		`, userID, chatID).Scan(&targetRole, &mutedAt, &currentMutedUntil)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMemberNotFound
	}
	if err != nil {
		return err
	}
	if err := AssertCanModerate(actorRole, targetRole); err != nil {
		return err
	}
	sameUntil := (!currentMutedUntil.Valid && mutedUntil == nil) || (currentMutedUntil.Valid && mutedUntil != nil && currentMutedUntil.Time.Equal(*mutedUntil))
	if mutedAt.Valid && sameUntil {
		return nil
	}
	res, err := s.db.ExecContext(ctx, `UPDATE chats.members SET muted_at = NOW(), muted_until = $3 WHERE chat_id = $1 AND user_id = $2 AND (muted_at IS NULL OR muted_until IS DISTINCT FROM $3)`, chatID, userID, mutedUntil)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		// Гонка: состояние изменилось между SELECT и UPDATE. Различаем
		// «участника удалили» и «нужное состояние уже достигнуто» —
		// событие публикуем только при фактическом изменении.
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`, chatID, userID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrMemberNotFound
		}
		return nil
	}
	if s.ws != nil {
		payload, _ := json.Marshal(MemberMuteEvent{
			Type:       "chat_member_muted",
			ChatID:     chatID,
			UserID:     userID,
			ByUserID:   actorID,
			MutedUntil: mutedUntil,
		})
		s.ws.BroadcastToChat(chatID, payload, "")
	}
	return nil
}

func (s *Service) UnmuteMember(ctx context.Context, actorID, chatID, userID string) error {
	input := muteMemberInput{ActorID: actorID, ChatID: chatID, UserID: userID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}
	chatType, actorRole, err := s.getChatInfo(ctx, actorID, chatID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if chatType != "group" {
		return ErrInvalidChatType
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}

	var targetRole string
	var mutedAt sql.NullTime
	var currentMutedUntil sql.NullTime
	err = s.db.QueryRowContext(ctx, `
		SELECT role, muted_at, muted_until FROM chats.members WHERE user_id = $1 AND chat_id = $2
		`, userID, chatID).Scan(&targetRole, &mutedAt, &currentMutedUntil)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMemberNotFound
	}
	if err != nil {
		return err
	}

	if err := AssertCanModerate(actorRole, targetRole); err != nil {
		return err
	}
	if !mutedAt.Valid {
		return nil
	}

	res, err := s.db.ExecContext(ctx, `UPDATE chats.members SET muted_at = NULL, muted_until = NULL	WHERE chat_id = $1 AND user_id = $2 AND muted_at IS NOT NULL`, chatID, userID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		// Гонка: состояние изменилось между SELECT и UPDATE. Различаем
		// «участника удалили» и «нужное состояние уже достигнуто» —
		// событие публикуем только при фактическом изменении.
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`, chatID, userID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrMemberNotFound
		}
		return nil
	}

	if s.ws != nil {
		payload, _ := json.Marshal(MemberMuteEvent{
			Type:     "chat_member_unmuted",
			ChatID:   chatID,
			UserID:   userID,
			ByUserID: actorID,
		})
		s.ws.BroadcastToChat(chatID, payload, "")
	}
	return nil
}

func (s *Service) MembersOnline(ctx context.Context, userID, chatID string) ([]string, error) {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT cm.user_id::text
		FROM chats.members cm
		JOIN users.profiles p ON p.user_id = cm.user_id
		WHERE cm.chat_id = $1 AND p.is_online = TRUE
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Service) isMember(ctx context.Context, userID, chatID string) (bool, error) {
	var ok bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`, userID, chatID).Scan(&ok)
	return ok, err
}

func (s *Service) IsMember(ctx context.Context, userID, chatID string) (bool, error) {
	return s.isMember(ctx, userID, chatID)
}

func (s *Service) memberRole(ctx context.Context, userID, chatID string) (string, error) {
	var role string
	err := s.db.QueryRowContext(ctx, `SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`, userID, chatID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrForbidden
	}
	return role, err
}

func (s *Service) peerPublicKey(ctx context.Context, userID, chatID string) (string, error) {
	var key sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT pk.public_key
		FROM chats.members cm
		LEFT JOIN auth.public_keys pk ON pk.user_id = cm.user_id
		WHERE cm.chat_id = $1 AND cm.user_id <> $2
		ORDER BY pk.updated_at DESC NULLS LAST
		LIMIT 1
	`, chatID, userID).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !key.Valid {
		return "", nil
	}
	return key.String, nil
}

func scanChats(rows *sql.Rows) ([]Chat, error) {
	var chats []Chat
	for rows.Next() {
		var chat Chat
		var unreadCount int
		var lmID, lmSenderID, lmContent, lmType, lmSender sql.NullString
		if err := rows.Scan(
			&chat.ID, &chat.Type, &chat.Title, &chat.Description, &chat.AvatarURL,
			&chat.OwnerID, &chat.Role, &chat.IsPinned, &chat.IsArchived, &chat.LastReadAt,
			&chat.CreatedAt, &chat.UpdatedAt, &chat.MemberCount, &chat.LastMessageAt,
			&chat.PeerID, &chat.PeerIsOnline, &chat.PeerLastSeen,
			&unreadCount, &lmID, &lmSenderID, &lmContent, &lmType, &lmSender,
		); err != nil {
			return nil, err
		}
		chat.UnreadCount = unreadCount
		if lmContent.Valid || lmType.Valid {
			chat.LastMessage = &LastMessagePreview{
				ID:         lmID.String,
				Content:    lmContent.String,
				Type:       lmType.String,
				SenderID:   lmSenderID.String,
				SenderName: lmSender.String,
			}
		}
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

func (s *Service) ListMessages(ctx context.Context, userID, chatID string, limit, offset int) ([]Message, error) {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `
				SELECT *
		FROM (
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.type, m.reply_to::text, m.metadata,
		       (p.message_id IS NOT NULL), m.updated_at > m.created_at,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM messages.messages m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		LEFT JOIN messages.pins p ON p.message_id = m.id
		WHERE m.chat_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.created_at DESC
		LIMIT $2 OFFSET $3
		) recent_messages
		ORDER BY created_at ASC
	`, chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages, err := scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateMessagesReactions(ctx, userID, messages); err != nil {
		return nil, err
	}
	if err := s.hydrateMessagesFields(ctx, messages); err != nil {
		return nil, err
	}
	return messages, nil
}

func scanMessages(rows *sql.Rows) ([]Message, error) {
	var messages []Message
	for rows.Next() {
		var msg Message
		var metadataBytes []byte
		var replyTo sql.NullString
		var deletedAt sql.NullString
		if err := rows.Scan(
			&msg.ID, &msg.ChatID, &msg.SenderID,
			&msg.SenderName, &msg.SenderAvatar,
			&msg.Content, &msg.Type, &replyTo, &metadataBytes,
			&msg.IsPinned, &msg.IsEdited,
			&msg.CreatedAt, &msg.UpdatedAt, &deletedAt,
		); err != nil {
			return nil, err
		}
		if replyTo.Valid {
			msg.ReplyTo = &replyTo.String
		}
		if deletedAt.Valid {
			msg.DeletedAt = &deletedAt.String
		}
		if metadataBytes != nil {
			if err := json.Unmarshal(metadataBytes, &msg.Metadata); err != nil {
				return nil, err
			}
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func (s *Service) SendMessage(ctx context.Context, userID, chatID, content, msgType string, replyTo *string, metadata map[string]any) (Message, error) {
	content = sanitizeMessageContent(content)

	var role string
	var isMuted sql.NullBool
	err := s.db.QueryRowContext(ctx, `
		SELECT cm.role,
		       (
		         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR
		         (cm.muted_at IS NOT NULL AND (cm.muted_until IS NULL OR cm.muted_until > NOW()))
		       )
		FROM chats.members cm
		JOIN auth.users u ON u.id = cm.user_id
		WHERE cm.chat_id = $1 AND cm.user_id = $2
	`, chatID, userID).Scan(&role, &isMuted)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Message{}, ErrForbidden
		}
		return Message{}, err
	}

	if isMuted.Valid && isMuted.Bool {
		return Message{}, ErrMemberMuted
	}

	var msg Message
	var replyToStr sql.NullString
	var deletedAt sql.NullString
	var metadataBytes []byte

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return Message{}, err
	}

	var replyToSQL sql.NullString

	if replyTo != nil && *replyTo != "" {
		if err := validate.Var(*replyTo, "uuid"); err != nil {
			return Message{}, ErrInvalidInput
		}

		replyToSQL = sql.NullString{
			String: *replyTo,
			Valid:  true,
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if replyToSQL.Valid {
		var replyID string
		err = tx.QueryRowContext(ctx, `
        SELECT id::text
        FROM messages.messages
        WHERE id = $1
          AND chat_id = $2
          AND deleted_at IS NULL
        FOR SHARE
    `, replyToSQL.String, chatID).Scan(&replyID)

		if errors.Is(err, sql.ErrNoRows) {
			return Message{}, ErrNotFound
		}
		if err != nil {
			return Message{}, err
		}
	}

	err = tx.QueryRowContext(ctx, `
		WITH inserted AS (
			INSERT INTO messages.messages (chat_id, sender_id, content, type, reply_to, metadata)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING *
		)
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.type, m.reply_to::text, m.metadata,
		       FALSE, FALSE,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM inserted m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
	`, chatID, userID, content, msgType, replyToSQL, metadataJSON).Scan(
		&msg.ID, &msg.ChatID, &msg.SenderID,
		&msg.SenderName, &msg.SenderAvatar,
		&msg.Content, &msg.Type, &replyToStr, &metadataBytes,
		&msg.IsPinned, &msg.IsEdited,
		&msg.CreatedAt, &msg.UpdatedAt, &deletedAt)

	if err != nil {
		return Message{}, err
	}

	if err := tx.Commit(); err != nil {
		return Message{}, err
	}

	if replyToStr.Valid {
		msg.ReplyTo = &replyToStr.String
	}

	if deletedAt.Valid {
		msg.DeletedAt = &deletedAt.String
	}

	if metadataBytes != nil {
		if err := json.Unmarshal(metadataBytes, &msg.Metadata); err != nil {
			return Message{}, err
		}
	}
	if err := s.hydrateMessageFields(ctx, &msg); err != nil {
		return Message{}, err
	}

	// Broadcast
	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":    "new_message",
			"chatId":  chatID,
			"message": msg,
		})
		s.ws.BroadcastToChat(chatID, payload, userID)
	}

	return msg, nil
}

func (s *Service) EditMessage(ctx context.Context, userID, messageID, content string) (Message, error) {
	content = sanitizeMessageContent(content)

	var msg Message
	var replyToStr sql.NullString
	var deletedAt sql.NullString
	var metadataBytes []byte
	var msgType string

	// Require the sender to still be a chat member both when validating
	// the message type and when applying the update.
	err := s.db.QueryRowContext(ctx, `
		SELECT m.type
		FROM messages.messages m
		JOIN chats.members cm
		ON cm.chat_id = m.chat_id
		AND cm.user_id = $2
		WHERE m.id = $1
		AND m.sender_id = $2
		AND m.deleted_at IS NULL`,
		messageID, userID,
	).Scan(&msgType)

	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}

	if err != nil {
		return Message{}, err
	}

	if msgType == "sticker" {
		return Message{}, ErrStickerCannotBeEdited
	}

	if msgType == "text" && strings.TrimSpace(content) == "" {
		return Message{}, ErrInvalidInput
	}

	err = s.db.QueryRowContext(ctx, `
		WITH updated AS (
			UPDATE messages.messages AS m
			SET content = $1, updated_at = NOW()
			FROM chats.members AS cm
			WHERE m.id = $2 AND m.sender_id = $3 AND m.deleted_at IS NULL
			  AND cm.chat_id = m.chat_id AND cm.user_id = $3
			RETURNING m.*
		)
		SELECT u.id::text, u.chat_id::text, u.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       u.content, u.type, u.reply_to::text, u.metadata,
		       (p.message_id IS NOT NULL), u.updated_at > u.created_at,
		       u.created_at::text, u.updated_at::text, u.deleted_at::text
		FROM updated u
		LEFT JOIN auth.users au ON au.id = u.sender_id
		LEFT JOIN users.profiles up ON up.user_id = u.sender_id
		LEFT JOIN messages.pins p ON p.message_id = u.id
	`, content, messageID, userID).Scan(
		&msg.ID, &msg.ChatID, &msg.SenderID,
		&msg.SenderName, &msg.SenderAvatar,
		&msg.Content, &msg.Type, &replyToStr, &metadataBytes,
		&msg.IsPinned, &msg.IsEdited,
		&msg.CreatedAt, &msg.UpdatedAt, &deletedAt)

	if err == sql.ErrNoRows {
		return Message{}, ErrNotFound
	}

	if err != nil {
		return Message{}, err
	}

	if replyToStr.Valid {
		msg.ReplyTo = &replyToStr.String
	}

	if deletedAt.Valid {
		msg.DeletedAt = &deletedAt.String
	}

	if metadataBytes != nil {
		if err := json.Unmarshal(metadataBytes, &msg.Metadata); err != nil {
			return Message{}, err
		}
	}

	if err := s.hydrateMessageFields(ctx, &msg); err != nil {
		return Message{}, err
	}

	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":      "message_edited",
			"chatId":    msg.ChatID,
			"messageId": msg.ID,
			"content":   msg.Content,
			"updatedAt": msg.UpdatedAt,
		})
		s.ws.BroadcastToChat(msg.ChatID, payload, userID)
	}

	return msg, nil
}

func (s *Service) DeleteMessage(ctx context.Context, userID, messageID string) (*Message, error) {
	if err := validate.Var(messageID, "required,uuid"); err != nil {
		return nil, ErrInvalidInput
	}

	var chatID string
	var createdAt time.Time
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Require sender to be a current member to prevent deletion after being kicked.
	err = tx.QueryRowContext(ctx, `
		UPDATE messages.messages AS m
		SET deleted_at = NOW()
		FROM chats.members AS cm
		WHERE m.id = $1 AND (m.sender_id = $2 OR cm.role = 'owner' OR (cm.role = 'admin' AND cm.permissions->>'can_delete_messages' = 'true')) AND m.deleted_at IS NULL
		  AND cm.chat_id = m.chat_id AND cm.user_id = $2
		RETURNING m.chat_id::text, m.created_at
	`, messageID, userID).Scan(&chatID, &createdAt)

	switch {
	case errors.Is(err, sql.ErrNoRows):
		exists, existsErr := s.messageExistsForMember(ctx, userID, messageID)
		if existsErr != nil {
			return nil, existsErr
		}
		if exists {
			return nil, ErrForbidden
		}
		return nil, ErrNotFound

	case err != nil:
		return nil, err
	}

	previousMessage, err := s.loadMessageAfterDelete(ctx, tx, userID, chatID, &createdAt, messageID)
	if err != nil {
		return nil, err
	}
	lastMessage, err := s.loadMessageAfterDelete(ctx, tx, userID, chatID, nil, messageID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":            "message_deleted",
			"chatId":          chatID,
			"messageId":       messageID,
			"previousMessage": previousMessage,
		})
		s.ws.BroadcastToChat(chatID, payload, userID)
	}

	return lastMessage, nil
}

// loadMessageAfterDelete returns either the newest message before the deleted
// message (when before is non-nil), or the newest remaining message in the chat.
func (s *Service) loadMessageAfterDelete(ctx context.Context, tx *sql.Tx, userID, chatID string, before *time.Time, messageID string) (*Message, error) {
	var msg Message
	var replyTo sql.NullString
	var metadataBytes, reactionsBytes []byte
	var deletedAt sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.type, m.reply_to::text, m.metadata,
		       (p.message_id IS NOT NULL), m.updated_at > m.created_at,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text,
		       COALESCE((
		           SELECT jsonb_agg(jsonb_build_object(
		               'emoji', grouped.emoji,
		               'count', grouped.reaction_count,
		               'myReaction', grouped.my_reaction
		           ) ORDER BY grouped.reaction_count DESC, grouped.emoji)
		           FROM (
		               SELECT r.emoji, COUNT(*) AS reaction_count,
		                      BOOL_OR(r.user_id = $4) AS my_reaction
		               FROM messages.reactions r
		               WHERE r.message_id = m.id
		               GROUP BY r.emoji
		           ) grouped
		       ), '[]'::jsonb)
		FROM messages.messages m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		LEFT JOIN messages.pins p ON p.message_id = m.id
		WHERE m.chat_id = $1
		  AND m.deleted_at IS NULL
		  AND ($2::timestamptz IS NULL OR (m.created_at, m.id) < ($2, $3::uuid))
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT 1
	`, chatID, before, messageID, userID).Scan(
		&msg.ID, &msg.ChatID, &msg.SenderID,
		&msg.SenderName, &msg.SenderAvatar,
		&msg.Content, &msg.Type, &replyTo, &metadataBytes,
		&msg.IsPinned, &msg.IsEdited,
		&msg.CreatedAt, &msg.UpdatedAt, &deletedAt, &reactionsBytes,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if replyTo.Valid {
		msg.ReplyTo = &replyTo.String
		msg.ReplyToMessageID = msg.ReplyTo
	}
	if err := json.Unmarshal(metadataBytes, &msg.Metadata); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(reactionsBytes, &msg.Reactions); err != nil {
		return nil, err
	}
	msg.SenderFirstName = msg.SenderName
	if err := s.hydrateDeleteMessageFields(ctx, tx, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func (s *Service) hydrateDeleteMessageFields(ctx context.Context, tx *sql.Tx, msg *Message) error {
	if msg.ReplyTo != nil {
		var name string
		err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(up.first_name, au.first_name, au.username, '')
			FROM messages.messages m
			LEFT JOIN auth.users au ON au.id = m.sender_id
			LEFT JOIN users.profiles up ON up.user_id = m.sender_id
			WHERE m.id = $1
		`, *msg.ReplyTo).Scan(&name)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		msg.ReplySenderName = name
		msg.ReplyToSenderName = name
	}
	if forwardedFrom, ok := msg.Metadata["forwardedFrom"].(string); ok && forwardedFrom != "" {
		msg.IsForwarded = true
		if name, ok := msg.Metadata["forwardedSenderName"].(string); ok {
			msg.ForwardedSenderName = name
		}
		if msg.ForwardedSenderName == "" {
			_ = tx.QueryRowContext(ctx, `
				SELECT COALESCE(up.first_name, au.first_name, au.username, '')
				FROM messages.messages m
				LEFT JOIN auth.users au ON au.id = m.sender_id
				LEFT JOIN users.profiles up ON up.user_id = m.sender_id
				WHERE m.id::text = $1
			`, forwardedFrom).Scan(&msg.ForwardedSenderName)
		}
	}
	return nil
}

func (s *Service) messageExistsForMember(ctx context.Context, userID, messageID string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM messages.messages m
			JOIN chats.members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
			WHERE m.id = $1 AND m.deleted_at IS NULL
		)
	`, messageID, userID).Scan(&exists)
	return exists, err
}

func (s *Service) getMessage(ctx context.Context, chat_id, messageID string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1
	 FROM messages.messages WHERE id = $2
	AND chat_id = $1 AND deleted_at IS NULL)`, chat_id, messageID).Scan(&exists)

	if err != nil {
		return exists, err
	}

	return exists, nil
}

// ForwardMessage copies a message into a target chat.
func (s *Service) ForwardMessage(ctx context.Context, userID, messageID, targetChatID string) (Message, error) {
	if ok, err := s.isMember(ctx, userID, targetChatID); err != nil || !ok {
		if err != nil {
			return Message{}, err
		}
		return Message{}, ErrForbidden
	}

	var src Message
	var replyTo sql.NullString
	var deletedAt sql.NullString
	var metadataBytes []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''),
		       m.content, m.type, m.reply_to::text, m.metadata, m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM messages.messages m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		WHERE m.id = $1 AND m.deleted_at IS NULL
	`, messageID).Scan(&src.ID, &src.ChatID, &src.SenderID, &src.SenderName, &src.Content, &src.Type, &replyTo, &metadataBytes, &src.CreatedAt, &src.UpdatedAt, &deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}
	if len(metadataBytes) > 0 {
		if err := json.Unmarshal(metadataBytes, &src.Metadata); err != nil {
			return Message{}, err
		}
	}

	if ok, err := s.isMember(ctx, userID, src.ChatID); err != nil || !ok {
		if err != nil {
			return Message{}, err
		}
		return Message{}, ErrForbidden
	}

	if src.Metadata == nil {
		src.Metadata = make(map[string]any)
	}
	// Forwarding a forwarded message keeps pointing at the original author;
	// the copied metadata already carries it.
	if origin, _ := src.Metadata["forwardedFrom"].(string); origin == "" {
		src.Metadata["forwardedFrom"] = src.ID
		src.Metadata["forwardedSenderName"] = src.SenderName
	}
	return s.SendMessage(ctx, userID, targetChatID, src.Content, src.Type, nil, src.Metadata)
}

// ForwardOrigin resolves the forwardedFrom metadata for a message the client
// forwards itself: end-to-end encrypted content has to be re-encrypted for the
// target chat, so it arrives through the regular send route instead of
// ForwardMessage.
//
// The requester must be able to read the message being forwarded. Without
// this check a client could pass any message ID and learn who wrote a message
// in a chat it does not belong to. A missing, deleted and inaccessible message
// all yield ErrNotFound, so the response does not reveal which one it was.
//
// If the message is itself a forward, the original is returned instead. The
// requester may have no access to the original's chat, so its ID and author
// name come from the forwarded copy's metadata rather than from a lookup.
func (s *Service) ForwardOrigin(ctx context.Context, userID, messageID string) (originID, senderName string, err error) {
	if err := validate.Var(messageID, "required,uuid"); err != nil {
		return "", "", ErrInvalidInput
	}

	var chatID string
	var metadataBytes []byte
	err = s.db.QueryRowContext(ctx, `
		SELECT m.chat_id::text, COALESCE(up.first_name, au.first_name, au.username, ''), m.metadata
		FROM messages.messages m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		WHERE m.id = $1 AND m.deleted_at IS NULL
	`, messageID).Scan(&chatID, &senderName, &metadataBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}

	ok, err := s.isMember(ctx, userID, chatID)
	if err != nil {
		return "", "", err
	}
	if !ok {
		return "", "", ErrNotFound
	}

	var metadata map[string]any
	if len(metadataBytes) > 0 {
		if err := json.Unmarshal(metadataBytes, &metadata); err != nil {
			return "", "", err
		}
	}
	if origin, _ := metadata["forwardedFrom"].(string); origin != "" {
		originName, _ := metadata["forwardedSenderName"].(string)
		return origin, originName, nil
	}

	return messageID, senderName, nil
}

// Reaction types.

type Reaction struct {
	Emoji      string `json:"emoji"`
	Count      int    `json:"count"`
	MyReaction bool   `json:"myReaction"`
}

// ReactionStatus represents the outcome of a reaction toggle operation.
// It is returned only when the operation succeeds (error == nil).
type ReactionStatus string

const (
	// StatusAdded indicates that a new reaction was successfully inserted
	// for the user and message.
	StatusAdded ReactionStatus = "added"

	// StatusRemoved indicates that an existing reaction was successfully
	// deleted (the user toggled off the same emoji).
	StatusRemoved ReactionStatus = "removed"

	// StatusReplaced indicates that the user changed their reaction from
	// one emoji to another (update of the existing record).
	StatusReplaced ReactionStatus = "replaced"
)

// ReactionResponse – reaction without myReaction flag for WebSocket payload
type ReactionResponse struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

// ChangeResponse – information about the reaction change
type ChangeResponse struct {
	Action        string  `json:"action"`        // "added", "removed", "replaced"
	Emoji         *string `json:"emoji"`         // current emoji (nil if removed)
	PreviousEmoji *string `json:"previousEmoji"` // previous emoji (nil if none)
}

func (s *Service) ListReactions(ctx context.Context, userID, messageID string) ([]Reaction, error) {
	var chatID string

	if err := validate.Var(messageID, "required,uuid"); err != nil {
		return nil, ErrInvalidInput
	}

	err := s.db.QueryRowContext(ctx,
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
		messageID,
	).Scan(&chatID)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	isMember, err := s.isMember(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrForbidden
	}

	return s.listReactionsInternal(ctx, s.db, messageID, userID)
}

// Querier is an interface that both *sql.DB and *sql.Tx implement.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

func (s *Service) listReactionsInternal(ctx context.Context, q Querier, messageID, userID string) ([]Reaction, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction
		FROM messages.reactions
		WHERE message_id = $1
		GROUP BY emoji
		ORDER BY cnt DESC
	`, messageID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Reaction, 0)
	for rows.Next() {
		var r Reaction
		if err := rows.Scan(&r.Emoji, &r.Count, &r.MyReaction); err != nil {
			return nil, err
		}
		result = append(result, r)
	}

	return result, rows.Err()
}

// isMemberWithQuerier executes the query using any Querier
// (either *sql.DB or *sql.Tx), allowing it to run inside a transaction.
func (s *Service) isMemberWithQuerier(ctx context.Context, q Querier, userID, chatID string) (bool, error) {
	var exists bool
	err := q.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
		userID, chatID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// ToggleReaction adds or removes a reaction (toggle semantics).
// Returns:
//   - ReactionStatus: "added", "removed", "replaced"
//   - string: current emoji for response
//   - []Reaction: aggregated reactions with the myReaction flag.
//   - error: if we have error.
func (s *Service) ToggleReaction(ctx context.Context, userID, messageID, emoji string) (ReactionStatus, string, []Reaction, error) {
	// check - if emoji not empty
	if emoji == "" {
		log.Printf("[chat-service-ToggleReaction]:invalid input for emoji: %v", emoji)
		return "", "", nil, ErrInvalidInput
	}
	// check the length of emoji and symbols
	if len(emoji) > 64 || strings.ContainsAny(emoji, "<>\"'&/\\") {
		log.Printf("[chat-service-ToggleReaction]:invalid input for emoji: %v", emoji)
		return "", "", nil, ErrInvalidInput
	}

	// 1. Start transaction with READ COMMITTED isolation level
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		log.Printf("[chat-service-ToggleReaction]:failed to begin transaction: %v", err)
		return "", "", nil, fmt.Errorf("begin tx: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	// 2. Check message existence and get chatID inside transaction
	var chatID string
	err = tx.QueryRowContext(ctx,
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
		messageID,
	).Scan(&chatID)

	if errors.Is(err, sql.ErrNoRows) {
		log.Printf("[chat-service-ToggleReaction]:chat was not found: %v", err)
		return "", "", nil, ErrNotFound
	} else if err != nil {
		log.Printf("[chat-service-ToggleReaction]:failed to get chatID: %v", err)
		return "", "", nil, fmt.Errorf("get chatID: %w", err)
	}

	// 3. Check membership inside transaction
	if ok, err := s.isMemberWithQuerier(ctx, tx, userID, chatID); err != nil || !ok {
		if err != nil {
			log.Printf("[chat-service-ToggleReaction]:failed to check membership: %v", err)
			return "", "", nil, fmt.Errorf("check membership: %w", err)
		}
		log.Printf("[chat-service-ToggleReaction]:user not a member: %v", userID)
		return "", "", nil, ErrForbidden
	}

	// 4. Acquire advisory lock for the (message_id, user_id) pair
	// pg_advisory_xact_lock blocks until lock is available or timeout occurs
	_, err = tx.ExecContext(ctx,
		`SELECT pg_advisory_xact_lock($1)`,
		getAdvisoryKey(messageID, userID),
	)
	if err != nil {
		log.Printf("[chat-service-ToggleReaction]:failed to acquire advisory lock: %v", err)
		return "", "", nil, fmt.Errorf("acquire lock: %w", err)
	}

	// 5. Now safely query the current reaction (with lock held)
	var currentEmoji string
	err = tx.QueryRowContext(ctx,
		`SELECT emoji FROM messages.reactions
		 WHERE message_id = $1 AND user_id = $2`,
		messageID, userID,
	).Scan(&currentEmoji)

	hasCurrent := true
	if errors.Is(err, sql.ErrNoRows) {
		hasCurrent = false
	} else if err != nil {
		log.Printf("[chat-service-ToggleReaction]:failed to get current reaction: %v", err)
		return "", "", nil, fmt.Errorf("get current reaction: %w", err)
	}

	// Store the previous emoji (if any) as a pointer
	var previousEmoji *string
	if hasCurrent {
		prev := currentEmoji
		previousEmoji = &prev
	} else {
		previousEmoji = nil
	}

	// create status variable
	var status ReactionStatus

	// 6. Perform the appropriate action based on the current state
	switch {
	case !hasCurrent:
		// No reaction yet – insert the new one
		result, execErr := tx.ExecContext(ctx,
			`INSERT INTO messages.reactions (message_id, user_id, emoji)
			 VALUES ($1, $2, $3)`,
			messageID, userID, emoji,
		)
		if execErr != nil {
			log.Printf("[chat-service-ToggleReaction]:insert reaction failed: %v", execErr)
			return "", "", nil, fmt.Errorf("insert reaction: %w", execErr)
		}
		if err := requireOneAffectedRow(result, "insert reaction"); err != nil {
			return "", "", nil, err
		}

		currentEmoji = emoji
		status = StatusAdded

	case currentEmoji == emoji:
		// Same emoji – remove the reaction (toggle off)
		result, execErr := tx.ExecContext(ctx,
			`DELETE FROM messages.reactions
			 WHERE message_id = $1 AND user_id = $2`,
			messageID, userID,
		)
		if execErr != nil {
			log.Printf("[chat-service-ToggleReaction]:delete reaction failed: %v", execErr)
			return "", "", nil, fmt.Errorf("delete reaction: %w", execErr)
		}
		if err := requireOneAffectedRow(result, "delete reaction"); err != nil {
			return "", "", nil, err
		}

		currentEmoji = ""
		status = StatusRemoved

	default:
		// Different emoji – update the existing one
		result, execErr := tx.ExecContext(ctx,
			`UPDATE messages.reactions SET emoji = $1
			 WHERE message_id = $2 AND user_id = $3`,
			emoji, messageID, userID,
		)
		if execErr != nil {
			return "", "", nil, fmt.Errorf("update reaction: %w", execErr)
		}
		if err := requireOneAffectedRow(result, "update reaction"); err != nil {
			return "", "", nil, err
		}

		currentEmoji = emoji
		status = StatusReplaced
	}

	// 7. Fetch the aggregated counts per emoji for the message
	reactions, err := s.listReactionsInternal(ctx, tx, messageID, userID)
	if err != nil {
		return "", "", nil, fmt.Errorf("get aggregates: %w", err)
	}

	// 8. Commit transaction (automatically releases advisory lock)
	if err = tx.Commit(); err != nil {
		log.Printf("[chat-service-ToggleReaction]:failed to commit transaction: %v", err)
		return "", "", nil, fmt.Errorf("commit transaction: %w", err)
	}
	committed = true

	// 9. Build the change response
	change := ChangeResponse{
		Action: string(status),
	}

	switch status {
	case StatusAdded:
		change.Emoji = &emoji
		change.PreviousEmoji = nil
	case StatusRemoved:
		change.Emoji = nil
		change.PreviousEmoji = previousEmoji
	case StatusReplaced:
		change.Emoji = &emoji                // new emoji
		change.PreviousEmoji = previousEmoji // old emoji
	}

	// 10. Convert reactions to response format without myReaction flag
	reactionResponses := make([]ReactionResponse, len(reactions))
	for i, r := range reactions {
		reactionResponses[i] = ReactionResponse{
			Emoji: r.Emoji,
			Count: r.Count,
		}
	}

	// 11. Send WebSocket notification
	if s.ws != nil {
		payload, err := json.Marshal(map[string]any{
			"type":      "reaction_updated",
			"chatId":    chatID,
			"messageId": messageID,
			"actorId":   userID,
			"change":    change,
			"reactions": reactionResponses,
		})
		if err != nil {
			log.Printf("[chat-service-ToggleReaction]: failed to marshal payload: %v", err)
		} else {
			s.ws.BroadcastToChat(chatID, payload, "")
		}
	}

	return status, currentEmoji, reactions, nil
}

func requireOneAffectedRow(result sql.Result, operation string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s rows affected: %w", operation, err)
	}
	if affected != 1 {
		return fmt.Errorf("%s: expected 1 affected row, got %d", operation, affected)
	}
	return nil
}

// getAdvisoryKey generates a 64-bit key for advisory lock from messageID and userID
func getAdvisoryKey(messageID, userID string) int64 {
	// Combine both IDs into a single string and hash to 64-bit
	// Using FNV-1a 64-bit hash for good distribution and low collision rate
	h := fnv.New64a()
	h.Write([]byte(messageID))
	h.Write([]byte(":"))
	h.Write([]byte(userID))

	// FNV-1a returns uint64, convert to int64
	// PostgreSQL advisory locks work with signed 64-bit integers
	return int64(h.Sum64())
}

// Message pin types.

type Pin struct {
	ID        string  `json:"id"`
	MessageID string  `json:"messageId"`
	ChatID    string  `json:"chatId"`
	PinnedBy  string  `json:"pinnedBy"`
	PinnedAt  string  `json:"pinnedAt"`
	Message   Message `json:"message"`
}

func (s *Service) ListPins(
	ctx context.Context,
	userID string, chatID string,
) ([]Pin, error) {
	// Получать закреплённые сообщения может только участник чата.
	ok, err := s.isMember(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrForbidden
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			p.id::text,
			p.message_id::text,
			p.chat_id::text,
			p.pinned_by::text,
			p.pinned_at::text,

			m.id::text,
			m.chat_id::text,
			m.sender_id::text,
			COALESCE(up.first_name, au.first_name, au.username, ''),
			COALESCE(up.avatar_url, ''),
			m.content,
			m.type,
			m.reply_to::text,
			m.metadata,
			m.updated_at > m.created_at,
			m.created_at::text,
			m.updated_at::text
		FROM messages.pins AS p
		JOIN messages.messages AS m
			ON m.id = p.message_id
			AND m.chat_id = p.chat_id
		LEFT JOIN auth.users AS au
			ON au.id = m.sender_id
		LEFT JOIN users.profiles AS up
			ON up.user_id = m.sender_id
		WHERE p.chat_id = $1
			AND m.deleted_at IS NULL
		ORDER BY p.pinned_at DESC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pins := make([]Pin, 0)

	for rows.Next() {
		var pin Pin
		var replyTo sql.NullString
		var metadataBytes []byte

		if err := rows.Scan(
			&pin.ID,
			&pin.MessageID,
			&pin.ChatID,
			&pin.PinnedBy,
			&pin.PinnedAt,

			&pin.Message.ID,
			&pin.Message.ChatID,
			&pin.Message.SenderID,
			&pin.Message.SenderName,
			&pin.Message.SenderAvatar,
			&pin.Message.Content,
			&pin.Message.Type,
			&replyTo,
			&metadataBytes,
			&pin.Message.IsEdited,
			&pin.Message.CreatedAt,
			&pin.Message.UpdatedAt,
		); err != nil {
			return nil, err
		}

		if replyTo.Valid {
			replyToValue := replyTo.String
			pin.Message.ReplyTo = &replyToValue
		}

		if len(metadataBytes) > 0 {
			if err := json.Unmarshal(metadataBytes, &pin.Message.Metadata); err != nil {
				return nil, err
			}
		}

		// Сообщение получено из таблицы закреплений.
		pin.Message.IsPinned = true

		// WHERE m.deleted_at IS NULL гарантирует, что DeletedAt остаётся nil.
		pins = append(pins, pin)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range pins {
		if err := s.hydrateMessageFields(ctx, &pins[i].Message); err != nil {
			return nil, err
		}
	}

	return pins, nil
}

func (s *Service) PinMessage(ctx context.Context, userID, chatID, messageID string) error {

	// Проверяет, что чат существует и что пользователь состоит в чате. Возвращает тип чата, роль пользователя и ошибку.
	chatType, role, err := s.getChatInfo(ctx, userID, chatID)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrForbidden
		}
		return err
	}

	if role == "member" && chatType != "private" {
		return ErrForbidden
	}

	//  Проверяет, что сообщение существует, оно принадлежит чату с указанным chatID и не было удалено.
	messageExists, err := s.getMessage(ctx, chatID, messageID)

	if err != nil {
		return err
	}

	if !messageExists {
		return ErrNotFound
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO messages.pins (chat_id, message_id, pinned_by)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
	`, chatID, messageID, userID)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rows == 0 {
		return nil
	}

	if s.ws != nil {
		pins, err := s.ListPins(ctx, userID, chatID)
		if err == nil {
			for _, pin := range pins {
				if pin.MessageID != messageID {
					continue
				}
				payload, marshalErr := messagePinnedPayload(pin)
				if marshalErr == nil {
					s.ws.BroadcastToChat(chatID, payload, "")
				}
				break
			}
		}
	}
	return nil
}

func messagePinnedPayload(pin Pin) ([]byte, error) {
	return json.Marshal(map[string]any{
		"type":      "message_pinned",
		"chatId":    pin.ChatID,
		"messageId": pin.MessageID,
		"pin":       pin,
	})
}

func (s *Service) UnpinMessage(ctx context.Context, userID, chatID, messageID string) error {

	// Проверяет, что чат существует и что пользователь состоит в чате. Возвращает тип чата, роль пользователя и ошибку.
	chatType, role, err := s.getChatInfo(ctx, userID, chatID)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrForbidden
		}
		return err
	}

	if role == "member" && chatType != "private" {
		return ErrForbidden
	}

	// Проверяет, что сообщение существует, оно принадлежит чату с указанным chatID и не было удалено.
	messageExists, err := s.getMessage(ctx, chatID, messageID)

	if err != nil {
		return err
	}

	if !messageExists {
		return ErrNotFound
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM messages.pins WHERE chat_id = $1 AND message_id = $2`, chatID, messageID)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()

	if err != nil {
		return err
	}

	if rows == 0 {
		return nil
	}

	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{"type": "message_unpinned", "chatId": chatID, "messageId": messageID})
		s.ws.BroadcastToChat(chatID, payload, "")
	}
	return nil
}

func (s *Service) SearchMessages(ctx context.Context, userID, query string, limit int) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.type,
		       m.reply_to::text, m.metadata,
		       (p.message_id IS NOT NULL), m.updated_at > m.created_at,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM messages.messages m
		JOIN chats.members cm ON cm.chat_id = m.chat_id AND cm.user_id = $1
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		LEFT JOIN messages.pins p ON p.message_id = m.id
		WHERE m.deleted_at IS NULL
		  AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', $2)
		ORDER BY m.created_at DESC
		LIMIT $3
	`, userID, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages, err := scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateMessagesFields(ctx, messages); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *Service) ToggleFavorite(ctx context.Context, userID, messageID string) (bool, error) {
	var dummy int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM messages.favorites WHERE user_id = $1 AND message_id = $2`, userID, messageID).Scan(&dummy)
	if err == nil {
		// Already favorited — remove.
		_, err = s.db.ExecContext(ctx, `DELETE FROM messages.favorites WHERE user_id = $1 AND message_id = $2`, userID, messageID)
		return false, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO messages.favorites (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, messageID)
	return true, err
}

func (s *Service) ListFavorites(ctx context.Context, userID string, limit, offset int) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.type,
		       m.reply_to::text, m.metadata,
		       (p.message_id IS NOT NULL), m.updated_at > m.created_at,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM messages.favorites f
		JOIN messages.messages m ON m.id = f.message_id
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		LEFT JOIN messages.pins p ON p.message_id = m.id
		WHERE f.user_id = $1 AND m.deleted_at IS NULL
		ORDER BY f.created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages, err := scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateMessagesFields(ctx, messages); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *Service) CreateCallRoom(ctx context.Context, userID, chatID, callType, callKind, title string) (string, error) {
	if ok, err := s.IsMember(ctx, userID, chatID); err != nil || !ok {
		return "", ErrForbidden
	}
	dbCallType := "video"
	if callKind == "audio" || callType == "voice" {
		dbCallType = "voice"
	}
	var roomID string
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO calls.rooms (chat_id, type, title, initiator_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text
	`, chatID, dbCallType, title, userID).Scan(&roomID)
	if err == nil {
		s.CallRooms().CreateRoom(userID, roomID, callType, callKind, chatID, title)
	}
	return roomID, err
}

func (s *Service) GetMlsState(ctx context.Context, chatID string) (int64, string, error) {
	var epoch int64
	var treeState sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT epoch, tree_structure FROM crypto.group_mls_state WHERE chat_id = $1`, chatID).Scan(&epoch, &treeState)
	if err == sql.ErrNoRows {
		return 0, "", nil
	}
	return epoch, treeState.String, err
}

type leaveChatInput struct {
	ChatID string `validate:"required,uuid"`
}

type MemberRemovedEvent struct {
	Type   string `json:"type"`
	ChatID string `json:"chatId"`
	UserID string `json:"userId"`
	Reason string `json:"reason"`
}

func (s *Service) LeaveChat(ctx context.Context, userID, chatID string) error {
	input := leaveChatInput{ChatID: chatID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}

	role, err := s.memberRole(ctx, userID, chatID)
	if err != nil {
		return err
	}
	if role == "owner" {
		return ErrOwnershipTransferRequired
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	rows, err := tx.QueryContext(ctx, `SELECT user_id FROM chats.members WHERE chat_id = $1`, chatID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	var recipients []string
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			_ = rows.Close()
			_ = tx.Rollback()
			return err
		}
		recipients = append(recipients, memberID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		_ = tx.Rollback()
		return err
	}
	_ = rows.Close()

	if _, err := tx.ExecContext(ctx, `DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`, chatID, userID); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`, userID, chatID); err != nil {
		_ = tx.Rollback()
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2 AND role<>'owner'`, chatID, userID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_ = tx.Rollback()
		return ErrForbidden
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	if s.ws != nil {
		event := MemberRemovedEvent{
			Type:   "chat_member_removed",
			ChatID: chatID,
			UserID: userID,
			Reason: "left",
		}
		payload, err := json.Marshal(event)
		if err != nil {
			slog.Error("failed to marshal member_removed event", "err", err, "chatID", chatID, "userID", userID)
		} else {
			s.ws.BroadcastToUsers(recipients, payload)
		}
	}
	return nil
}

type transferOwnershipInput struct {
	ChatID string `validate:"required,uuid"`
	UserID string `validate:"required,uuid"`
}

func (s *Service) TransferOwnership(ctx context.Context, actorID, chatID, targetUserID string) error {
	// 1. Валидация UUID
	input := transferOwnershipInput{ChatID: chatID, UserID: targetUserID}
	if err := validate.Struct(input); err != nil {
		return ErrInvalidInput
	}

	// 2. Цель ≠ actor
	if targetUserID == actorID {
		return ErrInvalidInput
	}

	// 3. Транзакция: блокируем чат и membership-строку target,
	// проверяем актуального владельца и членство target, обновляем роли.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	var currentOwnerID string
	var chatType string
	err = tx.QueryRowContext(ctx,
		`SELECT owner_id, type FROM chats.chats WHERE id = $1 FOR UPDATE`,
		chatID).Scan(&currentOwnerID, &chatType)
	if err == sql.ErrNoRows {
		_ = tx.Rollback()
		return ErrNotFound
	}
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if chatType != "group" {
		_ = tx.Rollback()
		return ErrInvalidChatType
	}
	if currentOwnerID != actorID {
		_ = tx.Rollback()
		return ErrOwnershipConflict
	}

	var targetRole string
	err = tx.QueryRowContext(ctx,
		`SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`,
		chatID, targetUserID).Scan(&targetRole)
	if err == sql.ErrNoRows {
		_ = tx.Rollback()
		return ErrNotMember
	}
	if err != nil {
		_ = tx.Rollback()
		return err
	}

	// 4.1. Обновить chats.chats.owner_id
	res, err := tx.ExecContext(ctx,
		`UPDATE chats.chats SET owner_id = $1, updated_at = NOW() WHERE id = $2`,
		targetUserID, chatID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}

	n, err := res.RowsAffected()
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if n != 1 {
		_ = tx.Rollback()
		return ErrNotFound
	}

	// 4.2. Новый owner в members
	res, err = tx.ExecContext(ctx,
		`UPDATE chats.members SET role = 'owner' WHERE chat_id = $1 AND user_id = $2`,
		chatID, targetUserID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}

	n, err = res.RowsAffected()
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if n != 1 {
		_ = tx.Rollback()
		return ErrNotMember
	}

	// 4.3. Прежний owner в member
	res, err = tx.ExecContext(ctx,
		`UPDATE chats.members SET role = 'member' WHERE chat_id = $1 AND user_id = $2`,
		chatID, actorID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}

	n, err = res.RowsAffected()
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if n != 1 {
		_ = tx.Rollback()
		return ErrOwnershipConflict
	}

	return tx.Commit()
}

// AssertCanModerate проверяет иерархию ролей: owner модерирует admin/member,
// admin — только member, member — никого.
func AssertCanModerate(actorRole, targetRole string) error {
	switch actorRole {
	case "owner":
		if targetRole == "owner" {
			return ErrCannotModerateTarget
		}
	case "admin":
		if targetRole != "member" {
			return ErrCannotModerateTarget
		}
	default:
		return ErrCannotModerateTarget
	}
	return nil
}

type onlineMembersInput struct {
	ChatID string `validate:"required,uuid"`
	UserID string `validate:"required,uuid"`
}

// ensureGroupMember проверяет существование чата, членство пользователя
// и принадлежность чата к типу "group".
func (s *Service) ensureGroupMember(ctx context.Context, chatID, userID string) error {
	var chatType string
	err := s.db.QueryRowContext(ctx, "SELECT type FROM chats.chats WHERE id = $1", chatID).Scan(&chatType)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if _, err := s.memberRole(ctx, userID, chatID); err != nil {
		return err
	}

	if chatType != "group" {
		return ErrInvalidChatType
	}
	return nil
}

// chatMemberIDs возвращает список UUID участников чата в порядке их хранения в БД.
func (s *Service) chatMemberIDs(ctx context.Context, chatID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT user_id::text FROM chats.members WHERE chat_id = $1", chatID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	memberIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		memberIDs = append(memberIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memberIDs, nil
}

// GetOnlineMembers возвращает UUID участников группового чата, которые сейчас online
// (по presence.Store). Доступ только для участников чата; личные чаты не поддерживаются.
func (s *Service) GetOnlineMembers(ctx context.Context, chatID, userID string) ([]string, error) {
	if err := validate.Struct(onlineMembersInput{ChatID: chatID, UserID: userID}); err != nil {
		return nil, ErrInvalidInput
	}

	if err := s.ensureGroupMember(ctx, chatID, userID); err != nil {
		return nil, err
	}

	memberIDs, err := s.chatMemberIDs(ctx, chatID)
	if err != nil {
		return nil, err
	}

	return s.presence.OnlineUsers(ctx, memberIDs)
}
