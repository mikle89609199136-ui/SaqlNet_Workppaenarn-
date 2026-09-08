package chat

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}
