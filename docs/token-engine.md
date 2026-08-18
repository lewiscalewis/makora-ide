# MakoraIDE — Motor de eficiencia de tokens (diseño)

Fecha: 2026-08-18. Este es el diferenciador del producto. Evidencia y cifras cacheadas en `docs/research/token-engine.md`.

## 1. Tesis

La eficiencia de tokens no es una feature, es una propiedad transversal: TODA request pasa por el motor. Eficiencia = (calidad de razonamiento preservada) × (tokens mínimos). El motor decide QUÉ entra al contexto, CÓMO se ordena, QUÉ modelo/esfuerzo atiende, QUÉ se cachea y CÓMO se mide.

## 2. Componentes

### 2.1 TokenCounter
- Conteo local exacto: tiktoken-rs (o200k_base, cl100k_base) para OpenAI; HF tokenizers para Llama/Gemini/Mistral.
- Fallback adaptativo: chars/4 + regresión calibrada con el `usage` real de cada request.
- API: `count(text, model)`, `budget_check`, `truncate_to_budget(text, budget, keep_parse_valid)`.
- El truncado NUNCA parte símbolos sintácticos: corta en fronteras de función/clase vía tree-sitter.

### 2.2 ContextComposer (ensamblador con presupuesto)
- Presupuesto total = min(context_window × 0.75, budget_usuario). El 0.75 reserva espacio para razonamiento y salida.
- Cuotas por componente, adaptativas por clase de tarea:

| Componente | Default | Código pesado | Debugging |
|---|---|---|---|
| System + reglas | 5% | 4% | 3% |
| Definiciones de tools | 8% | 8% | 10% |
| Memoria / rules | 4% | 4% | 4% |
| Archivos / código | 45% | 55% | 35% |
| Historial | 30% | 20% | 40% |
| Repo-map | 8% | 9% | 8% |

- Si un componente excede su cuota → reducción en cascada: (1) comprimir, (2) truncar con validez sintáctica, (3) resumir, (4) descartar dejando constancia explícita ("N archivos omitidos por presupuesto").
- **Regla de prefijo estable (caché):** system → rules → tools/schemas → memoria → repo-map → archivos → historial reciente → dinámico al final. Los bloques estáticos NUNCA se reordenan entre turnos; los cambios que invalidarían caché se agrupan en el mismo turno.

### 2.3 ContextCompressor
- **Compactación jerárquica** (patrón Claude Code):
  - Trigger: historial > 60% de su cuota, o fin de sesión.
  - Proceso: (1) archivar transcript completo a SQLite; (2) sumario que conserva decisiones de arquitectura, bugs abiertos, comandos/idempotencia y estado de cada archivo tocado; descarta tool outputs crudos; (3) conservar los últimos 5–8 archivos accedidos como contexto fresco; (4) insertar ítem `summary` + `CompactBoundary`; (5) la siguiente request parte de system + rules + sumarios + historial reciente → cache hit casi total.
  - Ahorro: 80–95% del historial viejo.
- **Sub-agentes destiladores:** exploración (grep/glob/tests) en sub-agente con contexto propio (10–50k tokens) que devuelve 1–2k de hallazgos con referencias `archivo:línea`. Ahorro: 60–80% del contexto de exploración.
- **LLMLingua-2** (fase experimental): solo bloques no-código (logs, outputs de tests, docs). NUNCA código.
- **Limpieza de tool results:** tras N turnos, resultados crudos → "tool X → resumido en ítem Y".

### 2.4 HistoryManager
- Ventana deslizante + sumarios; pruning configurable (últimos N ítems o presupuesto de tokens).
- Reutilización de razonamiento: `previous_response_id` (OpenAI) para no re-razonar; `reasoning.context=current_turn` en flujos largos.
- Resume por checkpoint: al retomar se inyecta "estado: ver checkpoint N" en lugar del transcript completo.

### 2.5 CacheLayer
- **Caché semántica** (fastembed-rs): embedding de query + contexto hasheado; umbral de similitud conservador (precisión > recall: un falso hit es peor que un miss); TTL 5–15 min; invalidación por hash de archivos editados referenciados en la entrada.
- **Dedup con simhash** de prompts casi idénticos antes de emitir.
- **Caché de respuestas exactas** para tareas deterministas (listar símbolos, error conocido).
- SOLO tareas de lectura (nunca mutadoras). Métricas: hit ratio, ahorro $, falsos positivos reportados por usuario.

### 2.6 ToolEfficiency
- **Definiciones mínimas (progressive discovery):** solo tools relevantes al paso actual. Si el presupuesto aprieta: lista de nombres + descripción de 1 línea; schema completo bajo demanda (`tool_request`).
- **Resultados comprimidos:** cap por tool (p. ej. 2k tokens), truncado inteligente, formato canónico `path:line → contenido`.
- Read-only en paralelo (1 turno = 1 request); mutadoras secuenciales con aprobación.
- **Structured outputs** (JSON Schema estricto) para acciones de máquina (planes, diffs): elimina retries de parseo y prosa.

### 2.7 OutputGovernor
- Clases de tarea → esfuerzo de razonamiento (policy configurable):

| Clase | Esfuerzo | Modelo |
|---|---|---|
| Resumir / renombrar / clasificar | none/low | local (Ollama) |
| Refactor simple, tests | low/medium | tier Haiku/Sonnet o gpt-5.5 low |
| Diseño, debugging difícil | medium/high | tier Opus/Sonnet o gpt-5.6 |

- `max_output_tokens` como cota dura (reservar ≥25k para reasoning en modelos reasoning).
- Routing automático por clasificador local (fastembed) de la tarea.
- Stop temprano: heurísticas de fin de respuesta en streaming (evita tokens de relleno, no corta razonamiento).

### 2.8 Metering & Optimizer
- Cada request → fila en `requests`: in/cached/write/out/reasoning, coste (tarifas por modelo cacheadas en config), latencia, hit de caché, cuotas aplicadas.
- Dashboard: coste por sesión/día/proyecto; eficiencia del prefijo (`cache_read / input`); **ahorro del motor vs "línea base ingenua"** (mismo contexto sin motor), estimado.
- Optimizer: sugiere cambios de policy (esfuerzo, TTL, cuotas) con proyección de ahorro.
- **Perfiles:** Máxima eficiencia / Equilibrado / Máxima calidad → mapean a parámetros concretos.

## 3. KPIs del motor

- `cache_read_ratio` = cached / (cached + uncached_input) → objetivo > 0.7 en sesiones largas.
- `compaction_ratio` = historial completo / contexto enviado tras compactar.
- `cost_per_resolved_task` = $ por tarea completada (eval suite).
- `reasoning_share` = reasoning / output → detecta tareas sobre-esforzadas.
- `semantic_hit_rate` y `false_positive_rate`.
- **Calidad:** eval suite de tareas (corregir bug, refactor, tests, exploración) — la eficiencia no puede bajar el pass rate.

## 4. Invariantes

1. Nunca enviar archivos completos si hay presupuesto insuficiente: repo-map primero.
2. Nunca truncar a mitad de símbolo sintáctico.
3. Nunca compactar en medio de un turno con streaming activo.
4. Nunca cachear respuestas de tareas mutadoras (solo lecturas puras).
5. El usuario ve siempre el desglose exacto de tokens y coste del turno.
6. Toda técnica nueva entra tras medir su delta en la eval suite (no por fe).

## 5. Orden de implementación

M2: contador + composer + repo-map → M4: caché de prefijo + compactación → M5: caché semántica + offload local → M6: optimizador + evals. (Ver `docs/roadmap.md`.)
