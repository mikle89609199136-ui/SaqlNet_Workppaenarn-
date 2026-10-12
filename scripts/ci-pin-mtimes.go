//go:build ignore

// Время изменения файлов — по их содержимому, для кеша go test в CI.
//
// go test кеширует результат теста, только если не изменились файлы, которые
// тест читал (миграции, исходники, фикстуры), и сверяет их по времени
// изменения и размеру. После checkout в CI время у всех файлов свежее, и кеш
// не срабатывал бы никогда. Здесь каждому файлу ставится время, выведенное из
// хеша его содержимого в git: файл изменился — изменилось и время; нет — то
// же, что в прошлом прогоне. Время в прошлом (2000–2008): слишком свежие
// файлы go test не кеширует. Папкам — одно постоянное время: их состав
// go test сверяет по именам файлов.
//
// Запуск из корня репозитория: go run scripts/ci-pin-mtimes.go backend-v2
package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

const base = 946684800 // 2000-01-01

func main() {
	args := append([]string{"ls-files", "-s", "-z", "--"}, os.Args[1:]...)
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		fmt.Fprintln(os.Stderr, "git ls-files:", err)
		os.Exit(1)
	}
	dirs := map[string]bool{}
	files := 0
	for _, entry := range bytes.Split(out, []byte{0}) {
		meta, path, ok := bytes.Cut(entry, []byte{'\t'})
		if !ok {
			continue
		}
		fields := bytes.Fields(meta)
		if len(fields) < 2 {
			continue
		}
		prefix, err := strconv.ParseInt(string(fields[1][:7]), 16, 64)
		if err != nil {
			continue
		}
		name := filepath.FromSlash(string(path))
		if info, err := os.Lstat(name); err != nil || !info.Mode().IsRegular() {
			continue
		}
		stamp := time.Unix(base+prefix, 0)
		if err := os.Chtimes(name, stamp, stamp); err != nil {
			fmt.Fprintln(os.Stderr, name, err)
			os.Exit(1)
		}
		files++
		for dir := filepath.Dir(name); dir != "." && dir != string(filepath.Separator); dir = filepath.Dir(dir) {
			dirs[dir] = true
		}
	}
	fixed := time.Unix(base, 0)
	for dir := range dirs {
		_ = os.Chtimes(dir, fixed, fixed)
	}
	fmt.Printf("время по содержимому: файлов %d, папок %d\n", files, len(dirs))
}
