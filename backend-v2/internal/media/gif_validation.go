package media

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	gifCreateBodyLimitBytes int64 = 64 << 10
	maxGifURLBytes                = 2048
	maxGifNameRunes               = 255
)

var gifMediaPathPattern = regexp.MustCompile(`^/api/v2/media/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`)

func parseGifMediaPath(raw string) (uploadID string, ok bool) {
	if len(raw) > maxGifURLBytes {
		return "", false
	}
	match := gifMediaPathPattern.FindStringSubmatch(raw)
	if match == nil {
		return "", false
	}
	return match[1], true
}

func validateGifName(raw string) (name string, ok bool) {
	name = strings.TrimSpace(raw)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxGifNameRunes {
		return "", false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return name, true
}
