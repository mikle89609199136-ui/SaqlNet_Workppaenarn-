package config

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

func Required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		panic(fmt.Sprintf("required environment variable %s is not set", name))
	}
	return value
}

func Value(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func PositiveFloat64(name string, fallback float64) float64 {
	value := os.Getenv(name)

	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		panic(fmt.Sprintf("environment variable %s must be a positive finite number, got %q", name, value))
	}

	return parsed
}

func PositiveInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		panic(fmt.Sprintf("environment variable %s must be a positive integer, got %q", name, value))
	}

	return parsed
}

func RequiredPositiveInt64(name string) int64 {
	value := Required(name)
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		panic(fmt.Sprintf("environment variable %s must be a positive integer, got %q", name, value))
	}
	return parsed
}
