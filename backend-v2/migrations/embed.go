// Package migrationsql exposes the SQL migration files as an in-binary
// filesystem. It is deliberately separate from internal/migrations, which
// contains the runner logic.
package migrationsql

import "embed"

// FS contains every *.sql file that lives next to this file.
//
// Files are rooted at the top of the FS, so callers should pass "." as the
// directory argument to migrations.Run.
//
//go:embed *.sql
var FS embed.FS
