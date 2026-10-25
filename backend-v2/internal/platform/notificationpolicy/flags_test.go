package notificationpolicy

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCanonicalFlagsNeverEnableCorruptPresentValues(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want Flags
	}{
		{"", Flags{true, true, true}}, {`{}`, Flags{true, true, true}},
		{`{"notifications":false,"sounds":true,"callSounds":false}`, Flags{false, true, false}},
		{`{"notifications":"false","sounds":null,"callSounds":1}`, Flags{}},
		{`null`, Flags{}}, {`[]`, Flags{}}, {`true`, Flags{}}, {`bad`, Flags{}},
	} {
		require.Equal(t, tc.want, Read([]byte(tc.raw)), tc.raw)
	}
}
