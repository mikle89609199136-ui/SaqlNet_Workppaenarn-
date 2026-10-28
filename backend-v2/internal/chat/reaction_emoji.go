package chat

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// reactionEmojis matches the existing client emoji picker. Reactions outside
// this finite set (including skin tones, flags and ZWJ sequences) are rejected.
const reactionEmojis = "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 🤔 🤨 😐 🙄 😏 😴 😌 🥲 😭 😤 😡 🤯 😱 🥶 😳 🤗 🤫 😎 👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 👐 🙏 💪 👀 👋 🤙 ☝️ 👆 👇 👉 👈 ✍️ 🫶 🤘 🖐️ ✊ ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🎉 🎊 🎁 🏆 ⚽ 🎮 🎧 🎵 ☕ 🍕 🍰 🍺 💻 📱 📷 🔑 💡 📌 ✅ ❌ ⚡ 🔥 ⭐ 🚀"

// canonicalReactionEmoji accepts optional surrounding Unicode whitespace and
// one trailing presentation selector. All aliases resolve to the picker form.
func canonicalReactionEmoji(input string) (string, error) {
	if !utf8.ValidString(input) || len(input) > 64 {
		return "", ErrInvalidInput
	}
	value := norm.NFC.String(strings.TrimSpace(input))
	if strings.HasSuffix(value, "\ufe0e") || strings.HasSuffix(value, "\ufe0f") {
		value = value[:len(value)-len("\ufe0f")]
	}
	for canonical := range strings.FieldsSeq(reactionEmojis) {
		if value == strings.TrimSuffix(canonical, "\ufe0f") {
			return canonical, nil
		}
	}
	return "", ErrInvalidInput
}
