package integration

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"craneapp/backend-v2/internal/media"
	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

type integrationEnvironment struct {
	db       *sql.DB
	store    *media.MinioStore
	endpoint string
	bucket   string
}

func requireIntegrationEnvironment(t *testing.T) integrationEnvironment {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	minioEndpoint := os.Getenv("TEST_MINIO_ENDPOINT")
	if databaseURL == "" || minioEndpoint == "" {
		t.Skip("TEST_DATABASE_URL and TEST_MINIO_ENDPOINT are required")
	}

	db, err := sql.Open("postgres", databaseURL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, db.PingContext(ctx))

	var cleanupTableExists bool
	require.NoError(t, db.QueryRowContext(ctx, `SELECT to_regclass('media.object_cleanup_jobs') IS NOT NULL`).Scan(&cleanupTableExists))
	require.True(t, cleanupTableExists, "migration 0023_sticker_object_cleanup.sql is not applied")

	accessKey := envOrDefault("TEST_MINIO_ACCESS_KEY", "craneapp")
	secretKey := envOrDefault("TEST_MINIO_SECRET_KEY", "craneapp-local-secret")
	region := envOrDefault("TEST_MINIO_REGION", "us-east-1")
	bucket := envOrDefault("TEST_MEDIA_BUCKET", "crane-media")
	store := media.NewMinioStore(minioEndpoint, accessKey, secretKey, region)
	require.NoError(t, store.EnsureBucket(ctx, bucket))

	return integrationEnvironment{db: db, store: store, endpoint: minioEndpoint, bucket: bucket}
}

func TestDeleteStickerPersistsAndDrainsCleanupJob(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, packID := seedUserAndPack(t, environment, false)
	objectKey := userID + "/stickers/" + strings.ReplaceAll(randomUUID(t), "-", "")
	putObject(t, environment.store, environment.bucket, objectKey)
	stickerID := randomUUID(t)
	_, err := environment.db.Exec(`
		INSERT INTO media.stickers (id, pack_id, image_url, bucket, object_key)
		VALUES ($1, $2, 'https://presentation.invalid/sticker', $3, $4)
	`, stickerID, packID, environment.bucket, objectKey)
	require.NoError(t, err)
	cleanupStickerFixture(t, environment, userID, []string{objectKey})

	handler := media.NewHandler(media.NewService(environment.db, environment.store, environment.bucket, 1<<20))
	response := deleteRequest(handler, "/api/v2/stickers/"+stickerID, userID)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, 0, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.stickers WHERE id = $1`, stickerID))
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2`, environment.bucket, objectKey))
	require.True(t, objectExists(t, environment.store, environment.bucket, objectKey))

	worker := media.NewCleanupWorker(environment.db, environment.store)
	processed, err := worker.ProcessNext(context.Background())
	require.NoError(t, err)
	require.True(t, processed)
	require.False(t, objectExists(t, environment.store, environment.bucket, objectKey))
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2 AND completed_at IS NOT NULL`, environment.bucket, objectKey))

	response = deleteRequest(handler, "/api/v2/stickers/"+stickerID, userID)
	require.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2`, environment.bucket, objectKey))
}

func TestDeleteStickerPackCleansIconAndImages(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, packID := seedUserAndPack(t, environment, true)
	iconKey := userID + "/stickers/" + strings.ReplaceAll(randomUUID(t), "-", "")
	_, err := environment.db.Exec(`
		UPDATE media.sticker_packs
		SET icon_url = 'https://presentation.invalid/icon', icon_bucket = $2, icon_object_key = $3
		WHERE id = $1
	`, packID, environment.bucket, iconKey)
	require.NoError(t, err)
	putObject(t, environment.store, environment.bucket, iconKey)

	objectKeys := []string{iconKey}
	for range 3 {
		objectKey := userID + "/stickers/" + strings.ReplaceAll(randomUUID(t), "-", "")
		putObject(t, environment.store, environment.bucket, objectKey)
		_, err := environment.db.Exec(`
			INSERT INTO media.stickers (id, pack_id, image_url, bucket, object_key)
			VALUES ($1, $2, 'https://presentation.invalid/sticker', $3, $4)
		`, randomUUID(t), packID, environment.bucket, objectKey)
		require.NoError(t, err)
		objectKeys = append(objectKeys, objectKey)
	}
	cleanupStickerFixture(t, environment, userID, objectKeys)

	handler := media.NewHandler(media.NewService(environment.db, environment.store, environment.bucket, 1<<20))
	response := deletePackRequest(handler, packID, userID)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, 0, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.sticker_packs WHERE id = $1`, packID))
	require.Equal(t, 0, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.stickers WHERE pack_id = $1`, packID))
	require.Equal(t, len(objectKeys), rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = ANY($2)`, environment.bucket, pq.Array(objectKeys)))

	worker := media.NewCleanupWorker(environment.db, environment.store)
	for range objectKeys {
		processed, err := worker.ProcessNext(context.Background())
		require.NoError(t, err)
		require.True(t, processed)
	}
	for _, objectKey := range objectKeys {
		require.False(t, objectExists(t, environment.store, environment.bucket, objectKey), objectKey)
	}

	response = deletePackRequest(handler, packID, userID)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
}

func TestCleanupCompletesWhenStorageObjectIsAlreadyMissing(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, packID := seedUserAndPack(t, environment, false)
	objectKey := userID + "/stickers/" + strings.ReplaceAll(randomUUID(t), "-", "")
	stickerID := randomUUID(t)
	_, err := environment.db.Exec(`
		INSERT INTO media.stickers (id, pack_id, image_url, bucket, object_key)
		VALUES ($1, $2, 'https://presentation.invalid/sticker', $3, $4)
	`, stickerID, packID, environment.bucket, objectKey)
	require.NoError(t, err)
	cleanupStickerFixture(t, environment, userID, []string{objectKey})

	handler := media.NewHandler(media.NewService(environment.db, environment.store, environment.bucket, 1<<20))
	response := deleteRequest(handler, "/api/v2/stickers/"+stickerID, userID)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	worker := media.NewCleanupWorker(environment.db, environment.store)
	processed, err := worker.ProcessNext(context.Background())
	require.NoError(t, err)
	require.True(t, processed)
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2 AND completed_at IS NOT NULL`, environment.bucket, objectKey))
}

func TestCleanupRetriesAfterStorageRecovers(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, packID := seedUserAndPack(t, environment, false)
	objectKey := userID + "/stickers/" + strings.ReplaceAll(randomUUID(t), "-", "")
	putObject(t, environment.store, environment.bucket, objectKey)
	stickerID := randomUUID(t)
	_, err := environment.db.Exec(`
		INSERT INTO media.stickers (id, pack_id, image_url, bucket, object_key)
		VALUES ($1, $2, 'https://presentation.invalid/sticker', $3, $4)
	`, stickerID, packID, environment.bucket, objectKey)
	require.NoError(t, err)
	cleanupStickerFixture(t, environment, userID, []string{objectKey})

	handler := media.NewHandler(media.NewService(environment.db, environment.store, environment.bucket, 1<<20))
	response := deleteRequest(handler, "/api/v2/stickers/"+stickerID, userID)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	failingWorker := media.NewCleanupWorker(environment.db, failingDeleteStore{Store: environment.store})
	processed, err := failingWorker.ProcessNext(context.Background())
	require.Error(t, err)
	require.True(t, processed)
	require.True(t, objectExists(t, environment.store, environment.bucket, objectKey))
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2 AND attempts = 1 AND completed_at IS NULL AND next_attempt_at > NOW()`, environment.bucket, objectKey))

	_, err = environment.db.Exec(`UPDATE media.object_cleanup_jobs SET next_attempt_at = NOW() WHERE bucket = $1 AND object_key = $2`, environment.bucket, objectKey)
	require.NoError(t, err)
	recoveredWorker := media.NewCleanupWorker(environment.db, environment.store)
	processed, err = recoveredWorker.ProcessNext(context.Background())
	require.NoError(t, err)
	require.True(t, processed)
	require.False(t, objectExists(t, environment.store, environment.bucket, objectKey))
}

func TestConcurrentWorkersDoNotClaimSameJob(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	objectKey := randomUUID(t) + "/stickers/concurrent"
	putObject(t, environment.store, environment.bucket, objectKey)
	_, err := environment.db.Exec(`INSERT INTO media.object_cleanup_jobs (bucket, object_key) VALUES ($1, $2)`, environment.bucket, objectKey)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = environment.store.Delete(context.Background(), environment.bucket, objectKey)
		_, _ = environment.db.Exec(`DELETE FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2`, environment.bucket, objectKey)
	})

	blockingStore := &blockingDeleteStore{
		Store:   environment.store,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	firstWorker := media.NewCleanupWorker(environment.db, blockingStore)
	secondWorker := media.NewCleanupWorker(environment.db, blockingStore)
	firstResult := make(chan error, 1)
	go func() {
		processed, err := firstWorker.ProcessNext(context.Background())
		if !processed && err == nil {
			err = errors.New("first worker did not process job")
		}
		firstResult <- err
	}()
	select {
	case <-blockingStore.started:
	case <-time.After(5 * time.Second):
		t.Fatal("first worker did not reach storage delete")
	}

	processed, err := secondWorker.ProcessNext(context.Background())
	require.NoError(t, err)
	require.False(t, processed)
	close(blockingStore.release)
	require.NoError(t, <-firstResult)
	require.Equal(t, int32(1), blockingStore.calls.Load())
}

func TestBackfillAcceptsManagedURLAndLeavesLegacyURLUnmanaged(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, packID := seedUserAndPack(t, environment, false)
	managedKey := userID + "/stickers/123456789"
	managedURL, err := environment.store.PresignGet(context.Background(), environment.bucket, managedKey, time.Hour)
	require.NoError(t, err)
	_, err = environment.db.Exec(`UPDATE media.sticker_packs SET icon_url = $2 WHERE id = $1`, packID, managedURL)
	require.NoError(t, err)

	legacyStickerID := randomUUID(t)
	_, err = environment.db.Exec(`
		INSERT INTO media.stickers (id, pack_id, image_url)
		VALUES ($1, $2, '/uploads/stickers/legacy.webp')
	`, legacyStickerID, packID)
	require.NoError(t, err)
	cleanupStickerFixture(t, environment, userID, nil)

	require.NoError(t, media.BackfillStickerStorageIdentities(context.Background(), environment.db, environment.endpoint, environment.bucket))
	var iconBucket, iconObjectKey sql.NullString
	require.NoError(t, environment.db.QueryRow(`SELECT icon_bucket, icon_object_key FROM media.sticker_packs WHERE id = $1`, packID).Scan(&iconBucket, &iconObjectKey))
	require.True(t, iconBucket.Valid)
	require.True(t, iconObjectKey.Valid)
	require.Equal(t, environment.bucket, iconBucket.String)
	require.Equal(t, managedKey, iconObjectKey.String)

	var stickerBucket, stickerObjectKey sql.NullString
	require.NoError(t, environment.db.QueryRow(`SELECT bucket, object_key FROM media.stickers WHERE id = $1`, legacyStickerID).Scan(&stickerBucket, &stickerObjectKey))
	require.False(t, stickerBucket.Valid)
	require.False(t, stickerObjectKey.Valid)
}

func TestConcurrentDeletesOfSharedCrossTableObjectEnqueueOnce(t *testing.T) {
	environment := requireIntegrationEnvironment(t)
	userID, iconPackID := seedUserAndPack(t, environment, false)
	stickerPackID := randomUUID(t)
	_, err := environment.db.Exec(`
		INSERT INTO media.sticker_packs (id, user_id, name)
		VALUES ($1, $2, 'Shared object pack')
	`, stickerPackID, userID)
	require.NoError(t, err)
	objectKey := userID + "/stickers/987654321"
	putObject(t, environment.store, environment.bucket, objectKey)
	_, err = environment.db.Exec(`
		UPDATE media.sticker_packs
		SET icon_url = 'https://presentation.invalid/icon', icon_bucket = $2, icon_object_key = $3
		WHERE id = $1
	`, iconPackID, environment.bucket, objectKey)
	require.NoError(t, err)
	stickerID := randomUUID(t)
	_, err = environment.db.Exec(`
		INSERT INTO media.stickers (id, pack_id, image_url, bucket, object_key)
		VALUES ($1, $2, 'https://presentation.invalid/sticker', $3, $4)
	`, stickerID, stickerPackID, environment.bucket, objectKey)
	require.NoError(t, err)
	cleanupStickerFixture(t, environment, userID, []string{objectKey})

	handler := media.NewHandler(media.NewService(environment.db, environment.store, environment.bucket, 1<<20))
	start := make(chan struct{})
	statuses := make(chan int, 2)
	go func() {
		<-start
		statuses <- deletePackRequest(handler, iconPackID, userID).Code
	}()
	go func() {
		<-start
		statuses <- deleteRequest(handler, "/api/v2/stickers/"+stickerID, userID).Code
	}()
	close(start)
	require.Equal(t, http.StatusOK, <-statuses)
	require.Equal(t, http.StatusOK, <-statuses)
	require.Equal(t, 1, rowCount(t, environment.db, `SELECT COUNT(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2`, environment.bucket, objectKey))

	worker := media.NewCleanupWorker(environment.db, environment.store)
	processed, err := worker.ProcessNext(context.Background())
	require.NoError(t, err)
	require.True(t, processed)
	require.False(t, objectExists(t, environment.store, environment.bucket, objectKey))
}

type failingDeleteStore struct {
	media.Store
}

func (failingDeleteStore) Delete(context.Context, string, string) error {
	return errors.New("object storage unavailable")
}

type blockingDeleteStore struct {
	media.Store
	started chan struct{}
	release chan struct{}
	once    sync.Once
	calls   atomic.Int32
}

func (store *blockingDeleteStore) Delete(ctx context.Context, bucket, objectKey string) error {
	store.calls.Add(1)
	store.once.Do(func() { close(store.started) })
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-store.release:
	}
	return store.Store.Delete(ctx, bucket, objectKey)
}

func seedUserAndPack(t *testing.T, environment integrationEnvironment, withIcon bool) (string, string) {
	t.Helper()
	userID := randomUUID(t)
	packID := randomUUID(t)
	username := "sticker_" + strings.ReplaceAll(userID, "-", "")[:16]
	_, err := environment.db.Exec(`
		INSERT INTO auth.users (id, username, password_hash, first_name)
		VALUES ($1, $2, 'hash', 'Sticker')
	`, userID, username)
	require.NoError(t, err)
	iconURL := ""
	if withIcon {
		iconURL = "https://presentation.invalid/icon"
	}
	_, err = environment.db.Exec(`
		INSERT INTO media.sticker_packs (id, user_id, name, icon_url)
		VALUES ($1, $2, 'Integration pack', $3)
	`, packID, userID, iconURL)
	require.NoError(t, err)
	return userID, packID
}

func cleanupStickerFixture(t *testing.T, environment integrationEnvironment, userID string, objectKeys []string) {
	t.Helper()
	t.Cleanup(func() {
		for _, objectKey := range objectKeys {
			_ = environment.store.Delete(context.Background(), environment.bucket, objectKey)
		}
		_, _ = environment.db.Exec(`DELETE FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = ANY($2)`, environment.bucket, pq.Array(objectKeys))
		_, _ = environment.db.Exec(`DELETE FROM auth.users WHERE id = $1`, userID)
	})
}

func deleteRequest(handler *media.Handler, path, userID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodDelete, path, nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: userID}))
	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, request)
	return response
}

func deletePackRequest(handler *media.Handler, packID, userID string) *httptest.ResponseRecorder {
	return deleteRequest(handler, "/api/v2/stickers/packs/"+packID, userID)
}

func putObject(t *testing.T, store media.Store, bucket, objectKey string) {
	t.Helper()
	payload := []byte("sticker integration object")
	require.NoError(t, store.Put(context.Background(), bucket, objectKey, bytes.NewReader(payload), int64(len(payload)), "image/png"))
}

func objectExists(t *testing.T, store media.Store, bucket, objectKey string) bool {
	t.Helper()
	response, err := store.Get(context.Background(), bucket, objectKey, media.GetOptions{Head: true})
	require.NoError(t, err)
	defer response.Body.Close()
	return response.StatusCode != http.StatusNotFound
}

func rowCount(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRow(query, args...).Scan(&count))
	return count
}

func randomUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	_, err := io.ReadFull(rand.Reader, value[:])
	require.NoError(t, err)
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
