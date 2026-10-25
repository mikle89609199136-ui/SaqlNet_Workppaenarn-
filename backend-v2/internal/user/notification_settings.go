package user

import (
	"encoding/json"
	"fmt"
	"maps"
)

// Вызывается после domain validation, но до BEGIN/ensure. Проигравшие aliases
// уже проверены; приоритет определяется переданными keys, не прошлым snapshot.
func notificationPatch(input AllSettings) (AllSettings, error) {
	if len(input.SoundSettings) == 0 {
		return input, nil
	}
	var general SettingsPatch
	var sound SoundSettingsPatch
	for _, part := range []struct {
		patch map[string]any
		dto   any
	}{{input.Settings, &general}, {input.SoundSettings, &sound}} {
		data, err := json.Marshal(part.patch)
		if err != nil {
			return AllSettings{}, fmt.Errorf("%w: invalid sound patch", ErrInvalidSettings)
		}
		if err := json.Unmarshal(data, part.dto); err != nil {
			return AllSettings{}, fmt.Errorf("%w: invalid sound patch", ErrInvalidSettings)
		}
	}
	if general.Sounds == nil && sound.MessagesSound != nil && sound.NotificationsSound != nil &&
		*sound.MessagesSound != *sound.NotificationsSound {
		return AllSettings{}, fmt.Errorf("%w: conflicting message sound aliases", ErrInvalidSettings)
	}
	canonical := maps.Clone(input.Settings)
	if canonical == nil {
		canonical = make(map[string]any)
	}
	if general.Sounds == nil {
		if sound.MessagesSound != nil {
			canonical["sounds"] = *sound.MessagesSound
		} else if sound.NotificationsSound != nil {
			canonical["sounds"] = *sound.NotificationsSound
		}
	}
	if general.CallSounds == nil && sound.CallsSound != nil {
		canonical["callSounds"] = *sound.CallsSound
	}
	input.Settings = canonical
	input.SoundSettings = maps.Clone(input.SoundSettings)
	// Сохранённые старые aliases остаются исходными compatibility data, новые
	// writes меняют canonical flags. Все GET/PUT responses проецируют aliases.
	delete(input.SoundSettings, "messagesSound")
	delete(input.SoundSettings, "notificationsSound")
	delete(input.SoundSettings, "callsSound")
	return input, nil
}
