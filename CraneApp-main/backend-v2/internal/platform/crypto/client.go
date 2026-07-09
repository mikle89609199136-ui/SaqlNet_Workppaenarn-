package crypto

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type TokenClaims struct {
	Subject  string `json:"subject"`
	Username string `json:"username"`
	IssuedAt int64  `json:"issued_at"`
	Expires  int64  `json:"expires_at"`
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 3 * time.Second},
	}
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

func (c *Client) IssueToken(ctx context.Context, subject, username string) (string, error) {
	var response struct {
		Token string `json:"token"`
	}
	err := c.post(ctx, "/internal/v1/token/issue", map[string]string{"subject": subject, "username": username}, &response)
	return response.Token, err
}

func (c *Client) VerifyToken(ctx context.Context, token string) (TokenClaims, error) {
	var response TokenClaims
	err := c.post(ctx, "/internal/v1/token/verify", map[string]string{"token": token}, &response)
	return response, err
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
