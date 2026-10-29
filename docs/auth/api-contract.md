# Контракт Auth API (#428)

Канонический исполнимый источник — `backend-v2/contracts/openapi/paths/auth.yaml`
и связанные схемы. Все 23 операции текущего сервиса перечислены ниже; старый
список из 14 операций и JSON authToken больше не используются.

## Сессия и подтверждающие credentials

В production используется HttpOnly Secure host-only cookie `__Host-craneapp_session`,
в development — `craneapp_session`. Токен не возвращается в JSON, не хранится
JavaScript-кодом и не принимается как bearer credential. Успешные register/login
и confirmed QR status устанавливают cookie; login challenge её не устанавливает.
Logout/logout-all очищают cookie. При ошибке зависимости cookie сохраняется.

Выбранный владельцем контракт от 29.10.2026: при действующей сессии неверный
подтверждающий пароль в change-password, 2fa/disable и 2fa/verify возвращает
`403 wrong_password`. Ответ не меняет сессию, пароль и настройки 2FA.
`401` защищённых операций означает missing_token, invalid_token, token_revoked
(либо invalid_session при исчезнувшем пользователе в public-key). Ошибки входа
`401 invalid_credentials/invalid_2fa` не обозначают отзыв другой действующей сессии.
Фронтенд не должен выполнять logout при 403, 429 или 5xx; совместимость обработки
старого 401 wrong_password на фронте сохранена.

## Тела, ошибки и времена

JSON body ограничен 64 КиБ, для всех QR body — 16 КиБ. Ровно одно значение JSON,
за которым допустимы только пробелы; empty/malformed/oversized/trailing data дают
`400 invalid_json`. Неизвестные свойства игнорируются. Request schemas описывают
допустимые входные данные; некоторые legacy handlers заменяют отсутствующее/null
строковое поле пустой строкой и затем применяют бизнес-валидацию. Это не строгий
settings patch contract. firstName/lastName ограничены 64 кодовыми точками Unicode.
Пароль при создании/изменении проверяется по Password; параметры deviceName
нормализуются и обрезаются до 64 кодовых точек, недопустимый deviceType заменяется
значением, определённым по User-Agent.

Все ошибки имеют code/message и необязательный requestId. В OpenAPI для каждого
статуса задан enum code и x-error-codes: 400 — ввод, 401 — аутентификация,
403 — неверное подтверждение/QR secret/Origin, 404 — QR отсутствует или заменён,
409 — конфликт, 500 — внутренняя ошибка, 503 — недоступность crypto/проверки
сессии/совместимости протокола/выдачи токена или отключённый logout-all.
Edge дополнительно возвращает 429 rate_limited с Retry-After (целые секунды),
502 upstream_unavailable, а для изменяющих запросов с session cookie —
403 cross_site_request при нарушении Origin-контракта. Классификация лимитов
зависит от маршрута и конфигурации edge; новые лимиты не вводились.

QR timestamps — Unix milliseconds; AuthSession createdAt/lastActive —
RFC 3339 date-time. AuthSessionsResponse всегда содержит массив, включая пустой.
У pending/scanned status есть expiresAt, у confirmed — encrypted payload и
Set-Cookie, у expired — только status. У offer state claimed дополнительно
обязателен claim с claimedAt. Ссылки/TTL/порядок QR запросов описаны в
[qr-links.md](qr-links.md). Неподтверждённый QR никогда не выдаёт сессию.

## Операции

| Метод | Путь относительно /api/v2 | Успешные статусы | Ошибки |
|---|---|---|---|
| POST | /auth/register | 201 | 400, 403, 405, 409, 429, 500, 502, 503 |
| POST | /auth/login | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |
| POST | /auth/public-key | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |
| POST | /auth/qr-token | 200 | 400, 403, 405, 409, 429, 500, 502 |
| DELETE | /auth/qr-token/{token} | 204 | 400, 403, 405, 429, 502 |
| GET | /auth/qr-request/{token} | 200 | 401, 404, 405, 429, 502, 503 |
| DELETE | /auth/qr-request/{token} | 204 | 401, 403, 405, 429, 502, 503 |
| GET | /auth/qr-status/{token} | 200 | 400, 403, 405, 429, 502 |
| POST | /auth/qr-confirm | 200 | 400, 401, 403, 405, 409, 429, 500, 502, 503 |
| POST | /auth/qr-offer | 200 | 400, 401, 403, 405, 409, 429, 500, 502, 503 |
| GET | /auth/qr-offer/{token} | 200 | 401, 405, 429, 502, 503 |
| DELETE | /auth/qr-offer/{token} | 204 | 401, 403, 405, 429, 502, 503 |
| POST | /auth/qr-offer/{token}/claim | 200 | 400, 403, 404, 405, 429, 500, 502 |
| GET | /auth/qr-offer/{token}/status | 200 | 403, 405, 429, 502 |
| POST | /auth/qr-offer/{token}/confirm | 200 | 400, 401, 403, 404, 405, 409, 429, 500, 502, 503 |
| POST | /auth/logout | 200 | 401, 403, 405, 429, 500, 502, 503 |
| POST | /auth/logout-all | 200 | 401, 403, 405, 429, 500, 502, 503 |
| GET | /auth/sessions | 200 | 401, 405, 429, 500, 502, 503 |
| POST | /auth/change-password | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |
| GET | /auth/2fa/status | 200 | 401, 405, 429, 500, 502, 503 |
| POST | /auth/2fa/enable | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |
| POST | /auth/2fa/disable | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |
| POST | /auth/2fa/verify | 200 | 400, 401, 403, 405, 429, 500, 502, 503 |

## Проверки контракта

`npm --prefix frontend run api:types` обновляет типы, `api:check` проверяет
контракты Auth/User/Media через TypeScript и AJV. Auth-тест сверяет список путей
с реальным cmd/auth, наличие всех 23 операций, success/error schemas, enum ошибок,
cookie security, лимиты и условные QR-поля. Backend integration test
TestWrongConfirmationPasswordPreservesAuthenticatedSession проверяет настоящий
HTTP, middleware и PostgreSQL: три 403 wrong_password, сохранение данных и
работоспособности той же cookie, missing/revoked session → 401.
