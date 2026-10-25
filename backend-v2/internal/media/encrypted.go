package media

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
)

// Web Crypto appends a 128-bit AES-GCM tag to the original media bytes.
const mediaEncryptionOverheadBytes int64 = 16

func (s *Service) encryptedUploadLimit() int64 {
	return addRequestOverhead(s.maxUploadBytes, mediaEncryptionOverheadBytes)
}

// encryptedMediaEnvelope is the v2 wire format. Deploy support for new formats
// server-first; validation here checks the envelope, never decrypts its contents.
type encryptedMediaEnvelope struct {
	Encrypted  bool   `json:"encrypted"`
	Version    int64  `json:"version"`
	Algorithm  string `json:"algorithm"`
	IV         string `json:"iv"`
	KeyEpoch   int64  `json:"keyEpoch"`
	SizeBytes  int64  `json:"sizeBytes"`
	MIMEType   string `json:"mimeType"`
	FileName   string `json:"fileName"`
	Ciphertext string `json:"-"`
}

type envelopeValidationError struct {
	code    string
	message string
}

func decodeEnvelopeField(raw json.RawMessage, dest any) bool {
	return len(raw) != 0 && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) && json.Unmarshal(raw, dest) == nil
}

func validateEncryptedEnvelope(raw json.RawMessage, fallbackFilename string) (encryptedMediaEnvelope, *envelopeValidationError) {
	var envelope encryptedMediaEnvelope
	var fields map[string]json.RawMessage
	fail := func(code, message string) (encryptedMediaEnvelope, *envelopeValidationError) {
		return encryptedMediaEnvelope{}, &envelopeValidationError{code: code, message: message}
	}
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return fail("validation_failed", "encrypted file must be an object")
	}
	for _, name := range []string{"encrypted", "version", "algorithm", "iv", "keyEpoch", "sizeBytes", "ciphertext"} {
		if _, ok := fields[name]; !ok {
			return fail("validation_failed", name+" is required")
		}
	}

	if !decodeEnvelopeField(fields["encrypted"], &envelope.Encrypted) || !envelope.Encrypted {
		return fail("validation_failed", "encrypted must be true")
	}
	if !decodeEnvelopeField(fields["version"], &envelope.Version) || envelope.Version != 2 {
		return fail("validation_failed", "version must be 2")
	}
	if !decodeEnvelopeField(fields["algorithm"], &envelope.Algorithm) || envelope.Algorithm != "AES-GCM" {
		return fail("validation_failed", "algorithm must be AES-GCM")
	}
	if !decodeEnvelopeField(fields["iv"], &envelope.IV) || len(envelope.IV) > maxEncryptionIVBytes {
		return fail("validation_failed", "iv must be a bounded base64 string")
	}
	iv, err := base64.StdEncoding.Strict().DecodeString(envelope.IV)
	// Strict still accepts CR/LF; a round trip additionally enforces canonical text.
	if err != nil || len(iv) != 12 || base64.StdEncoding.EncodeToString(iv) != envelope.IV {
		return fail("validation_failed", "iv must be canonical base64 encoding of 12 bytes")
	}

	epoch, err := strconv.ParseInt(strings.TrimSpace(string(fields["keyEpoch"])), 10, 64)
	if err != nil || epoch < 1 || epoch > maxJSONSafeInteger {
		return fail("validation_failed", "keyEpoch must be a positive safe integer")
	}
	envelope.KeyEpoch = epoch
	if !decodeEnvelopeField(fields["sizeBytes"], &envelope.SizeBytes) || envelope.SizeBytes < 0 || envelope.SizeBytes > maxJSONSafeInteger {
		return fail("invalid_size", "sizeBytes must be a non-negative safe integer")
	}
	if !decodeEnvelopeField(fields["ciphertext"], &envelope.Ciphertext) {
		return fail("invalid_ciphertext", "ciphertext must be a string")
	}
	if raw, exists := fields["mimeType"]; exists {
		if !decodeEnvelopeField(raw, &envelope.MIMEType) || len(envelope.MIMEType) > maxUploadMIMETypeBytes {
			return fail("validation_failed", "mimeType must be a bounded string")
		}
	}
	if envelope.MIMEType == "" {
		envelope.MIMEType = "application/octet-stream"
	}
	if raw, exists := fields["fileName"]; exists {
		if !decodeEnvelopeField(raw, &envelope.FileName) || len(envelope.FileName) > maxFilenameBytes {
			return fail("validation_failed", "fileName must be a bounded string")
		}
	}
	if envelope.FileName == "" {
		envelope.FileName = fallbackFilename
	}
	envelope.FileName = sanitizeFilename(envelope.FileName)
	return envelope, nil
}
