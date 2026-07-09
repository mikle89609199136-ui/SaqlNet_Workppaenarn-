package media

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// MinioStore is a minimal S3-compatible store that uses presigned URLs (AWS Signature V4).
// No external SDK dependency — keeps the Go module lean.
type MinioStore struct {
	endpoint  string // e.g. "http://minio:9000"
	accessKey string
	secretKey string
	region    string
	client    *http.Client
}

func NewMinioStore(endpoint, accessKey, secretKey, region string) *MinioStore {
	return &MinioStore{
		endpoint:  strings.TrimRight(endpoint, "/"),
		accessKey: accessKey,
		secretKey: secretKey,
		region:    region,
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

// EnsureBucket creates the bucket if it does not already exist.
func (m *MinioStore) EnsureBucket(ctx context.Context, bucket string) error {
	reqURL := fmt.Sprintf("%s/%s", m.endpoint, bucket)
	// HEAD to check existence.
	headReq, err := http.NewRequestWithContext(ctx, http.MethodHead, reqURL, nil)
	if err != nil {
		return err
	}
	m.signRequest(headReq, nil)
	resp, err := m.client.Do(headReq)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil // already exists
	}
	// PUT to create.
	putReq, err := http.NewRequestWithContext(ctx, http.MethodPut, reqURL, nil)
	if err != nil {
		return err
	}
	putReq.ContentLength = 0
	m.signRequest(putReq, nil)
	resp2, err := m.client.Do(putReq)
	if err != nil {
		return err
	}
	defer resp2.Body.Close()
	if resp2.StatusCode >= 300 {
		return fmt.Errorf("minio create bucket %s: %s", bucket, resp2.Status)
	}
	return nil
}

func (m *MinioStore) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	reqURL := fmt.Sprintf("%s/%s/%s", m.endpoint, bucket, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, reqURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = size
	m.signRequest(req, data)
	resp, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("minio put: %s", resp.Status)
	}
	return nil
}

func (m *MinioStore) PresignGet(ctx context.Context, bucket, key string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	expiresSecs := int(ttl.Seconds())

	credScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, m.region)
	credential := m.accessKey + "/" + credScope

	params := url.Values{}
	params.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	params.Set("X-Amz-Credential", credential)
	params.Set("X-Amz-Date", amzDate)
	params.Set("X-Amz-Expires", fmt.Sprintf("%d", expiresSecs))
	params.Set("X-Amz-SignedHeaders", "host")

	host := strings.TrimPrefix(strings.TrimPrefix(m.endpoint, "https://"), "http://")
	canonicalHeaders := "host:" + host + "\n"

	canonicalURI := "/" + bucket + "/" + key
	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		params.Encode(),
		canonicalHeaders,
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")

	strToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credScope,
		hexHash(canonicalRequest),
	}, "\n")

	signingKey := m.derivedKey(dateStamp)
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(strToSign)))
	params.Set("X-Amz-Signature", signature)

	return fmt.Sprintf("%s%s?%s", m.endpoint, canonicalURI, sortedEncode(params)), nil
}

func (m *MinioStore) Delete(ctx context.Context, bucket, key string) error {
	reqURL := fmt.Sprintf("%s/%s/%s", m.endpoint, bucket, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, reqURL, nil)
	if err != nil {
		return err
	}
	m.signRequest(req, nil)
	resp, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (m *MinioStore) signRequest(req *http.Request, body []byte) {
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	req.Header.Set("X-Amz-Date", amzDate)

	bodyHash := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if len(body) > 0 {
		bodyHash = hexHash(string(body))
	}
	req.Header.Set("X-Amz-Content-Sha256", bodyHash)

	host := req.URL.Host
	if host == "" {
		host = strings.TrimPrefix(strings.TrimPrefix(m.endpoint, "https://"), "http://")
	}
	req.Header.Set("Host", host)

	ct := req.Header.Get("Content-Type")
	var signedHeaders, canonicalHeaders string
	if ct != "" {
		signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date"
		canonicalHeaders = fmt.Sprintf("content-type:%s\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
			ct, host, bodyHash, amzDate)
	} else {
		signedHeaders = "host;x-amz-content-sha256;x-amz-date"
		canonicalHeaders = fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
			host, bodyHash, amzDate)
	}

	credScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, m.region)
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.Path,
		req.URL.RawQuery,
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	}, "\n")

	strToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credScope,
		hexHash(canonicalRequest),
	}, "\n")

	sigKey := m.derivedKey(dateStamp)
	sig := hex.EncodeToString(hmacSHA256(sigKey, []byte(strToSign)))
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		m.accessKey, credScope, signedHeaders, sig,
	))
}

func (m *MinioStore) derivedKey(dateStamp string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+m.secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(m.region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func hexHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func sortedEncode(v url.Values) string {
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v.Get(k)))
	}
	return strings.Join(parts, "&")
}
