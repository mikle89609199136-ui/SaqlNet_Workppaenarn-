package privacy

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const photoQuery = `FROM auth\.users u\s+LEFT JOIN users\.settings s`

func TestHidePhotos(t *testing.T) {
	t.Run("свои и пустые аватары не стоят ни одного запроса", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		own, empty := "/own", ""

		require.NoError(t, HidePhotos(context.Background(), db, "viewer", []PhotoSlot{
			{OwnerID: "viewer", URL: &own}, {OwnerID: "a", URL: &empty}, {OwnerID: "b", URL: nil},
		}))
		require.Equal(t, "/own", own)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("один запрос на весь список, повторы не дублируются", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(photoQuery).WithArgs(sqlmock.AnyArg(), "viewer").
			WillReturnRows(sqlmock.NewRows([]string{"id", "privacy_settings", "blocked", "exceptions"}).
				AddRow("open", nil, false, nil).
				AddRow("closed", []byte(`{"photoVisibility":"nobody"}`), false, nil).
				AddRow("excepted", []byte(`{"photoVisibility":"nobody"}`), false, []byte(`{"photoVisibility":true}`)).
				AddRow("blocking", nil, true, nil))
		urls := map[string]string{"open": "/o", "closed": "/c", "excepted": "/e", "blocking": "/b", "missing": "/m"}
		second := "/o2"
		slots := []PhotoSlot{{OwnerID: "open", URL: &second}}
		for id, url := range urls {
			slots = append(slots, PhotoSlot{OwnerID: id, URL: &url})
		}

		require.NoError(t, HidePhotos(context.Background(), db, "viewer", slots))

		require.Equal(t, map[string]string{"open": "/o", "closed": "", "excepted": "/e", "blocking": "", "missing": ""}, values(slots[1:]))
		require.Equal(t, "/o2", second)
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

func values(slots []PhotoSlot) map[string]string {
	out := make(map[string]string, len(slots))
	for _, slot := range slots {
		out[slot.OwnerID] = *slot.URL
	}
	return out
}
