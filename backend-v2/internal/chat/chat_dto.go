package chat

import "time"

type UserID struct {
	UserID string `json:"userId" validate:"required,uuid"`
}

type ChatID struct {
	ChatID string `json:"chatId" validate:"required,uuid"`
}

type PinsData struct {
	ChatID    string `validate:"required,uuid"`
	MessageID string `validate:"required,uuid"`
}

// forward structurs

type TAttachment struct {
	MediaURL       string `json:"mediaUrl" validate:"required"`
	ContentType    string `json:"contentType" validate:"required"`
	FileName       string `json:"fileName,required" validate:"required"`
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
	Forwarded     bool           `json:"forwarded" validate:"eq=true"`
	ForwardedFrom TForwardedFrom `json:"forwardedFrom" validate:"required"`
}

type TE2EContent struct {
	E2E                bool   `json:"e2e" validate:"eq=true"`
	IV                 string `json:"iv" validate:"required"`
	Data               string `json:"data" validate:"required"`
	SenderPublicKey    string `json:"senderPublicKey" validate:"required,max=1024"`
	SenderKeyFp        string `json:"senderKeyFp" validate:"required"`
	RecipientPubKeyB64 string `json:"recipientPubKeyB64" validate:"required,base64,max=65535"`
	RecipientKeyFp     string `json:"recipientKeyFp" validate:"required"`
}

type TMessages struct {
	MessageID   string        `json:"messageId" validate:"required,uuid"`
	SenderID    string        `json:"senderId" validate:"required,uuid"`
	Content     string        `json:"content,omitempty" validate:"omitempty"`
	Attachments []TAttachment `json:"attachments,omitempty" validate:"omitempty,max=10,dive"`
}

type ForwardMessageInput struct {
	ChatID       string      `json:"chatId" validate:"required,uuid"`
	TargetChatID string      `json:"targetChatId" validate:"required,uuid"`
	Messages     []TMessages `json:"messages" validate:"required,gt=0,max=100,dive"`
	Caption      string      `json:"caption,omitempty" validate:"omitempty"`
}

type CreateGroupRequest struct {
	Title       string   `json:"title" validate:"required,max=128"`
	Description string   `json:"description"`
	AvatarURL   string   `json:"avatarUrl"`
	Members     []string `json:"members" validate:"required,min=1,dive,uuid"`
}
