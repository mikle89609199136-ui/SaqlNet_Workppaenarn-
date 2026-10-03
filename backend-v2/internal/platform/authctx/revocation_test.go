package authctx

import (
	"database/sql"
	"errors"
	"testing"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestDBTokenCheckerRejectsIndividuallyRevokedToken(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := cryptoclient.TokenClaims{Subject: "11111111-1111-4111-8111-111111111111", TokenGeneration: 3}
	mock.ExpectQuery(`SELECT.*EXISTS`).
		WithArgs(TokenHash("access-token"), claims.Subject).
		WillReturnRows(sqlmock.NewRows([]string{"individually_revoked", "token_generation"}).AddRow(true, 3))

	revoked, err := NewDBTokenChecker(db).IsTokenRevoked(t.Context(), "access-token", claims)
	if err != nil {
		t.Fatalf("check token: %v", err)
	}
	if !revoked {
		t.Fatal("expected individually revoked token to be rejected")
	}
}

func TestDBTokenCheckerRejectsPreviousGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := cryptoclient.TokenClaims{Subject: "11111111-1111-4111-8111-111111111111", TokenGeneration: 2}
	mock.ExpectQuery(`SELECT.*EXISTS`).
		WillReturnRows(sqlmock.NewRows([]string{"individually_revoked", "token_generation"}).AddRow(false, 3))

	revoked, err := NewDBTokenChecker(db).IsTokenRevoked(t.Context(), "old-access-token", claims)
	if err != nil {
		t.Fatalf("check token: %v", err)
	}
	if !revoked {
		t.Fatal("expected token from previous generation to be rejected")
	}
}

func TestDBTokenCheckerAllowsCurrentGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := cryptoclient.TokenClaims{Subject: "11111111-1111-4111-8111-111111111111", TokenGeneration: 3}
	mock.ExpectQuery(`SELECT.*EXISTS`).
		WillReturnRows(sqlmock.NewRows([]string{"individually_revoked", "token_generation"}).AddRow(false, 3))

	revoked, err := NewDBTokenChecker(db).IsTokenRevoked(t.Context(), "new-access-token", claims)
	if err != nil {
		t.Fatalf("check token: %v", err)
	}
	if revoked {
		t.Fatal("expected current-generation token to remain valid")
	}
}

func TestDBTokenCheckerReturnsDatabaseFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT.*EXISTS`).WillReturnError(errors.New("database unavailable"))
	_, err = NewDBTokenChecker(db).IsTokenRevoked(t.Context(), "access-token", cryptoclient.TokenClaims{Subject: "user"})
	if err == nil {
		t.Fatal("expected database failure to be returned")
	}
}

func TestDBTokenCheckerRejectsTokenForDeletedUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT.*EXISTS`).WillReturnError(sql.ErrNoRows)
	revoked, err := NewDBTokenChecker(db).IsTokenRevoked(t.Context(), "access-token", cryptoclient.TokenClaims{Subject: "deleted-user"})
	if err != nil {
		t.Fatalf("check deleted user: %v", err)
	}
	if !revoked {
		t.Fatal("expected token for deleted user to be rejected")
	}
}
