package chat

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseLimit проверяет извлечение и валидацию параметра limit из query-строки:
// значения по умолчанию, граничные допустимые значения и ошибки на некорректных данных.
func TestParseLimit(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		wantLimit int
		wantErr   error
	}{
		{name: "limit below minimum", query: "?limit=0", wantLimit: 0, wantErr: errInvalidLimit},
		{name: "negative limit", query: "?limit=-1", wantLimit: 0, wantErr: errInvalidLimit},
		{name: "limit above maximum", query: "?limit=101", wantLimit: 0, wantErr: errInvalidLimit},
		{name: "non-numeric limit", query: "?limit=abc", wantLimit: 0, wantErr: errInvalidLimit},
		{name: "empty limit param", query: "?limit=", wantLimit: 0, wantErr: errInvalidLimit},
		{name: "boundary limit 1", query: "?limit=1", wantLimit: 1, wantErr: nil},
		{name: "boundary limit 100", query: "?limit=100", wantLimit: 100, wantErr: nil},
		{name: "valid limit within range", query: "?limit=25", wantLimit: 25, wantErr: nil},
		{name: "default when no param", query: "", wantLimit: 50, wantErr: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/messages"+tt.query, nil)
			got, err := parseLimit(req)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantLimit, got)
			}
		})
	}
}

// TestParsePagination проверяет извлечение и валидацию limit и offset:
// дефолты при отсутствии параметров, граничные валидные значения и отказ на некорректных данных.
func TestParsePagination(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
		wantErr    error
	}{
		{name: "limit below minimum", query: "?limit=0", wantLimit: 0, wantOffset: 0, wantErr: errInvalidLimit},
		{name: "negative limit", query: "?limit=-1", wantLimit: 0, wantOffset: 0, wantErr: errInvalidLimit},
		{name: "limit above maximum", query: "?limit=101", wantLimit: 0, wantOffset: 0, wantErr: errInvalidLimit},
		{name: "non-numeric limit", query: "?limit=abc", wantLimit: 0, wantOffset: 0, wantErr: errInvalidLimit},
		{name: "empty limit param", query: "?limit=", wantLimit: 0, wantOffset: 0, wantErr: errInvalidLimit},
		{name: "negative offset", query: "?offset=-1", wantLimit: 0, wantOffset: 0, wantErr: errInvalidOffset},
		{name: "non-numeric offset", query: "?offset=xyz", wantLimit: 0, wantOffset: 0, wantErr: errInvalidOffset},
		{name: "empty offset param", query: "?offset=", wantLimit: 0, wantOffset: 0, wantErr: errInvalidOffset},
		{name: "boundary offset 0", query: "?offset=0", wantLimit: 50, wantOffset: 0, wantErr: nil},
		{name: "large offset", query: "?offset=1000", wantLimit: 50, wantOffset: 1000, wantErr: nil},
		{name: "boundary limit 1 and offset 10", query: "?limit=1&offset=10", wantLimit: 1, wantOffset: 10, wantErr: nil},
		{name: "boundary limit 100 and offset 0", query: "?limit=100&offset=0", wantLimit: 100, wantOffset: 0, wantErr: nil},
		{name: "defaults when no params", query: "", wantLimit: 50, wantOffset: 0, wantErr: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/messages"+tt.query, nil)
			gotLimit, gotOffset, err := parsePagination(req)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantLimit, gotLimit)
				assert.Equal(t, tt.wantOffset, gotOffset)
			}
		})
	}
}
