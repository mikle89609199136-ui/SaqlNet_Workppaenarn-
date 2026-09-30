package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Версия выпуска — из version.json сборки фронтенда (#892).
func TestReadBuildInfoFromFrontendBuild(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "version.json"),
		[]byte(`{"version":"0.10.0","build":"mulktlld","builtAt":"2026-09-28T14:00:00.000Z"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	info := readBuildInfo(dir)
	if info.Version != "0.10.0" || info.Build != "mulktlld" {
		t.Fatalf("info = %+v", info)
	}
}

// Нет файла или он битый — «unknown», сервер из-за версии не падает.
func TestReadBuildInfoMissingOrBrokenIsUnknown(t *testing.T) {
	if info := readBuildInfo(t.TempDir()); info.Version != unknownVersion {
		t.Fatalf("missing: %+v", info)
	}

	dir := t.TempDir()
	for _, body := range []string{`not json`, `{"build":"x"}`} {
		if err := os.WriteFile(filepath.Join(dir, "version.json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		if info := readBuildInfo(dir); info.Version != unknownVersion {
			t.Fatalf("%s: %+v", body, info)
		}
	}
}
