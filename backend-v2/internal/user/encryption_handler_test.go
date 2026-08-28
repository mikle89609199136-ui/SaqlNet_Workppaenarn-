package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"github.com/DATA-DOG/go-sqlmock"
)

type signalRegistrationValidatorStub struct {
	valid        bool
	err          error
	calls        int
	identityKey  string
	signedPreKey string
	signature    string
}

func (s *signalRegistrationValidatorStub) ValidateSignalRegistration(_ context.Context, identityKey, signedPreKey, signature string) (bool, error) {
	s.calls++
	s.identityKey = identityKey
	s.signedPreKey = signedPreKey
	s.signature = signature
	return s.valid, s.err
}

func TestUploadSignalKeysUsesInjectedValidator(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	validator := &signalRegistrationValidatorStub{valid: true}
	handler := NewHandler(NewService(db), validator)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO crypto.signal_identity_keys").
		WithArgs("user-id", "identity-key", 42).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO crypto.signal_signed_prekeys").
		WithArgs("user-id", 7, "signed-pre-key", "signature").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	response := serveSignalKeys(handler, validSignalRegistrationBody())

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if validator.calls != 1 {
		t.Fatalf("expected validator to be called once, got %d", validator.calls)
	}
	if validator.identityKey != "identity-key" || validator.signedPreKey != "signed-pre-key" || validator.signature != "signature" {
		t.Fatalf("validator received unexpected keys: identity=%q signed=%q signature=%q", validator.identityKey, validator.signedPreKey, validator.signature)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUploadSignalKeysRejectsInvalidRegistrationWithoutDatabaseWrite(t *testing.T) {
	assertSignalValidationFailure(t, &signalRegistrationValidatorStub{valid: false})
}

func TestUploadSignalKeysPreservesValidatorErrorBehaviorWithoutDatabaseWrite(t *testing.T) {
	assertSignalValidationFailure(t, &signalRegistrationValidatorStub{err: errors.New("crypto unavailable")})
}

func TestUploadSignalKeysInvalidJSONDoesNotCallValidator(t *testing.T) {
	validator := &signalRegistrationValidatorStub{valid: true}
	handler := NewHandler(nil, validator)

	response := serveSignalKeys(handler, []byte("{"))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", response.Code)
	}
	if code := responseErrorCode(t, response); code != "invalid_json" {
		t.Fatalf("expected invalid_json, got %q", code)
	}
	if validator.calls != 0 {
		t.Fatalf("expected validator not to be called, got %d calls", validator.calls)
	}
}

func assertSignalValidationFailure(t *testing.T, validator *signalRegistrationValidatorStub) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	handler := NewHandler(NewService(db), validator)
	response := serveSignalKeys(handler, validSignalRegistrationBody())

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", response.Code)
	}
	if code := responseErrorCode(t, response); code != "invalid_registration" {
		t.Fatalf("expected invalid_registration, got %q", code)
	}
	if validator.calls != 1 {
		t.Fatalf("expected validator to be called once, got %d", validator.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database interaction: %v", err)
	}
}

func serveSignalKeys(handler *Handler, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/v2/encryption/signal/keys", bytes.NewReader(body))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()
	handler.EncryptionRoutes(response, request)
	return response
}

func validSignalRegistrationBody() []byte {
	return []byte(`{
		"identityKey":{"identityKey":"identity-key","registrationId":42},
		"signedPreKey":{"keyId":7,"publicKey":"signed-pre-key","signature":"signature"},
		"oneTimePreKeys":[]
	}`)
}

func responseErrorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body httpx.Error
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return body.Code
}
