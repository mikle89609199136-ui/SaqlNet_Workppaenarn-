package media

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestGetStickersUsesPackIDFromRoute(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	mock.ExpectQuery(`SELECT id::text,[\s\S]*FROM media\.stickers[\s\S]*WHERE pack_id = \$1`).
		WithArgs(stickerTestPackID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "image_url", "created_at"}).AddRow(stickerTestID, "/api/v2/media/"+stickerTestID, "2026-10-12"))
	response := httptest.NewRecorder()
	handler.HandleStickersRoutes(response, stickerDeleteRequest(http.MethodGet, "/api/v2/stickers/packs/"+stickerTestPackID, stickerTestUserID))
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Stickers []Sticker `json:"stickers"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Len(t, body.Stickers, 1)
	require.Equal(t, stickerTestID, body.Stickers[0].ID)
	require.Equal(t, "/api/v2/media/"+stickerTestID, body.Stickers[0].ImageUrl)
	require.NoError(t, mock.ExpectationsWereMet())
}
