package media

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const favoriteTestGifID = "abcdef01-2345-6789-abcd-ef0123456789"

func performGifFavorite(handler *Handler, method, gifID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/api/v2/gifs/"+url.PathEscape(gifID)+"/favorite", nil)
	request.Header.Set("X-Request-ID", "gif-favorite-request-id")
	response := httptest.NewRecorder()
	handler.HandleGifsRoutes(response, uploadRequestWithUser(request))
	return response
}

func TestGifFavoriteRejectsInvalidIDBeforeDatabase(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		for _, tt := range []struct {
			name string
			id   string
		}{
			{"not UUID", "not-a-uuid"},
			{"favorites segment", "favorites"},
			{"no hyphens", strings.ReplaceAll(favoriteTestGifID, "-", "")},
			{"leading space", " " + favoriteTestGifID},
			{"4000 characters", strings.Repeat("x", 4000)},
			{"escaped script", "<script>"},
		} {
			t.Run(method+"/"+tt.name, func(t *testing.T) {
				handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
				response := performGifFavorite(handler, method, tt.id)
				assertGifFavoriteError(t, response, http.StatusBadRequest, "invalid_gif_id", "invalid GIF id")
				if strings.Contains(response.Body.String(), tt.id) {
					t.Error("response echoes rejected GIF id")
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestGifFavoriteOutcomes(t *testing.T) {
	const insertQuery = `
		WITH gif AS (
			SELECT id FROM media.gifs WHERE id = $2
		), inserted AS (
			INSERT INTO media.favorite_gifs (user_id, gif_id)
			SELECT $1, id FROM gif
			ON CONFLICT DO NOTHING
			RETURNING 1
		)
		SELECT EXISTS (SELECT 1 FROM gif) AS gif_exists,
		       EXISTS (SELECT 1 FROM inserted) AS inserted
	`
	const deleteQuery = `
		WITH gif AS (
			SELECT id FROM media.gifs WHERE id = $2
		), deleted AS (
			DELETE FROM media.favorite_gifs
			WHERE user_id = $1 AND gif_id IN (SELECT id FROM gif)
			RETURNING 1
		)
		SELECT EXISTS (SELECT 1 FROM gif) AS gif_exists,
		       EXISTS (SELECT 1 FROM deleted) AS deleted
	`
	const driverError = "pq: violates foreign key constraint favorite_gifs_gif_id_fkey"
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		for _, tt := range []struct {
			name      string
			exists    bool
			changed   bool
			uppercase bool
			dbError   bool
		}{
			{name: "GIF not found"},
			{name: "favorite changed", exists: true, changed: true},
			{name: "idempotent repeat", exists: true},
			{name: "uppercase UUID", exists: true, changed: true, uppercase: true},
			{name: "database error", dbError: true},
		} {
			t.Run(method+"/"+tt.name, func(t *testing.T) {
				handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
				gifID := favoriteTestGifID
				if tt.uppercase {
					gifID = strings.ToUpper(gifID)
				}
				query, changedColumn := insertQuery, "inserted"
				if method == http.MethodDelete {
					query, changedColumn = deleteQuery, "deleted"
				}
				expectation := mock.ExpectQuery(regexp.QuoteMeta(query)).WithArgs("user-id", gifID)
				if tt.dbError {
					expectation.WillReturnError(errors.New(driverError))
				} else {
					expectation.WillReturnRows(sqlmock.NewRows([]string{"gif_exists", changedColumn}).AddRow(tt.exists, tt.changed))
				}
				response := performGifFavorite(handler, method, gifID)
				switch {
				case tt.dbError:
					assertGifFavoriteError(t, response, http.StatusInternalServerError, "internal_error", "internal server error")
					for _, detail := range []string{"pq:", "violates foreign key constraint", "favorite_gifs_gif_id_fkey", gifID} {
						if strings.Contains(response.Body.String(), detail) {
							t.Errorf("response leaks database detail %q", detail)
						}
					}
				case !tt.exists:
					assertGifFavoriteError(t, response, http.StatusNotFound, "gif_not_found", "GIF not found")
				default:
					status := http.StatusOK
					if method == http.MethodPost && tt.changed {
						status = http.StatusCreated
					}
					if response.Code != status {
						t.Fatalf("status=%d, want %d: %s", response.Code, status, response.Body.String())
					}
					var body map[string]bool
					if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					if len(body) != 1 || !body["success"] {
						t.Fatalf("expected only success=true: %s", response.Body.String())
					}
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestGifFavoriteRejectsUnsupportedMethod(t *testing.T) {
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	response := performGifFavorite(handler, http.MethodPut, favoriteTestGifID)
	assertGifFavoriteError(t, response, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func assertGifFavoriteError(t *testing.T, response *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status=%d, want %d: %s", response.Code, status, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type=%q, want application/json", got)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["error"]; exists {
		t.Fatal("unexpected nested error envelope")
	}
	if len(fields) != 3 {
		t.Fatalf("expected exactly three root fields: %s", response.Body.String())
	}
	for key, want := range map[string]string{"code": code, "message": message, "requestId": "gif-favorite-request-id"} {
		var got string
		if err := json.Unmarshal(fields[key], &got); err != nil {
			t.Fatalf("field %s: %v", key, err)
		}
		if got != want {
			t.Errorf("%s=%q, want %q", key, got, want)
		}
	}
}
