# Acceso remoto (Móvil)

MakoraIDE puede exponer un servidor HTTPS local para chatear con el asistente
desde el navegador del móvil (o cualquier dispositivo en la misma red).

## Estado actual (MVP 1)

- ✅ Servidor HTTPS autofirmado en la red local (puerto configurable, 8443 por defecto).
- ✅ **Túnel público con Cloudflare Quick Tunnel** (`cloudflared`): URL `https://*.trycloudflare.com`
  para acceder desde cualquier red, sin cuenta ni token. TLS válido (termina en Cloudflare).
- ✅ SPA web embebida en el binario (`web/` → `include_dir`): interfaz de chat móvil
  con tema Makora Abyss, historial de chats local (localStorage) y selector de
  proveedor/modelo.
- ✅ Emparejamiento por código (8 caracteres alfanuméricos, TTL 3 min) + token por dispositivo.
- ✅ Rate limiting por IP (anti fuerza bruta) y persistencia del token en `app_data_dir`.
- ✅ Streaming de respuestas por **Server-Sent Events** (`GET /api/chat?session=...`).
- ✅ Comandos Tauri para la UI de escritorio: `remote_status`, `remote_start`,
  `remote_stop`, `remote_pair_code`, `remote_revoke`, `remote_get_config`,
  `remote_sync_config`, `remote_tunnel_start`, `remote_tunnel_stop`, `get_lan_ips`.
- ✅ Panel "Acceso remoto" en la UI de escritorio (icono 🌐 en la cabecera):
  iniciar/detener, generar código, exponer públicamente (túnel Cloudflare),
  URL móvil (pública o IP LAN + puerto), revocar dispositivo.

## Cómo usarlo (escritorio)

### Acceso público (desde cualquier red)

1. Configura un proveedor/modelo en Ajustes (el móvil usa la misma config).
2. Pulsa el icono 🌐 de la cabecera → **Iniciar servidor**.
3. **Generar código de emparejamiento** (válido 3 min).
4. Pulsa **Exponer públicamente (Cloudflare)**. La primera vez se descarga
   `cloudflared` automáticamente a la carpeta de datos de la app (o se usa el
   que esté en el PATH). Al cabo de unos segundos aparece la URL
   `https://*.trycloudflare.com`.
5. Abre esa URL en el móvil (certificado TLS válido) e introduce el código.

### Acceso en red local (misma Wi-Fi)

1. Inicia el servidor y genera el código.
2. En el móvil abre `https://IP-del-PC:8443` y acepta el certificado autofirmado.
3. Introduce el código de emparejamiento.

> La URL del túnel es **efímera**: cambia cada vez que reinicias el túnel. Para una
> URL estable se necesita un túnel con nombre (cuenta Cloudflare) — ver roadmap.

## Arquitectura

```
src-tauri/src/remote/
  mod.rs            Estado (RemoteState), handlers axum, comandos Tauri, spawn del servidor
  auth.rs           Emparejamiento (código + token), rate limiter, fingerprint
  cert.rs           Generación de certificado autofirmado (rcgen + rustls)
  chat.rs           Endpoint SSE /api/chat (streaming vía eventos Tauri)
  tunnel.rs         Túnel público Cloudflare (spawn cloudflared, parseo de URL, auto-descarga)
  remote_config.rs  Config remota (provider/modelo) persistida en app_data_dir
web/                SPA móvil embebida (index.html, app.js, styles.css)
```

### Endpoints HTTP

| Método | Ruta | Auth | Descripción |
|-------|------|------|-------------|
| GET | `/` | – | SPA de chat móvil |
| GET | `/app.js`, `/styles.css`, … | – | estáticos de la SPA (fallback a `/`) |
| GET | `/api/state` | Bearer | estado (config, fingerprint, dispositivo) |
| POST | `/api/pair` | – | enviar código PIN → token de dispositivo |
| POST | `/api/chat` | Bearer | streaming de la respuesta (body JSON: `message`, `history`) |
| POST | `/api/sync-config` | Bearer | actualizar config remota (proveedor/modelo/baseUrl/kind) |
| POST | `/api/revoke` | Bearer | revocar token actual |
| GET | `/api/list-models` | Bearer | listar modelos del proveedor actual |
| GET | `/api/providers` | Bearer | listar proveedores soportados para el selector móvil |
| GET | `/api/health` | – | health check (para diagnósticos) |
| GET | `/ws` | – | WebSocket de eventos en tiempo real |

> `POST /api/chat` usa la config activa de `RemoteConfig` (proveedor/modelo).
> Para cambiar de proveedor o modelo desde el móvil, primero se llama a
> `POST /api/sync-config` y después a `/api/chat`.
>
> La SPA móvil mantiene un **historial local de chats** en `localStorage` del
> navegador (no accede al historial del escritorio) y permite cambiar de
> proveedor/modelo desde el panel ⚙.

### Seguridad (límites actuales)

- Certificado autofirmado por sesión (regenerado al iniciar el servidor).
- En el túnel público, TLS termina en Cloudflare (certificado válido); el enlace
  local Cloudflare ↔ tu PC usa HTTPS con `--no-tls-verify` (certificado propio).
- Código de 8 caracteres alfanuméricos con expiración de 3 min; rate limit 5 intentos fallidos/10 s.
- El servidor escucha en `0.0.0.0` (LAN); el túnel no requiere abrir puertos en el router.

## Roadmap

- **MVP 2**: túnel con URL estable (Cloudflare Named Tunnel con cuenta, o dominio
  propio + reverse proxy) y código QR en el panel; auto-reinicio del túnel.
- **MVP 3**: control remoto completo (terminal, editor, ejecución de tareas
  agénticas) con autenticación por dispositivo + revocación por sesión.
- **MVP 4**: multi-dispositivo con gestión central, auditoría y cifrado E2E.

## Notas de desarrollo

- Los bindings TS de los comandos nuevos se regeneran con tauri-specta al
  ejecutar la app en modo debug (`cargo tauri dev`); mientras tanto se mantienen
  a mano en `src/bindings.ts` / `src/api.ts` / `src/types.ts`.
- La SPA `web/` se compila en build-time vía `include_dir!`; editarla no requiere
  toolchain JS.
