package crypto

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

var ErrTokenGenerationProtocol = errors.New("crypto service does not support token generations")

type Client struct {
	baseURL string
	http    *http.Client
}

type TokenClaims struct {
	Subject         string `json:"subject"`
	Username        string `json:"username"`
	IssuedAt        int64  `json:"issued_at"`
	Expires         int64  `json:"expires_at"`
	TokenGeneration int64  `json:"token_generation"`
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 3 * time.Second},
	}
}

// CheckTokenGenerationSupport is used by service readiness probes to prevent
// a mixed-version rollout from sending traffic to Go replicas backed by an old
// crypto service that silently drops token generations.
func (c *Client) CheckTokenGenerationSupport(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health/ready", nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("crypto service returned %s", res.Status)
	}

	var response struct {
		Capabilities struct {
			TokenGeneration *bool `json:"token_generation"`
		} `json:"capabilities"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		return err
	}
	if response.Capabilities.TokenGeneration == nil || !*response.Capabilities.TokenGeneration {
		return ErrTokenGenerationProtocol
	}
	return nil
}

func (c *Client) HashPassword(ctx context.Context, password string) (string, error) {
	var response struct {
		Hash string `json:"hash"`
	}
	err := c.post(ctx, "/internal/v1/password/hash", map[string]string{"password": password}, &response)
	return response.Hash, err
}

func (c *Client) VerifyPassword(ctx context.Context, password, hash string) (bool, error) {
	var response struct {
		Valid bool `json:"valid"`
	}
	err := c.post(ctx, "/internal/v1/password/verify", map[string]string{"password": password, "hash": hash}, &response)
	return response.Valid, err
}

func (c *Client) IssueToken(ctx context.Context, subject, username string, tokenGeneration int64) (string, error) {
	var response struct {
		Token           string `json:"token"`
		TokenGeneration *int64 `json:"token_generation"`
	}
	err := c.post(ctx, "/internal/v1/token/issue", map[string]any{
		"subject":          subject,
		"username":         username,
		"token_generation": tokenGeneration,
	}, &response)
	if err != nil {
		return "", err
	}
	if response.TokenGeneration == nil || *response.TokenGeneration != tokenGeneration {
		return "", fmt.Errorf("%w: issue response generation mismatch", ErrTokenGenerationProtocol)
	}
	return response.Token, nil
}

func (c *Client) VerifyToken(ctx context.Context, token string) (TokenClaims, error) {
	var response struct {
		Subject         string `json:"subject"`
		Username        string `json:"username"`
		IssuedAt        int64  `json:"issued_at"`
		Expires         int64  `json:"expires_at"`
		TokenGeneration *int64 `json:"token_generation"`
	}
	if err := c.post(ctx, "/internal/v1/token/verify", map[string]string{"token": token}, &response); err != nil {
		return TokenClaims{}, err
	}
	if response.TokenGeneration == nil {
		return TokenClaims{}, fmt.Errorf("%w: verify response is missing token_generation", ErrTokenGenerationProtocol)
	}
	return TokenClaims{
		Subject:         response.Subject,
		Username:        response.Username,
		IssuedAt:        response.IssuedAt,
		Expires:         response.Expires,
		TokenGeneration: *response.TokenGeneration,
	}, nil
}

func (c *Client) Encrypt(ctx context.Context, data, associatedData string) (string, error) {
	var response struct {
		Data string `json:"data"`
	}
	err := c.post(ctx, "/internal/v1/encrypt", map[string]string{"data": data, "associated_data": associatedData}, &response)
	return response.Data, err
}

func (c *Client) Decrypt(ctx context.Context, data, associatedData string) (string, error) {
	var response struct {
		Data string `json:"data"`
	}
	err := c.post(ctx, "/internal/v1/decrypt", map[string]string{"data": data, "associated_data": associatedData}, &response)
	return response.Data, err
}

type KeyVerification struct {
	Valid    bool   `json:"valid"`
	Checksum string `json:"checksum"`
}

func (c *Client) VerifyKey(ctx context.Context, keyID, publicKey string) (KeyVerification, error) {
	var response KeyVerification
	err := c.post(ctx, "/api/v2/crypto/verify-key", map[string]string{"key_id": keyID, "public_key": publicKey}, &response)
	return response, err
}

type MLSValidateResp struct {
	Valid     bool   `json:"valid"`
	KeyID     string `json:"key_id"`
	NextEpoch int64  `json:"next_epoch"`
	Error     string `json:"error"`
}

func (c *Client) ValidateKeyPackage(ctx context.Context, keypackageBytes string) (MLSValidateResp, error) {
	var response MLSValidateResp
	err := c.post(ctx, "/api/v2/crypto/mls/validate-keypackage", map[string]string{"keypackage_bytes": keypackageBytes}, &response)
	return response, err
}

func (c *Client) ValidateCommit(ctx context.Context, commitBytes string, currentEpoch int64) (MLSValidateResp, error) {
	var response MLSValidateResp
	err := c.post(ctx, "/api/v2/crypto/mls/validate-commit", map[string]any{"commit_bytes": commitBytes, "current_epoch": currentEpoch}, &response)
	return response, err
}

func (c *Client) ValidateWelcome(ctx context.Context, welcomeBytes string) (bool, error) {
	var response struct {
		Valid bool `json:"valid"`
	}
	err := c.post(ctx, "/api/v2/crypto/mls/validate-welcome", map[string]string{"welcome_bytes": welcomeBytes}, &response)
	return response.Valid, err
}

func (c *Client) ValidateSignalRegistration(ctx context.Context, identityKey, signedPreKey, signature string) (bool, error) {
	var response struct {
		Valid bool `json:"valid"`
	}
	reqBody := map[string]string{
		"identity_key":   identityKey,
		"signed_pre_key": signedPreKey,
		"signature":      signature,
	}
	err := c.post(ctx, "/api/v2/crypto/signal/validate-registration", reqBody, &response)
	return response.Valid, err
}

func (c *Client) post(ctx context.Context, path string, request, response any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("crypto service returned %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(response)
}
