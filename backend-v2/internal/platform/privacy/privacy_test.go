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
		"null в месте правила": `{"lastSeen":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			s := Parse([]byte(raw))
			if name == "null в месте правила" {
				// null — «не задано», а не «сломано»: значение по умолчанию.
				require.Equal(t, Everyone, s.Base(LastSeen))
				return
			}
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
