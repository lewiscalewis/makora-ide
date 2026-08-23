# Changelog de la rama `feat/remote-chat-session-provider-costs`

Este documento resume los cambios incluidos en la rama feature que agrupa el
trabajo de **proveedor/modelo por sesión**, el **fix de cálculo de saldo** y la
**puerta de enlace de acceso remoto (chat móvil)**.

> Historial completo: `git log feat/remote-chat-session-provider-costs --oneline`.
> Documentación detallada: `docs/architecture.md` (nota de costes/proveedor por
> sesión) y `docs/REMOTE_ACCESS.md` (acceso remoto móvil).

## Proveedor y modelo por sesión (no global)

- `ChatSession` ahora conserva `providerId`, `model` y `baseUrl`
  (`src/types.ts`). El proveedor efectivo de una sesión es
  `activeSession.providerId || settings.providerId` (`src/App.tsx`).
- Al restaurar una sesión se **valida que su modelo siga existiendo** en el
  proveedor de la sesión; si el modelo fue retirado (p. ej.
  `deepseek-v4-flash-vision-exp`, error 404), se cae a un modelo válido en vez
  de bloquear la conversación (`src/App.tsx`).
- `requestConfig` / `addUsage` / `persistTranscript` usan el proveedor de la
  sesión activa, no el global (`src/App.tsx`, `src/sessions.ts`).
- Al cambiar de proveedor en Ajustes, el cambio se propaga a la sesión activa.

## Fix: bloqueo espurio «Coste de sesión ≥ saldo»

- El bloqueo por saldo comparaba el **coste histórico acumulado de la sesión**
  contra el **saldo restante** (que ya descuenta cada llamada), por lo que una
  sesión larga se bloqueaba sin motivo. Ahora se estima el **coste medio por
  turno** (`totalCostUsd / turnos`) y solo se bloquea si ese coste estimado
  supera el saldo (`src/App.tsx`).
- `UsagePanel` muestra el «restante estimado» restando el coste del siguiente
  turno en lugar del coste acumulado de la sesión (`src/components/UsagePanel.tsx`).

## Costes y sincronización con el proveedor (estado documentado)

- El coste por turno se calcula en el frontend (`computeCostUsd`) con precios
  estáticos de `src/providers.ts` (`MODERN_PROVIDER_MODELS` /
  `inferModelConfig`); el backend devuelve `usage` (tokens) y el frontend aplica
  la tarifa.
- **No hay sincronización de precios en vivo** (no existe API estándar de
  precios). El saldo real solo está disponible para DeepSeek (`/user/balance`) y
  OpenRouter (`/api/v1/credits`) en `src-tauri/src/balance.rs`.
- El `addUsage` usa el proveedor de la sesión activa para aplicar la tarifa
  correcta.

## Puerta de enlace de acceso remoto (chat móvil)

- Nuevo módulo Rust `src-tauri/src/remote/`: servidor HTTPS autofirmado
  (axum + rustls) en la LAN (puerto 8443 por defecto), túnel público Cloudflare
  Quick Tunnel (auto-descarga de `cloudflared`), emparejamiento por código PIN
  (TTL 3 min) + token por dispositivo, rate limiting por IP, streaming SSE de
  chat y WebSocket de eventos.
- Endpoints: `/api/state`, `/api/pair`, `/api/chat` (SSE), `/api/sync-config`,
  `/api/revoke`, `/api/list-models`, `/api/providers`, `/api/health`, `/ws`
  (ver tabla en `docs/REMOTE_ACCESS.md`).
- Comandos Tauri: `remote_status/start/stop/pair_code/revoke/get_config/
  sync_config/tunnel_start/tunnel_stop`, `get_lan_ips` (`src-tauri/src/lib.rs`),
  bindings en `src/bindings.ts` / `src/api.ts`.
- Panel «Acceso remoto» en la UI (`src/components/RemotePanel.tsx`, icono 🌐 en
  `src/components/Header.tsx`): iniciar/detener servidor, código de
  emparejamiento, túnel público, revocación.
- SPA móvil embebida (`web/index.html`, `web/app.js`, `web/styles.css`) con
  **tema Makora Abyss**, **historial local de chats** (localStorage) y
  **selector de proveedor/modelo** sincronizable vía `/api/sync-config`.

## Verificación

- `npx tsc --noEmit` → OK (sin errores de tipos).
- `cargo check` → OK (solo warnings de dead code en el módulo remoto).
- `npm run tauri build` → OK (instaladores MSI y NSIS generados).
