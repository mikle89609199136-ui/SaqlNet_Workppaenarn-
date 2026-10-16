// Package privacy — единая проверка настроек приватности (#726, #783).
//
// Настройки хранятся одним JSON в users.settings.privacy_settings. Раньше
// каждый путь читал его по-своему: статус считал «contacts» закрытым, данные
// чата не смотрели в настройки вовсе, а PUT /users/privacy сохранял что
// угодно. Здесь одна схема, одна нормализация и одно решение «можно ли
// зрителю видеть это у владельца».
//
// Порядок решения: сам себе — можно; владелец заблокировал зрителя — нельзя;
// дальше исключение владельца для этого зрителя (#784), если оно есть, и
// только потом базовое правило.
//
// Контактов в приложении нет, поэтому у правил два значения: «all» и
// «nobody». Сохранённые раньше «contacts» и «none» читаются как «nobody»,
// «everyone» — как «all». Незнакомое значение или повреждённый JSON —
// «nobody»: при сомнении закрываем, а не открываем.
package privacy

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Rule — правило видимости: кто из других пользователей получает доступ.
type Rule string

const (
	LastSeen  Rule = "lastSeen"
	Photo     Rule = "photoVisibility"
	Phone     Rule = "phoneVisibility"
	Forwards  Rule = "forwards"
	Calls     Rule = "calls"
	GroupsAdd Rule = "groupsAdd"
	// MessagesFromStrangers хранится булевым: true — «Все».
	MessagesFromStrangers Rule = "messagesFromStrangers"
)

// Значения правила видимости.
const (
	Everyone = "all"
	Nobody   = "nobody"
)

// defaults — значения для правил, которых в настройках ещё нет. Совпадают
// с тем, что auth пишет при регистрации; телефон закрыт — раньше там стояло
// «contacts».
var defaults = map[Rule]string{
	LastSeen:              Everyone,
	Photo:                 Everyone,
	Phone:                 Nobody,
	Forwards:              Everyone,
	Calls:                 Everyone,
	GroupsAdd:             Everyone,
	MessagesFromStrangers: Everyone,
}

// flags — прочие булевы поля настроек приватности: не правила видимости,
// но живут в том же JSON и должны проходить проверку.
var flags = map[string]bool{
	"twoFactorAuth":     true,
	"autoDeleteAccount": true,
}

// Settings — разобранные настройки приватности одного пользователя.
type Settings struct {
	rules map[Rule]string
	flags map[string]bool
}

// Parse разбирает сохранённый JSON. Отсутствующее правило берёт значение по
// умолчанию, незнакомое значение и повреждённый JSON — «nobody».
func Parse(raw []byte) Settings {
	var stored map[string]any
	if len(raw) > 0 && (json.Unmarshal(raw, &stored) != nil || stored == nil) {
		return Closed()
	}

	s := Settings{rules: make(map[Rule]string, len(defaults)), flags: map[string]bool{}}
	for rule, fallback := range defaults {
		if value, exists := stored[string(rule)]; exists {
			s.rules[rule] = readRule(rule, value)
		} else {
			s.rules[rule] = fallback
		}
	}
	for name := range flags {
		if value, ok := stored[name].(bool); ok {
			s.flags[name] = value
		}
	}
	return s
}

// Closed — настройки, закрывающие всё: для повреждённых данных и
// отсутствующего владельца.
func Closed() Settings {
	s := Settings{rules: make(map[Rule]string, len(defaults)), flags: map[string]bool{}}
	for rule := range defaults {
		s.rules[rule] = Nobody
	}
	return s
}

// readRule приводит сохранённое значение к «all» / «nobody».
func readRule(rule Rule, value any) string {
	if rule == MessagesFromStrangers {
		if allowed, ok := value.(bool); ok && allowed {
			return Everyone
		}
		if text, ok := value.(string); ok {
			return normalizeVisibility(text)
		}
		return Nobody
	}
	text, ok := value.(string)
	if !ok {
		return Nobody
	}
	return normalizeVisibility(text)
}

func normalizeVisibility(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "all", "everyone", "everybody":
		return Everyone
	default:
		// «nobody», «none», «contacts» и всё незнакомое.
		return Nobody
	}
}

// Base — базовое правило без учёта отношений между людьми.
func (s Settings) Base(rule Rule) string {
	if value, ok := s.rules[rule]; ok {
		return value
	}
	return Nobody
}

// Map — настройки в том виде, в каком их отдаёт API: канонические значения
// правил и булевы флаги.
func (s Settings) Map() map[string]any {
	out := make(map[string]any, len(s.rules)+len(s.flags))
	for rule, value := range s.rules {
		if rule == MessagesFromStrangers {
			out[string(rule)] = value == Everyone
			continue
		}
		out[string(rule)] = value
	}
	for name, value := range s.flags {
		out[name] = value
	}
	return out
}

// Relation — отношение зрителя к владельцу настроек.
type Relation struct {
	// Self — зритель и есть владелец.
	Self bool
	// Blocked — владелец заблокировал зрителя.
	Blocked bool
	// Exceptions — исключения владельца для зрителя (#784): true —
	// «всегда разрешать», false — «никогда не разрешать».
	Exceptions map[Rule]bool
}

// Decide — можно ли зрителю с таким отношением то, что закрывает правило.
func Decide(s Settings, rel Relation, rule Rule) bool {
	if rel.Self {
		return true
	}
	if rel.Blocked {
		return false
	}
	if allow, ok := rel.Exceptions[rule]; ok {
		return allow
	}
	return s.Base(rule) == Everyone
}

// Normalize проверяет изменение настроек из PUT /users/privacy и приводит
// значения к каноническим. Незнакомый ключ или значение — ошибка: раньше
// такое молча сохранялось (#439).
func Normalize(patch map[string]any) (map[string]any, error) {
	out := make(map[string]any, len(patch))
	var unknown []string
	for key, value := range patch {
		rule := Rule(key)
		if _, isRule := defaults[rule]; isRule {
			normalized, err := normalizeInput(rule, value)
			if err != nil {
				return nil, err
			}
			out[key] = normalized
			continue
		}
		if flags[key] {
			flag, ok := value.(bool)
			if !ok {
				return nil, fmt.Errorf("%s must be a boolean", key)
			}
			out[key] = flag
			continue
		}
		unknown = append(unknown, key)
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, fmt.Errorf("unknown privacy settings: %s", strings.Join(unknown, ", "))
	}
	return out, nil
}

func normalizeInput(rule Rule, value any) (any, error) {
	if rule == MessagesFromStrangers {
		if flag, ok := value.(bool); ok {
			return flag, nil
		}
		if text, ok := value.(string); ok && knownVisibility(text) {
			return normalizeVisibility(text) == Everyone, nil
		}
		return nil, fmt.Errorf("%s must be a boolean", rule)
	}
	text, ok := value.(string)
	if !ok || !knownVisibility(text) {
		return nil, fmt.Errorf("%s must be one of: all, nobody", rule)
	}
	return normalizeVisibility(text), nil
}

// knownVisibility — значения, которые клиент вправе прислать. Прежние
// «contacts» и «none» принимаются и сохраняются как «nobody», пока старый
// интерфейс их ещё отправляет.
func knownVisibility(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "all", "everyone", "everybody", "nobody", "none", "contacts":
		return true
	default:
		return false
	}
}
