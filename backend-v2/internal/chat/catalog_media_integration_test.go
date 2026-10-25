//go:build integration

package chat

import (
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestCatalogGifUUIDAndMIMECompatibility(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := t.Context()
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	dbtest.User(t, db, owner, "catalog_gif_owner")
	service := NewService(db, nil, nil)
	for _, test := range []struct {
		name, mime string
		encrypted  bool
		uppercase  bool
		want       error
	}{
		{name: "UUID в верхнем регистре", mime: "image/gif", uppercase: true},
		{name: "MIME с параметрами", mime: "image/gif; version=89a"},
		{name: "MIME в смешанном регистре с пробелами", mime: " Image/GIF ; version=89a", uppercase: true},
		{name: "не GIF", mime: "image/png", want: ErrInvalidInput},
		{name: "зашифрованная загрузка", mime: "image/gif", encrypted: true, want: ErrInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			var id string
			require.NoError(t, db.QueryRowContext(ctx, `INSERT INTO media.uploads (uploader_id,object_key,filename,content_type,size_bytes,is_encrypted) VALUES ($1,'catalog-key','gif',$2,1,$3) RETURNING id::text`, owner, test.mime, test.encrypted).Scan(&id))
			url := mediaURLPrefix + id
			if test.uppercase {
				url = mediaURLPrefix + strings.ToUpper(id)
			}
			_, err := db.ExecContext(ctx, `INSERT INTO media.gifs (user_id,name,url) VALUES ($1,'GIF',$2)`, owner, url)
			require.NoError(t, err)
			err = service.ValidateCatalogMedia(ctx, "gif", url, false)
			if test.want != nil {
				require.ErrorIs(t, err, test.want)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
