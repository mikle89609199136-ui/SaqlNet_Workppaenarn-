package mediarefs

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUploadIDFromURL(t *testing.T) {
	const id = "ABCDEF01-2345-6789-abcd-ef0123456789"
	for _, tt := range []struct {
		url string
		ok  bool
	}{
		{URLPrefix + id, true}, {URLPrefix + "abcdef01-2345-6789-abcd-ef0123456789", true},
		{"", false}, {URLPrefix, false}, {URLPrefix + "not-a-uuid", false},
		{"https://example.org" + URLPrefix + id, false}, {"//host" + URLPrefix + id, false},
		{URLPrefix + id + "?x=1", false}, {URLPrefix + id + "#x", false},
		{URLPrefix + id + "/", false}, {URLPrefix + id + "\n", false},
		{URLPrefix + "/" + id, false}, {URLPrefix + "../" + id, false},
		{URLPrefix + "abcdef0123456789abcdef0123456789", false},
	} {
		t.Run(tt.url, func(t *testing.T) {
			got, ok := UploadIDFromURL(tt.url)
			if ok != tt.ok || (ok && URLPrefix+got != tt.url) || (!ok && got != "") {
				t.Fatalf("got %q, %t", got, ok)
			}
		})
	}
}

func TestAddPreservesFirstAttachment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for range 2 {
		mock.ExpectExec("INSERT INTO media.upload_refs .*ON CONFLICT DO NOTHING").
			WithArgs("upload", Message, "message", "chat", "", "", "").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectExec(`UPDATE media.uploads SET first_attached_at = COALESCE\(first_attached_at, NOW\(\)\) WHERE id = \$1`).
			WithArgs("upload").WillReturnResult(sqlmock.NewResult(0, 1))
		if err := Add(context.Background(), db, Ref{UploadID: "upload", Kind: Message, MessageID: "message", ChatID: "chat"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
