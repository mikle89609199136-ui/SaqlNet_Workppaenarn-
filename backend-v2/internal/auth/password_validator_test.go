package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name       string
		password   string
		wantReason PasswordValidationReason
	}{
		{
			name:       "empty",
			password:   "",
			wantReason: PasswordTooShort,
		},
		{
			name:       "too short",
			password:   strings.Repeat("a", minPasswordLength-3) + "1!",
			wantReason: PasswordTooShort,
		},
		{
			name:       "65 characters is too long",
			password:   strings.Repeat("a", maxPasswordLength-1) + "1!",
			wantReason: PasswordTooLong,
		},
		{
			name:       "ordinary space is not allowed",
			password:   "Password1 !",
			wantReason: PasswordWhitespaceNotAllowed,
		},
		{
			name:       "tab is not allowed",
			password:   "Password1!\t",
			wantReason: PasswordWhitespaceNotAllowed,
		},
		{
			name:       "newline is not allowed",
			password:   "Password1!\n",
			wantReason: PasswordWhitespaceNotAllowed,
		},
		{
			name:       "missing digit",
			password:   strings.Repeat("a", minPasswordLength-1) + "!",
			wantReason: PasswordDigitRequired,
		},
		{
			name:       "missing special character",
			password:   strings.Repeat("a", minPasswordLength-1) + "1",
			wantReason: PasswordSpecialRequired,
		},
		{
			name:     "minimum boundary",
			password: strings.Repeat("a", minPasswordLength-2) + "1!",
		},
		{
			name:     "64 characters maximum boundary",
			password: strings.Repeat("a", maxPasswordLength-2) + "1!",
		},
		{
			name:     "valid password",
			password: strings.Repeat("a", minPasswordLength) + "1!",
		},
		{
			name:       "multiple violations use deterministic priority",
			password:   strings.Repeat("a", minPasswordLength),
			wantReason: PasswordDigitRequired,
		},
		{
			name:     "unicode characters count as code points",
			password: strings.Repeat("я", minPasswordLength-2) + "1!",
		},
		{
			name:       "unicode digit does not satisfy digit requirement",
			password:   strings.Repeat("a", minPasswordLength-2) + "١!",
			wantReason: PasswordDigitRequired,
		},
		{
			name:       "unicode symbol outside whitelist does not satisfy special requirement",
			password:   strings.Repeat("a", minPasswordLength-2) + "1€",
			wantReason: PasswordSpecialRequired,
		},
		{
			name:     "whitelisted special character is accepted",
			password: strings.Repeat("a", minPasswordLength-2) + "1@",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.password)
			if tt.wantReason == "" {
				if err != nil {
					t.Fatalf("ValidatePassword() error = %v, want nil", err)
				}
				return
			}

			if !errors.Is(err, ErrInvalidPassword) {
				t.Fatalf("ValidatePassword() error = %v, want ErrInvalidPassword", err)
			}

			var validationErr *PasswordValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("ValidatePassword() error type = %T, want *PasswordValidationError", err)
			}
			if validationErr.Reason != tt.wantReason {
				t.Errorf("ValidatePassword() reason = %q, want %q", validationErr.Reason, tt.wantReason)
			}
		})
	}
}
