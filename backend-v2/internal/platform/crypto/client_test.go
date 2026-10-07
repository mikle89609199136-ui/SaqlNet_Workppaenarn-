package crypto

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

type tokenGenerationContract struct {
	IssueRequest struct {
		Subject         string `json:"subject"`
		Username        string `json:"username"`
		TokenGeneration int64  `json:"token_generation"`
	} `json:"issue_request"`
	IssueResponse  map[string]any `json:"issue_response"`
	VerifyResponse map[string]any `json:"verify_response"`
	HealthResponse map[string]any `json:"health_response"`
}

func loadTokenGenerationContract(t *testing.T) tokenGenerationContract {
	t.Helper()
	content, err := os.ReadFile("../../../contracts/fixtures/token_generation.json")
	if err != nil {
		t.Fatalf("read token-generation contract: %v", err)
	}
	var contract tokenGenerationContract
	if err := json.Unmarshal(content, &contract); err != nil {
		t.Fatalf("decode token-generation contract: %v", err)
	}
	return contract
}

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

func TestClientChecksTokenGenerationCapability(t *testing.T) {
	contract := loadTokenGenerationContract(t)
	tests := []struct {
		name    string
		body    any
		wantErr bool
	}{
		{
			name: "supported",
			body: contract.HealthResponse,
		},
		{
			name:    "legacy crypto response",
			body:    map[string]string{"status": "ok"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient("http://crypto.test")
			client.http = staticJSONClient(tt.body)

			err := client.CheckTokenGenerationSupport(t.Context())
			if tt.wantErr && !errors.Is(err, ErrTokenGenerationProtocol) {
				t.Fatalf("expected generation protocol error, got %v", err)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected supported protocol, got %v", err)
			}
		})
	}
}

func TestClientIssueTokenSendsGeneration(t *testing.T) {
	contract := loadTokenGenerationContract(t)
	client := NewClient("http://crypto.test")
	client.http = &http.Client{
		Timeout: time.Second,
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			var request map[string]any
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request["subject"] != contract.IssueRequest.Subject || request["username"] != contract.IssueRequest.Username {
				t.Fatalf("unexpected issue request identity: %#v", request)
			}
			if request["token_generation"] != float64(contract.IssueRequest.TokenGeneration) {
				t.Fatalf("expected token generation %d, got %#v", contract.IssueRequest.TokenGeneration, request["token_generation"])
			}
			body, _ := json.Marshal(contract.IssueResponse)
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     http.StatusText(http.StatusOK),
				Body:       io.NopCloser(bytes.NewReader(body)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	issuedToken, err := client.IssueToken(t.Context(), contract.IssueRequest.Subject, contract.IssueRequest.Username, contract.IssueRequest.TokenGeneration)
	if err != nil || issuedToken.Token != "contract-issued-token" || issuedToken.ExpiresAt.Unix() != 1_700_003_600 {
		t.Fatalf("unexpected issue response: token=%#v err=%v", issuedToken, err)
	}
}

func TestClientIssueTokenRejectsCryptoWithoutGenerationSupport(t *testing.T) {
	client := NewClient("http://crypto.test")
	client.http = staticJSONClient(map[string]any{"token": "legacy-token"})

	_, err := client.IssueToken(t.Context(), "user-id", "user", 7)
	if !errors.Is(err, ErrTokenGenerationProtocol) {
		t.Fatalf("expected generation protocol error, got %v", err)
	}
}

func TestClientIssueTokenRejectsResponseWithoutExpiry(t *testing.T) {
	generation := int64(7)
	client := NewClient("http://crypto.test")
	client.http = staticJSONClient(map[string]any{
		"token":            "token-without-expiry",
		"token_generation": generation,
	})

	issuedToken, err := client.IssueToken(t.Context(), "user-id", "user", generation)
	if err == nil {
		t.Fatalf("expected incomplete-response error, got %#v", issuedToken)
	}
}

func TestClientVerifyTokenReadsGeneration(t *testing.T) {
	contract := loadTokenGenerationContract(t)
	client := NewClient("http://crypto.test")
	client.http = &http.Client{
		Timeout: time.Second,
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			body, _ := json.Marshal(contract.VerifyResponse)
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     http.StatusText(http.StatusOK),
				Body:       io.NopCloser(bytes.NewReader(body)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	claims, err := client.VerifyToken(t.Context(), "token")
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	if claims.Subject != contract.IssueRequest.Subject || claims.Username != contract.IssueRequest.Username {
		t.Fatalf("unexpected verified identity: %#v", claims)
	}
	if claims.TokenGeneration != contract.IssueRequest.TokenGeneration {
		t.Fatalf("expected token generation %d, got %d", contract.IssueRequest.TokenGeneration, claims.TokenGeneration)
	}
}

func TestClientVerifyTokenRejectsCryptoWithoutGenerationSupport(t *testing.T) {
	client := NewClient("http://crypto.test")
	client.http = staticJSONClient(map[string]any{
		"subject":    "user-id",
		"username":   "user",
		"issued_at":  int64(1_700_000_000),
		"expires_at": int64(1_700_003_600),
	})

	_, err := client.VerifyToken(t.Context(), "legacy-token")
	if !errors.Is(err, ErrTokenGenerationProtocol) {
		t.Fatalf("expected generation protocol error, got %v", err)
	}
}

func staticJSONClient(bodyValue any) *http.Client {
	return &http.Client{
		Timeout: time.Second,
		Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			body, _ := json.Marshal(bodyValue)
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     http.StatusText(http.StatusOK),
				Body:       io.NopCloser(bytes.NewReader(body)),
				Header:     make(http.Header),
			}, nil
		}),
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
