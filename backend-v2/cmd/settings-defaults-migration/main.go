package main

import (
	"flag"
	"fmt"
	"os"

	"craneapp/backend-v2/internal/platform/settingsdefaults"
)

func main() {
	output := flag.String("output", "", "new migration path (existing files are never overwritten)")
	flag.Parse()
	if *output == "" {
		fmt.Fprintln(os.Stderr, "--output is required; choose a NEW migration number")
		os.Exit(1)
	}
	file, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_, writeErr := file.WriteString(settingsdefaults.MigrationSQL())
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		fmt.Fprintln(os.Stderr, writeErr, closeErr)
		os.Exit(1)
	}
}
