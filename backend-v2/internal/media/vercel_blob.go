package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// VercelBlobAdapter implements the private Blob HTTP protocol, not S3.
// Protocol reference: vercel/storage packages/blob/src/{put,del,get,api}.ts.
// Buckets are namespaces within one private Blob store. No token reaches callers.
type VercelBlobAdapter struct {
	token    string
	baseURL  string
	apiURL   string
	client   *http.Client
	maxBytes int64
}

var blobTokenPattern = regexp.MustCompile(`^vercel_blob_rw_([A-Za-z0-9]+)_([A-Za-z0-9]+)$`)
var blobBucketPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`)

func NewVercelBlobAdapter(token string, maxBytes int64) (*VercelBlobAdapter, error) {
	parts := blobTokenPattern.FindStringSubmatch(token)
	if parts == nil {
		return nil, errors.New("BLOB_READ_WRITE_TOKEN must be a Vercel Blob read-write token")
	}
	if maxBytes <= 0 {
		return nil, errors.New("Blob maximum upload size must be positive")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return &VercelBlobAdapter{
		token: token, baseURL: "https://" + strings.ToLower(parts[1]) + ".private.blob.vercel-storage.com",
		apiURL: "https://vercel.com/api/blob", maxBytes: maxBytes,
		client: &http.Client{Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
	}, nil
}

func blobPath(bucket, key string) (string, error) {
	if !blobBucketPattern.MatchString(bucket) || key == "" || len(bucket)+len(key) > 1023 || strings.HasPrefix(key, "/") || path.Clean(key) != key || strings.Contains(key, `\`) || strings.IndexFunc(key, unicode.IsControl) >= 0 {
		return "", errors.New("invalid Blob object key or bucket")
	}
	for _, part := range strings.Split(key, "/") {
		if part == "." || part == ".." || part == "" {
			return "", errors.New("invalid Blob object key")
		}
	}
	return bucket + "/" + key, nil
}

func (b *VercelBlobAdapter) objectURL(bucket, key string) (string, error) {
	pathname, err := blobPath(bucket, key)
	if err != nil {
		return "", err
	}
	segments := strings.Split(pathname, "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	return b.baseURL + "/" + strings.Join(segments, "/"), nil
}

func (b *VercelBlobAdapter) request(ctx context.Context, method, target string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, errors.New("invalid Blob request")
	}
	req.Header.Set("Authorization", "Bearer "+b.token)
	req.Header.Set("X-Api-Version", "13")
	return req, nil
}

func (b *VercelBlobAdapter) do(req *http.Request) (*http.Response, error) {
	resp, err := b.client.Do(req)
	if err != nil {
		if req.Context().Err() != nil {
			return nil, req.Context().Err()
		}
		// Never expose URLs, headers, tokens or API response bodies in errors.
		return nil, fmt.Errorf("%w: Blob network request failed", ErrStorage)
	}
	return resp, nil
}

func blobStatus(status int) error {
	if status == http.StatusRequestEntityTooLarge {
		return ErrTooBig
	}
	return fmt.Errorf("%w: Blob API returned HTTP %d", ErrStorage, status)
}

func (b *VercelBlobAdapter) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string) error {
	pathname, err := blobPath(bucket, key)
	if err != nil {
		return err
	}
	if size > b.maxBytes {
		return ErrTooBig
	}
	if size < 0 || r == nil {
		return errors.New("Blob upload requires a reader and a known nonnegative size")
	}
	// Bounded request lifetime, streaming input, no whole-file copy in this adapter.
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	target := b.apiURL + "/?" + url.Values{"pathname": {pathname}}.Encode()
	req, err := b.request(ctx, http.MethodPut, target, io.LimitReader(r, size+1))
	if err != nil {
		return err
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Content-Type", contentType)
	req.Header.Set("X-Content-Length", strconv.FormatInt(size, 10))
	req.Header.Set("X-Vercel-Blob-Access", "private")
	req.Header.Set("X-Add-Random-Suffix", "0")
	req.Header.Set("X-Allow-Overwrite", "0")
	resp, err := b.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return blobStatus(resp.StatusCode)
	}
	var result struct {
		Pathname string `json:"pathname"`
		URL      string `json:"url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result); err != nil {
		return fmt.Errorf("%w: invalid Blob upload response", ErrStorage)
	}
	want, _ := b.objectURL(bucket, key)
	if result.Pathname != pathname || result.URL != want {
		return fmt.Errorf("%w: Blob upload identity or private access mismatch", ErrStorage)
	}
	return nil
}

func (b *VercelBlobAdapter) Get(ctx context.Context, bucket, key string, options GetOptions) (*ObjectResponse, error) {
	target, err := b.objectURL(bucket, key)
	if err != nil {
		return nil, err
	}
	method := http.MethodGet
	if options.Head {
		method = http.MethodHead
	}
	req, err := b.request(ctx, method, target, nil)
	if err != nil {
		return nil, err
	}
	if options.Range != "" {
		req.Header.Set("Range", options.Range)
	}
	resp, err := b.do(req)
	if err != nil {
		return nil, err
	}
	// Preserve statuses for the existing service's 404/416/storage error mapping.
	return &ObjectResponse{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentType: resp.Header.Get("Content-Type"), ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: resp.Header.Get("Accept-Ranges")}, nil
}

// PresignGet returns a private storage reference, NOT a public/signed download
// grant. Existing handlers return /api/v2/media/{id} and proxy authorized reads;
// sticker URLs stored in SQL are also projected to those routes. TTL is unused.
func (b *VercelBlobAdapter) PresignGet(ctx context.Context, bucket, key string, _ time.Duration) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return b.objectURL(bucket, key)
}

func (b *VercelBlobAdapter) Delete(ctx context.Context, bucket, key string) error {
	pathname, err := blobPath(bucket, key)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	data, _ := json.Marshal(map[string][]string{"urls": {pathname}})
	req, err := b.request(ctx, http.MethodPost, b.apiURL+"/delete", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return blobStatus(resp.StatusCode)
}

var _ Store = (*VercelBlobAdapter)(nil)
