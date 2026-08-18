package chat

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}


type TAttachment struct {
	CDNAttachmentID    string `json:"cdnAttachmentId" validate:"required"`
	MediaDecryptionKey string `json:"mediaDecryptionKey" validate:"required"`
	ContentType        string `json:"contentType" validate:"required"`
	SHA256Digest       string `json:"sha256Digest" validate:"required"`
	FileSize           int64  `json:"fileSize" validate:"required,gt=0"`
	FileName           string `json:"fileName"`
}


type TForwardedFrom struct {
	MessageID  string `json:"messageId" validate:"required,uuid"`
	SenderID   string `json:"senderId" validate:"required,uuid"`
	SenderName string `json:"senderName" validate:"required,min=1"`
}

type TMessageForwardMetadata struct {
	Forwarded     bool            `json:"forwarded"`
	ForwardedFrom *TForwardedFrom `json:"forwardedFrom,omitempty" validate:"required_if=Forwarded true,omitempty"`
}

type TMessages struct {
	MessageID      string                       `json:"messageId" validate:"required,uuid"`
	ChatID         string                       `json:"chatId" validate:"required,uuid"`
	SenderID       string                       `json:"senderId" validate:"required,uuid"`
	Content        string                       `json:"content" validate:"omitempty,base64,max=65535"` 
	Attachment     []TAttachment                `json:"attachment,omitempty" validate:"omitempty,max=10,dive"`

	Type           string                       `json:"type" validate:"required"`
	ReplyTo        *string                      `json:"replyTo,omitempty" validate:"omitempty,uuid"`
	Metadata       *TMessageForwardMetadata     `json:"metadata,omitempty"`
}



type ForwardMessageInput struct {
	ChatID       string       `json:"chatId" validate:"required,uuid"`
	TargetChatID string       `json:"targetChatId" validate:"required,uuid"`
	Messages     []TMessages  `json:"messages" validate:"required,gt=0,max=100,dive"` 
	Caption      string       `json:"caption" validate:"base64,max=65535,omitempty"`
}