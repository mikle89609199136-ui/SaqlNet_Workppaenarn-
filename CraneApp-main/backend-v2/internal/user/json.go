package user

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
)

type jsonMap map[string]any
type jsonArray []any

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

func (a jsonArray) Value() (driver.Value, error) {
	if a == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]any(a))
}

func (a *jsonArray) Scan(value any) error {
	if value == nil {
		*a = jsonArray{}
		return nil
	}
	var bytes []byte
	switch typed := value.(type) {
	case []byte:
		bytes = typed
	case string:
		bytes = []byte(typed)
	default:
		return fmt.Errorf("unsupported json array type %T", value)
	}
	return json.Unmarshal(bytes, a)
}

type pqStringArray []string

func (a *pqStringArray) Scan(value any) error {
	if value == nil {
		*a = []string{}
		return nil
	}
	raw, ok := value.(string)
	if !ok {
		if bytes, ok := value.([]byte); ok {
			raw = string(bytes)
		} else {
			return fmt.Errorf("unsupported string array type %T", value)
		}
	}
	raw = strings.Trim(raw, "{}")
	if raw == "" {
		*a = []string{}
		return nil
	}
	*a = strings.Split(raw, ",")
	return nil
}
