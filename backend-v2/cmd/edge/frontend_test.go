package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func frontendDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o600))
	must(os.MkdirAll(filepath.Join(dir, "assets"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "assets", "main-abc.js"), []byte("console.log(1)"), 0o600))
	must(os.WriteFile(filepath.Join(dir, "sw.js"), []byte("self"), 0o600))
	return dir
}

func serve(handler http.Handler, path string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

// Файл сборки прошлой версии после деплоя — 404, а не страница приложения:
// иначе браузер получил бы HTML вместо скрипта, а service worker сохранил
// бы его под именем скрипта (#880).
func TestFrontendMissingBuildAssetIs404(t *testing.T) {
	handler := frontendHandler(frontendDir(t))

	missing := serve(handler, "/assets/main-OLD.js")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing asset: status %d, want 404", missing.Code)
	}
	if strings.Contains(missing.Body.String(), "<html>app</html>") {
		t.Fatal("missing asset must not return the app page")
	}
	if got := missing.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("missing asset Cache-Control = %q, want no-store", got)
	}

	present := serve(handler, "/assets/main-abc.js")
	if present.Code != http.StatusOK || present.Body.String() != "console.log(1)" {
		t.Fatalf("present asset: %d %q", present.Code, present.Body.String())
	}
	if got := present.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("present asset Cache-Control = %q", got)
	}
}

func TestFrontendRoutesFallBackToAppPage(t *testing.T) {
	handler := frontendHandler(frontendDir(t))

	route := serve(handler, "/chats/123")
	if route.Code != http.StatusOK || !strings.Contains(route.Body.String(), "<html>app</html>") {
		t.Fatalf("app route: %d %q", route.Code, route.Body.String())
	}
	if got := route.Header().Get("Cache-Control"); !strings.Contains(got, "no-cache") {
		t.Fatalf("app route Cache-Control = %q", got)
	}

	worker := serve(handler, "/sw.js")
	if worker.Code != http.StatusOK || worker.Body.String() != "self" {
		t.Fatalf("service worker: %d %q", worker.Code, worker.Body.String())
	}
	if got := worker.Header().Get("Cache-Control"); !strings.Contains(got, "no-cache") {
		t.Fatalf("service worker must not be cached: %q", got)
	}

	for _, path := range []string{"/api/v2/unknown", "/ws-other"} {
		if got := serve(handler, path).Code; got != http.StatusNotFound {
			t.Fatalf("%s: status %d, want 404", path, got)
		}
	}
}
