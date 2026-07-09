# Client Clean Architecture

The mobile web client is split into layers that keep UI, business logic, domain
models, and external dependencies independent.

## Layers

- `client/mobile/core` contains framework-neutral primitives such as
  `EventBus` and `Component`.
- `client/mobile/domain` contains entities and validators. These modules do not
  import UI, browser APIs, or HTTP clients.
- `client/mobile/application` contains services and use cases. Services depend
  on abstractions passed into constructors, mainly the API client.
- `client/mobile/infrastructure` contains concrete browser/API adapters:
  `ApiClient`, storage adapters, and `WebSocketClient`.
- `client/mobile/presentation` is the target location for UI components that use
  the core component base class.
- `client/mobile/shared` contains constants and small pure utilities.

## Compatibility

Existing modules in `client/mobile/services/api` are retained as compatibility
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
