package privacy

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestApproximateBoundaries(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	for _, tt := range []struct {
		ago  time.Duration
		want string
	}{
		{0, Recently},
		{3 * day, Recently},
		{3*day + time.Second, WithinWeek},
		{7 * day, WithinWeek},
		{7*day + time.Second, WithinMonth},
		{30 * day, WithinMonth},
		{30*day + time.Second, LongAgo},
		{400 * day, LongAgo},
	} {
		require.Equal(t, tt.want, Approximate(now.Add(-tt.ago), now), tt.ago)
	}
	require.Equal(t, LongAgo, Approximate(time.Time{}, now), "никогда не заходил")
}

func TestPairLastSeen(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	yesterday := now.Add(-24 * time.Hour)
	open := Parse([]byte(`{"lastSeen":"all"}`))
	closed := Parse([]byte(`{"lastSeen":"nobody"}`))
	always := Relation{Exceptions: map[Rule]bool{LastSeen: true}}
	never := Relation{Exceptions: map[Rule]bool{LastSeen: false}}
	exact := LastSeenView{Exact: true}
	recently := LastSeenView{Approx: Recently}

	for name, tt := range map[string]struct {
		pair Pair
		want LastSeenView
	}{
		"оба открыли":                  {Pair{Owner: open, Viewer: open}, exact},
		"владелец скрыл":               {Pair{Owner: closed, Viewer: open}, recently},
		"зритель скрыл своё — взаимно": {Pair{Owner: open, Viewer: closed}, recently},
		"зритель скрыл, но владельцу «всегда»": {
			Pair{Owner: open, Viewer: closed, ViewerToOwner: always}, exact,
		},
		"владелец скрыл, но зрителю «всегда»": {
			Pair{Owner: closed, Viewer: open, OwnerToViewer: always}, exact,
		},
		"зритель открыт, но владельцу «никогда»": {
			Pair{Owner: open, Viewer: open, ViewerToOwner: never}, recently,
		},
		"зритель заблокировал владельца": {
			Pair{Owner: open, Viewer: open, ViewerToOwner: Relation{Blocked: true}}, recently,
		},
		"владелец заблокировал зрителя — «давно»": {
			Pair{Owner: open, Viewer: open, OwnerToViewer: Relation{Blocked: true}}, LastSeenView{Approx: LongAgo},
		},
		"сам себе — всегда точно": {
			Pair{Owner: closed, Viewer: closed, OwnerToViewer: Relation{Self: true}}, exact,
		},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tt.want, tt.pair.LastSeen(yesterday, now))
		})
	}

	// Промежуток считается от настоящего времени, а не всегда «недавно».
	hidden := Pair{Owner: closed, Viewer: open}
	require.Equal(t, LastSeenView{Approx: WithinMonth}, hidden.LastSeen(now.Add(-10*24*time.Hour), now))
	require.Equal(t, LastSeenView{Approx: LongAgo}, hidden.LastSeen(time.Time{}, now))
}
