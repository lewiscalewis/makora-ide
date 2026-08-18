# ⚔️ Reglas Maestras de Desarrollo Agéntico y Eficiencia de Tokens (MakoraIDE)

> **Invariantes Operativos Universales para Modelos de Razonamiento y Agentes de Código (Gemini 3.7 Flash, Claude 3.7, DeepSeek v4, GPT-4o).**

---

## ⚡ 1. Reglas Cardinales de Eficiencia de Tokens

1. **Cero Prosa Innecesaria:** NUNCA generes saludos de cortesía ('Hola', 'Entendido'), explicaciones preliminares vacías ni despedidas redundantes ('Espero que esto te sea útil'). Comienza directamente invocando las herramientas necesarias o con la solución técnica concreta.
2. **Edición Quirúrgica Obligatoria (`apply_patch`):**
   * **PROHIBIDO** usar `write_file` sobre archivos existentes.
   * Emite siempre parches quirúrgicos con formato diff `apply_patch`:
     ```
     <<<<<<< SEARCH
     [3-5 líneas exactas de contexto a reemplazar]
     =======
     [nuevas líneas modificadas]
     >>>>>>> REPLACE
     ```
   * `write_file` se reserva **exclusivamente para la creación de archivos 100% nuevos**.
3. **Lectura Progresiva y Focalizada (`read_file_range`):**
   * **PROHIBIDO** leer archivos completos de 200+ líneas con `read_file` si solo necesitas inspeccionar una función o tipo.
   * Utiliza `list_dir` para ubicar rutas, `grep` para encontrar líneas exactas y `read_file_range` con `[start_line, end_line]`.
4. **Agrupación Concurrente de Herramientas (Tool Batching):**
   * Emite todas las operaciones de solo lectura independientes en el mismo turno para reducir viajes de ida y vuelta a la API y acelerar la respuesta.
5. **Exploración Efímera Aislada (`explore_subagent`):**
   * Cuando requieras investigar logs pesados, analizar múltiples dependencias o hacer búsquedas recursivas extensas, delega la tarea a `explore_subagent` para no polucionar el historial de contexto principal.
6. **Terminal Silenciosa (`bash`):**
   * Ejecuta comandos con banderas silenciosas (`-q`, `--quiet`, `--no-progress`).
   * Acota las salidas para evitar volcados masivos en el transcript.

---

## 🎯 2. Formato Canónico de Conclusión

Al finalizar una tarea técnica, concluye con un resumen compacto y estructurado de máximo 1 línea por archivo modificado:
- `ruta/al/archivo:línea - acción realizada / función modificada`

---

## 🛡️ 3. Verificación de Calidad y Sintaxis

* Verifica siempre la validez de tipos y la estructura sintáctica antes de dar por completada una modificación.
* Corrige de forma autónoma cualquier error de compilación o test antes de ceder el turno al usuario.
