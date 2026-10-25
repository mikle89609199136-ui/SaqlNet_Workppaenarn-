package main

import (
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"

	"craneapp/backend-v2/internal/platform/config"
)

type rateLimitConfig struct {
	loginRegister bucketConfig
	password2FA   bucketConfig
	otherAuth     bucketConfig
	qrPoll        bucketConfig
	usernameCheck bucketConfig
	messageWrite  bucketConfig
	messageRead   bucketConfig
	mediaDownload bucketConfig
	mediaUpload   bucketConfig
	calls         bucketConfig
	mls           bucketConfig
	otherAPI      bucketConfig
	websocket     bucketConfig
	global        bucketConfig
}

type bucketConfig struct {
	// rate — скорость пополнения корзины в токенах в секунду. Внутри лимитера
	// единица всегда секунда, потому что пополнение считается от прошедшего
	// времени. Наружу — в конфиг и в документацию — единица выносится явно.
	rate  float64
	burst int
}

// perSecond и perMinute нужны, чтобы дефолт в коде читался так же, как строка в
// политике: perMinute(10) вместо 10.0/60.0. Без них часть дефолтов выглядела бы
// как голые числа, и единицу приходилось бы угадывать.
func perSecond(requests float64) float64 {
	return requests
}

func perMinute(requests float64) float64 {
	return requests / 60
}

func loadRateLimitConfig() rateLimitConfig {
	return rateLimitConfig{
		loginRegister: loadBucketConfig("LOGIN_REGISTER", perMinute(10), 5),
		password2FA:   loadBucketConfig("PASSWORD_2FA", perMinute(10), 5),
		otherAuth:     loadBucketConfig("OTHER_AUTH", perMinute(30), 10),
		qrPoll:        loadBucketConfig("QR_POLL", perSecond(2), 10),
		usernameCheck: loadBucketConfig("USERNAME_CHECK", perSecond(2), 5),
		messageWrite:  loadBucketConfig("MESSAGE_WRITE", perSecond(5), 20),
		messageRead:   loadBucketConfig("MESSAGE_READ", perSecond(20), 40),
		mediaDownload: loadBucketConfig("MEDIA_DOWNLOAD", perSecond(20), 60),
		mediaUpload:   loadBucketConfig("MEDIA_UPLOAD", perMinute(60), 30),
		calls:         loadBucketConfig("CALLS", perMinute(30), 15),
		mls:           loadBucketConfig("MLS", perSecond(5), 10),
		otherAPI:      loadBucketConfig("OTHER_API", perSecond(20), 40),
		websocket:     loadBucketConfig("WEBSOCKET", perMinute(10), 20),
		global:        loadBucketConfig("GLOBAL", perSecond(50), 100),
	}
}

func loadBucketConfig(name string, defaultRate float64, defaultBurst int) bucketConfig {
	prefix := "EDGE_RATE_LIMIT_" + name

	return bucketConfig{
		rate:  loadRate(prefix+"_RATE", defaultRate),
		burst: config.PositiveInt(prefix+"_BURST", defaultBurst),
	}
}

// loadRate читает лимит из переменной окружения. Пустое значение означает
// «взять дефолт из кода»; некорректное останавливает запуск, а не подменяется
// дефолтом молча: лимит, настроенный с опечаткой, должен быть виден сразу.
func loadRate(name string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	rate, err := parseRate(value)
	if err != nil {
		panic(fmt.Sprintf("environment variable %s: %v", name, err))
	}

	return rate
}

// rateUnits — сколько секунд в одной единице. Значение "10/min" означает
// 10 запросов на 60 секунд, то есть 10/60 токена в секунду.
var rateUnits = map[string]float64{
	"s":      1,
	"sec":    1,
	"second": 1,
	"min":    60,
	"minute": 60,
	"h":      3600,
	"hour":   3600,
}

// parseRate разбирает лимит вида "10/min" или "5/s" и возвращает токены в
// секунду. Единица обязательна: голое число — ошибка конфигурации, а не повод
// догадываться, что имел в виду человек. Именно из-за таких догадок значение
// можно было перепутать в 60 раз, ничего при этом не заметив.
func parseRate(value string) (float64, error) {
	numberPart, unitPart, hasUnit := strings.Cut(value, "/")
	if !hasUnit {
		return 0, fmt.Errorf("rate %q has no unit, expected a value like \"10/min\" or \"5/s\"", value)
	}

	number := strings.TrimSpace(numberPart)
	unit := strings.ToLower(strings.TrimSpace(unitPart))

	unitSeconds, known := rateUnits[unit]
	if !known {
		return 0, fmt.Errorf("rate %q has unknown unit %q, expected one of: s, sec, second, min, minute, h, hour", value, unit)
	}

	requests, err := strconv.ParseFloat(number, 64)
	if err != nil {
		return 0, fmt.Errorf("rate %q has an invalid number %q", value, number)
	}

	// ParseFloat принимает "NaN" и "Inf" без ошибки, поэтому проверяем отдельно.
	if requests <= 0 || math.IsNaN(requests) || math.IsInf(requests, 0) {
		return 0, fmt.Errorf("rate %q must be a positive finite number of requests", value)
	}

	return requests / unitSeconds, nil
}

// logRateLimits печатает действующие лимиты при старте. Это единственный способ
// снаружи узнать, какая настройка реально применилась: переменная, не дошедшая
// до контейнера, выглядит точно так же, как незаданная, и сервис в обоих
// случаях работает — просто с разными лимитами.
func logRateLimits(cfg rateLimitConfig) {
	log.Printf("edge rate limits (rate in tokens per second, burst in tokens):")

	for _, entry := range orderedBucketConfigs(cfg) {
		log.Printf("  %-15s %9.3f/s  (%8.1f/min)  burst %d",
			entry.group, entry.config.rate, entry.config.rate*60, entry.config.burst)
	}
}

type namedBucketConfig struct {
	group  routeGroup
	config bucketConfig
}

// orderedBucketConfigs задаёт стабильный порядок вывода: map по группам дал бы
// разный порядок при каждом запуске, и логи двух запусков нельзя было бы
// сравнить глазами.
func orderedBucketConfigs(cfg rateLimitConfig) []namedBucketConfig {
	entries := make([]namedBucketConfig, 0, len(allRouteGroups)+1)

	for _, group := range allRouteGroups {
		entries = append(entries, namedBucketConfig{group: group, config: cfg.bucketFor(group)})
	}

	return append(entries, namedBucketConfig{group: routeGroupGlobal, config: cfg.global})
}

// bucketFor связывает группу маршрутов с её настройкой. Единственное место, где
// эта связь задана: и newLimiterSet, и логирование ходят через него, поэтому
// новая группа не может появиться в одном месте и потеряться в другом.
func (cfg rateLimitConfig) bucketFor(group routeGroup) bucketConfig {
	switch group {
	case routeGroupLoginRegister:
		return cfg.loginRegister
	case routeGroupPassword2FA:
		return cfg.password2FA
	case routeGroupOtherAuth:
		return cfg.otherAuth
	case routeGroupQRPoll:
		return cfg.qrPoll
	case routeGroupUsernameCheck:
		return cfg.usernameCheck
	case routeGroupMessageWrite:
		return cfg.messageWrite
	case routeGroupMessageRead:
		return cfg.messageRead
	case routeGroupMediaDownload:
		return cfg.mediaDownload
	case routeGroupMediaUpload:
		return cfg.mediaUpload
	case routeGroupCalls:
		return cfg.calls
	case routeGroupMLS:
		return cfg.mls
	case routeGroupOtherAPI:
		return cfg.otherAPI
	case routeGroupWebSocket:
		return cfg.websocket
	case routeGroupGlobal:
		return cfg.global
	default:
		panic(fmt.Sprintf("no bucket config for route group %q", group))
	}
}
