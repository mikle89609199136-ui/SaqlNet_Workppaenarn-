package crypto

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestClientHashAndVerifyPassword(t *testing.T) {
	client := NewClient("http://crypto.test")
	client.http = &http.Client{
		Timeout: time.Second,
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			var body []byte
			var status = http.StatusOK
			switch r.URL.Path {
			case "/internal/v1/password/hash":
				body, _ = json.Marshal(map[string]string{"hash": "argon-hash"})
			case "/internal/v1/password/verify":
				body, _ = json.Marshal(map[string]bool{"valid": true})
			default:
				status = http.StatusNotFound
			}
			return &http.Response{
				StatusCode: status,
				Status:     http.StatusText(status),
				Body:       io.NopCloser(bytes.NewReader(body)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	hash, err := client.HashPassword(t.Context(), "long-password")
	if err != nil || hash != "argon-hash" {
		t.Fatalf("unexpected hash response: hash=%q err=%v", hash, err)
	}
	valid, err := client.VerifyPassword(t.Context(), "long-password", hash)
	if err != nil || !valid {
		t.Fatalf("unexpected verify response: valid=%v err=%v", valid, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
