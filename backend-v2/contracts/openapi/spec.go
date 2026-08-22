package openapi

import (
	"embed"
	"net/http"
)

// files contains the modular API contract used by Swagger UI and API clients.
//
//go:embed api-v2.yaml paths/*.yaml components/*.yaml
var files embed.FS

//go:embed api-v2.yaml
var apiV2 []byte

// ServeSpec serves the embedded OpenAPI contract.
func ServeSpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(apiV2)
}

// Files serves external files referenced by the root OpenAPI contract.
func Files() http.Handler {
	return http.StripPrefix("/docs/", http.FileServer(http.FS(files)))
}
