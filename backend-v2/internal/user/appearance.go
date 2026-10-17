package user

import "maps"

// Старый fontSize имеет тот же enum, что textSize. Приоритет определяется
// переданным patch, а не defaults/snapshot: новый frozen-client выбор тоже
// должен работать после регистрации с полным набором canonical defaults.
func appearancePatch(patch map[string]any) map[string]any {
	if _, canonical := patch["textSize"]; canonical {
		return patch
	}
	if size, legacy := patch["fontSize"]; legacy {
		out := maps.Clone(patch)
		out["textSize"] = size
		return out
	}
	return patch
}

func storedAppearance(section string, data []byte) map[string]any {
	stored := normalizeSettingsPatchBase("legacy_settings", data)
	// Валидный canonical выбор приоритетен. Если его нет, сохраняем старый
	// размер; defaults добавляются лишь после разрешения aliases.
	stored = appearancePatch(stored)
	out := withSettingsDefaults(section, stored)
	if section == "legacy_settings" {
		out["fontSize"] = out["textSize"]
	} else {
		delete(out, "fontSize")
		delete(out, "accentColor")
	}
	// Произвольный accentColor нельзя без потери представить шестью presets.
	// Он остаётся compatibility data в bulk/export и не подменяет accentPreset.
	return out
}
