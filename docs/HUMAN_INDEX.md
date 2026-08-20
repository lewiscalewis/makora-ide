# 👤 Guía Rápida para el Humano (tú)

> Este es el ÚNICO documento pensado para lectura humana directa.
> El resto de archivos de `docs/` y `MAKORA.md` están orientados a contextualizar agentes de IA.
> No necesitas leerlos todos; con esta guía y `README.md` tienes el mapa.

---

## 1. ¿Qué es esto?

**MakoraIDE** — un IDE/agente de desarrollo construido con Tauri v2 + Rust + React 19, con gateway multi-proveedor de IA, soporte MCP y reglas de disciplina agéntica (economía de tokens, parches quirúrgicos, circuit breakers).

La apuesta del proyecto: **usar IA para construir la herramienta que usa mejor a la IA**, y que el agente se comporte como un ingeniero disciplinado, no como un generador de código sin freno.

---

## 2. Mapa de la documentación

| Archivo | Para quién | Qué es |
|---|---|---|
| `README.md` | Humano + agentes | Presentación general y quickstart |
| `docs/HUMAN_INDEX.md` | **Humano (tú)** | Esta guía. Punto de entrada |
| `MAKORA.md` | Agentes | Reglas maestras de conducta agéntica y eficiencia de tokens |
| `docs/CODEBASE_INDEX.md` | Agentes | Índice de módulos, rutas y contratos del código |
| `docs/architecture.md` | Agentes | Arquitectura del sistema |
| `docs/contracts.md` | Agentes | Contratos IPC/tipos/firmas públicas |
| `docs/decisions.md` | Ambos | Decisiones de diseño y su motivación |
| `docs/roadmap.md` | Ambos | Hoja de ruta y prioridades |
| `docs/token-engine.md` | Agentes | Motor de economía de tokens |
| `docs/audit-plan.md` | Ambos | Plan de auditorías de calidad |
| `docs/review.md` | Ambos | Protocolo de revisión de código |
| `docs/opencode-benchmark.md` | Ambos | Benchmarks/mediciones del agente |
| `docs/04_PLAN_INTERNACIONALIZACION_I18N.md` | Ambos | Plan de i18n |
| `docs/research/` | Ambos | Investigaciones y estudios |

**Regla de oro**: si un documento no está pensado para agentes, no lo metas en el flujo de contexto del agente. Solo `MAKORA.md` + `CODEBASE_INDEX.md` + `architecture.md` + `contracts.md` se cargan por defecto en contexto.

---

## 3. Flujo de trabajo recomendado

1. **Tú**: lee este índice y `README.md`. Decide qué quieres construir/cambiar.
2. **Agente**: carga `MAKORA.md` (reglas) y consulta `CODEBASE_INDEX.md` + `contracts.md` antes de tocar código.
3. **Regla de oro agéntica**: parches quirúrgicos (`apply_patch`), nunca reescribir archivos completos; lecturas focalizadas con `read_file_range`; cero prosa en las respuestas.
4. **Cierre**: el agente siempre termina con resumen `archivo:línea — acción` y estado de verificación.

---

## 4. Cambios recientes (mantener al día)

> Actualiza aquí cada vez que hagas un commit importante, para que el agente no opere con contexto caduco.

- _(pendiente de rellenar con el último `git log`)_

---

## 5. Estado de salud del proyecto

- Stack: Tauri v2 · Rust · React 19 · gateway multi-proveedor · MCP · terminal PTY
- Documentación agéntica: completa y disciplinada (punto fuerte del proyecto)
- Riesgo principal: la coherencia del conjunto depende de mantener al día `CODEBASE_INDEX.md` y `contracts.md` ante cada cambio de firma
