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

func TestMinioStoreDeleteStatusSemantics(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		wantError  bool
	}{
		{name: "no content", statusCode: http.StatusNoContent},
		{name: "ok", statusCode: http.StatusOK},
		{name: "missing object", statusCode: http.StatusNotFound},
		{name: "forbidden", statusCode: http.StatusForbidden, wantError: true},
		{name: "server error", statusCode: http.StatusInternalServerError, wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
			body := &trackingReadCloser{Reader: strings.NewReader("internal storage details")}
			store.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.Method != http.MethodDelete {
					t.Fatalf("method=%q", request.Method)
				}
				if request.Context() == nil {
					t.Fatal("request has no context")
				}
				return &http.Response{StatusCode: tt.statusCode, Body: body, Header: make(http.Header)}, nil
			})

			err := store.Delete(context.Background(), "bucket", "object")
			if (err != nil) != tt.wantError {
				t.Fatalf("Delete() error=%v, wantError=%v", err, tt.wantError)
			}
			if !body.closed {
				t.Fatal("response body was not closed")
			}
			if err != nil && strings.Contains(err.Error(), "internal storage details") {
				t.Fatalf("storage response details leaked: %v", err)
			}
		})
	}
}

func TestMinioStoreDeleteTransportFailureIsSanitized(t *testing.T) {
	store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
	store.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("dial http://minio:9000?token=secret: connection refused")
	})

	err := store.Delete(context.Background(), "bucket", "object")
	if err == nil {
		t.Fatal("expected transport error")
	}
	if strings.Contains(err.Error(), "minio:9000") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("transport details leaked: %v", err)
	}
}

func TestMinioStoreDeleteHonorsCanceledContext(t *testing.T) {
	store := NewMinioStore("http://minio:9000", "access", "secret", "us-east-1")
	store.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return nil, request.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := store.Delete(ctx, "bucket", "object")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

type trackingReadCloser struct {
	io.Reader
	closed bool
}

func (body *trackingReadCloser) Close() error {
	body.closed = true
	return nil
}
