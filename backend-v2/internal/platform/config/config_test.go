package config

import "testing"

func TestPositiveFloat64UsesFallbackWhenUnset(t *testing.T) {
	t.Setenv("TEST_POSITIVE_FLOAT64", "")

	got := PositiveFloat64("TEST_POSITIVE_FLOAT64", 5)

	if got != 5 {
		t.Fatalf("expected fallback 5, got %v", got)
	}
}

func TestPositiveFloat64ReadsEnvironmentValue(t *testing.T) {
	t.Setenv("TEST_POSITIVE_FLOAT64", "2.5")

	got := PositiveFloat64("TEST_POSITIVE_FLOAT64", 5)

	if got != 2.5 {
		t.Fatalf("expected 2.5, got %v", got)
	}
}

func TestPositiveFloat64PanicsOnInvalidValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "text", value: "abc"},
		{name: "zero", value: "0"},
		{name: "negative", value: "-1"},
		{name: "not a number", value: "NaN"},
		{name: "positive infinity", value: "Inf"},
		{name: "negative infinity", value: "-Inf"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_POSITIVE_FLOAT64", tt.value)

			defer func() {
				if recover() == nil {
					t.Fatal("expected panic, but function did not panic")
				}
			}()

			PositiveFloat64("TEST_POSITIVE_FLOAT64", 5)
		})

	}
}

func TestPositiveIntUsesFallbackWhenUnset(t *testing.T) {
	t.Setenv("TEST_POSITIVE_INT", "")

	got := PositiveInt("TEST_POSITIVE_INT", 5)

	if got != 5 {
		t.Fatalf("expected fallback 5, got %v", got)
	}
}

func TestPositiveIntReadsEnvironmentValue(t *testing.T) {
	t.Setenv("TEST_POSITIVE_INT", "10")

	got := PositiveInt("TEST_POSITIVE_INT", 5)

	if got != 10 {
		t.Fatalf("expected 10, got %v", got)
	}
}

func TestPositiveIntPanicsOnInvalidValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "text", value: "abc"},
		{name: "zero", value: "0"},
		{name: "fractional", value: "2.5"},
		{name: "negative", value: "-1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_POSITIVE_INT", tt.value)

			defer func() {
				if recover() == nil {
					t.Fatal("expected panic, but function did not panic")
				}
			}()

			PositiveInt("TEST_POSITIVE_INT", 5)
		})

	}
}

func TestRequiredPositiveInt64ReadsEnvironmentValue(t *testing.T) {
	t.Setenv("TEST_REQUIRED_POSITIVE_INT64", "104857600")

	got := RequiredPositiveInt64("TEST_REQUIRED_POSITIVE_INT64")

	if got != 104857600 {
		t.Fatalf("expected 104857600, got %d", got)
	}
}

func TestRequiredPositiveInt64PanicsOnMissingOrInvalidValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "missing", value: ""},
		{name: "text", value: "abc"},
		{name: "zero", value: "0"},
		{name: "negative", value: "-1"},
		{name: "overflow", value: "9223372036854775808"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_REQUIRED_POSITIVE_INT64", tt.value)
			defer func() {
				if recover() == nil {
					t.Fatal("expected panic, but function did not panic")
				}
			}()
			RequiredPositiveInt64("TEST_REQUIRED_POSITIVE_INT64")
		})
	}
}
