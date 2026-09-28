package media

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestManagedStickerURLAcceptsOnlyCurrentOwnedLayout(t *testing.T) {
	const (
		endpoint = "http://minio:9000"
		bucket   = "crane-media"
		ownerID  = "11111111-1111-4111-8111-111111111111"
		key      = ownerID + "/stickers/123456789"
	)
	store := NewMinioStore(endpoint, "access", "secret", "us-east-1")
	rawURL, err := store.PresignGet(context.Background(), bucket, key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	identity, ok := managedStickerURL(rawURL, endpoint, bucket, ownerID)
	if !ok {
		t.Fatalf("expected managed URL: %s", rawURL)
	}
	if identity.Bucket != bucket || identity.ObjectKey != key {
		t.Fatalf("identity=%#v", identity)
	}
}

func TestManagedStickerURLRejectsUnsafeAndLegacyReferences(t *testing.T) {
	const (
		endpoint = "http://minio:9000"
		bucket   = "crane-media"
		ownerID  = "11111111-1111-4111-8111-111111111111"
		key      = ownerID + "/stickers/123456789"
	)
	store := NewMinioStore(endpoint, "access", "secret", "us-east-1")
	validURL, err := store.PresignGet(context.Background(), bucket, key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	tests := map[string]string{
		"legacy relative URL": "/uploads/stickers/image.webp",
		"external host":       strings.Replace(validURL, "minio:9000", "storage.example.com", 1),
		"different bucket":    strings.Replace(validURL, "/crane-media/", "/other/", 1),
		"different owner":     strings.Replace(validURL, ownerID, "22222222-2222-4222-8222-222222222222", 1),
		"unexpected key":      strings.Replace(validURL, "/stickers/123456789", "/uploads/123456789", 1),
		"unsigned URL":        endpoint + "/" + bucket + "/" + key,
	}
	for name, rawURL := range tests {
		t.Run(name, func(t *testing.T) {
			if identity, ok := managedStickerURL(rawURL, endpoint, bucket, ownerID); ok {
				t.Fatalf("unsafe URL accepted as %#v: %s", identity, rawURL)
			}
		})
	}
}
