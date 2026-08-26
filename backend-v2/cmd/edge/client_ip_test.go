package main

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestParseTrustedProxiesEmptyValue(t *testing.T) {
	_, err := parseTrustedProxies("")
	if err != nil {
		t.Fatalf("Expected no error for empty value, got: %v", err)
	}
}

func TestParseTrustedProxiesSingleIP(t *testing.T) {
	result, err := parseTrustedProxies("10.0.0.5")
	if err != nil {
		t.Fatalf("Expected no error for single IP, got: %v", err)
	}
	if len(result.prefixes) != 1 {
		t.Errorf("Expected 1 prefix, got: %d", len(result.prefixes))
	}

	trustedIP := netip.MustParseAddr("10.0.0.5")
	if !result.contains(trustedIP) {
		t.Errorf("Expected trusted IP %v to be contained in the set", trustedIP)
	}

	anotherIP := netip.MustParseAddr("10.0.0.6")
	if result.contains(anotherIP) {
		t.Errorf("Expected non-trusted IP %v to not be contained in the set", anotherIP)
	}
}

func TestParseTrustedProxiesCIDR(t *testing.T) {
	result, err := parseTrustedProxies("10.0.0.0/24")
	if err != nil {
		t.Fatalf("Expected no error for CIDR, got: %v", err)
	}
	if len(result.prefixes) != 1 {
		t.Errorf("Expected 1 prefix, got: %d", len(result.prefixes))
	}

	trustedIP := netip.MustParseAddr("10.0.0.42")
	if !result.contains(trustedIP) {
		t.Errorf("Expected trusted IP %v to be contained in the set", trustedIP)
	}

	anotherIP := netip.MustParseAddr("10.0.1.1")
	if result.contains(anotherIP) {
		t.Errorf("Expected non-trusted IP %v to not be contained in the set", anotherIP)
	}
}

func TestParseTrustedProxiesMultipleEntries(t *testing.T) {
	result, err := parseTrustedProxies("10.0.0.5,10.0.0.6")
	if err != nil {
		t.Fatalf("Expected no error for multiple entries, got: %v", err)
	}
	if len(result.prefixes) != 2 {
		t.Errorf("Expected 2 prefixes, got: %d", len(result.prefixes))
	}

	trustedIP := netip.MustParseAddr("10.0.0.5")
	if !result.contains(trustedIP) {
		t.Errorf("Expected trusted IP %v to be contained in the set", trustedIP)
	}

	anotherIP := netip.MustParseAddr("10.0.0.6")
	if !result.contains(anotherIP) {
		t.Errorf("Expected trusted IP %v to be contained in the set", anotherIP)
	}

	yetAnotherIP := netip.MustParseAddr("10.0.0.7")
	if result.contains(yetAnotherIP) {
		t.Errorf("Expected non-trusted IP %v to not be contained in the set", yetAnotherIP)
	}
}

func TestParseTrustedProxiesInvalidValues(t *testing.T) {
	invalidValues := []string{
		"10.0.0.256",         // Invalid IP
		"10.0.0.1/33",        // Invalid CIDR
		"10.0.0.5,,10.0.0.6", // Empty entry
		"10.0.0.5,",          // Trailing comma
	}
	for _, invalidValue := range invalidValues {
		t.Run(invalidValue, func(t *testing.T) {
			_, err := parseTrustedProxies(invalidValue)
			if err == nil {
				t.Errorf("expected error for invalid value: %s", invalidValue)
			}
		})
	}
}

func TestClientIPIgnoresForwardedForFromUntrustedPeer(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.7:54321"
	req.Header.Set("X-Forwarded-For", "1.1.1.1")

	proxies := trustedProxySet{}

	got := proxies.clientIP(req)
	want := "198.51.100.7"
	if got != want {
		t.Errorf("expected client IP %q, got %q", want, got)
	}
}

func TestClientIPUsesForwardedForFromTrustedPeer(t *testing.T) {
	proxies, err := parseTrustedProxies("10.0.0.5")
	if err != nil {
		t.Fatalf("failed to parse trusted proxies: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:54321"
	req.Header.Set("X-Forwarded-For", "198.51.100.7")

	got := proxies.clientIP(req)
	want := "198.51.100.7"
	if got != want {
		t.Errorf("expected client IP %q, got %q", want, got)
	}
}

func TestClientIPWalksForwardedForFromRightToLeft(t *testing.T) {
	proxies, err := parseTrustedProxies("10.0.0.0/24")
	if err != nil {
		t.Fatalf("failed to parse trusted proxies: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:54321"
	req.Header.Set(
		"X-Forwarded-For",
		"198.51.100.7, 10.0.0.4",
	)

	got := proxies.clientIP(req)
	want := "198.51.100.7"

	if got != want {
		t.Errorf("expected client IP %q, got %q", want, got)
	}
}

func TestClientIPFallsBackToRemoteIPWhenForwardedForIsUnusable(t *testing.T) {
	proxies, err := parseTrustedProxies("10.0.0.5")
	if err != nil {
		t.Fatalf("failed to parse trusted proxies: %v", err)
	}

	tests := []struct {
		name         string
		forwardedFor string
	}{
		{
			name:         "missing header",
			forwardedFor: "",
		},
		{
			name:         "invalid header",
			forwardedFor: "not-an-ip",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = "10.0.0.5:54321"

			if test.forwardedFor != "" {
				req.Header.Set("X-Forwarded-For", test.forwardedFor)
			}

			got := proxies.clientIP(req)
			want := "10.0.0.5"

			if got != want {
				t.Errorf("expected client IP %q, got %q", want, got)
			}
		})
	}
}
