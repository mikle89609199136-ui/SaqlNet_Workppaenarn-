package media

import (
	"errors"
	"fmt"
	"net/url"
)

// NewConfiguredStore keeps the legacy MinIO defaults when the provider is absent.
// lookup makes configuration testable without modifying the process environment.
func NewConfiguredStore(lookup func(string) string, maxBytes int64) (Store, error) {
	value := func(key, fallback string) string {
		if v := lookup(key); v != "" {
			return v
		}
		return fallback
	}
	switch value("STORAGE_PROVIDER", "minio") {
	case "vercel_blob":
		if _, err := blobPath(value("MEDIA_BUCKET", "crane-media"), "config-check"); err != nil {
			return nil, errors.New("MEDIA_BUCKET must be a valid Blob namespace")
		}
		return NewVercelBlobAdapter(lookup("BLOB_READ_WRITE_TOKEN"), maxBytes)
	case "minio":
		secret := value("MINIO_SECRET_KEY", "craneapp-local-secret")
		if value("CRANE_ENV", "development") == "production" && secret == "craneapp-local-secret" {
			return nil, errors.New("MINIO_SECRET_KEY must be set to a non-default value in production")
		}
		endpoint := value("MINIO_ENDPOINT", "http://127.0.0.1:9000")
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("MINIO_ENDPOINT must be an HTTP(S) endpoint without credentials or query")
		}
		return NewMinioStore(endpoint, value("MINIO_ACCESS_KEY", "craneapp"), secret, value("MINIO_REGION", "us-east-1")), nil
	default:
		return nil, fmt.Errorf("STORAGE_PROVIDER must be minio or vercel_blob")
	}
}
