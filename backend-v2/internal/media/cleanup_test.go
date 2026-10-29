package media

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type cleanupTestStore struct {
	mu        sync.Mutex
	deleteErr map[string]error
	deleted   []string
}

func (*cleanupTestStore) Put(context.Context, string, string, io.Reader, int64, string) error {
	return nil
}

func (*cleanupTestStore) Get(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
	return &ObjectResponse{Body: io.NopCloser(bytes.NewReader(nil)), StatusCode: http.StatusOK}, nil
}

func (*cleanupTestStore) PresignGet(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}

func (store *cleanupTestStore) Delete(_ context.Context, bucket, objectKey string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	identity := bucket + "/" + objectKey
	store.deleted = append(store.deleted, identity)
	return store.deleteErr[identity]
}

func (store *cleanupTestStore) deleteCount() int {
	store.mu.Lock()
	defer store.mu.Unlock()
	return len(store.deleted)
}

func newCleanupWorkerTest(t *testing.T, store *cleanupTestStore) (*CleanupWorker, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewCleanupWorker(db, store), mock
}

func cleanupJobRows(id, bucket, objectKey, token string, attempts int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "bucket", "object_key", "attempts", "claim_token"}).
		AddRow(id, bucket, objectKey, attempts, token)
}

func TestCleanupWorkerCompletesSuccessfulAndMissingObjects(t *testing.T) {
	for _, name := range []string{"deleted", "already missing"} {
		t.Run(name, func(t *testing.T) {
			store := &cleanupTestStore{deleteErr: map[string]error{}}
			worker, mock := newCleanupWorkerTest(t, store)
			mock.ExpectQuery("WITH candidate").WillReturnRows(cleanupJobRows("job-1", "bucket", "key", "claim-1", 0))
			mock.ExpectQuery("SELECT media.prepare_object_cleanup").WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(true))
			mock.ExpectExec("SET completed_at = NOW").WithArgs("job-1", "claim-1", "bucket", "key").WillReturnResult(sqlmock.NewResult(0, 1))

			processed, err := worker.ProcessNext(context.Background())
			if err != nil || !processed {
				t.Fatalf("ProcessNext() processed=%v error=%v", processed, err)
			}
			if store.deleteCount() != 1 {
				t.Fatalf("Delete calls=%d, want 1", store.deleteCount())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCleanupWorkerSchedulesRetryWithBackoff(t *testing.T) {
	storageErr := errors.New("temporary storage failure")
	store := &cleanupTestStore{deleteErr: map[string]error{"bucket/key": storageErr}}
	worker, mock := newCleanupWorkerTest(t, store)
	mock.ExpectQuery("WITH candidate").WillReturnRows(cleanupJobRows("job-1", "bucket", "key", "claim-1", 0))
	mock.ExpectQuery("SELECT media.prepare_object_cleanup").WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(true))
	before := time.Now().UTC()
	mock.ExpectExec("SET attempts = attempts \\+ 1").
		WithArgs("job-1", "claim-1", futureTimeArgument{after: before.Add(cleanupBaseBackoff - time.Second)}, "temporary storage failure").
		WillReturnResult(sqlmock.NewResult(0, 1))

	processed, err := worker.ProcessNext(context.Background())
	if !errors.Is(err, storageErr) || !processed {
		t.Fatalf("ProcessNext() processed=%v error=%v", processed, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupWorkerDoesNotProcessCompletedJobs(t *testing.T) {
	store := &cleanupTestStore{deleteErr: map[string]error{}}
	worker, mock := newCleanupWorkerTest(t, store)
	mock.ExpectQuery("WITH candidate").WillReturnError(sql.ErrNoRows)

	processed, err := worker.ProcessNext(context.Background())
	if err != nil || processed {
		t.Fatalf("ProcessNext() processed=%v error=%v", processed, err)
	}
	if store.deleteCount() != 0 {
		t.Fatalf("Delete calls=%d, want 0", store.deleteCount())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupWorkerPartialBatchCompletesIndependently(t *testing.T) {
	storageErr := errors.New("second object unavailable")
	store := &cleanupTestStore{deleteErr: map[string]error{"bucket/failed": storageErr}}
	worker, mock := newCleanupWorkerTest(t, store)
	mock.ExpectQuery("WITH candidate").WillReturnRows(cleanupJobRows("job-ok", "bucket", "ok", "claim-ok", 0))
	mock.ExpectQuery("SELECT media.prepare_object_cleanup").WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(true))
	mock.ExpectExec("SET completed_at = NOW").WithArgs("job-ok", "claim-ok", "bucket", "ok").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("WITH candidate").WillReturnRows(cleanupJobRows("job-failed", "bucket", "failed", "claim-failed", 2))
	mock.ExpectQuery("SELECT media.prepare_object_cleanup").WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(true))
	mock.ExpectExec("SET attempts = attempts \\+ 1").
		WithArgs("job-failed", "claim-failed", futureTimeArgument{after: time.Now().UTC()}, "second object unavailable").
		WillReturnResult(sqlmock.NewResult(0, 1))

	processed, err := worker.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("first ProcessNext() processed=%v error=%v", processed, err)
	}
	processed, err = worker.ProcessNext(context.Background())
	if !errors.Is(err, storageErr) || !processed {
		t.Fatalf("second ProcessNext() processed=%v error=%v", processed, err)
	}
	if store.deleteCount() != 2 {
		t.Fatalf("Delete calls=%d, want 2", store.deleteCount())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupWorkerConcurrentClaimsProcessJobOnce(t *testing.T) {
	store := &cleanupTestStore{deleteErr: map[string]error{}}
	worker, mock := newCleanupWorkerTest(t, store)
	mock.MatchExpectationsInOrder(false)
	mock.ExpectQuery("WITH candidate").WillReturnRows(cleanupJobRows("job-1", "bucket", "key", "claim-1", 0))
	mock.ExpectQuery("SELECT media.prepare_object_cleanup").WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(true))
	mock.ExpectQuery("WITH candidate").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("SET completed_at = NOW").WithArgs("job-1", "claim-1", "bucket", "key").WillReturnResult(sqlmock.NewResult(0, 1))

	start := make(chan struct{})
	results := make(chan bool, 2)
	errorsCh := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			processed, err := worker.ProcessNext(context.Background())
			results <- processed
			errorsCh <- err
		}()
	}
	close(start)

	processedCount := 0
	for range 2 {
		if <-results {
			processedCount++
		}
		if err := <-errorsCh; err != nil {
			t.Fatal(err)
		}
	}
	if processedCount != 1 || store.deleteCount() != 1 {
		t.Fatalf("processed=%d Delete calls=%d, want 1 and 1", processedCount, store.deleteCount())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupWorkerStopsOnCanceledContext(t *testing.T) {
	store := &cleanupTestStore{deleteErr: map[string]error{}}
	worker, _ := newCleanupWorkerTest(t, store)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() {
		worker.Run(ctx)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker did not stop after context cancellation")
	}
}

func TestCleanupBackoffIsBounded(t *testing.T) {
	if got := cleanupBackoff(1); got != cleanupBaseBackoff {
		t.Fatalf("first backoff=%s", got)
	}
	if got := cleanupBackoff(100); got != cleanupMaxBackoff {
		t.Fatalf("bounded backoff=%s", got)
	}
}

func TestSanitizeCleanupError(t *testing.T) {
	err := errors.New("delete https://minio:9000/bucket/key?X-Amz-Signature=secret\npassword=hunter2")
	message := sanitizeCleanupError(err)
	if message == "" || bytes.Contains([]byte(message), []byte("minio:9000")) || bytes.Contains([]byte(message), []byte("hunter2")) {
		t.Fatalf("error was not sanitized: %q", message)
	}
}

type futureTimeArgument struct {
	after time.Time
}

func (argument futureTimeArgument) Match(value driver.Value) bool {
	timestamp, ok := value.(time.Time)
	return ok && timestamp.After(argument.after)
}
