//go:build integration

package integration

import (
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	emojiThumbsUp = "👍"
	emojiHeart    = "❤️"
	emojiFire     = "🔥"
)

// -----------------------------------------------------------------------------
// Access: participant, stranger, former member, missing/deleted message
// -----------------------------------------------------------------------------

func TestListReactionAuthors_Access(t *testing.T) {
	t.Run("participant gets authors", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)
		seedReaction(t, TestDB, ctx, messageID, peerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Equal(t, 2, page.Total)
		require.Len(t, page.Users, 2)
	})

	t.Run("stranger is forbidden", func(t *testing.T) {
		svc, ownerID, _, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		strangerID := seedUser(t, TestDB, ctx)
		_, err := svc.ListReactionAuthors(ctx, strangerID, messageID, emojiThumbsUp, "", 0)
		require.ErrorIs(t, err, chat.ErrForbidden)
	})

	t.Run("former member is forbidden", func(t *testing.T) {
		svc, ownerID, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		_, err := TestDB.ExecContext(ctx,
			`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`,
			chatID, peerID)
		require.NoError(t, err)

		_, err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.ErrorIs(t, err, chat.ErrForbidden)
	})

	t.Run("unknown message is not found", func(t *testing.T) {
		svc, _, peerID, _, _, ctx := setupReactionFixture(t)
		_, err := svc.ListReactionAuthors(ctx, peerID, randomUUID(t), emojiThumbsUp, "", 0)
		require.ErrorIs(t, err, chat.ErrNotFound)
	})

	t.Run("soft-deleted message is not found", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		_, err := TestDB.ExecContext(ctx,
			`UPDATE messages.messages SET deleted_at = NOW() WHERE id = $1`, messageID)
		require.NoError(t, err)

		_, err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.ErrorIs(t, err, chat.ErrNotFound)
	})

	t.Run("unknown message outranks forbidden for stranger", func(t *testing.T) {
		// A stranger querying a non-existent message must get ErrNotFound,
		// not ErrForbidden: the handler must not reveal which UUIDs exist.
		svc, _, _, _, _, ctx := setupReactionFixture(t)
		strangerID := seedUser(t, TestDB, ctx)
		_, err := svc.ListReactionAuthors(ctx, strangerID, randomUUID(t), emojiThumbsUp, "", 0)
		require.ErrorIs(t, err, chat.ErrNotFound)
	})
}

// -----------------------------------------------------------------------------
// Multiple emoji: filter isolation and emoji switching
// -----------------------------------------------------------------------------

func TestListReactionAuthors_MultipleEmoji(t *testing.T) {
	t.Run("filters by emoji", func(t *testing.T) {
		svc, ownerID, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		thirdID := seedUser(t, TestDB, ctx)
		// The API only lets members react, so the fixture does the same:
		// seeding a reaction for a non-member would create a state the
		// service can never produce, and would silently break any future
		// read-side filter that relies on membership.
		seedMember(t, TestDB, ctx, chatID, thirdID, "member")

		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)
		seedReaction(t, TestDB, ctx, messageID, peerID, emojiThumbsUp)
		seedReaction(t, TestDB, ctx, messageID, thirdID, emojiHeart)

		thumbs, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Equal(t, 2, thumbs.Total)
		require.Len(t, thumbs.Users, 2)

		heart, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiHeart, "", 0)
		require.NoError(t, err)
		require.Equal(t, 1, heart.Total)
		require.Len(t, heart.Users, 1)
		assert.Equal(t, thirdID, heart.Users[0].ID)
	})

	t.Run("emoji with no reactions returns empty page", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiFire, "", 0)
		require.NoError(t, err)
		assert.Equal(t, 0, page.Total)
		assert.Empty(t, page.Users)
		assert.Empty(t, page.NextCursor)
	})

	t.Run("switching emoji moves the author between lists", func(t *testing.T) {
		// The reaction-logic migration reduced the unique key to
		// (message_id, user_id): switching emoji is an UPDATE of a single row,
		// so the author disappears from the old list and appears in the new one.
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		_, err := TestDB.ExecContext(ctx,
			`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
			emojiHeart, messageID, ownerID)
		require.NoError(t, err)

		thumbs, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		assert.Equal(t, 0, thumbs.Total)

		heart, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiHeart, "", 0)
		require.NoError(t, err)
		require.Equal(t, 1, heart.Total)
		assert.Equal(t, ownerID, heart.Users[0].ID)
	})
}

// -----------------------------------------------------------------------------
// Pagination: cursor round-trip, stable ordering, limit normalization
// -----------------------------------------------------------------------------

func TestListReactionAuthors_Pagination(t *testing.T) {
	t.Run("cursor walks every author exactly once", func(t *testing.T) {
		svc, ownerID, peerID, chatID, messageID, ctx := setupReactionFixture(t)

		authorIDs := []string{ownerID, peerID}
		for i := 0; i < 3; i++ {
			uid := seedUser(t, TestDB, ctx)
			seedMember(t, TestDB, ctx, chatID, uid, "member")
			authorIDs = append(authorIDs, uid)
		}

		base := time.Now().Add(-time.Hour)
		for i, uid := range authorIDs {
			seedReactionAt(t, TestDB, ctx, messageID, uid, emojiThumbsUp, base.Add(time.Duration(i)*time.Second))
		}

		seen := map[string]bool{}
		cursor := ""
		pages := 0
		for {
			page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, cursor, 2)
			require.NoError(t, err)
			assert.Equal(t, 5, page.Total, "total must not depend on the page")

			for _, u := range page.Users {
				require.Falsef(t, seen[u.ID], "author %s appeared on two pages", u.ID)
				seen[u.ID] = true
			}
			pages++
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
			require.LessOrEqual(t, pages, 10, "pagination did not terminate")
		}
		assert.Len(t, seen, 5, "every author must be returned once")
		assert.Equal(t, 3, pages, "5 authors with limit=2 must be 3 pages")
	})

	t.Run("stable order when created_at is equal", func(t *testing.T) {
		// The tuple comparison (created_at, user_id) must give a deterministic
		// order even when several reactions share the same timestamp —
		// otherwise cursor pagination could skip or duplicate rows.
		svc, ownerID, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		thirdID := seedUser(t, TestDB, ctx)
		fourthID := seedUser(t, TestDB, ctx)
		seedMember(t, TestDB, ctx, chatID, thirdID, "member")
		seedMember(t, TestDB, ctx, chatID, fourthID, "member")

		sameTime := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
		for _, uid := range []string{ownerID, peerID, thirdID, fourthID} {
			seedReactionAt(t, TestDB, ctx, messageID, uid, emojiThumbsUp, sameTime)
		}

		page1, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 10)
		require.NoError(t, err)
		page2, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 10)
		require.NoError(t, err)

		require.Len(t, page1.Users, 4)
		require.Len(t, page2.Users, 4)
		for i := range page1.Users {
			assert.Equal(t, page1.Users[i].ID, page2.Users[i].ID, "order must be deterministic")
		}
		// PostgreSQL orders UUID values by their 16-byte representation,
		// which coincides with lexicographic ordering of the canonical text
		// form because the hyphens sit at fixed positions.
		for i := 1; i < len(page1.Users); i++ {
			assert.Greater(t, page1.Users[i-1].ID, page1.Users[i].ID)
		}
	})

	t.Run("limit normalization", func(t *testing.T) {
		svc, _, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		for i := 0; i < 5; i++ {
			u := seedUser(t, TestDB, ctx)
			seedMember(t, TestDB, ctx, chatID, u, "member")
			seedReactionAt(t, TestDB, ctx, messageID, u, emojiThumbsUp, time.Now().Add(time.Duration(i)*time.Second))
		}

		// limit <= 0 falls back to the default (50) — all 5 fit.
		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		assert.Len(t, page.Users, 5)

		page, err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", -5)
		require.NoError(t, err)
		assert.Len(t, page.Users, 5)

		// limit > max is capped at 100 — still 5.
		page, err = svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 9999)
		require.NoError(t, err)
		assert.Len(t, page.Users, 5)
	})

	t.Run("malformed cursor is invalid input", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		for _, bad := range []string{
			"!not-base64!", // invalid base64
			"YWJj",         // valid base64, not JSON
			"e30",          // valid base64, JSON {}, but missing fields
		} {
			_, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, bad, 0)
			require.ErrorIsf(t, err, chat.ErrInvalidInput, "cursor=%q", bad)
		}
	})
}

// -----------------------------------------------------------------------------
// Privacy and block rules for the avatar
// -----------------------------------------------------------------------------

func TestListReactionAuthors_Privacy(t *testing.T) {
	const ownerAvatar = "https://cdn.example.com/o.png"

	t.Run("avatar visible by default", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Equal(t, ownerAvatar, page.Users[0].AvatarURL)
	})

	t.Run("photoVisibility=nobody hides avatar but keeps names", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedPrivacySettings(t, TestDB, ctx, ownerID, map[string]any{"photoVisibility": "nobody"})
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Empty(t, page.Users[0].AvatarURL)
		assert.NotEmpty(t, page.Users[0].Username)
		assert.NotEmpty(t, page.Users[0].FirstName)
	})

	t.Run("missing settings row falls back to default (all)", func(t *testing.T) {
		// No users.settings row: privacy.Parse(nil) returns the defaults,
		// photoVisibility = all.
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Equal(t, ownerAvatar, page.Users[0].AvatarURL)
	})

	t.Run("author blocking viewer hides avatar", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedBlock(t, TestDB, ctx, ownerID, peerID)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Empty(t, page.Users[0].AvatarURL)
	})

	t.Run("viewer blocking author does not hide the avatar", func(t *testing.T) {
		// Photo is one-way: the viewer's own block list does not affect what
		// they see. Pinned by applyPeerPrivacy and by privacy.Decide.
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedBlock(t, TestDB, ctx, peerID, ownerID)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Equal(t, ownerAvatar, page.Users[0].AvatarURL)
	})

	t.Run("exception allow=true overrides nobody", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedPrivacySettings(t, TestDB, ctx, ownerID, map[string]any{"photoVisibility": "nobody"})
		seedPrivacyException(t, TestDB, ctx, ownerID, peerID, "photoVisibility", true)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Equal(t, ownerAvatar, page.Users[0].AvatarURL)
	})

	t.Run("exception allow=false overrides all", func(t *testing.T) {
		svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedPrivacySettings(t, TestDB, ctx, ownerID, map[string]any{"photoVisibility": "all"})
		seedPrivacyException(t, TestDB, ctx, ownerID, peerID, "photoVisibility", false)
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Empty(t, page.Users[0].AvatarURL)
	})

	t.Run("author sees their own avatar even under nobody", func(t *testing.T) {
		svc, ownerID, _, _, messageID, ctx := setupReactionFixture(t)
		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedPrivacySettings(t, TestDB, ctx, ownerID, map[string]any{"photoVisibility": "nobody"})
		seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

		page, err := svc.ListReactionAuthors(ctx, ownerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 1)
		assert.Equal(t, ownerAvatar, page.Users[0].AvatarURL)
	})

	t.Run("privacy is applied per-author on a mixed page", func(t *testing.T) {
		svc, ownerID, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		thirdID := seedUser(t, TestDB, ctx)
		seedMember(t, TestDB, ctx, chatID, thirdID, "member")

		seedProfile(t, TestDB, ctx, ownerID, "Owner", "One", ownerAvatar)
		seedProfile(t, TestDB, ctx, thirdID, "Third", "Three", "https://cdn.example.com/t.png")
		seedPrivacySettings(t, TestDB, ctx, thirdID, map[string]any{"photoVisibility": "nobody"})

		base := time.Now().Add(-time.Minute)
		seedReactionAt(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp, base.Add(-time.Second))
		seedReactionAt(t, TestDB, ctx, messageID, thirdID, emojiThumbsUp, base)

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		require.Len(t, page.Users, 2)

		byID := map[string]string{}
		for _, u := range page.Users {
			byID[u.ID] = u.AvatarURL
		}
		assert.Equal(t, ownerAvatar, byID[ownerID])
		assert.Empty(t, byID[thirdID])
	})
}

// -----------------------------------------------------------------------------
// Total: consistency with the aggregate reader and across pages
// -----------------------------------------------------------------------------

func TestListReactionAuthors_TotalConsistency(t *testing.T) {
	t.Run("total matches aggregate and single page length", func(t *testing.T) {
		svc, _, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		for i := 0; i < 4; i++ {
			u := seedUser(t, TestDB, ctx)
			seedMember(t, TestDB, ctx, chatID, u, "member")
			seedReactionAt(t, TestDB, ctx, messageID, u, emojiThumbsUp, time.Now().Add(time.Duration(i)*time.Second))
		}

		page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, "", 0)
		require.NoError(t, err)
		assert.Equal(t, 4, page.Total)
		assert.Len(t, page.Users, 4)

		// Cross-check against the existing aggregate reader.
		reactions, err := svc.ListReactions(ctx, peerID, messageID)
		require.NoError(t, err)
		var aggregate int
		for _, r := range reactions {
			if r.Emoji == emojiThumbsUp {
				aggregate = r.Count
			}
		}
		assert.Equal(t, aggregate, page.Total, "total must match Reaction.count")
	})

	t.Run("total is page-independent", func(t *testing.T) {
		svc, _, peerID, chatID, messageID, ctx := setupReactionFixture(t)
		for i := 0; i < 6; i++ {
			u := seedUser(t, TestDB, ctx)
			seedMember(t, TestDB, ctx, chatID, u, "member")
			seedReactionAt(t, TestDB, ctx, messageID, u, emojiThumbsUp, time.Now().Add(time.Duration(i)*time.Second))
		}

		cursor := ""
		pages := 0
		for {
			page, err := svc.ListReactionAuthors(ctx, peerID, messageID, emojiThumbsUp, cursor, 2)
			require.NoError(t, err)
			assert.Equal(t, 6, page.Total)
			pages++
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
			// Guard against a buggy cursor that never terminates:
			// without this, the test would hang instead of failing.
			require.LessOrEqual(t, pages, 10, "pagination did not terminate")
		}
	})
}

// -----------------------------------------------------------------------------
// Input validation
// -----------------------------------------------------------------------------

// TestListReactionAuthors_Validation exercises the pure input-validation path
// of the service. It carries the integration build tag for consistency with
// the rest of the file, but the code under test never issues a query — the
// table-driven check reuses the fixture only to keep the call signature simple.
func TestListReactionAuthors_Validation(t *testing.T) {
	svc, ownerID, peerID, _, messageID, ctx := setupReactionFixture(t)
	seedReaction(t, TestDB, ctx, messageID, ownerID, emojiThumbsUp)

	cases := []struct {
		name      string
		messageID string
		emoji     string
	}{
		{"invalid messageID", "not-a-uuid", emojiThumbsUp},
		{"empty emoji", messageID, ""},
		{"emoji too long (65 bytes)", messageID, strings.Repeat("a", 65)},
		{"emoji with html-hostile characters", messageID, "<script>"},
		{"emoji with slash", messageID, "a/b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.ListReactionAuthors(ctx, peerID, tc.messageID, tc.emoji, "", 0)
			require.ErrorIs(t, err, chat.ErrInvalidInput)
		})
	}
}
