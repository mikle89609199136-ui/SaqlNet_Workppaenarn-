package chat

type MessageType string

const (
	MessageTypeText    MessageType = "text"
	MessageTypeImage   MessageType = "image"
	MessageTypeAudio   MessageType = "audio"
	MessageTypeVideo   MessageType = "video"
	MessageTypeVoice   MessageType = "voice"
	MessageTypeSticker MessageType = "sticker"
	MessageTypeGIF     MessageType = "gif"
	MessageTypeFile    MessageType = "file"
)

var allowedClientMessageTypes = map[string]struct{}{
	string(MessageTypeText):    {},
	string(MessageTypeImage):   {},
	string(MessageTypeAudio):   {},
	string(MessageTypeVideo):   {},
	string(MessageTypeVoice):   {},
	string(MessageTypeSticker): {},
	string(MessageTypeGIF):     {},
	string(MessageTypeFile):    {},
}

func isAllowedClientMessageType(value string) bool {
	_, ok := allowedClientMessageTypes[value]
	return ok
}
