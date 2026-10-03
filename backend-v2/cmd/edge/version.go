package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// buildInfo — какая версия выпущена (#892). Номер ставит сборка фронтенда
// в FRONTEND_DIR/version.json: версия у выпуска одна, и сервер отдаёт ту
// же, что видит приложение.
type buildInfo struct {
	Version string `json:"version"`
	Build   string `json:"build"`
}

const unknownVersion = "unknown"

// readBuildInfo читает version.json. Нет файла (локальный запуск без
// сборки) или он битый — "unknown": из-за номера версии сервер не падает.
func readBuildInfo(frontendDir string) buildInfo {
	raw, err := os.ReadFile(filepath.Join(frontendDir, "version.json"))
	if err != nil {
		return buildInfo{Version: unknownVersion}
	}
	var info buildInfo
	if err := json.Unmarshal(raw, &info); err != nil || info.Version == "" {
		return buildInfo{Version: unknownVersion}
	}
	return info
}
