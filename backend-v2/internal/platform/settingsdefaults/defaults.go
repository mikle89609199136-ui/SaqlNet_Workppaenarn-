// Package settingsdefaults содержит единый источник defaults (#451).
// SQL defaults — версионированный снимок defaults.json, сгенерированный
// cmd/settings-defaults-migration. Старые миграции не регенерируются.
package settingsdefaults

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

//go:embed defaults.json
var source []byte

var defaults = func() map[string]json.RawMessage {
	var values map[string]json.RawMessage
	if err := json.Unmarshal(source, &values); err != nil {
		panic(err) // Ошибка встроенного артефакта, не пользовательского JSON.
	}
	return values
}()

// Values возвращает независимую копию: callers не меняют общие defaults.
func Values() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(defaults))
	for key, value := range defaults {
		out[key] = append(json.RawMessage(nil), value...)
	}
	return out
}

func Object(section string) map[string]any {
	if section == "legacy_settings" {
		section = "settings"
	}
	var object map[string]any
	if err := json.Unmarshal(defaults[section], &object); err != nil || object == nil {
		panic("unknown settings defaults section: " + section)
	}
	return object
}

// MigrationSQL создаёт только ALTER DEFAULT, без backfill/перезаписи данных.
func MigrationSQL() string {
	values := Values()
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	out.WriteString("-- Generated from internal/platform/settingsdefaults/defaults.json (#451).\n")
	out.WriteString("-- Future changes require a NEW migration; do not regenerate applied files.\n")
	for _, key := range keys {
		var value any
		if err := json.Unmarshal(values[key], &value); err != nil {
			panic(err)
		}
		compact, err := json.Marshal(value)
		if err != nil {
			panic(err)
		}
		literal := string(compact)
		if key != "passcode_enabled" && key != "passcode_timeout" {
			literal = "'" + strings.ReplaceAll(literal, "'", "''") + "'::jsonb"
		}
		fmt.Fprintf(&out, "ALTER TABLE users.settings ALTER COLUMN %s SET DEFAULT %s;\n", key, literal)
	}
	return out.String()
}
