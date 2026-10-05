package auth

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCheckSessionSchema(t *testing.T) {
	for _, test := range []struct {
		name    string
		ready   bool
		wantErr bool
	}{
		{name: "migration applied", ready: true},
		{name: "migration missing", ready: false, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })

			mock.ExpectQuery("information_schema.columns").
				WillReturnRows(sqlmock.NewRows([]string{"ready"}).AddRow(test.ready))

			err = CheckSessionSchema(t.Context(), db)
			if test.wantErr && !errors.Is(err, ErrSessionSchemaNotReady) {
				t.Fatalf("expected schema-not-ready error, got %v", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("expected ready schema, got %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCheckSessionSchemaRejectsNilDatabase(t *testing.T) {
	if err := CheckSessionSchema(t.Context(), nil); !errors.Is(err, ErrSessionSchemaNotReady) {
		t.Fatalf("expected schema-not-ready error, got %v", err)
	}
}
