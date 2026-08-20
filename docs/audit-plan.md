# MakoraIDE — Plan de Análisis y Auditoría

Fecha: 2026-08-20. Documento vivo de referencia para la revisión integral del prototipo.

## 1. Objetivo y alcance

Auditar el estado real del prototipo MakoraIDE (Tauri 2 + React 19 + Rust) contra lo documentado, y verificar seguridad, calidad, correctitud, concurrencia y rendimiento. El entregable de cada fase es un checklist resuelto + accionables priorizados (P0–P3) que se incorporan a `docs/review.md` y `docs/roadmap.md`.

Alcance: `src-tauri/src/` (backend Rust), `src/` (frontend React/TS), `docs/` (documentación) y `package.json`/`Cargo.toml` (dependencias).

## 2. Estado actual (resumen de revisión)

- **Fase:** M3 completado. M2/M4/M6 parciales; M5/M7 no iniciados (ver `docs/roadmap.md`).
- **Repo:** rama `main`, working tree limpio. Último commit: `62ec4dc` (wire sanitization universal, multiagente por delegación, endurecimiento de estabilidad).
- **Backend:** 10 módulos Rust (`agent`, `gateway`, `token_engine`, `history`, `terminal`, `mcp`, `balance`, `multiagent`, `lib`, `main`).
- **Frontend:** modular por sesión (`sessionStore.ts`), i18n activo (`src/i18n/` con 7 locales), auto-router multiagente (`autoRouter.ts`), vault de credenciales (`vault.ts`), temas (`themes.ts`), split panes (`core/SplitPane.tsx`), diffs (`core/diff.ts`).
- **Tests:** suite Rust (`cargo test`) + 3 suites frontend (`src/__tests__/`: `autoRouter.test.ts`, `i18n.test.ts`, `sessions.test.ts`).

### Hallazgos de deriva documental (confirmados)

| # | Hallazgo | Severidad | Ubicación |
|---|---|---|---|
| D1 | `docs/decisions.md` omite ADR-012 a ADR-015 (referenciados en `CONTEXT.md` y `review.md`) | Media | `docs/decisions.md` |
| D2 | `docs/CODEBASE_INDEX.md` no lista `multiagent.rs`, `vault.ts`, `autoRouter.ts`, `defaults.ts`, `themes.ts`, `sessionStore.ts`, `core/`, `i18n/`, `__tests__/`, `assets/` | Alta | `docs/CODEBASE_INDEX.md` |
| D3 | `CODEBASE_INDEX.md` lista componentes ausentes: `AmbientCanvas3D.tsx`, `BetaAgreementModal.tsx`, `EditorPanel.tsx`, `OnboardingModal.tsx`, `WorkspaceTabBar.tsx`, `viewers/` | Media | `docs/CODEBASE_INDEX.md` |
| D4 | `CODEBASE_INDEX.md` declara stack Markdown `marked`/`prismjs`; real es `react-markdown` + `remark-gfm` | Media | `docs/CODEBASE_INDEX.md` |
| D5 | `04_PLAN_INTERNACIONALIZACION_I18N.md` planifica locales `.json`; implementados como `.ts` (7 locales) | Baja | `docs/04_PLAN_INTERNACIONALIZACION_I18N.md` |
| D6 | `CONTEXT.md` (08-19) no menciona i18n, `autoRouter.ts`, `vault.ts`, `core/`, `__tests__/` | Media | `CONTEXT.md` |

## 3. Plan de auditoría (fases)

### Fase 0 — Verificación mecánica (baseline, ejecutar primero)
- [ ] `npm run build` (tsc + vite) → 0 errores.
- [ ] `npm run test` (vitest) → 3 suites en verde.
- [ ] `cargo build` en `src-tauri/` → 0 errores.
- [ ] `cargo test` → suite Rust (históricamente 18 tests) en verde.
- [ ] `cargo clippy --all-targets` → 0 warnings P1+.
- [ ] `git status` limpio; `git log` coherente con ADR-021.
- **Criterio de salida:** baseline reproducible en máquina limpia (comandos en `CODEBASE_INDEX.md` §7).

### Fase 1 — Seguridad (prioridad máxima)
- [ ] Revalidar DPAPI/OS Keyring (`keyring` crate v3) y fallback `vault.ts`/SQLite Vault; confirmar migración legacy→Keyring (commit `9b64517`).
- [ ] Verificar CSP en `src-tauri/tauri.conf.json` y que ningún `unsafe-inline`/origen amplio se haya filtrado.
- [ ] Re-auditar `resolve_path` + `within()` contra path traversal (tests dedicados existentes; añadir casos `%2e%2e`, symlinks, rutas UNC).
- [ ] Auditar `run_bash` (PTY real): timeout 600s, kill-tree al cancelar, `CREATE_NO_WINDOW`, no persistencia de secretos en logs.
- [ ] Auditar aislamiento MCP (`mcp__server__tool`) y `spawn_blocking` (ADR-021) para no bloquear el hilo principal.
- [ ] Revisar sanitización de wire (`sanitize_history`/`sanitize_openai_wire`/`anthropic_turn`) contra inyección vía contenido de archivos.
- [ ] Escaneo de dependencias: `cargo audit` y `npm audit`.

### Fase 2 — Calidad de código y correctitud
- [ ] `cargo clippy` + revisión manual de `guard()` poison-safe en los 5 módulos con lock.
- [ ] Verificar cobertura de tests frontend (autoRouter, i18n, sessions) y añadir tests para `core/diff.ts` y `core/SplitPane.tsx` (sin cobertura actual).
- [ ] Confirmar contratos TS en `docs/contracts.md` vs `src/bindings.ts` (stub manual; regenerar con tauri-specta si procede).
- [ ] Revisar `MultiAgent`/`delegate_subagent` (ADR-020): briefing condensado, prefijo `sub:{rol}:`, metering integrado (`ChatUsage: AddAssign`).

### Fase 3 — Arquitectura, concurrencia y persistencia
- [ ] Probar 2+ sesiones concurrentes (stream en A, envío en B, cancelación aislada, borrado de sesión ocupada).
- [ ] Verificar `sessionStore.ts` (useSyncExternalStore) y enrutado de eventos por `chatId`.
- [ ] Auditar SQLite WAL: `busy_timeout`, auto-init, FNV-1a del `chatId`, cascade de checkpoints.
- [ ] Confirmar que `multiagent.rs` (delegación) no duplica historial ni system prompt por subagente.

### Fase 4 — Rendimiento y motor de tokens
- [ ] Validar log `[TOKEN_ENGINE] turn=… local=… api_in=… api_cached=… api_out=…` en una sesión de 10+ turnos.
- [ ] Medir `cache_read_ratio` (M4) y contraste conteo local vs `usage` real.
- [ ] Verificar `prune_tool_output` (últimos 6 resultados crudos; resto compactado) y `truncate()` con límite de línea.
- [ ] Confirmar perfiles Eco/Balanced/Deep (ADR-015) y estimador de coste en `balance.rs`.

### Fase 5 — Dependencias y entorno
- [ ] `cargo audit` y `npm audit` (vulnerabilidades conocidas).
- [ ] Verificar versiones pineadas (`tauri-specta =2.0.0-rc.25`) y plan de migración a estable.
- [ ] Revisar dependencias sin uso aparente (`three`, `pdfjs-dist`, `lucide-react`) y su impacto en bundle.

### Fase 6 — Reconciliación documental (ejecutar al cierre)
- [ ] Completar ADR-012 a ADR-015 en `docs/decisions.md` (aplicar_patch/read_file_range, Provider Shield, evicción de tools, coste local + perfiles).
- [ ] Sincronizar `docs/CODEBASE_INDEX.md`: añadir `multiagent.rs`, `vault.ts`, `autoRouter.ts`, `defaults.ts`, `themes.ts`, `sessionStore.ts`, `core/`, `i18n/`, `__tests__/`; corregir stack Markdown y componentes.
- [ ] Actualizar `CONTEXT.md` con i18n, auto-router, vault y tests.
- [ ] Actualizar `docs/review.md` con los resultados P0–P3 de esta auditoría.
- [ ] Actualizar `docs/roadmap.md` si algún milestone cambia de estado.

## 4. Priorización y criterios de salida

- **P0 (bloquear antes de M4/M5):** Fase 1 completa sin hallazgos críticos.
- **P1:** Fase 0 + Fase 3 (correctitud/concurrencia) verdes.
- **P2:** Fase 2 + Fase 4 (calidad/rendimiento) con accionables registrados.
- **P3:** Fase 5 + Fase 6 (dependencias/documentación) — reconciliación documental siempre al cierre.

**Criterio global de cierre:** baseline reproducible, cero vulnerabilidades P0/P1 abiertas, documentación sincronizada con el código (sin D1–D6), y accionables restantes trazados en `docs/review.md`.
