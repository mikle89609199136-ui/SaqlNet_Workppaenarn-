package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
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

func (h *Handler) writeFileTooLarge(w http.ResponseWriter, r *http.Request) {
	httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "file_too_large", uploadLimitMessage(h.service.maxUploadBytes))
}

func (h *Handler) writeUploadError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrTooBig) {
		h.writeFileTooLarge(w, r)
		return
	}
	httpx.ErrorJSON(w, r, http.StatusInternalServerError, "upload_failed", "upload failed")
}

func metadataStringTooLong(values map[string]any, key string, maxBytes int) bool {
	value, ok := values[key].(string)
	return ok && len(value) > maxBytes
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
			Purpose  string `json:"purpose"`
			File     any    `json:"file"`
			FileName string `json:"fileName"`
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
			fileMap, ok := req.File.(map[string]any)
			if !ok {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "file must be an object for message purpose")
				return
			}
			if metadataStringTooLong(fileMap, "version", maxEncryptionVersionBytes) ||
				metadataStringTooLong(fileMap, "algorithm", maxEncryptionAlgorithmBytes) ||
				metadataStringTooLong(fileMap, "iv", maxEncryptionIVBytes) ||
				metadataStringTooLong(fileMap, "mimeType", maxUploadMIMETypeBytes) ||
				metadataStringTooLong(fileMap, "fileName", maxFilenameBytes) {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
				return
			}

			// Extract encrypted metadata
			enc := map[string]any{
				"encrypted": true,
			}
			if v, ok := fileMap["version"]; ok {
				enc["version"] = v
			}
			if v, ok := fileMap["algorithm"]; ok {
				enc["algorithm"] = v
			}
			if v, ok := fileMap["iv"]; ok {
				enc["iv"] = v
			}

			mimeType, _ := fileMap["mimeType"].(string)
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			enc["mimeType"] = mimeType

			var originalSize int64
			if sizeBytes, ok := fileMap["sizeBytes"].(float64); ok {
				if sizeBytes < 0 || sizeBytes > maxJSONSafeInteger || math.Trunc(sizeBytes) != sizeBytes {
					httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_size", "sizeBytes must be a non-negative integer")
					return
				}
				originalSize = int64(sizeBytes)
				enc["sizeBytes"] = originalSize
			}
			fileName, _ := fileMap["fileName"].(string)
			if fileName == "" {
				fileName = req.FileName
			}
			fileName = sanitizeFilename(fileName)
			enc["fileName"] = fileName

			ciphertext, ok := fileMap["ciphertext"].(string)
			if !ok {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_ciphertext", "ciphertext must be a string")
				return
			}

			encJson, _ := json.Marshal(enc)

			up, err := h.service.UploadEncrypted(r.Context(), current.ID, fileName, ciphertext, string(encJson), mimeType)
			if err != nil {
				h.writeUploadError(w, r, err)
				return
			}

			// Node.js returns extra data for encrypted
			resp := map[string]any{
				"success":     true,
				"url":         "/api/v2/media/" + up.ID,
				"encrypted":   true,
				"encryption":  string(encJson),
				"fileName":    fileName,
				"sizeBytes":   originalSize,
				"contentType": up.ContentType,
			}
			httpx.JSON(w, http.StatusCreated, resp)
			return
		}

		// Plain data URL
		fileStr, ok := req.File.(string)
		if !ok || !strings.HasPrefix(fileStr, "data:") {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "plain uploads must be data URLs")
			return
		}

		parts := strings.SplitN(fileStr, ",", 2)
		if len(parts) != 2 {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "invalid data url")
			return
		}

		mimeType := "application/octet-stream"
		header := parts[0]
		if len(header) > maxDataURLHeaderBytes {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
			return
		}
		if strings.Contains(header, ";base64") {
			mimeType = strings.TrimPrefix(header, "data:")
			mimeType = strings.TrimSuffix(mimeType, ";base64")
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
		defer r.MultipartForm.RemoveAll()
	}
	if parseErr != nil {
		if isMaxBytesError(parseErr) {
			h.writeFileTooLarge(w, r)
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_form", "failed to parse multipart form")
		return
	}
	file, fh, err := r.FormFile("file")
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_file", "field 'file' is required")
		return
	}
	_ = file.Close()
	if len(fh.Filename) > maxFilenameBytes || len(fh.Header.Get("Content-Type")) > maxUploadMIMETypeBytes {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "media metadata exceeds allowed length")
		return
	}
	up, err := h.service.Upload(r.Context(), current.ID, fh)
	switch {
	case errors.Is(err, ErrTooBig):
		h.writeFileTooLarge(w, r)
	case errors.Is(err, ErrBadType):
		httpx.ErrorJSON(w, r, http.StatusUnsupportedMediaType, "unsupported_type", "file type not allowed")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "upload_failed", "upload failed")
	default:
		httpx.JSON(w, http.StatusCreated, uploadResponse(up))
	}
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
	if r.Method != http.MethodGet {
		httpx.ErrorJSON(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	uploadID := strings.TrimPrefix(r.URL.Path, "/api/v2/media/")
	if uploadID == "" {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "upload id required")
		return
	}

	// Delegate fully to Service to handle JSON encrypted response vs Redirect
	err := h.service.ServeProxy(r.Context(), uploadID, w)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "upload not found")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", err.Error())
	}
}
