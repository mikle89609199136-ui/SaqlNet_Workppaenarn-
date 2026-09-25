package authctx

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCheckTokenGenerationSchema(t *testing.T) {
	tests := []struct {
		name    string
		ready   bool
		wantErr bool
	}{
		{name: "migration applied", ready: true},
		{name: "migration missing", ready: false, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })

			mock.ExpectQuery("information_schema.columns").
				WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(tt.ready))

			err = CheckTokenGenerationSchema(t.Context(), db)
			if tt.wantErr && !errors.Is(err, ErrTokenGenerationSchemaNotReady) {
				t.Fatalf("expected schema-not-ready error, got %v", err)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected ready schema, got %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCheckTokenGenerationSchemaRejectsNilDatabase(t *testing.T) {
	if err := CheckTokenGenerationSchema(t.Context(), nil); !errors.Is(err, ErrTokenGenerationSchemaNotReady) {
		t.Fatalf("expected schema-not-ready error, got %v", err)
	}
}
