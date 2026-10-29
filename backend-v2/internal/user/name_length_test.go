package user

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUpdateProfileRejectsLongNamesBeforeDatabase(t *testing.T) {
	name := strings.Repeat("😀", 65)
	for _, names := range [][2]*string{{&name, nil}, {nil, &name}} {
		_, err := NewService(nil).UpdateProfile(t.Context(), "unused", names[0], names[1], nil, nil)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}
