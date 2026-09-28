package media

import (
	"bytes"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
)

const (
	stickerTestUserID    = "11111111-1111-4111-8111-111111111111"
	stickerTestForeignID = "22222222-2222-4222-8222-222222222222"
	stickerTestID        = "33333333-3333-4333-8333-333333333333"
	stickerTestPackID    = "44444444-4444-4444-8444-444444444444"
)

func stickerDeleteRequest(method, path, userID string) *http.Request {
	request := httptest.NewRequest(method, path, bytes.NewReader(nil))
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: userID}))
}

func TestDeleteStickerEnqueuesCleanupAndRepeatedDeleteReturnsNotFound(t *testing.T) {
	handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT s.bucket, s.object_key").
		WithArgs(stickerTestID, stickerTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow("media", "owner/stickers/1"))
	mock.ExpectExec("SELECT pg_advisory_xact_lock").
		WithArgs("media", "owner/stickers/1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("media", "owner/stickers/1", stickerTestID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec("INSERT INTO media.object_cleanup_jobs").
		WithArgs("media", "owner/stickers/1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM media.stickers").
		WithArgs(stickerTestID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("first DELETE status=%d body=%s", response.Code, response.Body.String())
	}
	if store.deleteCalls != 0 {
		t.Fatalf("handler called storage Delete %d times", store.deleteCalls)
	}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT s.bucket, s.object_key").
		WithArgs(stickerTestID, stickerTestUserID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	response = httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, stickerTestUserID))
	if response.Code != http.StatusNotFound {
		t.Fatalf("repeated DELETE status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerForeignAndMissingReturnNotFound(t *testing.T) {
	for _, test := range []struct {
		name   string
		userID string
	}{
		{name: "foreign", userID: stickerTestForeignID},
		{name: "missing", userID: stickerTestUserID},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT s.bucket, s.object_key").
				WithArgs(stickerTestID, test.userID).
				WillReturnError(sql.ErrNoRows)
			mock.ExpectRollback()

			response := httptest.NewRecorder()
			handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, test.userID))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDeleteStickerUnmanagedLegacyURLDoesNotEnqueue(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT s.bucket, s.object_key").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow(nil, nil))
	mock.ExpectExec("DELETE FROM media.stickers").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerEnqueueFailureRollsBack(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT s.bucket, s.object_key").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow("media", "owner/stickers/1"))
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec("INSERT INTO media.object_cleanup_jobs").WillReturnError(errors.New("enqueue failed"))
	mock.ExpectRollback()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, stickerTestUserID))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerSharedObjectIsNotEnqueued(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT s.bucket, s.object_key").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow("media", "owner/stickers/shared"))
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec("DELETE FROM media.stickers").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/"+stickerTestID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerPackWithoutObjects(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT icon_bucket, icon_object_key").
		WithArgs(stickerTestPackID, stickerTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"icon_bucket", "icon_object_key"}).AddRow(nil, nil))
	mock.ExpectQuery("SELECT bucket, object_key").
		WithArgs(stickerTestPackID).
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}))
	mock.ExpectExec("DELETE FROM media.sticker_packs").
		WithArgs(stickerTestPackID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerPackCollectsIconAndChildrenBeforeCascade(t *testing.T) {
	handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT icon_bucket, icon_object_key").
		WillReturnRows(sqlmock.NewRows([]string{"icon_bucket", "icon_object_key"}).AddRow("media", "owner/stickers/icon"))
	mock.ExpectQuery("SELECT bucket, object_key").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).
			AddRow("media", "owner/stickers/one").
			AddRow("media", "owner/stickers/two").
			AddRow(nil, nil))
	for _, key := range []string{"owner/stickers/icon", "owner/stickers/one", "owner/stickers/two"} {
		mock.ExpectExec("SELECT pg_advisory_xact_lock").
			WithArgs("media", key).
			WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectQuery("SELECT EXISTS").
			WithArgs("media", key, stickerTestPackID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
		mock.ExpectExec("INSERT INTO media.object_cleanup_jobs").
			WithArgs("media", key).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectExec("DELETE FROM media.sticker_packs").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if store.deleteCalls != 0 {
		t.Fatalf("handler called storage Delete %d times", store.deleteCalls)
	}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT icon_bucket, icon_object_key").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	response = httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, stickerTestUserID))
	if response.Code != http.StatusOK {
		t.Fatalf("repeated DELETE status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteStickerPackForeignAndMissingPreserveSuccessResponse(t *testing.T) {
	for _, test := range []struct {
		name   string
		userID string
	}{
		{name: "foreign", userID: stickerTestForeignID},
		{name: "missing", userID: stickerTestUserID},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT icon_bucket, icon_object_key").
				WithArgs(stickerTestPackID, test.userID).
				WillReturnError(sql.ErrNoRows)
			mock.ExpectRollback()

			response := httptest.NewRecorder()
			handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, test.userID))
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDeleteStickerPackEnqueueFailureRollsBack(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT icon_bucket, icon_object_key").
		WillReturnRows(sqlmock.NewRows([]string{"icon_bucket", "icon_object_key"}).AddRow("media", "owner/stickers/icon"))
	mock.ExpectQuery("SELECT bucket, object_key").WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}))
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec("INSERT INTO media.object_cleanup_jobs").WillReturnError(errors.New("enqueue failed"))
	mock.ExpectRollback()

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, stickerTestUserID))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
