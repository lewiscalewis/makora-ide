# AGENTS.md — MakoraIDE

Instrucciones canónicas y protocolo operativo para cualquier agente de IA (Claude Code, Cursor, Antigravity, OpenCode, Codex) que trabaje en el repositorio **makora-ide**. Leer atentamente antes de inspeccionar o modificar código.

---

## 1. Identidad y Misión

**MakoraIDE** es un entorno de desarrollo integrado (IDE) de escritorio orientado al **desarrollo agéntico autónomo** de alto rendimiento, construido con **Tauri v2 + Rust** (backend de alta velocidad, streaming reactivo, motor de herramientas local) y **React 19 + TypeScript + Vite** (frontend ultra-rápido, multisesión y visor enriquecido).

El objetivo del proyecto es proporcionar una experiencia de desarrollo asistida por IA de primer nivel, soportando proveedores en la nube y sirviendo como cliente nativo para **MakoraAI** (LLM local `qwen3-coder:30b` ejecutado en Ollama Windows nativo).

---

## 2. Mapa de Arquitectura y Directorios

| Directorio / Archivo | Responsabilidad |
|---|---|
| `src-tauri/src/agent.rs` | **Bucle agéntico central:** catálogo de herramientas, dispatching, circuito anti-bucles, modo plan, permisos y límites. |
| `src-tauri/src/gateway.rs` | **Gateway multi-proveedor:** cliente SSE/HTTP para OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter y Ollama local. Resuelve endpoints locales automáticamente. |
| `src-tauri/src/token_engine.rs` | **Motor de contexto:** `ContextComposer` (cuotas por sistema, tools, repo map, memoria, archivos e historia) y poda atómica `fit_history`. |
| `src-tauri/src/history.rs` | **Persistencia SQLite WAL:** sesiones, checkpoints de conversación, historial de turnos y métricas de consumo. |
| `src-tauri/src/repo_map.rs` | **Mapa del workspace:** árbol estructural de archivos inyectado en el prompt con TTL y caché. |
| `src-tauri/src/symbol_index.rs` | **Índice de símbolos BM25:** extracción y búsqueda de funciones/clases multi-lenguaje (`repo_map_query`). |
| `src-tauri/src/lib.rs` / `main.rs` | Registro de comandos IPC de Tauri, inicialización de plugins y ciclo de vida de la ventana. |
| `src/components/UnifiedWorkspace.tsx` | **Lienzo principal y barra de pestañas:** pestañas de archivos, pestaña fija Master Chat, menú contextual y modo Split/Zen. |
| `src/components/ContextMenu.tsx` | Componente reutilizable de menú contextual flotante con desenfoque de fondo y acciones rápidas. |
| `src/components/Chat.tsx` | Interfaz conversacional, renderizado de mensajes, streaming en tiempo real y selector de modelos. |
| `src/components/SettingsModal.tsx` | Configuración de proveedores, llaves API, cuotas de contexto, skills agénticas y servidores MCP. |
| `src/i18n/` | Sistema de internacionalización en 7 idiomas (`es`, `en`, `fr`, `de`, `it`, `pt`, `zh`) con tipado estricto en `types.ts`. |
| `src/providers.ts` / `defaults.ts` | Configuración por defecto de modelos, costes por token y presets. |

---

## 3. Catálogo de Herramientas del Agente (Core Tools)

Las siguientes herramientas residen en [`src-tauri/src/agent.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/agent.rs) y constituyen el contrato con el modelo:

1. `read_file`: Lee archivos con números de línea y truncado inteligente.
2. `read_file_range`: Lee rangos específicos `[start_line, end_line]`.
3. `list_dir`: Lista carpetas y archivos ordenados.
4. `grep`: Búsqueda de subcadenas o patrones en el workspace.
5. `edit`: Reemplazo exacto de cadenas con contexto (`old_string` único -> `new_string`).
6. `apply_patch`: Aplicación de parches quirúrgicos multi-bloque.
7. `write_file`: Creación de archivos nuevos (solo archivos no existentes).
8. `bash`: Ejecución de comandos de terminal en Windows (`cmd.exe` / `powershell`).
9. `web_search`: Búsqueda orgánica en internet vía DuckDuckGo Lite con los 5 mejores resultados (título, URL verificado y snippet).
10. `webfetch`: Descarga de páginas web públicas con cabeceras de navegador completo y conversión a Markdown.
11. `todowrite`: Gestión de tareas pendientes durante la ejecución agéntica.
12. `question`: Preguntas interactivas al usuario que bloquean la ejecución hasta recibir respuesta.
13. `skill`: Carga de instrucciones desde `.makora/skills/` o `.opencode/skills/`.
14. `repo_map_query`: Búsqueda de símbolos indexados mediante BM25.

---

## 4. Comandos de Verificación y Testing

Antes de dar por completado cualquier cambio, **SIEMPRE** ejecuta la suite de validación:

```powershell
# 1. Comprobación de tipos en TypeScript (Frontend)
npx tsc --noEmit

# 2. Pruebas unitarias de Frontend (Vitest)
npm test

# 3. Pruebas unitarias de Backend (Rust)
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 5. 🔨 Cómo Compilar los Instaladores de Producción (.exe y .msi)

Para compilar y empaquetar MakoraIDE para distribución en Windows:

### Requisitos Previos
* **Node.js 20+** y `npm`
* **Rust Toolchain (1.80+)** con target `x86_64-pc-windows-msvc`
* **WiX Toolset v3** (para generar `.msi`)
* **NSIS** (para generar `.exe` de instalación)

### Comando Único de Compilación Release
Ejecutar en la raíz del proyecto `makora-ide`:

```powershell
npm run tauri build
```

*(Alternativamente, se puede ejecutar el script helper [`build-installers.bat`](file:///c:/Users/lewis/Projects/makora-ide/build-installers.bat)).*

### 📍 Ubicación Exacta de los Artefactos Generados

Tras finalizar `tauri build`, los paquetes listos para distribución se generan en:

| Tipo de Paquete | Ruta en Disco | Descripción |
|---|---|---|
| **Instalador NSIS (.exe)** | [`src-tauri/target/release/bundle/nsis/MakoraIDE_0.1.0_x64-setup.exe`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/target/release/bundle/nsis/MakoraIDE_0.1.0_x64-setup.exe) | Instalador estándar ejecutable con asistente de instalación. |
| **Instalador WiX (.msi)** | [`src-tauri/target/release/bundle/msi/MakoraIDE_0.1.0_x64_en-US.msi`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/target/release/bundle/msi/MakoraIDE_0.1.0_x64_en-US.msi) | Paquete MSI corporativo para despliegue en Windows. |
| **Binario Standalone (.exe)** | [`src-tauri/target/release/makora.exe`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/target/release/makora.exe) | Binario ejecutable compilado sin instalador. |

---

## 6. Integración con MakoraAI (LLM Local en Windows)

* **Servidor Local:** Ollama corre de forma **nativa en Windows** (sin depender de WSL).
* **Endpoint:** `http://127.0.0.1:11434` / `http://localhost:11434`.
* **Preset del Modelo:** `makoraai:latest` (o `qwen3-coder:30b`, GGUF Q4_K_M ~18.5 GB).
* **Almacenamiento de Modelos en Windows:** `C:\Users\lewis\.ollama\models\`.
* **Gestión de VRAM (Perfil Gamer):**
  * Ollama descarga la VRAM de la GPU automáticamente tras 5 minutos de inactividad.
  * Para liberar inmediatamente el 100% de la VRAM de la GPU para videojuegos, cerrar Ollama desde el icono de la bandeja del sistema (*System Tray -> Quit Ollama*).

---

## 7. Invariantes Operativos y Reglas de Edición para Agentes

1. **Edición Quirúrgica:** NUNCA reescribas archivos completos si ya existen. Utiliza siempre ventanas de 3–5 líneas de anclaje contextual (`apply_patch` o `replace_file_content`).
2. **Contratos IPC y Tipos:**
   * Si modificas un comando en Rust (`src-tauri/src/`), asegúrate de que el tipo devuelto cumpla con `#[specta::specta]` y esté sincronizado en `src/types.ts` y `src/api.ts`.
3. **Internacionalización (i18n):**
   * Toda nueva cadena de texto que se añada a la interfaz DEBE registrarse en `src/i18n/types.ts` y en los 7 archivos de localización (`src/i18n/locales/*.ts`).
4. **Respeto a las Reglas de Eficiencia de Tokens:**
   * Los saludos o mensajes simples no deben disparar herramientas del sistema (`read_file`, `skill`, etc.).
   * Para búsquedas web sobre temas externos, usar siempre `web_search`.
