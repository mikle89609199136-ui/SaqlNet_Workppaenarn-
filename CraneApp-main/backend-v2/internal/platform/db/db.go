package db

import (
	"context"
	"database/sql"
	"time"
)

func Open(databaseURL string) (*sql.DB, error) {
	pool, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(20)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(30 * time.Minute)
	return pool, nil
}

func Ping(ctx context.Context, pool *sql.DB) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	return pool.PingContext(ctx)
}
