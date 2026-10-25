// Package notificationpolicy читает только canonical booleans после миграции
// #1042. Legacy fallback намеренно не повторяется при GET/push/refetch.
package notificationpolicy

import "encoding/json"

type Flags struct {
	Notifications bool
	Sounds        bool
	CallSounds    bool
}

func Read(raw []byte) Flags {
	if len(raw) == 0 { // У аккаунта ещё нет settings row.
		return Flags{true, true, true}
	}
	var values map[string]any
	if json.Unmarshal(raw, &values) != nil || values == nil {
		return Flags{}
	}
	return FromMap(values)
}

func FromMap(values map[string]any) Flags {
	if values == nil {
		return Flags{}
	}
	boolean := func(key string) bool {
		value, exists := values[key]
		if !exists {
			return true
		}
		valid, ok := value.(bool)
		return ok && valid
	}
	return Flags{boolean("notifications"), boolean("sounds"), boolean("callSounds")}
}

func (f Flags) Map() map[string]any {
	return map[string]any{"notifications": f.Notifications, "sounds": f.Sounds, "callSounds": f.CallSounds}
}

// ProjectSound меняет только response map, не compatibility data в БД.
func (f Flags) ProjectSound(sound map[string]any) {
	sound["messagesSound"] = f.Sounds
	sound["notificationsSound"] = f.Sounds
	sound["callsSound"] = f.CallSounds
}
