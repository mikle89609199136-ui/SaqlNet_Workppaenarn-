// Package username defines the canonical username policy shared by auth and user services.
package username

import (
	"regexp"
	"strings"
)

var pattern = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

// Normalize returns the canonical representation persisted by CraneApp.
func Normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// Valid reports whether a normalized username satisfies the public format contract.
func Valid(value string) bool {
	return pattern.MatchString(value)
}
