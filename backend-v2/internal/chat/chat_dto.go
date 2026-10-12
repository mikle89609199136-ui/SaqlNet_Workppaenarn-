package chat

type UserID struct {
	UserID string `json:"userId" validate:"required,uuid"`
}

type ChatID struct {
	ChatID string `json:"chatId" validate:"required,uuid"`
}

type UUIDInput struct {
	ID string `validate:"required,uuid"`
}

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}

type CreateGroupRequest struct {
	Title       string `json:"title" validate:"required,max=128"`
	Description string `json:"description"`
	AvatarURL   string `json:"avatarUrl"`
	// Может быть пустым: группа из одного владельца — свои заметки, черновики
	// для будущих участников. Сам список обязателен (null — ошибка запроса).
	Members []string `json:"members" validate:"required,dive,uuid"`
}
