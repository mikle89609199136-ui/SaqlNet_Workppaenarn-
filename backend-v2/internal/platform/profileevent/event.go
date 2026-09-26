package profileevent

const (
	Channel             = "crane_user_profile_changed"
	UsernameChangedType = "user_profile_updated"
)

type UsernameChanged struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
}
