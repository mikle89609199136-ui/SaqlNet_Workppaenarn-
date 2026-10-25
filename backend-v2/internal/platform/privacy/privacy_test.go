package privacy

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseAppliesDefaultsAndLegacyValues(t *testing.T) {
	s := Parse([]byte(`{"lastSeen":"contacts","photoVisibility":"everyone","phoneVisibility":"all","messagesFromStrangers":false,"twoFactorAuth":true}`))

	require.Equal(t, Nobody, s.Base(LastSeen), "contacts — как nobody: контактов нет")
	require.Equal(t, Everyone, s.Base(Photo))
	require.Equal(t, Everyone, s.Base(Phone))
	require.Equal(t, Nobody, s.Base(MessagesFromStrangers))
	// Правил, которых ещё не было, — по умолчанию.
	require.Equal(t, Everyone, s.Base(Forwards))
	require.Equal(t, Everyone, s.Base(Calls))
	require.Equal(t, true, s.Map()["twoFactorAuth"])
}

func TestParseFailsClosed(t *testing.T) {
	for name, raw := range map[string]string{
		"повреждённый JSON":    `{"lastSeen":`,
		"незнакомое значение":  `{"lastSeen":"friends","photoVisibility":"maybe"}`,
		"значение не строкой":  `{"lastSeen":42,"photoVisibility":true}`,
		"null в месте правила": `{"lastSeen":null,"photoVisibility":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			s := Parse([]byte(raw))
			require.Equal(t, Nobody, s.Base(LastSeen))
			require.Equal(t, Nobody, s.Base(Photo))
		})
	}

	// Повреждённый JSON закрывает всё, даже то, что по умолчанию открыто.
	broken := Parse([]byte(`not json`))
	for rule := range defaults {
		require.Equal(t, Nobody, broken.Base(rule), rule)
	}
}

func TestParseEmptySettingsUsesDefaults(t *testing.T) {
	for _, raw := range [][]byte{nil, []byte(`{}`)} {
		s := Parse(raw)
		require.Equal(t, Everyone, s.Base(LastSeen))
		require.Equal(t, Nobody, s.Base(Phone))
	}
}

func TestDecideOrder(t *testing.T) {
	open := Parse([]byte(`{"lastSeen":"all"}`))
	closed := Parse([]byte(`{"lastSeen":"nobody"}`))

	require.True(t, Decide(closed, Relation{Self: true}, LastSeen), "себе видно всегда")
	require.False(t, Decide(open, Relation{Blocked: true}, LastSeen), "блокировка сильнее открытого правила")
	require.True(t, Decide(open, Relation{}, LastSeen))
	require.False(t, Decide(closed, Relation{}, LastSeen))
}

func TestNormalize(t *testing.T) {
	out, err := Normalize(map[string]any{
		"lastSeen":              "contacts",
		"photoVisibility":       "everyone",
		"forwards":              "nobody",
		"messagesFromStrangers": false,
		"autoDeleteAccount":     true,
	})
	require.NoError(t, err)
	require.Equal(t, map[string]any{
		"lastSeen":              "nobody",
		"photoVisibility":       "all",
		"forwards":              "nobody",
		"messagesFromStrangers": false,
		"autoDeleteAccount":     true,
	}, out)

	for name, patch := range map[string]map[string]any{
		"незнакомый ключ":         {"lastSeenn": "all"},
		"незнакомое значение":     {"lastSeen": "friends"},
		"не строка":               {"calls": 1},
		"флаг не булев":           {"twoFactorAuth": "yes"},
		"сообщения не булевы":     {"messagesFromStrangers": 7},
		"запрос как в #439":       {"lastSeen": 123},
		"ключ из чужой настройки": {"theme": "dark"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Normalize(patch)
			require.Error(t, err)
		})
	}
}

func TestMapRoundTrip(t *testing.T) {
	m := Parse([]byte(`{"lastSeen":"none","messagesFromStrangers":true}`)).Map()

	require.Equal(t, "nobody", m["lastSeen"])
	require.Equal(t, true, m["messagesFromStrangers"])
	require.Equal(t, "nobody", m["phoneVisibility"])
}

// Исключения по людям (#784): сам себе → блокировка → исключение → правило.
func TestDecideWithExceptions(t *testing.T) {
	open := Parse([]byte(`{"lastSeen":"all","photoVisibility":"all"}`))
	closed := Parse([]byte(`{"lastSeen":"nobody","photoVisibility":"nobody"}`))
	always := map[Rule]bool{LastSeen: true}
	never := map[Rule]bool{LastSeen: false}

	require.True(t, Decide(closed, Relation{Exceptions: always}, LastSeen), "«всегда» открывает закрытое")
	require.False(t, Decide(open, Relation{Exceptions: never}, LastSeen), "«никогда» закрывает открытое")
	require.False(t, Decide(closed, Relation{Exceptions: always}, Photo), "исключение — только на своё правило")
	require.True(t, Decide(open, Relation{Exceptions: never}, Photo))
	require.False(t, Decide(open, Relation{Blocked: true, Exceptions: always}, LastSeen), "блокировка сильнее «всегда»")
	require.True(t, Decide(closed, Relation{Self: true, Exceptions: never}, LastSeen), "себе — всегда")
	// Повреждённые настройки закрывают правило, но «всегда» сильнее правила.
	require.True(t, Decide(Parse([]byte(`{broken`)), Relation{Exceptions: always}, LastSeen))
}

func TestParseExceptions(t *testing.T) {
	require.Nil(t, ParseExceptions(nil), "NULL из jsonb_object_agg — исключений нет")
	require.Equal(t, map[Rule]bool{LastSeen: true, Photo: false},
		ParseExceptions([]byte(`{"lastSeen":true,"photoVisibility":false}`)))

	broken := ParseExceptions([]byte(`{"lastSeen":"yes"}`))
	for rule := range defaults {
		allow, ok := broken[rule]
		require.True(t, ok, rule)
		require.False(t, allow, "повреждённые исключения закрывают %s", rule)
	}
}

func TestExceptionRuleAndMode(t *testing.T) {
	for _, name := range []string{"lastSeen", "photoVisibility", "phoneVisibility", "forwards", "calls", "groupsAdd"} {
		rule, ok := ExceptionRule(name)
		require.True(t, ok, name)
		require.Equal(t, Rule(name), rule)
	}
	for _, name := range []string{"messagesFromStrangers", "twoFactorAuth", "lastseen", ""} {
		_, ok := ExceptionRule(name)
		require.False(t, ok, name)
	}

	allow, ok := ParseMode("allow")
	require.True(t, ok)
	require.True(t, allow)
	allow, ok = ParseMode("deny")
	require.True(t, ok)
	require.False(t, allow)
	for _, mode := range []string{"", "Allow", "never", "true"} {
		_, ok := ParseMode(mode)
		require.False(t, ok, mode)
	}
	require.Equal(t, AlwaysAllow, ModeOf(true))
	require.Equal(t, NeverAllow, ModeOf(false))
}

func TestCallsFailClosedAndNormalize(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `42`, `{"calls":null}`, `{"calls":true}`, `{"calls":{}}`, `{"calls":"friends"}`} {
		require.Equal(t, Nobody, Parse([]byte(raw)).Base(Calls), raw)
	}
	for input, want := range map[string]string{"all": Everyone, "nobody": Nobody, "everyone": Everyone, "contacts": Nobody, "none": Nobody} {
		normalized, err := Normalize(map[string]any{"calls": input})
		require.NoError(t, err)
		require.Equal(t, want, normalized["calls"])
	}
}
