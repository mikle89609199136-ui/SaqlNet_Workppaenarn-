package privacy

import "encoding/json"

// Исключения по людям (#784). Владелец открывает правило конкретному
// человеку («всегда разрешать») или закрывает от него («никогда не
// разрешать») поверх базового значения. Хранятся в users.privacy_exceptions,
// по одному на человека и правило: попав в один список, человек уходит из
// другого.

// Mode — вид исключения, как его видит API.
type Mode string

const (
	AlwaysAllow Mode = "allow"
	NeverAllow  Mode = "deny"
)

// ParseMode разбирает вид исключения из запроса: allow — «всегда
// разрешать».
func ParseMode(value string) (allow bool, ok bool) {
	switch Mode(value) {
	case AlwaysAllow:
		return true, true
	case NeverAllow:
		return false, true
	default:
		return false, false
	}
}

// ModeOf — вид исключения по сохранённому флагу.
func ModeOf(allow bool) Mode {
	if allow {
		return AlwaysAllow
	}
	return NeverAllow
}

// ExceptionRule — правило, у которого бывают исключения. У «Сообщений от
// незнакомых» их нет: это переключатель, а не выбор круга людей.
func ExceptionRule(name string) (Rule, bool) {
	rule := Rule(name)
	if _, known := defaults[rule]; !known || rule == MessagesFromStrangers {
		return "", false
	}
	return rule, true
}

// ParseExceptions разбирает исключения владельца для одного зрителя —
// объект {"правило": allow}, который собирает jsonb_object_agg. NULL — их
// нет. Повреждённые данные закрывают все правила.
func ParseExceptions(raw []byte) map[Rule]bool {
	if len(raw) == 0 {
		return nil
	}
	var stored map[string]bool
	if json.Unmarshal(raw, &stored) != nil {
		closed := make(map[Rule]bool, len(defaults))
		for rule := range defaults {
			closed[rule] = false
		}
		return closed
	}
	out := make(map[Rule]bool, len(stored))
	for name, allow := range stored {
		out[Rule(name)] = allow
	}
	return out
}
