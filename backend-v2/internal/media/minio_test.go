package media

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestMinioStoreGetForwardsRangeAndReturnsResponseMetadata(t *testing.T) {
	store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
	store.downloadClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodGet {
			t.Fatalf("method=%q", r.Method)
		}
		if got := r.Header.Get("Range"); got != "bytes=2-4" {
			t.Fatalf("Range=%q", got)
		}
		if r.Header.Get("Authorization") == "" {
			t.Fatal("missing signed Authorization header")
		}
		return &http.Response{
			StatusCode:    http.StatusPartialContent,
			Body:          io.NopCloser(strings.NewReader("cde")),
			ContentLength: 3,
			Header: http.Header{
				"Content-Range": []string{"bytes 2-4/6"},
				"Accept-Ranges": []string{"bytes"},
			},
		}, nil
	})

	response, err := store.Get(context.Background(), "bucket", "object", GetOptions{Range: "bytes=2-4"})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusPartialContent || response.ContentRange != "bytes 2-4/6" || response.ContentLength != 3 || string(body) != "cde" {
		t.Fatalf("unexpected response: %#v body=%q", response, body)
	}
}

func TestMinioStoreGetUsesHeadWithoutReadingBody(t *testing.T) {
	store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
	store.downloadClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodHead {
			t.Fatalf("method=%q", r.Method)
		}
		return &http.Response{
			StatusCode:    http.StatusOK,
			Body:          http.NoBody,
			ContentLength: 42,
			Header:        make(http.Header),
		}, nil
	})

	response, err := store.Get(context.Background(), "bucket", "object", GetOptions{Head: true})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength != 42 {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestMinioStoreGetHonorsCanceledContext(t *testing.T) {
	store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
	store.downloadClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, r.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := store.Get(ctx, "bucket", "object", GetOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}
