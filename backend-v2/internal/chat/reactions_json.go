package chat

import "encoding/json"

// MessageReactions keeps the HTTP and WebSocket contract independent of whether
// a message was hydrated or just created. Like MessageEntities, its zero value
// encodes as an empty array.
type MessageReactions []Reaction

func (r MessageReactions) MarshalJSON() ([]byte, error) {
	if r == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]Reaction(r))
}
