package chat

import "time"

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}

// forward structurs

type TAttachment struct {
	MediaURL       string `json:"mediaUrl" validate:"required"`
	ContentType    string `json:"contentType" validate:"required"`
	FileName       string `json:"fileName"`
	FileSize       int64  `json:"fileSize" validate:"required,gt=0"`
	MediaEncrypted bool   `json:"mediaEncrypted" validate:"eq=true"`
}

type AttachmentResponse struct {
	ID             string    `json:"id"`
	MessageID      string    `json:"messageId"`
	Position       int       `json:"position"`
	MediaURL       string    `json:"mediaUrl"`
	MediaType      string    `json:"mediaType"`
	FileName       string    `json:"fileName"`
	SizeBytes      int64     `json:"sizeBytes"`
	MediaEncrypted bool      `json:"mediaEncrypted"`
	CreatedAt      time.Time `json:"createdAt"`
}

type TForwardedFrom struct {
	MessageID  string `json:"messageId" validate:"required,uuid"`
	SenderID   string `json:"senderId" validate:"required,uuid"`
	SenderName string `json:"senderName" validate:"required"`
}

type ResForwardMessage struct {
	Message
	Attachments []AttachmentResponse `json:"attachments"`
}

type TMessageForwardMetadata struct {
	Forwarded     bool            `json:"forwarded"`
	ForwardedFrom *TForwardedFrom `json:"forwardedFrom,omitempty" validate:"omitemptyrequired_if=Forwarded true"`
}

type TMessages struct {
	MessageID  string         `json:"messageId" validate:"required,uuid"`
	SenderID   string         `json:"senderId" validate:"required,uuid"`
	Content    string         `json:"content" validate:"omitempty,base64,max=65535"`
	Attachments []TAttachment `json:"attachments,omitempty" validate:"omitempty,max=10,dive"`

	Type     string                   `json:"type" validate:"required"`
	ReplyTo  *string                  `json:"replyTo,omitempty" validate:"omitempty,uuid"`
	Metadata *TMessageForwardMetadata `json:"metadata,omitempty"`
}

type ForwardMessageInput struct {
	ChatID       string      `json:"chatId" validate:"required,uuid"`
	TargetChatID string      `json:"targetChatId" validate:"required,uuid"`
	Messages     []TMessages `json:"messages" validate:"required,gt=0,max=100,dive"`
	Caption      string      `json:"caption" validate:"omitempty,base64,max=65535"`
}
