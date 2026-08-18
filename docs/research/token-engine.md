# Token Engine: eficiencia de tokens para un IDE agéntico

Investigación técnica. Fecha: 2026-08-18. Objetivo: máxima eficiencia de tokens (entrada/salida) sin degradar razonamiento.

## (a) Tabla de técnicas: ahorro estimado vs coste

| # | Técnica | Ahorro estimado | Coste/riesgo | Fuente |
|---|---------|-----------------|--------------|--------|
| 1 | Prompt caching prefijo (OpenAI) | 90% en input cacheado (0.1x); GPT-5.6+: +25% en escritura, TTL 30 min | Cambios en prefijo invalidan; mínimo 1.024 tokens; ~15 req/min por key | OpenAI |
| 2 | Prompt caching (Anthropic) | 90% en lectura (0.1x); escritura 1.25x (5m) o 2x (1h) | Mínimo 512–4.096 tokens según modelo; TTL 5 min/1 h | Anthropic |
| 3 | Batch API (OpenAI) | 50% de descuento en toda la request | Latencia hasta 24 h; sin streaming | OpenAI |
| 4 | Compaction (compactación de conversación) | 80–95% del historial viejo fuera del contexto (sumario 1–2k tokens) | Riesgo de pérdida de decisiones sutiles; tunear recall primero | Anthropic eng |
| 5 | Sub-agentes con resumen destilado | Sub-agente explora 10–50k tokens y devuelve solo 1–2k al agente principal | Orquestación extra; latencia | Anthropic eng |
| 6 | Limpieza de resultados de tools (tool result clearing) | Recupera input tokens de tools viejas; forma más ligera de compaction | Puede perder contexto si se hace demasiado pronto | Anthropic eng |
| 7 | Notas estructuradas / memoria en archivos (NOTES.md, CLAUDE.md) | Evita reinyectar contexto ya pagado; persistencia entre sesiones | El agente debe aprender a leerlas | Anthropic eng |
| 8 | Retrieval just-in-time (identificadores + grep/glob en vez de volcar archivos) | Reduce contexto inicial 50–90% frente a volcar todo el repo | Latencia de exploración; requiere buenas tools | Anthropic eng |
| 9 | Compresión de prompts (LLMLingua/LLMLingua-2) | Hasta 20x en prompts largos (paper); 3–10x realista sin degradación | Modelo local pequeño; riesgo de pérdida de información crítica en código | Microsoft |
| 10 | Caché semántico local (embeddings + similitud) | 100% de ahorro en hits (no se llama al API); GPTCache anuncia 10x coste / 100x velocidad | Falsos positivos; invalide por hash de archivos | GPTCache |
| 11 | Reasoning effort bajo/none para tareas simples | Hasta 80–90% menos reasoning tokens (billados como output) | Degradación en tareas difíciles; elegir por evals | OpenAI |
| 12 | max_output_tokens + budget de thinking (Anthropic) | Cota dura del gasto de salida; OpenAI recomienda reservar ≥25k tokens para reasoning | Respuestas `incomplete` si se queda corto | OpenAI/Anthropic |
| 13 | Structured outputs (json_schema estricto) | Elimina retries por JSON inválido (1 retry = +100% coste de esa llamada); salida mínima sin prosa | +latencia en primera llamada por schema; JSON añade sintaxis | OpenAI |
| 14 | Tokenizadores locales exactos (tiktoken-rs / HF tokenizers) | Permite presupuestar/truncar sin llamar al API; medición gratis | Divergencias menores con el conteo real del API | tiktoken-rs/HF |
| 15 | Modelos locales para tareas baratas (Ollama, fastembed-rs) | Coste marginal ~0 en tareas de bajo nivel (embeddings, re-ranking, resúmenes menores) | Hardware local; calidad inferior | Ollama/fastembed-rs |

## (b) Cifras clave: cachés y precios

### OpenAI Prompt Caching
- Caché automática para prompts >=1.024 tokens (gpt-4o y posteriores). GPT-5.6+: mínimo estricto 1.024; modelos previos 1.024–2.048 (los hits van en incrementos de 128 tokens).
- Lectura de caché: **0.1x** de la tarifa de input no cacheado (90% de descuento).
- GPT-5.6+ (p. ej. gpt-5.6): escritura de caché **1.25x** la tarifa de input (no es cargo adicional; es la tarifa total del token escrito). TTL **30 minutos** (único valor soportado en `prompt_cache_options.ttl`), se refresca con cada reuso. Breakpoints explícitos: `prompt_cache_breakpoint: {mode: "explicit"}`; modos `implicit` (default) / `explicit`; hasta 4 escrituras nuevas por request; lecturas consideran hasta los últimos 50 breakpoints.
- Modelos anteriores (gpt-5.5, gpt-5.4, gpt-5.2, gpt-5.1*, gpt-4.1…): sin cargo de escritura; retención en memoria 5–10 min de inactividad (máx. 1 h); retención extendida de **24 h** vía `prompt_cache_retention` (soportada en gpt-5.5/-pro, 5.4, 5.2, 5.1 family, 5, codex, 4.1).
- `prompt_cache_key` mejora el routing; mantener ~15 req/min por key. Métricas: `cached_tokens` y `cache_write_tokens` en `usage.input_tokens_details` (Responses) / `prompt_tokens_details` (Chat Completions).
- Regla de oro: contenido estático (instrucciones, tools, schemas, ejemplos) al principio; contenido variable al final. Cambiar tools/schemas/orden invalida el prefijo.

### Anthropic Prompt Caching
- Multiplicadores: escritura 5 min = **1.25x** input; escritura 1 h = **2x** input; lectura = **0.1x** input. Multiplicadores se apilan con el descuento de Batch API.
- Precios de ejemplo (por MTok): Claude Opus 5: input $5 / write-5m $6.25 / write-1h $10 / read $0.50 / output $25. Claude Sonnet 5: $2 / $2.50 / $4 / $0.20 / $10. Claude Haiku 4.5: $1 / $1.25 / $2 / $0.10 / $5.
- Mínimos cacheables: 512 tokens (Opus 5, Fable 5, Mythos 5); 1.024 (Opus 4.8, Sonnet 5/4.6/4.5); 2.048 (Mythos Preview, Opus 4.7); 4.096 (Opus 4.6/4.5, Haiku 4.5).
- `cache_control: {type: "ephemeral"}` por bloque (máx. 4 breakpoints) o automático a nivel top-level; ventana de lookback de 20 bloques; las escrituras solo ocurren en breakpoints. Jerarquía de invalidación: tools -> system -> messages.
- Métricas: `cache_creation_input_tokens`, `cache_read_input_tokens`; `input_tokens` = solo tokens tras el último breakpoint.

### OpenAI Batch API
- **50% de descuento** sobre el API síncrono, pool de rate limits separado, ventana de 24 h. Hasta 50.000 requests/batch, archivo 200 MB, 2.000 batches/h. Endpoints: /v1/responses, /v1/chat/completions, /v1/embeddings, /v1/moderations, /v1/images/*, /v1/videos. Útil para: resúmenes en segundo plano, indexación/embeddings de repos, evals, limpieza de contexto.

### Reasoning (OpenAI) y thinking budgets (Anthropic)
- `reasoning.effort`: `none`, `minimal`, `low`, `medium` (default en gpt-5.5), `high`, `xhigh`, `max` — dependientes de modelo. Los reasoning tokens se facturan como output tokens y ocupan contexto; cientos hasta decenas de miles por llamada. `max_output_tokens` limita reasoning+visible; OpenAI recomienda reservar >=25.000 tokens para reasoning al empezar.
- Persistir razonamiento entre turnos con `previous_response_id` (o `reasoning.context: all_turns` en gpt-5.6) evita re-razonar desde cero; `current_turn` reduce contexto renderizado en flujos largos.
- Anthropic: thinking con `budget_tokens` (modo extendido) acota explícitamente el gasto de razonamiento; cambiar el thinking config invalida caches de messages.

### Tokenizadores
- tiktoken-rs (MIT, Rust): encodings o200k_base (GPT-5, o1/o3/o4, gpt-4o, gpt-4.1, codex), cl100k_base (gpt-4, gpt-3.5, text-embedding-3), p50k, r50k; helper `get_chat_completion_max_tokens`; singletons para evitar reinicialización. Contextos de referencia: gpt-5.4: 1.050.000; gpt-4.1: 1.047.576; gpt-5: 400.000; o1/o3: 200.000; gpt-4o: 128.000.
- HF tokenizers (Apache-2.0, Rust): BPE/WordPiece/Unigram; <20 s para tokenizar 1 GB de texto en CPU de servidor; bindings Rust/Python/Node/Ruby; para Llama/Gemini/Mistral (no OpenAI).

### Structured outputs
- `text.format: {type: "json_schema", strict: true, schema: …}` garantiza adherencia al schema: elimina validación/retries (cada retry duplica el coste de la llamada) y prosa innecesaria. El schema se procesa una vez (latencia extra solo en la primera request con ese schema). Ojo: el schema forma parte del prefijo cacheable; cambiarlo invalida caché.

### Compresión de prompts
- LLMLingua (EMNLP'23): hasta **20x** de compresión con pérdida mínima usando un LM pequeño (GPT2-small/LLaMA-7B); ejemplo del README: 2.365 -> 211 tokens (11.2x, "$0.1 ahorrado en GPT-4"). LongLLMLingua (ACL'24): RAG +21.4% usando 1/4 de tokens. LLMLingua-2 (ACL Findings'24): encoder nivel BERT destilado de GPT-4, 3x–6x más rápido, task-agnostic (microsoft/llmlingua-2-*-meetingbank en HF). Survey de referencia: arXiv:2410.12388 (hard vs soft prompt compression).

### Caché semántico
- GPTCache (8.2k stars, MIT): embedding + búsqueda de similitud en vector store (FAISS, Milvus, Qdrant, Chroma, hnswlib…); coincidencia exacta y similar; evicción LRU/FIFO/LFU/RR; `temperature` controla skip de caché (2 = siempre API, 0 = siempre consulta caché); métricas: hit ratio, latency, recall; eslogan oficial: "10x costes, 100x velocidad". Esquema propio del IDE: TTL corto + invalidación por hash/contenido de archivos editados (editar un archivo invalida entradas cuyo contexto lo incluya) + simhash para dedup de prompts largos.

### Modelos locales
- Ollama (179k stars, MIT, Go): inferencia local vía llama.cpp; API REST en :11434; integración con OpenCode/Claude Code/Codex; coste marginal ~0 (solo hardware). Útil para: resúmenes menores, renombrados, embeddings, clasificación de intención.
- fastembed-rs (Apache-2.0, Rust, síncrono sin Tokio): embeddings ONNX locales (bge-small-en-v1.5 384-dim por defecto, all-MiniLM-L6-v2, jina-v2-code para código, nomic, Qwen3-Embedding), sparse (SPLADE), re-ranking (bge-reranker-base) e imágenes (CLIP); caché de modelos en disco. Base perfecta para caché semántico y retrieval local sin coste de API.

## (c) Top 10 priorizado para el prototipo

1. **Motor de ensamblado de contexto con prefijo estable (impacto ALTO).** Orden canónico: system+reglas+tools+schema primero, contenido variable después; exponer `prompt_cache_key` por sesión/archivo y breakpoints explícitos (OpenAI) o `cache_control` (Anthropic). Ahorro: ~90% del input recurrente en cada turno.
2. **Medición local de tokens con tiktoken-rs + HF tokenizers (ALTO).** Conteo local exacto, presupuesto por sesión, truncado inteligente sin llamar al API. Ahorro: 0 directo, habilita todo lo demás; coste ~0.
3. **Compactación de contexto con preservación de decisiones (ALTO).** Al acercarse al límite, sumario que conserve decisiones de arquitectura, bugs abiertos e implementaciones; descartar outputs de tools; conservar los últimos 5 archivos accedidos (patrón Claude Code). Ahorro: 80–95% del historial viejo.
4. **Rutas de modelo por tarea + reasoning effort (ALTO).** Tareas baratas (resúmenes, renombres, embeddings, clasificación) a modelo local (Ollama) o effort `low`/`none`; tareas difíciles a `medium`/`high`. Ahorro: 60–90% del gasto en tareas sencillas; nunca degradar el razonamiento donde importa.
5. **Caché semántico local con fastembed-rs (MEDIO-ALTO).** Embeddings bge/MiniLM + índice en memoria/archivo; TTL corto; invalidación por hash de archivos editados; simhash para dedup. Ahorro: 100% en hits de tareas repetitivas (LSP-ish Q&A, errores repetidos).
6. **Sub-agentes destiladores (MEDIO).** Exploración (grep/glob/tests) en sub-agentes que devuelven 1–2k tokens de hallazgos al agente principal; retriever just-in-time con identificadores de archivo en vez de contenido. Ahorro: 60–80% del contexto de exploración.
7. **Limpieza de tool results y reasoning.context=current_turn (MEDIO).** Purgar resultados crudos de tools viejas; en OpenAI usar `previous_response_id` para no re-renderizar razonamiento. Ahorro: 10–30% del contexto en sesiones largas.
8. **Batch API para tareas en segundo plano (MEDIO).** Resúmenes nocturnos de historial, embeddings de repo, indexación, evals. Ahorro: 50% en esas tareas.
9. **Structured outputs estrictos para salidas máquina (MEDIO).** Planes, diffs y acciones en JSON Schema estricto: cero retries por parseo, salida mínima. Ahorro: evita el +100% de cada retry fallido.
10. **Compresión de prompts con LLMLingua-2 (BAJO-MEDIO, experimental).** Solo para volcados grandes de contexto no-código (logs, docs, outputs de tests) donde la fidelidad letra a letra no importa. Ahorro: 3–10x en esos bloques; riesgo de pérdida en código: excluir código de la compresión.

## (d) Fuentes (consultadas 2026-08-18)

1. OpenAI Prompt Caching — https://platform.openai.com/docs/guides/prompt-caching
2. Anthropic Prompt Caching — https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching (redirect a platform.claude.com)
3. Effective Context Engineering for AI Agents (Anthropic, 2025-09-29) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
4. tiktoken-rs — https://github.com/zurawiki/tiktoken-rs
5. HuggingFace tokenizers — https://github.com/huggingface/tokenizers
6. OpenAI Reasoning models — https://platform.openai.com/docs/guides/reasoning
7. OpenAI Structured Outputs — https://platform.openai.com/docs/guides/structured-outputs
8. OpenAI Batch API — https://platform.openai.com/docs/guides/batch
9. LLMLingua / LLMLingua-2 — https://github.com/microsoft/LLMLingua (papers: EMNLP'23 aclanthology.org/2023.emnlp-main.825; ACL'24 aclanthology.org/2024.acl-long.91; Findings'24 aclanthology.org/2024.findings-acl.57)
10. Survey "Prompt Compression for LLMs" (Li et al., 2024-10) — https://arxiv.org/abs/2410.12388
11. GPTCache — https://github.com/zilliztech/GPTCache
12. Ollama — https://github.com/ollama/ollama
13. fastembed-rs — https://github.com/Anush008/fastembed-rs
