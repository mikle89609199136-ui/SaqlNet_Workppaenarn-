// Package blockevent — уведомление о блокировке между сервисами (#760).
//
// Сервис user пишет его через pg_notify в той же транзакции, что и
// блокировку, так что оно приходит только после коммита. Сервис chat
// слушает канал и сообщает обоим по WebSocket: заблокированному — чтобы
// поле ввода и звонки закрылись сразу, заблокировавшему — чтобы его
// остальные устройства узнали.
package blockevent

const (
	Channel     = "crane_user_block_changed"
	BlockedType = "user_blocked"
	// UnblockedType — событие о снятии блокировки.
	UnblockedType = "user_unblocked"
)

// Changed — кто кого заблокировал или разблокировал.
type Changed struct {
	UserID        string `json:"userId"`
	BlockedUserID string `json:"blockedUserId"`
	Blocked       bool   `json:"blocked"`
}
