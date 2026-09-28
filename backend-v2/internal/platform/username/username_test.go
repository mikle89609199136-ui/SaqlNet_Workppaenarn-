package username

import "testing"

func TestNormalizeAndValidate(t *testing.T) {
	tests := []struct {
		input string
		want  string
		valid bool
	}{
		{input: " Alice_1 ", want: "alice_1", valid: true},
		{input: "ab", want: "ab", valid: false},
		{input: "alice.smith", want: "alice.smith", valid: false},
		{input: "", want: "", valid: false},
	}

	for _, tt := range tests {
		got := Normalize(tt.input)
		if got != tt.want {
			t.Fatalf("Normalize(%q) = %q, want %q", tt.input, got, tt.want)
		}
		if Valid(got) != tt.valid {
			t.Fatalf("Valid(%q) = %v, want %v", got, Valid(got), tt.valid)
		}
	}
}
