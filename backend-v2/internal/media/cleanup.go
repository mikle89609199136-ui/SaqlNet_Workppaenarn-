package media

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	cleanupPollInterval = time.Second
	cleanupBaseBackoff  = 5 * time.Second
	cleanupMaxBackoff   = 5 * time.Minute
)

var (
	cleanupURLPattern    = regexp.MustCompile(`https?://\S+`)
	cleanupSecretPattern = regexp.MustCompile(`(?i)(authorization|credential|signature|token|secret|password)=\S+`)
)

type cleanupJob struct {
	ID         string
	Bucket     string
	ObjectKey  string
	Attempts   int
	ClaimToken string
}

type CleanupWorker struct {
	db           *sql.DB
	store        Store
	pollInterval time.Duration
}

func NewCleanupWorker(db *sql.DB, store Store) *CleanupWorker {
	return &CleanupWorker{db: db, store: store, pollInterval: cleanupPollInterval}
}

func (worker *CleanupWorker) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		processed, err := worker.ProcessNext(ctx)
		if err != nil && ctx.Err() == nil {
			slog.Error("media object cleanup", "err", sanitizeCleanupError(err))
		}
		if ctx.Err() != nil {
			return
		}
		if processed {
			continue
		}

		timer := time.NewTimer(worker.pollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}

func (worker *CleanupWorker) ProcessNext(ctx context.Context) (bool, error) {
	job, err := claimCleanupJob(ctx, worker.db)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	var ready bool
	if err := worker.db.QueryRowContext(ctx, `SELECT media.prepare_object_cleanup($1,$2)`, job.Bucket, job.ObjectKey).Scan(&ready); err != nil {
		return true, err
	}
	if !ready {
		_, err := worker.db.ExecContext(ctx, `
			UPDATE media.object_cleanup_jobs
			SET next_attempt_at = NOW() + INTERVAL '5 minutes', claimed_at = NULL, claim_token = NULL
			WHERE id = $1 AND claim_token = $2 AND completed_at IS NULL`, job.ID, job.ClaimToken)
		return true, err
	}
	if err := worker.store.Delete(ctx, job.Bucket, job.ObjectKey); err != nil {
		if ctx.Err() != nil {
			return true, ctx.Err()
		}
		nextAttempt := time.Now().UTC().Add(cleanupBackoff(job.Attempts + 1))
		_, updateErr := worker.db.ExecContext(ctx, `
			UPDATE media.object_cleanup_jobs
			SET attempts = attempts + 1,
			    next_attempt_at = $3,
			    last_error = $4,
			    claimed_at = NULL,
			    claim_token = NULL
			WHERE id = $1 AND claim_token = $2 AND completed_at IS NULL
		`, job.ID, job.ClaimToken, nextAttempt, sanitizeCleanupError(err))
		if updateErr != nil {
			return true, updateErr
		}
		return true, err
	}

	_, err = worker.db.ExecContext(ctx, `
		WITH removed AS (
			DELETE FROM media.uploads WHERE bucket=$3 AND object_key=$4
		)
		UPDATE media.object_cleanup_jobs
		SET completed_at = NOW(),
		    last_error = NULL,
		    claimed_at = NULL,
		    claim_token = NULL
		WHERE id = $1 AND claim_token = $2 AND completed_at IS NULL
	`, job.ID, job.ClaimToken, job.Bucket, job.ObjectKey)
	return true, err
}

func claimCleanupJob(ctx context.Context, db *sql.DB) (cleanupJob, error) {
	var job cleanupJob
	err := db.QueryRowContext(ctx, `
		WITH candidate AS (
			SELECT id
			FROM media.object_cleanup_jobs
			WHERE completed_at IS NULL
			  AND next_attempt_at <= NOW()
			  AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '2 minutes')
			ORDER BY next_attempt_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE media.object_cleanup_jobs job
		SET claimed_at = NOW(), claim_token = gen_random_uuid()
		FROM candidate
		WHERE job.id = candidate.id
		RETURNING job.id::text, job.bucket, job.object_key, job.attempts, job.claim_token::text
	`).Scan(&job.ID, &job.Bucket, &job.ObjectKey, &job.Attempts, &job.ClaimToken)
	return job, err
}

func cleanupBackoff(attempt int) time.Duration {
	if attempt <= 1 {
		return cleanupBaseBackoff
	}
	delay := cleanupBaseBackoff
	for current := 1; current < attempt; current++ {
		if delay >= cleanupMaxBackoff/2 {
			return cleanupMaxBackoff
		}
		delay *= 2
	}
	if delay > cleanupMaxBackoff {
		return cleanupMaxBackoff
	}
	return delay
}

func sanitizeCleanupError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, err.Error())
	message = cleanupURLPattern.ReplaceAllString(message, "[redacted-url]")
	message = cleanupSecretPattern.ReplaceAllString(message, "$1=[redacted]")
	message = strings.Join(strings.Fields(message), " ")
	const maxErrorBytes = 512
	for len(message) > maxErrorBytes {
		_, size := utf8.DecodeLastRuneInString(message)
		message = message[:len(message)-size]
	}
	return message
}
