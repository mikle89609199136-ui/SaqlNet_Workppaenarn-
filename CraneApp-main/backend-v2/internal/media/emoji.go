package media

import (
	"net/http"

	"craneapp/backend-v2/internal/platform/httpx"
)

type Emoji struct {
	Code string `json:"code"`
	Img  string `json:"img"`
}

func ServeEmojis(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	// For now, return a basic set of emojis as the Node.js implementation
	// used the 'applemojis' NPM package.
	emojis := []Emoji{
		{Code: ":grinning:", Img: "😀"},
		{Code: ":smile:", Img: "😄"},
		{Code: ":joy:", Img: "😂"},
		{Code: ":heart:", Img: "❤️"},
		{Code: ":fire:", Img: "🔥"},
		{Code: ":thumbsup:", Img: "👍"},
		{Code: ":rocket:", Img: "🚀"},
		{Code: ":eyes:", Img: "👀"},
		{Code: ":tada:", Img: "🎉"},
		{Code: ":sparkles:", Img: "✨"},
	}

	w.Header().Set("Cache-Control", "public, max-age=86400")
	httpx.JSON(w, http.StatusOK, map[string]any{"emojis": emojis})
}
