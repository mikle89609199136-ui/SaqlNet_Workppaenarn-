package auth

import (
	"errors"
	"unicode"
	"unicode/utf8"
)

const (
	minPasswordLength = 10
	maxPasswordLength = 64
)

var ErrInvalidPassword = errors.New("invalid password")

type PasswordValidationReason string

const (
	PasswordTooShort             PasswordValidationReason = "too_short"
	PasswordTooLong              PasswordValidationReason = "too_long"
	PasswordWhitespaceNotAllowed PasswordValidationReason = "whitespace_not_allowed"
	PasswordDigitRequired        PasswordValidationReason = "digit_required"
	PasswordSpecialRequired      PasswordValidationReason = "special_required"
)

type PasswordValidationError struct {
	Reason PasswordValidationReason
}

func (e *PasswordValidationError) Error() string {
	switch e.Reason {
	case PasswordTooShort:
		return "password is too short"
	case PasswordTooLong:
		return "password is too long"
	case PasswordWhitespaceNotAllowed:
		return "password must not contain whitespace"
	case PasswordDigitRequired:
		return "password must contain at least one digit"
	case PasswordSpecialRequired:
		return "password must contain at least one special character"
	default:
		return ErrInvalidPassword.Error()
	}
}

func (e *PasswordValidationError) Unwrap() error {
	return ErrInvalidPassword
}

func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < minPasswordLength {
		return &PasswordValidationError{Reason: PasswordTooShort}
	}
	if length > maxPasswordLength {
		return &PasswordValidationError{Reason: PasswordTooLong}
	}

	hasDigit := false
	hasSpecial := false
	for _, character := range password {
		if unicode.IsSpace(character) {
			return &PasswordValidationError{Reason: PasswordWhitespaceNotAllowed}
		}
		hasDigit = hasDigit || unicode.IsDigit(character)
		hasSpecial = hasSpecial || unicode.IsPunct(character) || unicode.IsSymbol(character)
	}

	if !hasDigit {
		return &PasswordValidationError{Reason: PasswordDigitRequired}
	}
	if !hasSpecial {
		return &PasswordValidationError{Reason: PasswordSpecialRequired}
	}

	return nil
}
