# Investigación de stack UI — IDE de escritorio agéntico

Fecha de consulta: 2026-08-18
Objetivo: elegir shell de escritorio (Windows primero, luego macOS/Linux), motor de edición y capa de integración LSP/parsing para un IDE orientado a desarrollo agéntico con IA. Core en Rust (contexto/tokens/herramientas). Frontend: editor, chat, diffs, dashboards.

## (a) Tabla comparativa de frameworks

| Criterio | Tauri 2 | Electron | gpui (Zed) | egui | Flutter desktop |
|---|---|---|---|---|---|
| Versión/estado | 2.x estable (v1 archivada; web v2.tauri.app) | 43.4.0 (Chromium 150, Node 24) | Estable, en producción en Zed | Activo, "interfaces aún en flujo, breaking changes" | 3.47, estable para desktop |
| Lenguaje UI | HTML/CSS/JS (cualquier framework) | HTML/CSS/JS | Rust (retained mode, GPU) | Rust (immediate mode) | Dart (render propio/Impeller) |
| Engine de render | WebView del SO (WebView2/WebKit/WKWebView vía WRY) | Chromium embebido | Render propio GPU | wgpu/glow | Motor Flutter |
| Licencia | MIT | MIT | Zed: GPL-3.0 (gpui marcado Apache-2.0) | MIT OR Apache-2.0 | BSD-3 |
| Tamaño binario (app vacía, Win x64) | ≈3 MB | ≈364 MB | n/d (Zed completo: cientos de MB) | pequeño (Rust nativo) | ≈27 MB |
| RAM total procesos (Release) | Win: ≈313 MB; macOS: ≈96 MB; Linux: ≈94 MB | Win: ≈260 MB; macOS: ≈347 MB; Linux: ≈631 MB | bajo (nativo, sin WebView) | muy bajo | Win Release ≈65 MB |
| Delta memoria libre (Release) | Win ≈206 MB; macOS ≈73 MB; Linux ≈15 MB | Win ≈87 MB; macOS ≈89 MB; Linux ≈75 MB | n/d | n/d | Win ≈43 MB |
| Arranque (Release) | Win ≈732 ms; macOS ≈1636 ms | Win ≈202 ms; macOS ≈318 ms | muy rápido (nativo) | muy rápido | Win ≈107 ms |
| Build (app vacía, CI) | ≈256 s (compila Rust) | ≈7,7 s | compilación Rust larga | media | ≈43 s |
| Plugins oficiales | fs, dialog, shell, updater, store, sql, http, websocket, process, window-state, global-shortcut, notification, logging, etc. (~29) | autoUpdater, dialog, menu, crashReporter, etc. (API base, npm para el resto) | n/a (monolito) | n/a (crates 3rd party) | pub.dev (desktop: menos maduro) |
| IPC Rust<->JS | Comandos/eventos propios + ACL/capabilities; typed vía tauri-specta | ipcMain/ipcRenderer (Node directo) | n/a (mismo lenguaje) | n/a | platform channels (Dart<->C++) |
| Estrellas GitHub | 109,9k | 122,3k | 88,8k (Zed) | 30,1k | 178,2k |
| Casos IDE/editor | Cursor/VS Code son Electron; hay IDEs Tauri emergentes | VS Code, Cursor, Windsurf, Claude Desktop, Slack, Figma | Zed | Rerun Viewer, dashboards | apps desktop genéricas |

### Lectura crítica de benchmarks

Fuente principal: Elanis/web-to-desktop-framework-comparison (CI, app vacía, margen de error; leer como comparación entre frameworks en la misma máquina):

- Tauri es drásticamente menor en disco (~3 MB vs ~364 MB en Windows) porque usa el WebView del SO en vez de empaquetar Chromium.
- En RAM, Tauri gana con claridad en macOS (~96 vs ~347 MB) y Linux (~94 vs ~631 MB). En Windows el resultado se invierte en el benchmark de CI (313 vs 260 MB total de procesos): WebView2 lanza múltiples procesos y en CI comparte runtime con Edge; además Tauri suma el overhead del proceso Rust. En máquinas Windows limpias la ventaja de Tauri tiende a ser menor que en macOS/Linux; hay que validarlo con benchmark propio.
- Electron gana en arranque en frío (~202 ms vs ~732 ms) y sobre todo en tiempo de build (~8 s vs ~256 s, por la compilación Rust).
- El arranque de Tauri en Linux en ese benchmark (≈30 s) es un outlier de CI (página propia, disco compartido); no debe tomarse como real.

### Conclusión del bloque

Para un IDE: Tauri 2 permite reutilizar el ecosistema web (Monaco/CM6, React, diff views) con un core Rust integrado en el mismo binario y ACL de seguridad para herramientas del agente. Electron es el camino probado (VS Code/Cursor/Windsurf) a costa de peso/RAM. gpui es el mejor rendimiento absoluto pero obliga a reimplementar todo el UI en Rust (esfuerzo de años, licencia GPL contagiosa salvo gpui Apache-2.0). egui no es apto para un editor de código profesional (immediate mode, layout complejo, widgets limitados). Flutter tiene buen rendimiento pero no tiene motores de edición comparables a Monaco/CM6 y aislaría el frontend del core Rust.

## (b) Análisis del motor de edición

### Monaco (microsoft/monaco-editor, MIT, v0.56.0, 46,6k stars)

- Es el editor de VS Code extraído de sus fuentes; probado a escala por millones de desarrolladores.
- Arquitectura: models por archivo (URI), editors como vistas, providers (completion, hover) mapeables a LSP, disposables.
- Tokenización Monarch (regex) por defecto; gramáticas TextMate vía monaco-tm (vscode-oniguruma + vscode-textmate). Sin soporte nativo de Tree-sitter.
- Usa web workers para servicios de lenguaje; exige servirse sobre http(s) o protocolo custom (no file://). En Tauri se sirve vía el asset protocol integrado, sin problema, pero hay que verificar el arranque de workers en WebView2.
- No soporta móvil; poco modular (npm package grande: el minificado ronda varios MB); API pública = monaco.d.ts, el resto es privado y puede romper.
- LSP: monaco-languageclient (TypeFox, MIT) lo conecta a language servers reales: cliente vía vscode-ws-jsonrpc (WebSocket), alineado con monaco-editor 0.56, vscode 1.129.1 y @codingame/monaco-vscode-editor-api 36.0.0. Ejemplos oficiales: JSON, pyright (Python), clangd (wasm), Java (eclipse.jdt.ls), Langium. Existe además monaco-lsp-client dentro del repo de Monaco.

### CodeMirror 6 (codemirror.net, MIT, @codemirror/view 6.43.9)

- Editorial por módulos/extensiones; 8,47M descargas semanales del paquete view vs 4,26M de monaco-editor.
- Parsing completo e incremental con Lezer (árbol sintáctico por lenguaje), comparable a Tree-sitter; los paquetes de lenguaje oficiales (Rust, Python, JS/TS, C++, Java, Go, PHP, SQL, YAML, etc.) incluyen gramática Lezer + integraciones (autocompletado, folding, lint).
- Anunciado explícitamente para "mantenerse responsivo incluso en documentos enormes y líneas largas" (demo "million"); con virtualización de viewport muy superior a Monaco en archivos grandes (Monaco degrada con líneas muy largas/minificadas).
- Features completas: autocompletion, folding, search/replace, linting, theming, collaborative editing, undo, multi-cursor, i18n, accesibilidad, mobile.
- LSP: no hay equivalente oficial a monaco-languageclient; se integra con language servers vía clientes genéricos (ej. codemirror-lsp, o adaptador propio sobre vscode-languageserver-protocol). Mayor trabajo de integración que Monaco.
- Usuarios de peso: Obsidian, Replit, Sourcegraph, Overleaf, Val Town.

### Tree-sitter (MIT, runtime C11 sin dependencias)

- Generador de parsers + parsing incremental; rápido para re-parsear en cada keystroke; robusto ante errores de sintaxis.
- Bindings oficiales: C, Rust, Go, JS/Wasm, Python, Java, Swift, Kotlin, C#, etc. Crates Rust: tree-sitter (bindings) + tree-sitter-<lang> para ~30 lenguajes del upstream.
- Rol en este proyecto: no como editor, sino como capa de análisis en el core Rust — estructura del código para chunking de contexto por símbolo, edición sintáctica por el agente, indexado, y highlighting server-side. Es la misma pieza que usan Zed (sus creadores), neovim y Atom.
- Lezer (de CM6) cumple un rol similar dentro del editor web; ambos pueden convivir: Tree-sitter en Rust para el agente, Lezer/Monarch en el frontend para pintado.

### Decisión de motor

- Si prioridad = velocidad de desarrollo y fidelidad LSP: Monaco + monaco-languageclient (camino VS Code, maduro).
- Si prioridad = rendimiento con archivos grandes/largos y tamaño/bundle y modularidad: CodeMirror 6, asumiendo el costo de integrar LSP a mano.
- Recomendación para un IDE agéntico que mostrará diffs de archivos completos y ediciones masivas: CodeMirror 6 como editor principal (licencia MIT, tree parsing real con Lezer, comportamiento conocido con archivos enormes) + Tree-sitter en el core Rust para el agente. Monaco queda como opción si el equipo prefiere el ecosistema VS Code (vscode-ws-jsonrpc + monaco-vscode-api permiten reusar extensiones LSP).

## (c) Riesgos y requisitos Windows

### Requisitos de build Tauri en Windows (oficiales)

- Microsoft C++ Build Tools con workload "Desktop development with C++".
- Rust toolchain MSVC (rustup default stable-msvc).
- WebView2 Runtime: preinstalado en Windows 10 1803+; en máquinas viejas instalar Evergreen Bootstrapper (o empaquetar el runtime fijo en el instalador).
- VBSCRIPT habilitado solo si se generan instaladores MSI (deprecado por Microsoft: riesgo futuro).
- Node.js solo si el frontend usa JS (sí, en nuestro caso).
- macOS: Xcode/CLT; Linux: webkit2gtk-4.1 (riesgo de fragmentación en distros).

### Riesgos identificados

1. Consistencia de WebView2 en Windows: los usuarios con Edge/WebView2 desactualizado o políticas de empresa pueden ver bugs de render distintos a los de desarrollo; hay que fijar una versión mínima de WebView2 y probar workers (Monaco usa web workers).
2. RAM en Windows: el benchmark CI muestra que Tauri+WebView2 no siempre gana a Electron en Windows; si la ligereza es argumento de venta, hay que medir en Windows real antes de comprometerse (riesgo de expectativas).
3. Arranque y build lentos: Tauri arranca más lento que Electron en frío (WebView2 + proceso Rust) y cada build de CI recompila Rust (~256 s en CI limpio). Mitigar con cachés sccache y release profiles optimizados (lto, strip, opt-level "s").
4. Workers de Monaco bajo el asset protocol de Tauri: oficialmente los workers requieren http(s); el protocolo custom de Tauri funciona pero exige configuración de CSP y verificación temprana (riesgo de bloqueo temprano del proyecto).
5. Licencia si se contemplara gpui: Zed es GPL-3.0 (solo gpui marcado Apache-2.0); reutilizar el editor de Zed implicaría GPL o licencia comercial con Zed Industries.
6. LSP de alto rendimiento en WebView: los language servers deben correr como procesos sidecar (Tauri: shell/sidecar) con vscode-ws-jsonrpc hacia el frontend; el socket no debe pasar por el core si no es necesario (latencia).

### Recomendaciones de mitigación

- Spike técnico semana 1: app Tauri vacía + Monaco y CM6 cargando un archivo de 10 MB, medir RAM/arranque/latencia de tipeo en Windows 10/11 reales (máquina propia, no CI).
- Definir protocolo IPC Rust<->JS con tauri-specta (typesafe, eventos y comandos tipados desde Rust a TS) desde el día 1.
- Usar plugins oficiales: fs (workspace), shell/process (language servers, herramientas del agente), store (config persistente), updater (distribución), dialog, window-state (layout del IDE).
- CSP estricta + capabilities por ventana (editor vs settings) para contener las acciones del agente.

## (d) Recomendación final

**Shell: Tauri 2 (Rust core + frontend web).**
- Justificación: (1) el core agéntico (contexto/tokens/herramientas) vive en Rust en el mismo proceso sin doble runtime JS; (2) plugins oficiales cubren todo lo que un IDE necesita (fs, shell, process, updater, store, dialog, window-state); (3) modelo de seguridad con ACL por comando es superior para un agente que ejecuta herramientas; (4) tamaño de distribución ~2 órdenes de magnitud menor que Electron; (5) frontend web = acceso directo a CodeMirror/Monaco, React y librerías de diffs/dashboards; (6) proyecto maduro (v2 estable, 110k stars, activo en 2026).
- Electron se descarta por peso y porque duplicaría runtime; quedaría como plan B solo si el spike de WebView2 fallara. gpui/egui/Flutter se descartan por costo de reimplementación del editor o falta de ecosistema de edición.

**Editor: CodeMirror 6 (con Lezer), con Monaco como alternativa de respaldo.**
- CM6 gana por rendimiento en archivos grandes, bundle modular y parsing real; el costo de integrar LSP manualmente se asume en el core Rust, que ya hablará con los language servers (sidecars) y repartirá los resultados al frontend por IPC tipado (specta).
- Si se priorizara velocidad de integración LSP, Monaco + monaco-languageclient es el camino con menos fricción (demo pyright/json funcionando hoy).

**Parsing agéntico: Tree-sitter en el core Rust** para chunking por símbolos, índice de código y ediciones sintácticas del agente, complementario al pintado del frontend.

**Stack propuesto**: Tauri 2 (Windows-first, luego macOS/Linux) · React/TS + CodeMirror 6 en el frontend · Rust core con tauri-specta IPC · language servers como sidecars (vscode-languageserver-protocol) · Tree-sitter en el core · plugins: fs, shell, process, store, updater, dialog, window-state.

## (e) Fuentes (consultadas 2026-08-18)

1. Tauri 2.0 — https://v2.tauri.app/ y https://tauri.app/
2. Tauri prerequisites (MSVC + WebView2 + VBSCRIPT) — https://v2.tauri.app/start/prerequisites/
3. Tauri App Size (optimización binario, removeUnusedCommands) — https://v2.tauri.app/concept/size/
4. Lista de plugins oficiales Tauri — https://v2.tauri.app/plugin/ (dialog, fs, shell, store, updater, window-state, process, sql…)
5. Benchmark comparativo web-to-desktop (Electron/Tauri/Wails/Flutter; tamaño, RAM, arranque, build) — https://github.com/Elanis/web-to-desktop-framework-comparison
6. Electron (43.4.0, Chromium 150, Node 24; apps: VS Code, Claude, Slack, Figma) — https://www.electronjs.org/
7. Zed / gpui — https://zed.dev/ y https://github.com/zed-industries/zed (licencia GPL-3.0, gpui Apache-2.0)
8. egui / eframe — https://github.com/emilk/egui y https://www.egui.rs/
9. Flutter desktop (3.47) — https://docs.flutter.dev/platform-integration/desktop
10. Monaco Editor (MIT, v0.56.0) — https://microsoft.github.io/monaco-editor/ y https://github.com/microsoft/monaco-editor
11. CodeMirror 6 (MIT, features y lenguajes) — https://codemirror.net/
12. Tree-sitter (parsing incremental, bindings Rust) — https://tree-sitter.github.io/tree-sitter/
13. monaco-languageclient (TypeFox, LSP sobre WebSocket, MIT) — https://github.com/TypeFox/monaco-languageclient
14. tauri-specta / specta (IPC tipado Rust->TS) — https://github.com/specta-rs/specta y https://github.com/specta-rs/tauri-specta
15. Paquetes npm (descargas/licencias): https://www.npmjs.com/package/monaco-editor y https://www.npmjs.com/package/@codemirror/view
