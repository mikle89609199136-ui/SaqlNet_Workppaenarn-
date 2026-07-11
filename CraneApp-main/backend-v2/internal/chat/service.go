package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

var (
	ErrNotFound      = errors.New("chat not found")
	ErrForbidden     = errors.New("access denied")
	ErrInvalidInput  = errors.New("invalid input")
	ErrUserNotFound  = errors.New("user not found")
	ErrBlockedByUser = errors.New("blocked by user")
)

type Chat struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	AvatarURL     string `json:"avatarUrl"`
	PeerPublicKey string `json:"peerPublicKey,omitempty"`
	PeerID        string `json:"peerId,omitempty"`
	OwnerID       string `json:"ownerId"`
	Role          string `json:"role"`
	IsPinned      bool   `json:"isPinned"`
	IsArchived    bool   `json:"isArchived"`
	LastReadAt    string `json:"lastReadAt,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	MemberCount   int                 `json:"memberCount"`
	LastMessageAt string              `json:"lastMessageAt,omitempty"`
	UnreadCount   int                 `json:"unreadCount"`
	LastMessage   *LastMessagePreview `json:"lastMessage,omitempty"`
}

type LastMessagePreview struct {
	Content    string `json:"content"`
	Type       string `json:"type"`
	SenderName string `json:"senderName"`
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
	JoinedAt    string         `json:"joinedAt"`
}

type Message struct {
	ID           string         `json:"id"`
	ChatID       string         `json:"chatId"`
	SenderID     string         `json:"senderId"`
	SenderName   string         `json:"senderName,omitempty"`
	SenderAvatar string         `json:"senderAvatar,omitempty"`
	Content      string         `json:"content"`
	Type         string         `json:"type"`
	ReplyTo      *string        `json:"replyTo,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	IsPinned     bool           `json:"isPinned"`
	IsEdited     bool           `json:"isEdited"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
	DeletedAt    *string        `json:"deletedAt,omitempty"`
}

type Service struct {
	db *sql.DB
	ws *WSServer
}

func NewService(db *sql.DB, ws *WSServer) *Service {
	return &Service{db: db, ws: ws}
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
		       COUNT(DISTINCT m.id) FILTER (
		         WHERE (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
		           AND (m.sender_id IS NULL OR m.sender_id <> $1)
		       )::int,
		       lm.content, lm.type, COALESCE(lm_up.first_name, lm_au.first_name, lm_au.username, '')
		FROM chats.chats c
		JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = $1
		LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = $1
		LEFT JOIN chats.members cm_all ON cm_all.chat_id = c.id
		LEFT JOIN messages.messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
		LEFT JOIN LATERAL (
		  SELECT au.id::text AS peer_id,
		         COALESCE(up.first_name, au.first_name, '') AS first_name,
		         COALESCE(up.last_name,  au.last_name,  '') AS last_name,
		         COALESCE(up.avatar_url, '') AS avatar_url,
		         au.username || '.' || au.username_discriminator::text AS display_username
		  FROM chats.members pm
		  JOIN auth.users au ON au.id = pm.user_id
		  LEFT JOIN users.profiles up ON up.user_id = pm.user_id
		  WHERE pm.chat_id = c.id AND pm.user_id != $1
		  LIMIT 1
		) peer ON c.type = 'private'
		LEFT JOIN LATERAL (
		  SELECT sender_id, content, type
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
		         lm.content, lm.type, lm_up.first_name, lm_au.first_name, lm_au.username
		ORDER BY COALESCE(cs.is_pinned, FALSE) DESC, MAX(m.created_at) DESC NULLS LAST, c.updated_at DESC
	`, userID, archived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChats(rows)
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
		       COUNT(DISTINCT m.id) FILTER (
		         WHERE (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
		           AND (m.sender_id IS NULL OR m.sender_id <> $1)
		       )::int,
		       lm.content, lm.type, COALESCE(lm_up.first_name, lm_au.first_name, lm_au.username, '')
		FROM chats.chats c
		JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = $1
		LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = $1
		LEFT JOIN chats.members cm_all ON cm_all.chat_id = c.id
		LEFT JOIN messages.messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
		LEFT JOIN LATERAL (
		  SELECT au.id::text AS peer_id,
		         COALESCE(up.first_name, au.first_name, '') AS first_name,
		         COALESCE(up.last_name,  au.last_name,  '') AS last_name,
		         COALESCE(up.avatar_url, '') AS avatar_url,
		         au.username || '.' || au.username_discriminator::text AS display_username
		  FROM chats.members pm
		  JOIN auth.users au ON au.id = pm.user_id
		  LEFT JOIN users.profiles up ON up.user_id = pm.user_id
		  WHERE pm.chat_id = c.id AND pm.user_id != $1
		  LIMIT 1
		) peer ON c.type = 'private'
		LEFT JOIN LATERAL (
		  SELECT sender_id, content, type
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
		         lm.content, lm.type, lm_up.first_name, lm_au.first_name, lm_au.username
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
	chat := chats[0]
	if chat.Type == "private" {
		chat.PeerPublicKey, err = s.peerPublicKey(ctx, userID, chatID)
		if err != nil {
			return Chat{}, err
		}
	}
	return chat, nil
}

func (s *Service) CreatePrivate(ctx context.Context, userID, peerID string) (string, bool, error) {
	if peerID == "" || peerID == userID {
		return "", false, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback()

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

func (s *Service) CreateGroup(ctx context.Context, ownerID, title, description, avatarURL string, members []string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" || len(members) == 0 {
		return "", ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var chatID string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO chats.chats (type, title, description, avatar_url, owner_id)
		VALUES ('group', $1, $2, $3, $4)
		RETURNING id::text
	`, title, description, avatarURL, ownerID).Scan(&chatID); err != nil {
		return "", err
	}
	seen := map[string]bool{ownerID: true}
	if _, err := tx.ExecContext(ctx, `INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, 'owner')`, chatID, ownerID); err != nil {
		return "", err
	}
	for _, memberID := range members {
		if memberID == "" || seen[memberID] {
			continue
		}
		seen[memberID] = true
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO chats.members (chat_id, user_id, role)
			SELECT $1, id, 'member' FROM auth.users WHERE id = $2 AND disabled_at IS NULL
			ON CONFLICT DO NOTHING
		`, chatID, memberID); err != nil {
			return "", err
		}
	}
	return chatID, tx.Commit()
}

func (s *Service) UpdateChat(ctx context.Context, actorID, chatID, title, description, avatarURL string) (Chat, error) {
	role, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return Chat{}, err
	}
	if role != "owner" && role != "admin" {
		return Chat{}, ErrForbidden
	}

	title = strings.TrimSpace(title)
	if title == "" {
		return Chat{}, ErrInvalidInput
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE chats.chats
		SET title = $1, description = $2, avatar_url = $3, updated_at = NOW()
		WHERE id = $4
	`, title, description, avatarURL, chatID)
	if err != nil {
		return Chat{}, err
	}

	return s.Get(ctx, actorID, chatID)
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
		       COALESCE(up.avatar_url, ''), cm.role, cm.permissions, COALESCE(cm.muted_until::text, ''), cm.joined_at::text
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
		if err := rows.Scan(&member.ID, &member.Username, &member.FirstName, &member.LastName, &member.AvatarURL, &member.Role, &permissions, &member.MutedUntil, &member.JoinedAt); err != nil {
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
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" {
		return ErrForbidden
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE chats.members SET role = $1
		WHERE chat_id = $2 AND user_id = $3 AND role <> 'owner'
	`, role, chatID, memberID)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrForbidden
	}
	return nil
}

func (s *Service) RemoveMember(ctx context.Context, actorID, chatID, memberID string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM chats.members
		WHERE chat_id = $1 AND user_id = $2 AND role <> 'owner'
	`, chatID, memberID)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrForbidden
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

func (s *Service) AddMember(ctx context.Context, actorID, chatID, userID string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	// Check if banned.
	var dummy int
	err = s.db.QueryRowContext(ctx,
		`SELECT 1 FROM chats.bans WHERE chat_id = $1 AND user_id = $2 AND (banned_until IS NULL OR banned_until > NOW())`,
		chatID, userID).Scan(&dummy)
	if err == nil {
		return ErrForbidden // user is banned
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, 'member')
		ON CONFLICT DO NOTHING
	`, chatID, userID)
	return err
}

func (s *Service) BanMember(ctx context.Context, actorID, chatID, userID, reason string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Remove from chat.
	_, _ = tx.ExecContext(ctx, `DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2 AND role <> 'owner'`, chatID, userID)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO chats.bans (chat_id, user_id, banned_by, reason)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chat_id, user_id) DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, banned_until = NULL, created_at = NOW()
	`, chatID, userID, actorID, reason)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) UnbanMember(ctx context.Context, actorID, chatID, userID string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM chats.bans WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	return err
}

func (s *Service) ListBans(ctx context.Context, actorID, chatID string) ([]Ban, error) {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return nil, err
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

func (s *Service) MuteMember(ctx context.Context, actorID, chatID, userID string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE chats.members SET muted_until = NOW() + INTERVAL '365 days'
		WHERE chat_id = $1 AND user_id = $2 AND role <> 'owner'
	`, chatID, userID)
	return err
}

func (s *Service) UnmuteMember(ctx context.Context, actorID, chatID, userID string) error {
	actorRole, err := s.memberRole(ctx, actorID, chatID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE chats.members SET muted_until = NULL
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID)
	return err
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
		var lmContent, lmType, lmSender sql.NullString
		if err := rows.Scan(
			&chat.ID, &chat.Type, &chat.Title, &chat.Description, &chat.AvatarURL,
			&chat.OwnerID, &chat.Role, &chat.IsPinned, &chat.IsArchived, &chat.LastReadAt,
			&chat.CreatedAt, &chat.UpdatedAt, &chat.MemberCount, &chat.LastMessageAt,
			&chat.PeerID,
			&unreadCount, &lmContent, &lmType, &lmSender,
		); err != nil {
			return nil, err
		}
		chat.UnreadCount = unreadCount
		if lmContent.Valid || lmType.Valid {
			chat.LastMessage = &LastMessagePreview{
				Content:    lmContent.String,
				Type:       lmType.String,
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
	`, chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMessages(rows)
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
			json.Unmarshal(metadataBytes, &msg.Metadata)
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func (s *Service) SendMessage(ctx context.Context, userID, chatID, content, msgType string, replyTo *string) (Message, error) {
	var role string
	var isMuted sql.NullBool
	err := s.db.QueryRowContext(ctx, `
		SELECT cm.role, 
		       (
		         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR 
		         (cm.role = 'member' AND cm.muted_until > NOW())
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
		return Message{}, ErrForbidden
	}

	var replyToSQL sql.NullString
	if replyTo != nil && *replyTo != "" {
		replyToSQL = sql.NullString{String: *replyTo, Valid: true}
	}

	var msg Message
	var replyToStr sql.NullString
	var deletedAt sql.NullString
	var metadataBytes []byte
	err = s.db.QueryRowContext(ctx, `
		WITH inserted AS (
			INSERT INTO messages.messages (chat_id, sender_id, content, type, reply_to)
			VALUES ($1, $2, $3, $4, $5)
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
	`, chatID, userID, content, msgType, replyToSQL).Scan(
		&msg.ID, &msg.ChatID, &msg.SenderID,
		&msg.SenderName, &msg.SenderAvatar,
		&msg.Content, &msg.Type, &replyToStr, &metadataBytes,
		&msg.IsPinned, &msg.IsEdited,
		&msg.CreatedAt, &msg.UpdatedAt, &deletedAt)
	if err != nil {
		return Message{}, err
	}
	if replyToStr.Valid {
		msg.ReplyTo = &replyToStr.String
	}
	if deletedAt.Valid {
		msg.DeletedAt = &deletedAt.String
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
	var msg Message
	var replyToStr sql.NullString
	var deletedAt sql.NullString
	var metadataBytes []byte

	// Require sender to be a current member of the chat to prevent editing after being kicked.
	err := s.db.QueryRowContext(ctx, `
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

func (s *Service) DeleteMessage(ctx context.Context, userID, messageID string) error {
	var chatID string
	// Require sender to be a current member to prevent deletion after being kicked.
	err := s.db.QueryRowContext(ctx, `
		UPDATE messages.messages AS m
		SET deleted_at = NOW()
		FROM chats.members AS cm
		WHERE m.id = $1 AND (m.sender_id = $2 OR cm.role = 'owner' OR (cm.role = 'admin' AND cm.permissions->>'can_delete_messages' = 'true')) AND m.deleted_at IS NULL
		  AND cm.chat_id = m.chat_id AND cm.user_id = $2
		RETURNING m.chat_id::text
	`, messageID, userID).Scan(&chatID)

	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":      "message_deleted",
			"chatId":    chatID,
			"messageId": messageID,
		})
		s.ws.BroadcastToChat(chatID, payload, userID)
	}

	return nil
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
		SELECT id::text, chat_id::text, sender_id::text, content, type, reply_to::text, metadata, created_at::text, updated_at::text, deleted_at::text
		FROM messages.messages WHERE id = $1 AND deleted_at IS NULL
	`, messageID).Scan(&src.ID, &src.ChatID, &src.SenderID, &src.Content, &src.Type, &replyTo, &metadataBytes, &src.CreatedAt, &src.UpdatedAt, &deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}

	if ok, err := s.isMember(ctx, userID, src.ChatID); err != nil || !ok {
		if err != nil {
			return Message{}, err
		}
		return Message{}, ErrForbidden
	}

	forwardedFrom := src.ID
	msg, err := s.SendMessage(ctx, userID, targetChatID, src.Content, src.Type, nil)
	if err != nil {
		return Message{}, err
	}
	_, _ = s.db.ExecContext(ctx, `
		UPDATE messages.messages SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{forwardedFrom}', to_jsonb($1::text)) WHERE id = $2
	`, forwardedFrom, msg.ID)
	return msg, nil
}

// Reaction types.

type Reaction struct {
	Emoji      string `json:"emoji"`
	Count      int    `json:"count"`
	MyReaction bool   `json:"myReaction"`
}

func (s *Service) ListReactions(ctx context.Context, userID, messageID string) ([]Reaction, error) {
	rows, err := s.db.QueryContext(ctx, `
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
	var result []Reaction
	for rows.Next() {
		var r Reaction
		if err := rows.Scan(&r.Emoji, &r.Count, &r.MyReaction); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// ToggleReaction adds or removes a reaction (toggle semantics).
// Returns (added bool, updated reactions, error).
func (s *Service) ToggleReaction(ctx context.Context, userID, messageID, emoji string) (bool, []Reaction, error) {
	if emoji == "" {
		return false, nil, ErrInvalidInput
	}
	if len(emoji) > 64 || strings.ContainsAny(emoji, "<>\"'&/\\") {
		return false, nil, ErrInvalidInput
	}

	var chatID string
	if err := s.db.QueryRowContext(ctx, `SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&chatID); errors.Is(err, sql.ErrNoRows) {
		return false, nil, ErrNotFound
	} else if err != nil {
		return false, nil, err
	}

	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return false, nil, err
		}
		return false, nil, ErrForbidden
	}

	var existingID string
	err := s.db.QueryRowContext(ctx, `SELECT id::text FROM messages.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, messageID, userID, emoji).Scan(&existingID)
	added := errors.Is(err, sql.ErrNoRows)
	if added {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`, messageID, userID, emoji); err != nil {
			return false, nil, err
		}
	} else if err == nil {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, messageID, userID, emoji); err != nil {
			return false, nil, err
		}
	} else {
		return false, nil, err
	}

	reactions, err := s.ListReactions(ctx, userID, messageID)
	if err != nil {
		return added, nil, err
	}

	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":      "reaction_updated",
			"chatId":    chatID,
			"messageId": messageID,
			"reactions": reactions,
		})
		s.ws.BroadcastToChat(chatID, payload, "")
	}

	return added, reactions, nil
}

// Message pin types.

type Pin struct {
	ID        string `json:"id"`
	MessageID string `json:"messageId"`
	ChatID    string `json:"chatId"`
	PinnedBy  string `json:"pinnedBy"`
	PinnedAt  string `json:"pinnedAt"`
}

func (s *Service) ListPins(ctx context.Context, userID, chatID string) ([]Pin, error) {
	if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, message_id::text, chat_id::text, pinned_by::text, pinned_at::text
		FROM messages.pins WHERE chat_id = $1 ORDER BY pinned_at DESC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pins []Pin
	for rows.Next() {
		var p Pin
		if err := rows.Scan(&p.ID, &p.MessageID, &p.ChatID, &p.PinnedBy, &p.PinnedAt); err != nil {
			return nil, err
		}
		pins = append(pins, p)
	}
	return pins, rows.Err()
}

func (s *Service) PinMessage(ctx context.Context, userID, chatID, messageID string) error {
	role, err := s.memberRole(ctx, userID, chatID)
	if err != nil {
		return err
	}
	if role == "member" {
		return ErrForbidden
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO messages.pins (chat_id, message_id, pinned_by)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
	`, chatID, messageID, userID)
	if err != nil {
		return err
	}
	if s.ws != nil {
		payload, _ := json.Marshal(map[string]any{"type": "message_pinned", "chatId": chatID, "messageId": messageID})
		s.ws.BroadcastToChat(chatID, payload, "")
	}
	return nil
}

func (s *Service) UnpinMessage(ctx context.Context, userID, chatID, messageID string) error {
	role, err := s.memberRole(ctx, userID, chatID)
	if err != nil {
		return err
	}
	if role == "member" {
		return ErrForbidden
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM messages.pins WHERE chat_id = $1 AND message_id = $2`, chatID, messageID)
	if err != nil {
		return err
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
	return scanMessages(rows)
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
	return scanMessages(rows)
}

func (s *Service) CreateCallRoom(ctx context.Context, userID, chatID, callType, callKind, title string) (string, error) {
	if ok, err := s.IsMember(ctx, userID, chatID); err != nil || !ok {
		return "", ErrForbidden
	}
	var roomID string
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO calls.rooms (chat_id, type, title, initiator_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text
	`, chatID, callType, title, userID).Scan(&roomID)
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