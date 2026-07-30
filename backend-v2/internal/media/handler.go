package media

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
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
		var req struct {
			Purpose  string `json:"purpose"`
			File     any    `json:"file"`
			FileName string `json:"fileName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "failed to parse json")
			return
		}

		if req.Purpose == "message" {
			fileMap, ok := req.File.(map[string]any)
			if !ok {
				httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_file", "file must be an object for message purpose")
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
				originalSize = int64(sizeBytes)
				if sizeBytes < 0 || sizeBytes > maxUploadBytes || float64(originalSize) != sizeBytes {
					httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_size", "sizeBytes must be a non-negative integer within the upload limit")
					return
				}
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
				status := http.StatusInternalServerError
				code := "upload_failed"
				if errors.Is(err, ErrTooBig) {
					status, code = http.StatusRequestEntityTooLarge, "file_too_large"
				}
				httpx.ErrorJSON(w, r, status, code, err.Error())
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
		if strings.Contains(header, ";base64") {
			mimeType = strings.TrimPrefix(header, "data:")
			mimeType = strings.TrimSuffix(mimeType, ";base64")
		}

		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_base64", "failed to decode base64")
			return
		}

		up, err := h.service.UploadRaw(r.Context(), current.ID, req.FileName, mimeType, data, false, "")
		if err != nil {
			status := http.StatusInternalServerError
			code := "upload_failed"
			if errors.Is(err, ErrTooBig) {
				status, code = http.StatusRequestEntityTooLarge, "file_too_large"
			}
			httpx.ErrorJSON(w, r, status, code, err.Error())
			return
		}
		httpx.JSON(w, http.StatusCreated, uploadResponse(up))
		return
	}

	// Multipart fallback
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_form", "failed to parse multipart form")
		return
	}
	_, fh, err := r.FormFile("file")
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "missing_file", "field 'file' is required")
		return
	}
	up, err := h.service.Upload(r.Context(), current.ID, fh)
	switch {
	case errors.Is(err, ErrTooBig):
		httpx.ErrorJSON(w, r, http.StatusRequestEntityTooLarge, "file_too_large", "file exceeds 100 MB limit")
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
