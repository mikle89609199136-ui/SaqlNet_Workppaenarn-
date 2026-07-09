package chat

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

type jsonMap map[string]any

func (m jsonMap) Value() (driver.Value, error) {
	if m == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(map[string]any(m))
}

func (m *jsonMap) Scan(value any) error {
	if value == nil {
		*m = jsonMap{}
		return nil
	}
	var bytes []byte
	switch typed := value.(type) {
	case []byte:
		bytes = typed
	case string:
		bytes = []byte(typed)
	default:
		return fmt.Errorf("unsupported json map type %T", value)
	}
	return json.Unmarshal(bytes, m)
}
