package chat

import (
	"context"

	"craneapp/backend-v2/internal/platform/privacy"
)

// Правило «Фото» в ответах чатов (#789).
//
// Аватар участника или отправителя виден зрителю по правилу «Фото» — с
// блокировкой и исключениями, как везде (privacy.HidePhotos). В ответах
// REST решается за того, кто спрашивает.
//
// В рассылках аватара нет вовсе: одно событие уходит всем участникам чата,
// и решить за каждого получателя в нём нельзя. Клиент аватары из событий не
// берёт — на chat_member_added он перечитывает участников, а senderAvatar
// не читает совсем.

func (s *Service) hideMemberPhotos(ctx context.Context, viewerID string, members []Member) error {
	slots := make([]privacy.PhotoSlot, len(members))
	for i := range members {
		slots[i] = privacy.PhotoSlot{OwnerID: members[i].ID, URL: &members[i].AvatarURL}
	}
	return privacy.HidePhotos(ctx, s.db, viewerID, slots)
}

func (s *Service) hideSenderPhotos(ctx context.Context, viewerID string, messages ...*Message) error {
	slots := make([]privacy.PhotoSlot, 0, len(messages))
	for _, msg := range messages {
		if msg != nil {
			slots = append(slots, privacy.PhotoSlot{OwnerID: msg.SenderID, URL: &msg.SenderAvatar})
		}
	}
	return privacy.HidePhotos(ctx, s.db, viewerID, slots)
}

func (s *Service) hideMessageListPhotos(ctx context.Context, viewerID string, messages []Message) error {
	pointers := make([]*Message, len(messages))
	for i := range messages {
		pointers[i] = &messages[i]
	}
	return s.hideSenderPhotos(ctx, viewerID, pointers...)
}

// memberForBroadcast — участник для события всем участникам: без аватара.
func memberForBroadcast(m Member) *Member {
	m.AvatarURL = ""
	return &m
}

// forBroadcast — сообщение для события всем участникам: без аватара
// отправителя.
func forBroadcast(msg *Message) *Message {
	if msg == nil {
		return nil
	}
	copied := *msg
	copied.SenderAvatar = ""
	copied.IsPersonalPinned = false
	return &copied
}
