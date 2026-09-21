package media

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
)

const stickerTestDataURL = "data:image/png;base64,YQ=="

func stickerCreateRequest(path, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: stickerTestUserID}))
}

func TestCreateStickerPackPersistsCanonicalIconIdentity(t *testing.T) {
	handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectQuery("INSERT INTO media.sticker_packs").
		WithArgs(stickerTestUserID, "Pack", "Description", "https://storage.test/object", "uploads", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "description", "icon_url", "created_at"}).
			AddRow(stickerTestPackID, "Pack", "Description", "https://storage.test/object", "2026-01-01"))

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerCreateRequest("/api/v2/stickers/packs", `{"name":"Pack","description":"Description","icon":"`+stickerTestDataURL+`"}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if store.putCalls != 1 {
		t.Fatalf("Put calls=%d, want 1", store.putCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAddStickerPersistsCanonicalIdentity(t *testing.T) {
	handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectQuery("SELECT user_id::text FROM media.sticker_packs").
		WithArgs(stickerTestPackID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(stickerTestUserID))
	mock.ExpectQuery("INSERT INTO media.stickers").
		WithArgs(stickerTestPackID, "https://storage.test/object", "uploads", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "image_url", "created_at"}).
			AddRow(stickerTestID, "https://storage.test/object", "2026-01-01"))

	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerCreateRequest("/api/v2/stickers/packs/"+stickerTestPackID, `{"image":"`+stickerTestDataURL+`"}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if store.putCalls != 1 {
		t.Fatalf("Put calls=%d, want 1", store.putCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStickerCreateCompensatesAfterDatabaseFailure(t *testing.T) {
	for _, test := range []struct {
		name    string
		prepare func(sqlmock.Sqlmock)
		invoke  func(*Handler, *httptest.ResponseRecorder)
	}{
		{
			name: "pack icon",
			prepare: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("INSERT INTO media.sticker_packs").WillReturnError(errors.New("insert failed"))
			},
			invoke: func(handler *Handler, response *httptest.ResponseRecorder) {
				handler.HandleStickersRoutes(response, stickerCreateRequest("/api/v2/stickers/packs", `{"name":"Pack","icon":"`+stickerTestDataURL+`"}`))
			},
		},
		{
			name: "sticker image",
			prepare: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT user_id::text FROM media.sticker_packs").
					WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(stickerTestUserID))
				mock.ExpectQuery("INSERT INTO media.stickers").WillReturnError(errors.New("insert failed"))
			},
			invoke: func(handler *Handler, response *httptest.ResponseRecorder) {
				handler.HandleStickersRoutes(response, stickerCreateRequest("/api/v2/stickers/packs/"+stickerTestPackID, `{"image":"`+stickerTestDataURL+`"}`))
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			test.prepare(mock)
			response := httptest.NewRecorder()
			test.invoke(handler, response)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if store.putCalls != 1 || store.deleteCalls != 1 {
				t.Fatalf("Put calls=%d Delete calls=%d, want 1 and 1", store.putCalls, store.deleteCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
