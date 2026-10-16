//go:build integration

package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/ratelimit"
)

const (
	kpAnna  = "91600000-0000-4000-8000-00000000a001"
	kpMax   = "91600000-0000-4000-8000-000000000002"
	kpBoris = "91600000-0000-4000-8000-000000000003"
	kpCarl  = "91600000-0000-4000-8000-000000000004"
	kpEve   = "91600000-0000-4000-8000-000000000005"
)

func kpFixture(t *testing.T, limits *mlsLimits) (*Service, *sql.DB) {
	t.Helper()
	db := dbtest.Postgres(t)
	for id, name := range map[string]string{kpAnna: "anna", kpMax: "max", kpBoris: "boris", kpCarl: "carl", kpEve: "eve"} {
		dbtest.User(t, db, id, name)
	}
	svc := NewService(db, &recordingRealtime{}, nil)
	svc.mls = limits
	ctx := context.Background()
	for _, peer := range []string{kpMax, kpBoris, kpCarl} {
		_, _, err := svc.CreatePrivate(ctx, kpAnna, peer)
		require.NoError(t, err)
	}
	for i := range 20 {
		_, err := db.Exec(`INSERT INTO crypto.user_mls_keypackages (user_id, keypackage_id, keypackage_bytes) VALUES ($1, $2, 'bytes')`,
			kpAnna, fmt.Sprintf("kp-%02d", i))
		require.NoError(t, err)
	}
	return svc, db
}

func annaKeyPackages(t *testing.T, db *sql.DB) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM crypto.user_mls_keypackages WHERE user_id = $1`, kpAnna).Scan(&n))
	return n
}

func kpLimits(pairBurst, targetBurst int) *mlsLimits {
	return &mlsLimits{
		user:     ratelimit.New(1000, 1000),
		kpPair:   ratelimit.New(0.0001, pairBurst),
		kpTarget: ratelimit.New(0.0001, targetBurst),
	}
}

func isRateLimited(err error) bool {
	var limited *RateLimitedError
	return errors.As(err, &limited)
}

func TestMLSKeyPackageLimitsOnRealSchema(t *testing.T) {
	ctx := context.Background()
	aliases := []string{
		strings.ReplaceAll(kpAnna, "-", ""),
		"{" + kpAnna + "}",
		strings.ToUpper(kpAnna),
	}

	t.Run("UUID aliases share the pair limit", func(t *testing.T) {
		svc, db := kpFixture(t, kpLimits(2, 100))
		for _, target := range []string{kpAnna, aliases[0]} {
			_, err := svc.MLSFetchKeyPackage(ctx, kpMax, target)
			require.NoError(t, err)
		}
		for _, target := range aliases {
			// Альтернативная запись запрашивающего тоже не создаёт новую пару.
			_, err := svc.MLSFetchKeyPackage(ctx, "{"+kpMax+"}", target)
			require.True(t, isRateLimited(err), "alias %s bypassed pair limit: %v", target, err)
		}
		require.Equal(t, 18, annaKeyPackages(t, db))
	})

	t.Run("UUID aliases share the target limit across requesters", func(t *testing.T) {
		svc, db := kpFixture(t, kpLimits(100, 2))
		for i, requester := range []string{kpMax, kpBoris} {
			_, err := svc.MLSFetchKeyPackage(ctx, requester, aliases[i])
			require.NoError(t, err)
		}
		for _, target := range append([]string{kpAnna}, aliases...) {
			_, err := svc.MLSFetchKeyPackage(ctx, kpCarl, target)
			require.True(t, isRateLimited(err), "alias %s bypassed target limit: %v", target, err)
		}
		require.Equal(t, 18, annaKeyPackages(t, db))
	})

	t.Run("pair limit stops repeated fetches and keeps the remaining keys", func(t *testing.T) {
		svc, db := kpFixture(t, kpLimits(2, 100))

		for range 2 {
			_, err := svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
			require.NoError(t, err)
		}
		require.Equal(t, 18, annaKeyPackages(t, db))

		_, err := svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
		require.True(t, isRateLimited(err), "third fetch by the same pair must be limited, got %v", err)
		require.Equal(t, 18, annaKeyPackages(t, db), "a rejected request must not delete a key")

		_, err = svc.MLSFetchKeyPackage(ctx, kpBoris, kpAnna)
		require.NoError(t, err)
		require.Equal(t, 17, annaKeyPackages(t, db))
	})

	t.Run("target limit holds against many different requesters", func(t *testing.T) {
		svc, db := kpFixture(t, kpLimits(100, 3))

		for _, requester := range []string{kpMax, kpBoris, kpCarl} {
			_, err := svc.MLSFetchKeyPackage(ctx, requester, kpAnna)
			require.NoError(t, err)
		}
		require.Equal(t, 17, annaKeyPackages(t, db))

		_, err := svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
		require.True(t, isRateLimited(err), "fourth fetch for the same target must be limited, got %v", err)
		require.Equal(t, 17, annaKeyPackages(t, db))
	})

	t.Run("requests without a shared chat are denied and do not spend the target limit", func(t *testing.T) {
		svc, db := kpFixture(t, kpLimits(100, 3))

		for range 10 {
			_, err := svc.MLSFetchKeyPackage(ctx, kpEve, kpAnna)
			require.EqualError(t, err, "access denied")
		}

		for _, requester := range []string{kpMax, kpBoris, kpCarl} {
			_, err := svc.MLSFetchKeyPackage(ctx, requester, kpAnna)
			require.NoError(t, err)
		}
		require.Equal(t, 17, annaKeyPackages(t, db))
	})

	t.Run("a pair rejected by its own limit does not spend the target limit", func(t *testing.T) {
		svc, _ := kpFixture(t, kpLimits(1, 3))

		_, err := svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
		require.NoError(t, err)
		for range 5 {
			_, err = svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
			require.True(t, isRateLimited(err))
		}

		for _, requester := range []string{kpBoris, kpCarl} {
			_, err = svc.MLSFetchKeyPackage(ctx, requester, kpAnna)
			require.NoError(t, err)
		}
	})

	t.Run("a request rejected by the target limit does not spend the pair limit", func(t *testing.T) {
		svc, _ := kpFixture(t, kpLimits(2, 1))

		_, err := svc.MLSFetchKeyPackage(ctx, kpBoris, kpAnna)
		require.NoError(t, err)

		for range 5 {
			_, err = svc.MLSFetchKeyPackage(ctx, kpMax, kpAnna)
			require.True(t, isRateLimited(err))
		}

		for i := range 2 {
			ok, _ := svc.mls.kpPair.Allow(kpMax + ">" + kpAnna)
			require.True(t, ok, "pair token %d of max was spent by requests the target limit rejected", i+1)
		}
	})

	t.Run("normal group creation fits the default limits", func(t *testing.T) {
		svc, db := kpFixture(t, newMLSLimitsFromEnv())

		for _, peer := range []string{kpBoris, kpCarl} {
			_, _, err := svc.CreatePrivate(ctx, kpMax, peer)
			require.NoError(t, err)
			_, err = db.Exec(`INSERT INTO crypto.user_mls_keypackages (user_id, keypackage_id, keypackage_bytes) VALUES ($1, 'kp', 'bytes')`, peer)
			require.NoError(t, err)
		}
		for _, target := range []string{kpAnna, kpBoris, kpCarl} {
			_, err := svc.MLSFetchKeyPackage(ctx, kpMax, target)
			require.NoError(t, err, "adding %s to a group must not be limited", target)
		}
	})
}
