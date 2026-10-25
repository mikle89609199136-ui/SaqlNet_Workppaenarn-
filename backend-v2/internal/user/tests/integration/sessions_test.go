//go:build integration

package integration

import (
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/user"
	"github.com/stretchr/testify/require"
)

// Device registration enriches an issued credential; it cannot create one.
func TestRegisterDevice_UpdatesIssuedSession(t *testing.T) {
	db := withCleanDB(t)
	owner := createTestUser(t, db, "alice")
	id := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("first")})
	before := sessionByID(t, db, id)
	svc := newService(db)
	got, err := svc.RegisterDevice(t.Context(), owner, authctx.TokenHash("first"),
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	require.NoError(t, err)
	require.Equal(t, id, got)
	row := sessionByID(t, db, id)
	require.Equal(t, owner, row.UserID)
	require.Equal(t, "Device One", row.DeviceName)
	require.Equal(t, "desktop", row.DeviceType)
	require.Equal(t, "IP A", row.IPAddress)
	require.Equal(t, "Unknown", row.Location)
	require.Equal(t, "audit-agent-1", row.UserAgent)
	require.True(t, row.CreatedAt.Equal(before.CreatedAt))
	require.False(t, row.LastActive.Before(before.LastActive))
	var legacyCount int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM public.user_sessions WHERE user_id = $1`, owner).Scan(&legacyCount))
	require.Zero(t, legacyCount)
}

// Regression #443: keep latest metadata without touching another equal-UA credential.
func TestRegisterDevice_ReregisterSameUserAgent_ReflectsLatestMetadata(t *testing.T) {
	db := withCleanDB(t)
	owner := createTestUser(t, db, "alice")
	first := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("first")})
	second := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("second")})
	svc := newService(db)
	for _, token := range []string{"first", "second"} {
		_, err := svc.RegisterDevice(t.Context(), owner, authctx.TokenHash(token),
			"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
		require.NoError(t, err)
	}
	before := sessionByID(t, db, first)
	other := sessionByID(t, db, second)
	// An old last_active makes advancement deterministic without sleeping.
	_, err := db.Exec(`UPDATE auth.sessions SET last_active = NOW() - INTERVAL '1 hour' WHERE id = $1`, first)
	require.NoError(t, err)
	oldActive := sessionByID(t, db, first).LastActive
	got, err := svc.RegisterDevice(t.Context(), owner, authctx.TokenHash("first"),
		"Renamed Device", "mobile", "IP B", "New location", "audit-agent-1")
	require.NoError(t, err)
	require.Equal(t, first, got)
	row := sessionByID(t, db, first)
	require.Equal(t, "Renamed Device", row.DeviceName)
	require.Equal(t, "mobile", row.DeviceType)
	require.Equal(t, "IP B", row.IPAddress)
	require.Equal(t, "New location", row.Location)
	require.Equal(t, "audit-agent-1", row.UserAgent)
	require.True(t, row.CreatedAt.Equal(before.CreatedAt))
	require.True(t, row.LastActive.After(oldActive))
	require.Equal(t, other, sessionByID(t, db, second))
	devices, err := svc.Devices(t.Context(), owner, "first")
	require.NoError(t, err)
	require.Len(t, devices, 2)
	require.Equal(t, first, devices[0].ID)
	require.True(t, devices[0].IsCurrent)
	require.Equal(t, "Renamed Device", devices[0].DeviceName)
	// User-Agent changes must not change identity either.
	got, err = svc.RegisterDevice(t.Context(), owner, authctx.TokenHash("first"),
		"Renamed Device", "mobile", "IP B", "New location", "updated-agent")
	require.NoError(t, err)
	require.Equal(t, first, got)
	require.NotEqual(t, first, second)
}

func TestRegisterDevice_RejectsInactiveCredentials(t *testing.T) {
	for _, state := range []string{"unknown", "revoked", "expired", "wrong-owner", "old-generation", "revoked-token"} {
		t.Run(state, func(t *testing.T) {
			db := withCleanDB(t)
			owner := createTestUser(t, db, "alice")
			opts := authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("first")}
			if state == "wrong-owner" {
				opts.UserID = createTestUser(t, db, "bob")
			}
			opts.Revoked = state == "revoked"
			if state == "expired" {
				opts.ExpiresAt = time.Now().Add(-time.Hour)
			}
			var id string
			if state != "unknown" {
				id = createAuthSession(t, db, opts)
			}
			if state == "old-generation" {
				_, err := db.Exec(`UPDATE auth.users SET token_generation = token_generation + 1 WHERE id = $1`, owner)
				require.NoError(t, err)
			}
			if state == "revoked-token" {
				_, err := db.Exec(`INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, opts.AccessTokenHash, owner)
				require.NoError(t, err)
			}
			var before sessionRow
			if id != "" {
				before = sessionByID(t, db, id)
			}
			got, err := newService(db).RegisterDevice(t.Context(), owner, opts.AccessTokenHash, "overwrite", "mobile", "IP B", "Unknown", "audit-agent-1")
			require.ErrorIs(t, err, user.ErrAuthSessionInactive)
			require.Empty(t, got)
			if id != "" {
				require.Equal(t, before, sessionByID(t, db, id))
			}
		})
	}
}

func TestDevices_Empty(t *testing.T) {
	db := withCleanDB(t)
	owner := createTestUser(t, db, "alice")
	devices, err := newService(db).Devices(t.Context(), owner, "caller")
	require.NoError(t, err)
	require.Empty(t, devices)
}

func TestDevices_IsolatesUsersAndCurrentCredentials(t *testing.T) {
	db := withCleanDB(t)
	alice := createTestUser(t, db, "alice")
	bob := createTestUser(t, db, "bob")
	svc := newService(db)
	first := createAuthSession(t, db, authSessionOpts{UserID: alice, AccessTokenHash: authctx.TokenHash("first")})
	second := createAuthSession(t, db, authSessionOpts{UserID: alice, AccessTokenHash: authctx.TokenHash("second")})
	bobID := createAuthSession(t, db, authSessionOpts{UserID: bob, AccessTokenHash: authctx.TokenHash("bob-token")})
	for token, want := range map[string]string{"first": first, "second": second} {
		devices, err := svc.Devices(t.Context(), alice, token)
		require.NoError(t, err)
		require.Len(t, devices, 2)
		require.Equal(t, want, devices[0].ID)
		require.True(t, devices[0].IsCurrent)
		require.False(t, devices[1].IsCurrent)
		for _, device := range devices {
			require.NotEqual(t, bobID, device.ID)
		}
	}
	devices, err := svc.Devices(t.Context(), bob, "bob-token")
	require.NoError(t, err)
	require.Len(t, devices, 1)
	require.Equal(t, bobID, devices[0].ID)
	require.True(t, devices[0].IsCurrent)
}

func TestDevices_CurrentFirstThenLastActivity(t *testing.T) {
	db := withCleanDB(t)
	owner := createTestUser(t, db, "alice")
	older := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("older")})
	newer := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("newer")})
	current := createAuthSession(t, db, authSessionOpts{UserID: owner, AccessTokenHash: authctx.TokenHash("current")})
	for i, id := range []string{current, older, newer} {
		_, err := db.Exec(`UPDATE auth.sessions SET last_active = $2 WHERE id = $1`, id, time.Date(2026, 1, i+1, 0, 0, 0, 0, time.UTC))
		require.NoError(t, err)
	}
	devices, err := newService(db).Devices(t.Context(), owner, "current")
	require.NoError(t, err)
	require.Len(t, devices, 3)
	require.Equal(t, []string{current, newer, older}, []string{devices[0].ID, devices[1].ID, devices[2].ID})
	require.True(t, devices[0].IsCurrent)
	require.False(t, devices[1].IsCurrent)
	require.False(t, devices[2].IsCurrent)
}
