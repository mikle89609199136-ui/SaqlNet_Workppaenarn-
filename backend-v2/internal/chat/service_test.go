package chat

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestValidateCatalogMedia(t *testing.T) {
	for _, kind := range []string{"sticker", "gif"} {
		for _, test := range []struct {
			name    string
			exists  bool
			dbError error
			want    error
		}{
			{name: "объект каталога доступен", exists: true},
			{name: "объект отсутствует или недоступен", want: ErrInvalidInput},
			{name: "ошибка базы", dbError: sql.ErrConnDone, want: sql.ErrConnDone},
		} {
			t.Run(kind+"/"+test.name, func(t *testing.T) {
				h, mock := messageValidationHandler(t)
				query := `SELECT EXISTS[\s\S]*FROM media\.stickers`
				if kind == "gif" {
					query = `SELECT EXISTS[\s\S]*FROM media\.gifs g[\s\S]*JOIN media\.uploads`
				}
				expected := mock.ExpectQuery(query).WithArgs(messageValidationMessageID)
				if test.dbError != nil {
					expected.WillReturnError(test.dbError)
				} else {
					expected.WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(test.exists))
				}
				err := h.service.ValidateCatalogMedia(t.Context(), kind, mediaURLPrefix+messageValidationMessageID, false)
				require.True(t, errors.Is(err, test.want), "error=%v, want=%v", err, test.want)
				require.NoError(t, mock.ExpectationsWereMet())
			})
		}
	}
}

func TestValidateCatalogMediaRejectsUnsafePathsBeforeDatabase(t *testing.T) {
	for _, kind := range []string{"sticker", "gif"} {
		for _, url := range []string{"https://foreign.test/file", "http://minio:9000/file", "//foreign.test/file", mediaURLPrefix + "invalid", mediaURLPrefix + messageValidationMessageID + "?q=1", mediaURLPrefix + messageValidationMessageID + "#fragment", mediaURLPrefix + messageValidationMessageID + "/", " /api/v2/media/" + messageValidationMessageID} {
			t.Run(kind+"/"+url, func(t *testing.T) {
				h, mock := messageValidationHandler(t)
				require.ErrorIs(t, h.service.ValidateCatalogMedia(t.Context(), kind, url, false), ErrInvalidInput)
				require.NoError(t, mock.ExpectationsWereMet())
			})
		}
		t.Run(kind+"/зашифрованный каталог", func(t *testing.T) {
			h, mock := messageValidationHandler(t)
			require.ErrorIs(t, h.service.ValidateCatalogMedia(t.Context(), kind, mediaURLPrefix+messageValidationMessageID, true), ErrInvalidInput)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestCatalogChangePreservesUploadOwnership(t *testing.T) {
	h, mock := messageValidationHandler(t)
	mock.ExpectQuery(`SELECT filename, size_bytes, is_encrypted, encryption_key_id, uploader_id::text`).WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows([]string{"filename", "size_bytes", "is_encrypted", "encryption_key_id", "uploader_id"}).AddRow("file.png", 10, false, "", messageValidationChatID))
	_, err := h.service.ValidateMediaMetadata(t.Context(), messageValidationUserID, mediaURLPrefix+messageValidationMessageID, "file.png", 10, false)
	require.ErrorIs(t, err, ErrInvalidInput)
	require.NoError(t, mock.ExpectationsWereMet())
}
