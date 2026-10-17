package settingsdefaults

import (
	"io/fs"
	"sort"
	"testing"

	migrationsql "craneapp/backend-v2/migrations"
	"github.com/stretchr/testify/require"
)

func TestDefaultsCopiesAndLatestMigration(t *testing.T) {
	first := Object("settings")
	first["theme"] = "light"
	require.Equal(t, "dark", Object("settings")["theme"])
	require.Equal(t, "letter", Object("settings")["avatarShape"])
	require.Equal(t, true, Object("settings")["callSounds"])
	files, err := fs.Glob(migrationsql.FS, "*_settings_defaults.sql")
	require.NoError(t, err)
	require.NotEmpty(t, files)
	sort.Strings(files)
	latest, err := fs.ReadFile(migrationsql.FS, files[len(files)-1])
	require.NoError(t, err)
	require.Equal(t, MigrationSQL(), string(latest), "изменение defaults требует НОВОЙ generated migration")
}
