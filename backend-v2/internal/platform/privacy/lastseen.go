package privacy

import "time"

// «Последняя активность» по паре людей (#791), как в Telegram.
//
// Точное время и «в сети» зритель видит, только если владелец открыл их
// ему и он сам открыл свои владельцу: скрывший своё время не видит чужого.
// Обе стороны решает Decide — с чёрным списком и исключениями, так что
// «всегда разрешать» открывает обмен с конкретным человеком и при «Никто».
//
// Вместо точного времени зритель получает промежуток. Заблокированный
// всегда видит «давно»: по «недавно» можно было бы понять, что аккаунт жив.

// Промежутки приблизительного времени.
const (
	Recently    = "recently"
	WithinWeek  = "within_week"
	WithinMonth = "within_month"
	LongAgo     = "long_ago"
)

// Границы промежутков.
const (
	recentlyWindow    = 3 * 24 * time.Hour
	withinWeekWindow  = 7 * 24 * time.Hour
	withinMonthWindow = 30 * 24 * time.Hour
)

// Approximate — промежуток для времени последней активности. Нулевое время
// (никогда не заходил) — «давно».
func Approximate(lastSeen, now time.Time) string {
	if lastSeen.IsZero() {
		return LongAgo
	}
	switch age := now.Sub(lastSeen); {
	case age <= recentlyWindow:
		return Recently
	case age <= withinWeekWindow:
		return WithinWeek
	case age <= withinMonthWindow:
		return WithinMonth
	default:
		return LongAgo
	}
}

// Pair — владелец и зритель: их настройки и отношения друг к другу.
type Pair struct {
	Owner, Viewer Settings
	// OwnerToViewer — отношение владельца к зрителю (Self, если это один
	// человек); ViewerToOwner — зрителя к владельцу.
	OwnerToViewer, ViewerToOwner Relation
}

// LastSeenView — что зритель видит о последней активности владельца.
type LastSeenView struct {
	// Exact — видны точное время и «в сети».
	Exact bool
	// Approx — промежуток, когда Exact == false.
	Approx string
}

// ExactLastSeen — видит ли зритель точное время и «в сети» владельца.
func (p Pair) ExactLastSeen() bool {
	if p.OwnerToViewer.Self {
		return true
	}
	return Decide(p.Owner, p.OwnerToViewer, LastSeen) && Decide(p.Viewer, p.ViewerToOwner, LastSeen)
}

// LastSeen — что показать зрителю о последней активности владельца.
func (p Pair) LastSeen(lastSeen, now time.Time) LastSeenView {
	switch {
	case p.ExactLastSeen():
		return LastSeenView{Exact: true}
	case p.OwnerToViewer.Blocked:
		return LastSeenView{Approx: LongAgo}
	default:
		return LastSeenView{Approx: Approximate(lastSeen, now)}
	}
}

// ParseLastSeen разбирает время активности в виде ISO 8601, как его
// отдают запросы. Пустое или нечитаемое — нулевое время, то есть «давно».
func ParseLastSeen(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}
