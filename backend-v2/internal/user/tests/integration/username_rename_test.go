//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"craneapp/backend-v2/internal/auth"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/profileevent"
	"craneapp/backend-v2/internal/user"

	"github.com/lib/pq"
)

type authCryptoStub struct{}

func (authCryptoStub) HashPassword(context.Context, string) (string, error) { return "hash", nil }
func (authCryptoStub) VerifyPassword(context.Context, string, string) (bool, error) {
	return true, nil
}
func (authCryptoStub) IssueToken(context.Context, string, string, int64) (cryptoclient.IssuedToken, error) {
	return cryptoclient.IssuedToken{Token: "token", ExpiresAt: time.Unix(2_000_000_000, 0).UTC()}, nil
}

// TestConcurrentUsernameClaim exercises the registry and the rename path under
// real PostgreSQL concurrency, against the shared TestDB container managed by
// TestMain. The clean-state contract of withCleanDB lets us use fixed names:
// every table is truncated after the test, so a fresh run starts empty.
//
// If the DB is run without TEST_DATABASE_URL, the shared container is what
// supplies it, so no skip is needed here.
func TestConcurrentUsernameClaim(t *testing.T) {
	db := withCleanDB(t)
	ctx := context.Background()

	// Truncation in withCleanDB wipes the registry between tests; the schema
	// itself is created once by TestMain's migrations.
	var registryExists bool
	if err := db.QueryRowContext(ctx,
		`SELECT to_regclass('auth.username_registry') IS NOT NULL`,
	).Scan(&registryExists); err != nil {
		t.Fatal(err)
	}
	if !registryExists {
		t.Fatal("migration 0025_username_changes.sql is not applied")
	}

	oldNames := []string{"race_a", "race_b"}
	target := "race_target"

	userIDs := make([]string, 0, len(oldNames))
	for _, username := range oldNames {
		var userID string
		err := db.QueryRowContext(ctx, `
			WITH claimed AS (
				INSERT INTO auth.username_registry (username, user_id)
				VALUES ($1, gen_random_uuid())
				RETURNING user_id
			)
			INSERT INTO auth.users (id, username, password_hash, first_name)
			SELECT user_id, $1, 'test', $1 FROM claimed
			RETURNING id::text
		`, username).Scan(&userID)
		if err != nil {
			t.Fatalf("seed user %q: %v", username, err)
		}
		userIDs = append(userIDs, userID)
	}

	service := user.NewService(db)

	// LISTEN/NOTIFY needs its own connection; it comes from the shared DSN.
	// pq.NewListener manages reconnects, so it is closed via defer, not via
	// the *sql.DB pool.
	listener := pq.NewListener(TestDSN, time.Second, 5*time.Second, nil)
	defer func() { _ = listener.Close() }()
	if err := listener.Listen(profileevent.Channel); err != nil {
		t.Fatalf("listen for profile event: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, len(userIDs))
	var wg sync.WaitGroup
	for _, id := range userIDs {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			<-start
			_, renameErr := service.RenameUsername(ctx, userID, target)
			results <- renameErr
		}(id)
	}
	close(start)
	wg.Wait()
	close(results)

	var successes, conflicts int
	for result := range results {
		switch {
		case result == nil:
			successes++
		case errors.Is(result, user.ErrUsernameTaken):
			conflicts++
		default:
			t.Fatalf("unexpected rename result: %v", result)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one winner and one conflict, got successes=%d conflicts=%d", successes, conflicts)
	}

	select {
	case notification := <-listener.Notify:
		if notification == nil {
			t.Fatal("profile notification channel closed")
		}
		var event profileevent.UsernameChanged
		if err := json.Unmarshal([]byte(notification.Extra), &event); err != nil {
			t.Fatalf("decode profile notification: %v", err)
		}
		if event.Username != target {
			t.Fatalf("notification username = %q, want %q", event.Username, target)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for committed profile notification")
	}

	var claims int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM auth.username_registry WHERE username = $1`, target,
	).Scan(&claims); err != nil {
		t.Fatal(err)
	}
	if claims != 1 {
		t.Fatalf("expected exactly one registry claim, got %d", claims)
	}

	var winnerID string
	if err := db.QueryRowContext(ctx,
		`SELECT id::text FROM auth.users WHERE username = $1`, target,
	).Scan(&winnerID); err != nil {
		t.Fatal(err)
	}
	winnerOldName := oldNames[0]
	if winnerID == userIDs[1] {
		winnerOldName = oldNames[1]
	}

	available, err := service.IsUsernameAvailable(ctx, winnerOldName)
	if err != nil {
		t.Fatal(err)
	}
	if available {
		t.Fatalf("previous username %q must remain reserved", winnerOldName)
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO auth.users (username, password_hash, first_name)
		VALUES ($1, 'test', 'Bypass')
	`, winnerOldName)
	var conflict *pq.Error
	if !errors.As(err, &conflict) || conflict.Code != "23505" {
		t.Fatalf("expected registry trigger to reject direct insert, got %v", err)
	}

	authService := auth.NewService(db, authCryptoStub{})
	if _, _, err := authService.Register(ctx, winnerOldName, "Password1!", "Taken", "", ""); !errors.Is(err, auth.ErrUsernameTaken) {
		t.Fatalf("expected previous username registration to fail with ErrUsernameTaken, got %v", err)
	}

	if _, _, err := authService.Register(ctx, "race_fresh", "Password1!", "Fresh", "", ""); err != nil {
		t.Fatalf("register fresh username through registry: %v", err)
	}
}
