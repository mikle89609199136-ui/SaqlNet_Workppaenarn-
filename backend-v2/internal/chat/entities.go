package chat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"unicode/utf16"
)

const maxMessageContentUnits = 16384

type MessageEntity struct {
	Type   string             `json:"type"`
	Offset int                `json:"offset"`
	Length int                `json:"length"`
	Data   *MessageEntityData `json:"data,omitempty"`
}

type MessageEntityData struct {
	URL string `json:"url"`
}

// UnmarshalJSON preserves required-field and data-presence checks that Go zero
// values cannot express. Semantic range checks are performed against content.
func (e *MessageEntity) UnmarshalJSON(raw []byte) error {
	var input struct {
		Type   *string         `json:"type"`
		Offset *int            `json:"offset"`
		Length *int            `json:"length"`
		Data   json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return err
	}
	if input.Type == nil {
		return fmt.Errorf("type is required and must be a string")
	}
	if input.Offset == nil {
		return fmt.Errorf("offset is required and must be an integer")
	}
	if input.Length == nil {
		return fmt.Errorf("length is required and must be an integer")
	}
	*e = MessageEntity{Type: *input.Type, Offset: *input.Offset, Length: *input.Length}
	if len(input.Data) != 0 {
		if e.Type != "link" {
			return fmt.Errorf("data must be absent for type %s", e.Type)
		}
		if err := json.Unmarshal(input.Data, &e.Data); err != nil {
			return fmt.Errorf("data: %w", err)
		}
	}
	return nil
}

// MessageEntities always serializes as an array, including messages produced by
// older INSERT paths that rely on the column default.
type MessageEntities []MessageEntity

func (e MessageEntities) MarshalJSON() ([]byte, error) {
	if e == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]MessageEntity(e))
}

func (e *MessageEntities) Scan(value any) error {
	var raw []byte
	switch v := value.(type) {
	case nil:
		*e = MessageEntities{}
		return nil
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		return fmt.Errorf("entities: unsupported database value %T", value)
	}
	return json.Unmarshal(raw, e)
}

func utf16Length(value string) int { return len(utf16.Encode([]rune(value))) }

func validateMessageContent(content string) error {
	if !isEncryptedMessagePayload(content) && utf16Length(content) > maxMessageContentUnits {
		return fmt.Errorf("%w: content must not exceed 16384 UTF-16 code units", ErrInvalidInput)
	}
	return nil
}

func parseMessageEntities(content string, raw json.RawMessage) (MessageEntities, error) {
	if err := validateMessageContent(content); err != nil {
		return nil, err
	}
	entities := MessageEntities{}
	if len(raw) != 0 {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil, fmt.Errorf("%w: entities must be an array", ErrInvalidInput)
		}
		if err := json.Unmarshal(raw, &entities); err != nil {
			return nil, fmt.Errorf("%w: entities: %v", ErrInvalidInput, err)
		}
	}
	return entities, validateMessageEntities(content, entities)
}

func validateMessageEntities(content string, entities MessageEntities) error {
	if err := validateMessageContent(content); err != nil {
		return err
	}
	fail := func(format string, args ...any) error {
		return fmt.Errorf("%w: entities: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
	}
	if len(entities) > 100 {
		return fail("at most 100 entries are allowed")
	}
	if isEncryptedMessagePayload(content) {
		if len(entities) != 0 {
			return fail("must be empty for encrypted content")
		}
		return nil
	}
	units := utf16.Encode([]rune(content))
	boundaries := make([]bool, len(units)+1)
	boundaries[0] = true
	position := 0
	for _, r := range content {
		position += utf16.RuneLen(r)
		boundaries[position] = true
	}
	for i, entity := range entities {
		switch entity.Type {
		case "bold", "italic", "underline", "strikethrough", "spoiler", "monospace", "link", "blockquote":
		default:
			return fail("[%d].type is unsupported", i)
		}
		// Subtraction avoids overflow for hostile integer values.
		if entity.Offset < 0 || entity.Offset > len(units) {
			return fail("[%d].offset is outside content", i)
		}
		if entity.Length <= 0 || entity.Length > len(units)-entity.Offset {
			return fail("[%d].length must be positive and end within content", i)
		}
		end := entity.Offset + entity.Length
		if !boundaries[entity.Offset] || !boundaries[end] {
			return fail("[%d].offset/length splits a UTF-16 surrogate pair", i)
		}
		if entity.Type == "link" {
			if entity.Data == nil || entity.Data.URL == "" {
				return fail("[%d].data.url is required", i)
			}
			if utf16Length(entity.Data.URL) > 2048 {
				return fail("[%d].data.url exceeds 2048 UTF-16 code units", i)
			}
			u, err := url.Parse(entity.Data.URL)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" {
				return fail("[%d].data.url must be an http or https URL with a host", i)
			}
		} else if entity.Data != nil {
			return fail("[%d].data must be absent for type %s", i, entity.Type)
		}
		if entity.Type == "blockquote" {
			if entity.Offset != 0 && units[entity.Offset-1] != '\n' {
				return fail("[%d].offset must start a whole line for blockquote", i)
			}
			if end != len(units) && units[end] != '\n' {
				return fail("[%d].length must end a whole line for blockquote", i)
			}
		}
	}
	for i, a := range entities {
		for j := i + 1; j < len(entities); j++ {
			b := entities[j]
			if a.Offset >= b.Offset+b.Length || b.Offset >= a.Offset+a.Length {
				continue
			}
			if a.Type == b.Type && (a.Type == "link" || a.Type == "blockquote") {
				return fail("[%d] and [%d]: %s ranges must not overlap", i, j, a.Type)
			}
			if a.Type == "blockquote" || b.Type == "blockquote" {
				quote, inline := a, b
				if b.Type == "blockquote" {
					quote, inline = b, a
				}
				if inline.Offset < quote.Offset || inline.Offset+inline.Length > quote.Offset+quote.Length {
					return fail("[%d] and [%d]: inline range crosses a blockquote boundary", i, j)
				}
			}
		}
	}
	return nil
}
