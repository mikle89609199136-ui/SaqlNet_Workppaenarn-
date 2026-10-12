package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

const (
	// Request overhead covers multipart boundaries and bounded part headers/metadata.
	multipartRequestOverheadBytes int64 = 64 << 10
	// JSON overhead covers worst-case escaping of bounded metadata plus JSON syntax.
	jsonRequestOverheadBytes      int64 = 64 << 10
	multipartMemoryThresholdBytes int64 = 32 << 20

	maxUploadPurposeBytes       = 32
	maxUploadMIMETypeBytes      = 255
	maxEncryptionVersionBytes   = 64
	maxEncryptionAlgorithmBytes = 128
	maxEncryptionIVBytes        = 4096
	maxDataURLHeaderBytes       = maxUploadMIMETypeBytes + 32
	maxJSONSafeInteger          = 1<<53 - 1
)

type Handler struct {
	service *Service
}

var uploadIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func base64EncodedSize(decodedBytes int64) int64 {
	groups := decodedBytes / 3
	if groups > math.MaxInt64/4 {
		return math.MaxInt64
	}
	encodedBytes := groups * 4
	if decodedBytes%3 != 0 {
		if encodedBytes > math.MaxInt64-4 {
			return math.MaxInt64
		}
		encodedBytes += 4
	}
	return encodedBytes
}

func addRequestOverhead(payloadBytes, overheadBytes int64) int64 {
	if payloadBytes > math.MaxInt64-overheadBytes {
		return math.MaxInt64
	}
	return payloadBytes + overheadBytes
}

func (h *Handler) jsonBodyLimit() int64 {
	return addRequestOverhead(base64EncodedSize(h.service.maxUploadBytes), jsonRequestOverheadBytes)
}

func (h *Handler) multipartBodyLimit() int64 {
	return addRequestOverhead(h.service.maxUploadBytes, multipartRequestOverheadBytes)
}

func (h *Handler) multipartMemoryLimit() int64 {
	if h.service.maxUploadBytes < multipartMemoryThresholdBytes {
		return h.service.maxUploadBytes
	}
	return multipartMemoryThresholdBytes
}

func decodeSingleJSON(reader io.Reader, value any) error {
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func isMaxBytesError(err error) bool {
	var maxBytesError *http.MaxBytesError
	return errors.As(err, &maxBytesError)
}

func uploadLimitMessage(maxBytes int64) string {
	const mebibyte = 1 << 20
	if maxBytes%mebibyte == 0 {
		return fmt.Sprintf("file exceeds %d MB limit", maxBytes/mebibyte)
	}
	return fmt.Sprintf("file exceeds %d byte limit", maxBytes)
}

func requestLimitMessage(maxBytes int64) string {
	return fmt.Sprintf("request body exceeds %d byte limit", maxBytes)
}

func (h *Handler) writeFileTooLarge(w http.ResponseWriter, r *http.Request) {
	writeTooLarge(w, r, h.service.maxUploadBytes)
}

func writeTooLarge(w http.ResponseWriter, r *http.Request, limit int64) {
	httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "file_too_large", uploadLimitMessage(limit))
}

// maxVoiceBytes — предел голосового (#843). 15 минут Opus 32 кбит/с —
// около 3,6 МБ; запас на контейнер и шифрование. Сервер не видит ни
// длительности, ни содержимого — только размер, его и ограничивает.
const maxVoiceBytes = 8 << 20

// decodedBase64Size — точный размер после декодирования, с учётом `=` в
// конце: DecodedLen даёт верхнюю оценку и отклонил бы файл ровно на пределе.
func decodedBase64Size(encoded string) int64 {
	size := int64(len(encoded) / 4 * 3)
	switch {
	case strings.HasSuffix(encoded, "=="):
		size -= 2
	case strings.HasSuffix(encoded, "="):
		size--
	}
	return size
}

func (h *Handler) writeUploadError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrBadType) {
		httpx.ErrorJSON(w, r, http.StatusUnsupportedMediaType, "unsupported_type", "file type not allowed")
		return
	}
	if errors.Is(err, ErrTooBig) {
		h.writeFileTooLarge(w, r)
		return
	}
	httpx.ErrorJSON(w, r, http.StatusInternalServerError, "upload_failed", "upload failed")
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	current := authctx.MustUser(r)

	contentType := r.Header.Get("Content-Type")

	// JSON payload
	if strings.HasPrefix(contentType, "application/json") {
		r.Body = http.MaxBytesReader(w, r.Body, h.jsonBodyLimit())
		var req struct {
			Purpose  string          `json:"purpose"`
			File     json.RawMessage `json:"file"`
			FileName string          `json:"fileName"`
			// Type — вид вложения; у голосового свой предел размера (#843).
			Type string `json:"type"`
		}
		if err := decodeSingleJSON(r.Body, &req); err != nil {
			if isMaxBytesError(err) {
				h.writeFileTooLarge(w, r)
				return
			}
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "failed to parse json")
			return
		}
		if len(req.Purpose) > maxUploadPurposeBytes || len(req.FileName) > maxFilenameBytes {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
			return
		}

		if req.Purpose == "message" {
			envelope, validationErr := validateEncryptedEnvelope(req.File, req.FileName)
			if validationErr != nil {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, validationErr.code, validationErr.message)
				return
			}
			if req.Type == "voice" && decodedBase64Size(envelope.Ciphertext) > maxVoiceBytes {
				writeTooLarge(w, r, maxVoiceBytes)
				return
			}

			encJson, _ := json.Marshal(envelope)

			up, err := h.service.UploadEncrypted(r.Context(), current.ID, envelope.FileName, envelope.Ciphertext, string(encJson), envelope.MIMEType)
			if err != nil {
				if errors.Is(err, ErrInvalidCiphertext) {
					httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_ciphertext", "failed to decode ciphertext base64")
					return
				}
				h.writeUploadError(w, r, err)
				return
			}

			// Node.js returns extra data for encrypted
			resp := map[string]any{
				"success":     true,
				"url":         "/api/v2/media/" + up.ID,
				"encrypted":   true,
				"encryption":  string(encJson),
				"fileName":    envelope.FileName,
				"sizeBytes":   envelope.SizeBytes,
				"contentType": up.ContentType,
			}
			httpx.JSON(w, http.StatusCreated, resp)
			return
		}

		// Plain data URL
		var fileStr string
		if err := json.Unmarshal(req.File, &fileStr); err != nil || !strings.HasPrefix(fileStr, "data:") {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "plain uploads must be data URLs")
			return
		}

		parts := strings.SplitN(fileStr, ",", 2)
		if len(parts) != 2 || !strings.HasSuffix(parts[0], ";base64") {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "invalid data url")
			return
		}

		header := parts[0]
		if len(header) > maxDataURLHeaderBytes {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
			return
		}
		mimeType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		mimeType, allowed := allowedMediaType(mimeType)
		if !allowed {
			h.writeUploadError(w, r, ErrBadType)
			return
		}

		data, err := decodeBase64Payload(parts[1], h.service.maxUploadBytes)
		if err != nil {
			if errors.Is(err, ErrTooBig) {
				h.writeFileTooLarge(w, r)
				return
			}
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_base64", "failed to decode base64")
			return
		}

		up, err := h.service.UploadRaw(r.Context(), current.ID, req.FileName, mimeType, data, false, "")
		if err != nil {
			h.writeUploadError(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, uploadResponse(up))
		return
	}

	// Multipart fallback
	r.Body = http.MaxBytesReader(w, r.Body, h.multipartBodyLimit())
	parseErr := r.ParseMultipartForm(h.multipartMemoryLimit())
	if r.MultipartForm != nil {
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}
	if parseErr != nil {
		if isMaxBytesError(parseErr) {
			h.writeFileTooLarge(w, r)
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_form", "failed to parse multipart form")
		return
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File["file"]) == 0 {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_file", "field 'file' is required")
		return
	}
	fh := r.MultipartForm.File["file"][0]
	if len(fh.Filename) > maxFilenameBytes || len(fh.Header.Get("Content-Type")) > maxUploadMIMETypeBytes {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
		return
	}
	up, err := h.service.Upload(r.Context(), current.ID, fh)
	if err != nil {
		h.writeUploadError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, uploadResponse(up))
}

func uploadResponse(up Upload) map[string]any {
	return map[string]any{
		"success":     true,
		"url":         "/api/v2/media/" + up.ID,
		"fileName":    up.Filename,
		"sizeBytes":   up.SizeBytes,
		"contentType": up.ContentType,
	}
}

func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	uploadID := strings.TrimPrefix(r.URL.Path, "/api/v2/media/")
	if uploadID == "" {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "upload id required")
		return
	}
	if !uploadIDPattern.MatchString(uploadID) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "upload not found")
		return
	}
	if err := httpx.DisableWriteDeadline(w); err != nil {
		slog.Error("disable media download write deadline", "err", err)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	err := h.service.ServeProxy(r.Context(), uploadID, w, GetOptions{
		Head:  r.Method == http.MethodHead,
		Range: r.Header.Get("Range"),
	})
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "upload not found")
	case errors.Is(err, ErrObjectNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "object_not_found", "media object not found")
	case errors.Is(err, ErrStorage):
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "storage_unavailable", "media storage unavailable")
	case errors.Is(err, ErrResponseStarted), err != nil && r.Context().Err() != nil:
		return
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
