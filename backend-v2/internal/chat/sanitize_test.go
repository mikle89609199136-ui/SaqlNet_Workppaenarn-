package chat

import "testing"

func TestSanitizeMessageContentEscapesPlaintextHTML(t *testing.T) {
	got := sanitizeMessageContent(`<img src=x onerror="alert('xss')">`)
	want := `&lt;img src=x onerror=&#34;alert(&#39;xss&#39;)&#34;&gt;`
	if got != want {
		t.Fatalf("sanitizeMessageContent() = %q, want %q", got, want)
	}
}

func TestSanitizeMessageContentKeepsEncryptedPayload(t *testing.T) {
	payload := `{"e2e":true,"iv":"/aStWzi3t0KBcr15","data":"2IEgPeAnPvygard5pmjeESpu"}`
	if got := sanitizeMessageContent(payload); got != payload {
		t.Fatalf("encrypted payload changed: got %q", got)
	}
}
