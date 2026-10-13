//go:build integration

// Package integration — integration tests for user.Service.Search and
// user.Service.UpdateProfile against a real PostgreSQL.
//
// These tests exist because the sqlmock-based unit tests match the SQL text
// verbatim and therefore cannot catch the "Auditb → UniqueSearchName260831"
// class of bugs, where SELECT and WHERE read first_name/last_name from
// different sources. Only a real database can prove the fix: after a rename,
// the new value must be findable and the old value must not be.
package integration

import (
	"context"
	"database/sql"
	"testing"

	"craneapp/backend-v2/internal/user"
)

// -----------------------------------------------------------------------------
// Helpers specific to Search / UpdateProfile tests.
//
// Intentionally separate from test_helpers.go: the shared createTestUser only
// sets username, which violates the auth.users NOT NULL constraints
// (password_hash, first_name). These helpers exist so the shared fixtures do
// not need to change.
// -----------------------------------------------------------------------------

// createAuthUser inserts a fully-populated auth.users row and returns its UUID
// as text. password_hash is a fixed placeholder — nothing in Search or
// UpdateProfile reads it.
func createAuthUser(t *testing.T, db *sql.DB, username, firstName, lastName string) string {
	t.Helper()

	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO auth.users (username, password_hash, first_name, last_name)
		VALUES ($1, 'test-hash', $2, $3)
		RETURNING id::text
	`, username, firstName, lastName).Scan(&id)
	if err != nil {
		t.Fatalf("insert auth user %q: %v", username, err)
	}
	return id
}

// seedProfile inserts a users.profiles row directly, bypassing the service.
// Used by tests that need a profile that already exists before Search runs.
func seedProfile(t *testing.T, db *sql.DB, userID, firstName, lastName, bio, avatarURL string) {
	t.Helper()

	_, err := db.ExecContext(context.Background(), `
		INSERT INTO users.profiles (user_id, first_name, last_name, bio, avatar_url)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, firstName, lastName, bio, avatarURL)
	if err != nil {
		t.Fatalf("seed profile for %s: %v", userID, err)
	}
}

// requireSingleResult asserts that Search returned exactly one row for the
// expected user and returns it for further field-level assertions.
func requireSingleResult(t *testing.T, results []user.SearchResult, wantID string) user.SearchResult {
	t.Helper()

	if len(results) != 1 {
		t.Fatalf("expected exactly 1 result, got %d: %+v", len(results), results)
	}
	if results[0].ID != wantID {
		t.Fatalf("expected result for user %s, got %s", wantID, results[0].ID)
	}
	return results[0]
}

// requireNoResults asserts that Search returned nothing.
func requireNoResults(t *testing.T, results []user.SearchResult, when string) {
	t.Helper()

	if len(results) != 0 {
		t.Fatalf("%s: expected no results, got %+v", when, results)
	}
}

// -----------------------------------------------------------------------------
// First-name: the primary regression — Auditb → UniqueSearchName260831
// -----------------------------------------------------------------------------

// TestSearch_AfterFirstNameUpdate_FindsNewNameAndHidesOldName reproduces the
// original bug end to end:
//
//  1. a user exists with first_name = "Auditb" (auth.users only, no profile);
//  2. Search finds them by "Auditb";
//  3. PUT /me changes first_name to "UniqueSearchName260831";
//  4. Search finds them by the new name and the response shows the new name;
//  5. Search no longer matches the old name.
//
// Step 5 is the crux: if WHERE reads auth.users.first_name while SELECT reads
// users.profiles.first_name, step 5 still returns the user.
func TestSearch_AfterFirstNameUpdate_FindsNewNameAndHidesOldName(t *testing.T) {
	ctx := context.Background()
	db := withCleanDB(t)
	svc := newService(db)

	viewerID := createAuthUser(t, db, "viewer", "Viewer", "User")
	targetID := createAuthUser(t, db, "target", "Auditb", "Old")

	// Sanity: the target is discoverable by the current first name.
	got, err := svc.Search(ctx, viewerID, "Auditb")
	if err != nil {
		t.Fatalf("Search(Auditb) before rename: %v", err)
	}
	requireSingleResult(t, got, targetID)

	// PUT /me: change only the first name.
	const newName = "UniqueSearchName260831"
	if _, err := svc.UpdateProfile(ctx, targetID, ptr(newName), nil, nil, nil); err != nil {
		t.Fatalf("UpdateProfile(first_name): %v", err)
	}

	// New name must be findable and returned in the response.
	got, err = svc.Search(ctx, viewerID, newName)
	if err != nil {
		t.Fatalf("Search(%q) after rename: %v", newName, err)
	}
	res := requireSingleResult(t, got, targetID)
	if res.FirstName != newName {
		t.Errorf("response FirstName = %q, want %q", res.FirstName, newName)
	}

	// Old name must no longer match — this is what the original bug violated.
	got, err = svc.Search(ctx, viewerID, "Auditb")
	if err != nil {
		t.Fatalf("Search(Auditb) after rename: %v", err)
	}
	requireNoResults(t, got, "Search(Auditb) after rename")
}

// -----------------------------------------------------------------------------
// Fallback: no users.profiles row → Search falls back to auth.users
// -----------------------------------------------------------------------------

// TestSearch_FallsBackToAuthUsers_WhenProfileRowMissing verifies the other
// half of the SELECT/WHERE contract: when users.profiles has no row for a
// user, Search must still find them via auth.users (COALESCE fallback) and
// return the same values it matched on.
func TestSearch_FallsBackToAuthUsers_WhenProfileRowMissing(t *testing.T) {
	ctx := context.Background()
	db := withCleanDB(t)
	svc := newService(db)

	viewerID := createAuthUser(t, db, "viewer", "Viewer", "User")
	targetID := createAuthUser(t, db, "no_profile_target", "FallbackFirst", "FallbackLast")

	// By first_name — matched through COALESCE(up.first_name, au.first_name).
	got, err := svc.Search(ctx, viewerID, "FallbackFirst")
	if err != nil {
		t.Fatalf("Search by fallback first_name: %v", err)
	}
	res := requireSingleResult(t, got, targetID)
	if res.FirstName != "FallbackFirst" || res.LastName != "FallbackLast" {
		t.Errorf("response = (%q, %q), want (FallbackFirst, FallbackLast)",
			res.FirstName, res.LastName)
	}
	// avatar_url is NULL in auth.users and defaults to '' in profiles; with no
	// profile row, COALESCE(up.avatar_url, '') must yield "".
	if res.AvatarURL != "" {
		t.Errorf("AvatarURL = %q, want empty", res.AvatarURL)
	}

	// By last_name — matched through COALESCE(up.last_name, au.last_name).
	got, err = svc.Search(ctx, viewerID, "FallbackLast")
	if err != nil {
		t.Fatalf("Search by fallback last_name: %v", err)
	}
	requireSingleResult(t, got, targetID)
}

// -----------------------------------------------------------------------------
// Last-name branch
// -----------------------------------------------------------------------------

// TestSearch_AfterLastNameUpdate_FindsNewNameAndHidesOldName is the last_name
// counterpart of the first-name regression. It exercises the second COALESCE
// pair in both SELECT and WHERE independently.
func TestSearch_AfterLastNameUpdate_FindsNewNameAndHidesOldName(t *testing.T) {
	ctx := context.Background()
	db := withCleanDB(t)
	svc := newService(db)

	viewerID := createAuthUser(t, db, "viewer", "Viewer", "User")
	targetID := createAuthUser(t, db, "target", "Some", "OldLastName")

	got, err := svc.Search(ctx, viewerID, "OldLastName")
	if err != nil {
		t.Fatalf("Search(old last_name) before update: %v", err)
	}
	requireSingleResult(t, got, targetID)

	const newLast = "FreshLastName"
	if _, err := svc.UpdateProfile(ctx, targetID, nil, ptr(newLast), nil, nil); err != nil {
		t.Fatalf("UpdateProfile(last_name): %v", err)
	}

	got, err = svc.Search(ctx, viewerID, newLast)
	if err != nil {
		t.Fatalf("Search(%q) after update: %v", newLast, err)
	}
	res := requireSingleResult(t, got, targetID)
	if res.LastName != newLast {
		t.Errorf("response LastName = %q, want %q", res.LastName, newLast)
	}

	got, err = svc.Search(ctx, viewerID, "OldLastName")
	if err != nil {
		t.Fatalf("Search(old last_name) after update: %v", err)
	}
	requireNoResults(t, got, "Search(old last_name) after update")
}

// -----------------------------------------------------------------------------
// Bio branch
// -----------------------------------------------------------------------------

// TestSearch_MatchesByBio_AfterUpdateProfile verifies that Search matches a
// user by a substring that appears only in users.profiles.bio, and that the
// value is visible only after UpdateProfile has written it.
func TestSearch_MatchesByBio_AfterUpdateProfile(t *testing.T) {
	ctx := context.Background()
	db := withCleanDB(t)
	svc := newService(db)

	viewerID := createAuthUser(t, db, "viewer", "Viewer", "User")
	targetID := createAuthUser(t, db, "target", "SomeFirstName", "SomeLastName")

	// The token appears in no name and no username, so it must not match yet.
	const token = "uniquebiotoken"
	got, err := svc.Search(ctx, viewerID, token)
	if err != nil {
		t.Fatalf("Search before bio set: %v", err)
	}
	requireNoResults(t, got, "Search before bio set")

	const bio = "passionate about uniquebiotoken conservation"
	if _, err := svc.UpdateProfile(ctx, targetID, nil, nil, ptr(bio), nil); err != nil {
		t.Fatalf("UpdateProfile(bio): %v", err)
	}

	got, err = svc.Search(ctx, viewerID, token)
	if err != nil {
		t.Fatalf("Search by bio: %v", err)
	}
	requireSingleResult(t, got, targetID)
}

// TestSearch_DoesNotMatchByBio_WhenProfileRowMissing documents that a user
// without a users.profiles row cannot be matched "by bio": up.bio is NULL in
// the LEFT JOIN, and NULL ILIKE ... is NULL (not TRUE), so the bio branch of
// the OR chain never fires for them.
//
// This is a guard against a future refactor that might replace
// `up.bio ILIKE $1` with something that defaults NULL to ” and, combined
// with a wide pattern, would spuriously match profile-less users.
func TestSearch_DoesNotMatchByBio_WhenProfileRowMissing(t *testing.T) {
	ctx := context.Background()
	db := withCleanDB(t)
	svc := newService(db)

	viewerID := createAuthUser(t, db, "viewer", "Viewer", "User")
	_ = createAuthUser(t, db, "no_profile", "No", "Profile")

	// Token deliberately present in no username, first_name or last_name.
	got, err := svc.Search(ctx, viewerID, "biotokennotinanyname")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	requireNoResults(t, got, "Search against profile-less user")
}

// -----------------------------------------------------------------------------
// Small utilities
// -----------------------------------------------------------------------------

// ptr returns a pointer to v. Keeps the pointer-heavy UpdateProfile call sites
// readable.
func ptr[T any](v T) *T { return &v }
