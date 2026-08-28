# Client Clean Architecture

> **Это описание устаревшего клиента.** Он лежит в `legacy/mobile-client/`,
> ничем не собирается и не раздаётся: edge-сервер отдаёт только сборку Vite
> из `dist/` (`FRONTEND_DIR`, см. `backend-v2/cmd/edge/main.go`). Каталог
> оставлен как справочный материал до тех пор, пока из него не будет
> вынесено всё нужное.
>
> Актуальный клиент — `frontend/`, про него `frontend-data-architecture.md`.

The mobile web client is split into layers that keep UI, business logic, domain
models, and external dependencies independent.

## Layers

- `legacy/mobile-client/core` contains framework-neutral primitives such as
  `EventBus` and `Component`.
- `legacy/mobile-client/domain` contains entities and validators. These modules do not
  import UI, browser APIs, or HTTP clients.
- `legacy/mobile-client/application` contains services and use cases. Services depend
  on abstractions passed into constructors, mainly the API client.
- `legacy/mobile-client/infrastructure` contains concrete browser/API adapters:
  `ApiClient`, storage adapters, and `WebSocketClient`.
- `legacy/mobile-client/presentation` is the target location for UI components that use
  the core component base class.
- `legacy/mobile-client/shared` contains constants and small pure utilities.

## Compatibility

Existing modules in `legacy/mobile-client/services/api` are retained as compatibility
adapters. They delegate to `application/services/serviceContainer.js`, so old
imports can keep working while new code imports services or use cases directly.

## Migration Rule

New client features should follow this dependency direction:

```text
presentation -> application -> domain
application -> infrastructure adapters injected by constructor/container
domain -> no outward dependencies
```

Do not put fetch calls, localStorage access, or WebSocket handling in screens or
UI components. Add those integrations to `infrastructure`, then expose behavior
through application services or use cases.
