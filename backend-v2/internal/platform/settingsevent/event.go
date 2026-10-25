package settingsevent

const (
	Channel = "crane_settings_changed"
	Type    = "settings_updated"
	Version = 1
)

// Changed is an invalidation, never a snapshot of private preferences.
type Changed struct {
	UserID  string `json:"userId"`
	Version int    `json:"version"`
}
