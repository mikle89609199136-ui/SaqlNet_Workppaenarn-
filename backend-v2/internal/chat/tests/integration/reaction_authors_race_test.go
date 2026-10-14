//go:build integration

package integration

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupGroupReactionFixture builds a service, a group chat with two members
// (owner, member) and one message from the owner. The chat is a group rather
// than private because LeaveChat is only valid for groups: the race tests
// need a scenario where a member can actually walk out between pages.
func setupGroupReactionFixture(t *testing.T) (*chat.Service, string, string, string, string, context.Context) {
	t.Helper()
	t.Cleanup(func() {
		truncateTables(t, TestDB, context.Background())
	})

	ctx := context.Background()
	svc := newChatService(t)
	ownerID := seedUser(t, TestDB, ctx)
	peerID := seedUser(t, TestDB, ctx)
	chatID := seedChat(t, TestDB, ctx, "group", ownerID, map[string]string{
		ownerID: "owner",
		peerID:  "member",
	})
	messageID := seedMessage(t, TestDB, ctx, chatID, ownerID, "hello")
	return svc, ownerID, peerID, chatID, messageID, ctx
}

// -----------------------------------------------------------------------------
// Deterministic: leave between pages
// -----------------------------------------------------------------------------

// TestListReactionAuthors_LeaveBetweenPages pins the guarantee that every page
// re-checks membership. A member loads page 1, leaves the chat, then tries to
// load page 2 with the cursor from page 1; the second call must fail with
// ErrForbidden. Without this re-check a former member could paginate through
// history they are no longer entitled to.
func TestListReactionAuthors_LeaveBetweenPages(t *testing.T) {
	svc, ownerID, peerID, chatID, messageID, ctx := setupGroupReactionFixture(t)

	// Five authors is enough to guarantee a second page at limit=2.
	base := time.Now().Add(-time.Hour)
	authorIDs := []string{ownerID, peerID}
	for i := 0; i < 3; i++ {
		uid := seedUser(t, TestDB, ctx)
		seedMember(t, TestDB, ctx, chatID, uid, "member")
		authorIDs = append(authorIDs, uid)
	}
	for i, uid := range authorIDs {
		seedReactionAt(t, TestDB, ctx, messageID, uid, emojiThumbsUp, base.Add(time.Duration(i)*time.Second))
	}

	page1, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 2)
	require.NoError(t, err)
	require.Len(t, page1.Users, 2)
	require.NotEmpty(t, page1.NextCursor, "fixture must produce a second page")

	require.NoError(t, svc.LeaveChat(ctx, peerID, chatID))

	_, err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, page1.NextCursor, 2)
	require.ErrorIs(t, err, chat.ErrForbidden)

	// The remaining member sees the same first page: reactions live with the
	// message, not with the reader, and leaving does not shift the cursor.
	page1AsOwner, err := svc.ListReactionAuthors(ctx, ownerID, messageID, emojiThumbsUp, "", 2)
	require.NoError(t, err)
	assert.Equal(t, page1.Total, page1AsOwner.Total)
	assert.Equal(t, page1.NextCursor, page1AsOwner.NextCursor)
	assert.Equal(t, page1.Users, page1AsOwner.Users)
}

// -----------------------------------------------------------------------------
// Race: leave and read run at the same instant
// -----------------------------------------------------------------------------

// TestListReactionAuthors_ConcurrentLeaveAndRead exercises the boundary between
// "a member is paginating" and "the same member leaves the chat". Because the
// interleaving is not deterministic, the test asserts invariants rather than a
// specific outcome:
//
//   - no goroutine panics;
//   - every error from a read is either nil or ErrForbidden; a generic database
//     error or ErrNotFound would signal a broken access path;
//   - LeaveChat itself succeeds because the caller is a member of a group chat
//     at the moment it runs;
//   - a page that succeeds is well-formed (total is the seeded count).
//
// The test runs multiple iterations so that on a multi-core machine both
// orderings (read-then-leave, leave-then-read) are likely to occur.
//
// Note: require/assert must not be called from goroutines other than the test
// goroutine — testing.T.FailNow panics otherwise. The goroutines below only
// record their results; the assertions run after wg.Wait.
func TestListReactionAuthors_ConcurrentLeaveAndRead(t *testing.T) {
	const iterations = 10

	for i := 0; i < iterations; i++ {
		t.Run(fmt.Sprintf("iter_%02d", i), func(t *testing.T) {
			svc, ownerID, peerID, chatID, messageID, ctx := setupGroupReactionFixture(t)

			base := time.Now().Add(-time.Hour)
			authorIDs := []string{ownerID, peerID}
			for k := 0; k < 3; k++ {
				uid := seedUser(t, TestDB, ctx)
				seedMember(t, TestDB, ctx, chatID, uid, "member")
				authorIDs = append(authorIDs, uid)
			}
			for k, uid := range authorIDs {
				seedReactionAt(t, TestDB, ctx, messageID, uid, emojiThumbsUp, base.Add(time.Duration(k)*time.Second))
			}

			var (
				page1    chat.ReactionAuthorsPage
				page1Err error
				page2Err error
				leaveErr error
			)

			// start releases both goroutines at the same instant; the scheduler
			// (and the database) decide the interleaving from there.
			start := make(chan struct{})
			var wg sync.WaitGroup
			wg.Add(2)

			go func() {
				defer wg.Done()
				<-start
				page1, page1Err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 2)
				if page1Err != nil {
					return
				}
				_, page2Err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, page1.NextCursor, 2)
			}()
			go func() {
				defer wg.Done()
				<-start
				leaveErr = svc.LeaveChat(ctx, peerID, chatID)
			}()

			close(start)
			wg.Wait()

			// The leaver is a member at the start; LeaveChat must succeed
			// regardless of how the read raced with it.
			require.NoError(t, leaveErr)

			// Page 1 may win (200) or lose (403) the race, but a loss must be
			// ErrForbidden, not a generic failure.
			if page1Err != nil {
				require.ErrorIs(t, page1Err, chat.ErrForbidden,
					"page 1 failed with an unexpected error: %v", page1Err)
			}

			// page2Err is only meaningful when page 1 succeeded: the goroutine
			// above returns early if page1Err != nil, so page 2 is never
			// attempted in that branch. A nil page2Err therefore means either
			// "page 2 was not called" (page 1 failed) or "page 2 succeeded"
			// (reader survived the race). The check below only fires in the
			// second case, where any error must be ErrForbidden — the reader
			// either still is a member or is not.
			if page2Err != nil {
				require.ErrorIs(t, page2Err, chat.ErrForbidden,
					"page 2 failed with an unexpected error: %v", page2Err)
			}

			// A successful page 1 is well-formed.
			if page1Err == nil {
				require.Len(t, page1.Users, 2)
				assert.Equal(t, 5, page1.Total)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// Race: many readers of the same page
// -----------------------------------------------------------------------------

// TestListReactionAuthors_ManyConcurrentReaders fires N goroutines that read
// the same page and asserts that every reader sees exactly the same authors in
// the same order. The read path is stateless per call, and the tuple-based
// ordering (created_at DESC, user_id DESC) is deterministic across concurrent
// connections, so no reader may observe a different arrangement than another.
func TestListReactionAuthors_ManyConcurrentReaders(t *testing.T) {
	const (
		readers = 16
		authors = 5
	)

	svc, ownerID, peerID, chatID, messageID, ctx := setupGroupReactionFixture(t)

	// Distinct, monotonic timestamps make the expected order unambiguous.
	base := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	authorIDs := []string{ownerID, peerID}
	for k := 0; k < authors-2; k++ {
		uid := seedUser(t, TestDB, ctx)
		seedMember(t, TestDB, ctx, chatID, uid, "member")
		authorIDs = append(authorIDs, uid)
	}
	for k, uid := range authorIDs {
		seedReactionAt(t, TestDB, ctx, messageID, uid, emojiThumbsUp, base.Add(time.Duration(k)*time.Second))
	}

	type result struct {
		page chat.ReactionAuthorsPage
		err  error
	}
	results := make([]result, readers)

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(readers)
	for i := 0; i < readers; i++ {
		go func(slot int) {
			defer wg.Done()
			<-start
			page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 10)
			results[slot] = result{page: page, err: err}
		}(i)
	}
	close(start)
	wg.Wait()

	for i, r := range results {
		require.NoErrorf(t, r.err, "reader %d failed", i)
		require.Lenf(t, r.page.Users, authors, "reader %d returned the wrong number of authors", i)
		assert.Equalf(t, authors, r.page.Total, "reader %d saw the wrong total", i)
	}

	// Every reader must agree on the ID order.
	reference := results[0].page.Users
	for i := 1; i < readers; i++ {
		got := results[i].page.Users
		require.Len(t, got, len(reference))
		for j := range reference {
			assert.Equalf(t, reference[j].ID, got[j].ID,
				"reader %d disagrees with reader 0 at position %d", i, j)
		}
	}
}
