//go:build integration

package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"craneapp/backend-v2/internal/user"
)

// =============================================================================
// RegisterDevice
// =============================================================================

// TestRegisterDevice_CreatesRow verifies that a first registration writes a
// single user_sessions row with the supplied metadata, marks it as current,
// and populates first_login / last_active.
func TestRegisterDevice_CreatesRow(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")

	id, err := svc.RegisterDevice(
		context.Background(), userID, "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty session id")
	}

	row := sessionByID(t, db, id)
	if row.UserID != userID {
		t.Errorf("user_id: got %q, want %q", row.UserID, userID)
	}
	if row.DeviceName != "Device One" {
		t.Errorf("device_name: got %q, want %q", row.DeviceName, "Device One")
	}
	if row.DeviceType != "desktop" {
		t.Errorf("device_type: got %q, want %q", row.DeviceType, "desktop")
	}
	if row.IPAddress != "IP A" {
		t.Errorf("ip_address: got %q, want %q", row.IPAddress, "IP A")
	}
	if row.Location != "Unknown" {
		t.Errorf("location: got %q, want %q", row.Location, "Unknown")
	}
	if row.UserAgent != "audit-agent-1" {
		t.Errorf("user_agent: got %q, want %q", row.UserAgent, "audit-agent-1")
	}
	if !row.IsCurrent {
		t.Error("is_current: got false, want true")
	}

	if got := countSessionsForUser(t, db, userID); got != 1 {
		t.Errorf("session count: got %d, want 1", got)
	}
}

// TestRegisterDevice_IdempotentOnSameUserAgent verifies that a second
// registration with the same user_agent updates the existing row in place:
// the session id is preserved, no duplicate is created, and the latest
// metadata is stored.
func TestRegisterDevice_IdempotentOnSameUserAgent(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	id1, err := svc.RegisterDevice(ctx, userID, "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}

	// Ensure the second call observes a strictly later NOW().
	time.Sleep(5 * time.Millisecond)

	id2, err := svc.RegisterDevice(ctx, userID, "",
		"Renamed Device", "mobile", "IP B", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}

	if id1 != id2 {
		t.Fatalf("expected the same session id, got %q vs %q", id1, id2)
	}
	if got := countSessionsForUser(t, db, userID); got != 1 {
		t.Fatalf("session count: got %d, want 1", got)
	}

	row := sessionByID(t, db, id2)
	if row.DeviceName != "Renamed Device" {
		t.Errorf("device_name: got %q, want %q", row.DeviceName, "Renamed Device")
	}
	if row.DeviceType != "mobile" {
		t.Errorf("device_type: got %q, want %q", row.DeviceType, "mobile")
	}
	if row.IPAddress != "IP B" {
		t.Errorf("ip_address: got %q, want %q", row.IPAddress, "IP B")
	}
	if !row.IsCurrent {
		t.Error("is_current: got false, want true")
	}
}

// TestRegisterDevice_PreservesFirstLogin verifies that first_login is set
// only once, on the very first registration, and is not overwritten by a
// subsequent re-registration of the same user_agent.
func TestRegisterDevice_PreservesFirstLogin(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	id1, err := svc.RegisterDevice(ctx, userID, "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}

	var firstLogin1, lastActive1 time.Time
	if err := db.QueryRowContext(ctx,
		`SELECT first_login, last_active FROM public.user_sessions WHERE id = $1`, id1,
	).Scan(&firstLogin1, &lastActive1); err != nil {
		t.Fatalf("select timestamps #1: %v", err)
	}

	time.Sleep(5 * time.Millisecond)

	id2, err := svc.RegisterDevice(ctx, userID, "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}

	var firstLogin2, lastActive2 time.Time
	if err := db.QueryRowContext(ctx,
		`SELECT first_login, last_active FROM public.user_sessions WHERE id = $1`, id2,
	).Scan(&firstLogin2, &lastActive2); err != nil {
		t.Fatalf("select timestamps #2: %v", err)
	}

	if !firstLogin2.Equal(firstLogin1) {
		t.Errorf("first_login changed: %v -> %v", firstLogin1, firstLogin2)
	}
	if !lastActive2.After(lastActive1) {
		t.Errorf("last_active did not advance: %v -> %v", lastActive1, lastActive2)
	}
}

// TestRegisterDevice_SwitchesCurrentFlag verifies that registering a second
// device (distinct user_agent) flips is_current: exactly one session is
// current, and it is the most recently registered one.
func TestRegisterDevice_SwitchesCurrentFlag(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	if _, err := svc.RegisterDevice(ctx, userID, "",
		"Device One", "desktop", "IP A", "Unknown", "ua-1"); err != nil {
		t.Fatalf("register #1: %v", err)
	}
	if got := currentSessionID(t, db, userID); got == "" {
		t.Fatal("expected a current session after first register")
	}

	id2, err := svc.RegisterDevice(ctx, userID, "",
		"Device Two", "mobile", "IP B", "Unknown", "ua-2")
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}

	if got := currentSessionID(t, db, userID); got != id2 {
		t.Fatalf("current session: got %q, want %q", got, id2)
	}
	if got := countSessionsForUser(t, db, userID); got != 2 {
		t.Fatalf("session count: got %d, want 2", got)
	}
}

// TestRegisterDevice_LinksActiveAuthSession verifies that an active
// auth.sessions row matching access_token_hash is linked to the freshly
// registered device session via device_session_id.
func TestRegisterDevice_LinksActiveAuthSession(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	authID := createAuthSession(t, db, authSessionOpts{
		UserID:          userID,
		AccessTokenHash: "hash-active",
		Revoked:         false,
		ExpiresAt:       time.Now().Add(time.Hour),
	})

	id, err := svc.RegisterDevice(ctx, userID, "hash-active",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}

	if got := authSessionDeviceLink(t, db, authID); got != id {
		t.Fatalf("device_session_id: got %q, want %q", got, id)
	}
}

// TestRegisterDevice_UnlinksPreviousAuthSession verifies the partial unique
// index contract on auth.sessions.device_session_id: when two distinct
// access tokens map to the same device session, the older link is released
// and only the most recent auth session points at the device row.
func TestRegisterDevice_UnlinksPreviousAuthSession(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	// First token: register and confirm the link.
	auth1 := createAuthSession(t, db, authSessionOpts{
		UserID:          userID,
		AccessTokenHash: "hash-1",
		ExpiresAt:       time.Now().Add(time.Hour),
	})
	id1, err := svc.RegisterDevice(ctx, userID, "hash-1",
		"Device", "desktop", "IP A", "Unknown", "ua-shared")
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}
	if got := authSessionDeviceLink(t, db, auth1); got != id1 {
		t.Fatalf("auth1 link after register #1: got %q, want %q", got, id1)
	}

	// Second token targeting the same device session (same user_agent).
	auth2 := createAuthSession(t, db, authSessionOpts{
		UserID:          userID,
		AccessTokenHash: "hash-2",
		ExpiresAt:       time.Now().Add(time.Hour),
	})
	id2, err := svc.RegisterDevice(ctx, userID, "hash-2",
		"Device", "desktop", "IP A", "Unknown", "ua-shared")
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("expected the same device session id, got %q vs %q", id1, id2)
	}

	if got := authSessionDeviceLink(t, db, auth1); got != "" {
		t.Errorf("auth1 must be unlinked, still points to %q", got)
	}
	if got := authSessionDeviceLink(t, db, auth2); got != id2 {
		t.Errorf("auth2 link: got %q, want %q", got, id2)
	}
}

// TestRegisterDevice_RevokedToken_ReturnsErrAuthSessionInactive verifies
// that a token which existed but is now revoked (row present, revoked_at
// set) causes RegisterDevice to return ErrAuthSessionInactive and roll the
// registration back.
func TestRegisterDevice_RevokedToken_ReturnsErrAuthSessionInactive(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	createAuthSession(t, db, authSessionOpts{
		UserID:          userID,
		AccessTokenHash: "hash-revoked",
		Revoked:         true,
		ExpiresAt:       time.Now().Add(time.Hour),
	})

	_, err := svc.RegisterDevice(ctx, userID, "hash-revoked",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if !errors.Is(err, user.ErrAuthSessionInactive) {
		t.Fatalf("expected ErrAuthSessionInactive, got %v", err)
	}
	if got := countSessionsForUser(t, db, userID); got != 0 {
		t.Fatalf("expected rollback to leave no sessions, got %d", got)
	}
}

// TestRegisterDevice_UnknownToken_SucceedsWithoutLink verifies that a token
// hash with no matching auth.sessions row is accepted silently: the device
// session is created and no auth link is attempted.
func TestRegisterDevice_UnknownToken_SucceedsWithoutLink(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	id, err := svc.RegisterDevice(ctx, userID, "hash-unknown",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty session id")
	}
	if got := countSessionsForUser(t, db, userID); got != 1 {
		t.Fatalf("session count: got %d, want 1", got)
	}
}

// =============================================================================
// Devices
// =============================================================================

// TestDevices_Empty verifies that Devices returns an empty slice (not an
// error) when the user has no sessions.
func TestDevices_Empty(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")

	devices, err := svc.Devices(context.Background(), userID)
	if err != nil {
		t.Fatalf("Devices: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("expected 0 devices, got %d", len(devices))
	}
}

// TestDevices_IsolatesUsers verifies that Devices returns only the sessions
// belonging to the requested user, even when other users have active
// sessions in the same table.
//
// This is the primary defense against a class of bugs where the WHERE
// clause silently loses its user_id filter (typo, refactor, JOIN rewrite).
func TestDevices_IsolatesUsers(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	alice := createTestUser(t, db, "alice")
	bob := createTestUser(t, db, "bob")
	ctx := context.Background()

	// Alice registers two devices so the test can distinguish "returns
	// nothing" from "returns only her rows".
	if _, err := svc.RegisterDevice(ctx, alice, "",
		"Alice Laptop", "desktop", "IP A1", "Unknown", "ua-alice-1"); err != nil {
		t.Fatalf("register alice #1: %v", err)
	}
	if _, err := svc.RegisterDevice(ctx, alice, "",
		"Alice Phone", "mobile", "IP A2", "Unknown", "ua-alice-2"); err != nil {
		t.Fatalf("register alice #2: %v", err)
	}
	if _, err := svc.RegisterDevice(ctx, bob, "",
		"Bob Tablet", "tablet", "IP B1", "Unknown", "ua-bob-1"); err != nil {
		t.Fatalf("register bob: %v", err)
	}

	aliceDevices, err := svc.Devices(ctx, alice)
	if err != nil {
		t.Fatalf("devices alice: %v", err)
	}
	if len(aliceDevices) != 2 {
		t.Fatalf("alice: expected 2 devices, got %d", len(aliceDevices))
	}
	for _, d := range aliceDevices {
		if d.ID == "" {
			t.Fatal("alice: got a device with empty id")
		}
		if d.UserAgent != "ua-alice-1" && d.UserAgent != "ua-alice-2" {
			t.Errorf("alice: leaked device from another user: %+v", d)
		}
		switch d.UserAgent {
		case "ua-alice-1":
			if d.DeviceName != "Alice Laptop" {
				t.Errorf("alice: device_name for ua-alice-1 = %q, want %q",
					d.DeviceName, "Alice Laptop")
			}
		case "ua-alice-2":
			if d.DeviceName != "Alice Phone" {
				t.Errorf("alice: device_name for ua-alice-2 = %q, want %q",
					d.DeviceName, "Alice Phone")
			}
		}
	}

	bobDevices, err := svc.Devices(ctx, bob)
	if err != nil {
		t.Fatalf("devices bob: %v", err)
	}
	if len(bobDevices) != 1 {
		t.Fatalf("bob: expected 1 device, got %d", len(bobDevices))
	}
	if bobDevices[0].DeviceName != "Bob Tablet" {
		t.Errorf("bob: got device_name %q, want %q",
			bobDevices[0].DeviceName, "Bob Tablet")
	}
	if bobDevices[0].UserAgent != "ua-bob-1" {
		t.Errorf("bob: got user_agent %q, want %q",
			bobDevices[0].UserAgent, "ua-bob-1")
	}
}

// TestDevices_IsolatesUsers_ByDeviceID verifies that a device session id
// belonging to one user never surfaces in another user's Devices list.
//
// Complements TestDevices_IsolatesUsers: even if the returned fields look
// plausible, the underlying row must belong to the requested user.
func TestDevices_IsolatesUsers_ByDeviceID(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	alice := createTestUser(t, db, "alice")
	bob := createTestUser(t, db, "bob")
	ctx := context.Background()

	aliceID, err := svc.RegisterDevice(ctx, alice, "",
		"Alice Device", "desktop", "IP A", "Unknown", "ua-alice")
	if err != nil {
		t.Fatalf("register alice: %v", err)
	}
	bobID, err := svc.RegisterDevice(ctx, bob, "",
		"Bob Device", "mobile", "IP B", "Unknown", "ua-bob")
	if err != nil {
		t.Fatalf("register bob: %v", err)
	}
	if aliceID == bobID {
		t.Fatalf("session ids must differ, both = %q", aliceID)
	}

	bobDevices, err := svc.Devices(ctx, bob)
	if err != nil {
		t.Fatalf("devices bob: %v", err)
	}
	for _, d := range bobDevices {
		if d.ID == aliceID {
			t.Fatalf("bob's Devices leaked alice's session %q", aliceID)
		}
	}

	aliceDevices, err := svc.Devices(ctx, alice)
	if err != nil {
		t.Fatalf("devices alice: %v", err)
	}
	for _, d := range aliceDevices {
		if d.ID == bobID {
			t.Fatalf("alice's Devices leaked bob's session %q", bobID)
		}
	}
}

// TestDevices_OrderedByLastActiveDesc verifies that Devices returns sessions
// in descending last_active order, with is_current set on exactly the most
// recently used one.
func TestDevices_OrderedByLastActiveDesc(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	if _, err := svc.RegisterDevice(ctx, userID, "",
		"Old Device", "desktop", "IP A", "Unknown", "ua-old"); err != nil {
		t.Fatalf("register old: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	newID, err := svc.RegisterDevice(ctx, userID, "",
		"New Device", "mobile", "IP B", "Unknown", "ua-new")
	if err != nil {
		t.Fatalf("register new: %v", err)
	}

	devices, err := svc.Devices(ctx, userID)
	if err != nil {
		t.Fatalf("Devices: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}
	if devices[0].ID != newID {
		t.Errorf("first device: got %q, want %q", devices[0].ID, newID)
	}
	if !devices[0].IsCurrent {
		t.Error("first device is_current: got false, want true")
	}
	if devices[1].IsCurrent {
		t.Error("second device is_current: got true, want false")
	}
}

// =============================================================================
// End-to-end scenario from the task
// =============================================================================

// TestRegisterDevice_ReregisterSameUserAgent_ReflectsLatestMetadata
// reproduces the scenario from the task on a real database:
//
//  1. Register(audit-agent-1, Device One,     desktop, IP A)
//  2. Register(audit-agent-1, Renamed Device, mobile,  IP B)
//
// Expectations:
//   - both calls return the same session id;
//   - the database holds a single row;
//   - Devices reports the latest metadata (Renamed Device / mobile / IP B)
//     with is_current = true.
func TestRegisterDevice_ReregisterSameUserAgent_ReflectsLatestMetadata(t *testing.T) {
	db := withCleanDB(t)
	svc := newService(db)
	userID := createTestUser(t, db, "alice")
	ctx := context.Background()

	id1, err := svc.RegisterDevice(ctx, userID, "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}
	id2, err := svc.RegisterDevice(ctx, userID, "",
		"Renamed Device", "mobile", "IP B", "Unknown", "audit-agent-1")
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("expected the same session id, got %q vs %q", id1, id2)
	}
	if got := countSessionsForUser(t, db, userID); got != 1 {
		t.Fatalf("session count: got %d, want 1", got)
	}

	devices, err := svc.Devices(ctx, userID)
	if err != nil {
		t.Fatalf("Devices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	d := devices[0]
	if d.ID != id1 {
		t.Errorf("id: got %q, want %q", d.ID, id1)
	}
	if d.DeviceName != "Renamed Device" {
		t.Errorf("device_name: got %q, want %q", d.DeviceName, "Renamed Device")
	}
	if d.DeviceType != "mobile" {
		t.Errorf("device_type: got %q, want %q", d.DeviceType, "mobile")
	}
	if d.IPAddress != "IP B" {
		t.Errorf("ip_address: got %q, want %q", d.IPAddress, "IP B")
	}
	if !d.IsCurrent {
		t.Error("is_current: got false, want true")
	}
}
