package chat

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}

type MediaEncryptionData struct {
	Algorithm string `json:"algorithm"`
	Encrypted bool   `json:"encrypted"`
	FileName  string `json:"fileName,omitempty"`
	IV        string `json:"iv"`
	MimeType  string `json:"mimeType"`
	SizeBytes int64  `json:"sizeBytes"`
	Version   int    `json:"version"`
}

type SendMessageAttachmentInput struct {
	MediaURL        string               `json:"mediaUrl"`
	MediaType       string               `json:"mediaType"`
	FileName        string               `json:"fileName"`
	SizeBytes       int64                `json:"sizeBytes"`
	MediaEncrypted  bool                 `json:"mediaEncrypted"`
	MediaEncryption *MediaEncryptionData `json:"mediaEncryption"`
}

type SendMessageInput struct {
	Content     string                       `json:"content"`
	Type        string                       `json:"type"`
	ReplyTo     *string                      `json:"replyTo,omitempty"`
	IsEncrypted bool                         `json:"isEncrypted"`
	Attachments []SendMessageAttachmentInput `json:"attachments,omitempty"`
}
