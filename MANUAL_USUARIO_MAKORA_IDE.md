# MakoraIDE — Guía para usuarios

Una guía sencilla y sin tecnicismos para entender **qué es MakoraIDE**, **para qué sirve** y **cómo usarlo** en el día a día.

---

## 1. ¿Qué es MakoraIDE?

**MakoraIDE** es un entorno de desarrollo (IDE) de escritorio orientado al **desarrollo agéntico**: en lugar de que tú escribas todo el código, un **agente de inteligencia artificial** trabaja junto a ti dentro de la aplicación.

La idea principal es simple:

- **Tú eliges el modelo de IA** que quieres usar (el tuyo, con tu propia clave o API key).
- **MakoraIDE conecta ese modelo con tu proyecto**: le da acceso a tus archivos, a una terminal y a herramientas de búsqueda y edición.
- **Tú pides en lenguaje normal** lo que necesitas, y el agente lo hace: busca, escribe, corrige, prueba y explica.

> 💡 **En una frase:** MakoraIDE es como tener un asistente de desarrollo experto viviendo dentro de tu proyecto, que entiende instrucciones en lenguaje humano y las convierte en cambios reales.

---

## 2. ¿Para qué sirve?

MakoraIDE te ayuda con tareas como:

| Tarea | Ejemplo de petición |
|-------|---------------------|
| Crear archivos | *"Crea un documento que explique cómo funciona mi proyecto."* |
| Modificar código | *"Cambia el color del botón de la página principal a azul."* |
| Buscar información | *"¿Dónde se guarda el historial de operaciones?"* |
| Corregir errores | *"El programa falla al iniciar, ¿qué está mal?"* |
| Probar el proyecto | *"Ejecuta las pruebas y dime si todo funciona."* |
| Explicar algo | *"¿Qué hace este archivo? Explícamelo simple."* |

---

## 3. ¿Cómo funciona?

El flujo de trabajo es muy simple, en 4 pasos:

```
1. TÚ PIDES ──> 2. MAKORAIDE ANALIZA ──> 3. EL AGENTE ACTÚA ──> 4. TÚ REVISAS
```

### Paso 1: Tú pides
Escribes lo que necesitas en el chat, con tus propias palabras. No hace falta saber programar.

**Ejemplo:** *"Revisa la carpeta de documentos y dime cuál explica la arquitectura del sistema."*

### Paso 2: MakoraIDE analiza
El agente examina los archivos de tu proyecto (el "workspace"). No lee todo de principio a fin: va directo a lo relevante, como un buscador inteligente. Tiene herramientas específicas para:

- 📂 **Explorar carpetas** y ver qué archivos existen.
- 🔍 **Buscar palabras o fragmentos** dentro de los archivos.
- 📄 **Leer archivos** cuando los necesita.
- ⌨️ **Ejecutar comandos** en una terminal integrada.
- ✍️ **Crear y modificar archivos** cuando tú lo autorizas.

### Paso 3: El agente actúa
Según lo que le pidas, puede crear o editar archivos, ejecutar comandos para compilar y probar, corregir errores, o resumirte lo que encontró. Todo ocurre **dentro de tu proyecto**, y te muestra qué hizo.

### Paso 4: Tú revisas
Siempre te explica qué cambió y dónde (con la ruta y la línea exactas). Tú decides si los cambios te sirven o si quieres ajustes.

---

## 4. Lo que puedes hacer con MakoraIDE

- 🖥️ **Interfaz de escritorio completa**: paneles redimensionables, explorador de archivos en árbol y una terminal integrada que tú y el agente compartís.
- 🧠 **Conecta tu propio modelo de IA** mediante API key. Soporta varios proveedores: **OpenAI, DeepSeek, OpenRouter, Anthropic, Ollama** (modelos locales) y conexiones personalizadas.
- 🔌 **Extensiones MCP** (Model Context Protocol): conectar herramientas externas adicionales desde la interfaz.
 - 🖼️ **Multimodal**: pegar imágenes o arrastrar archivos al chat para que el agente los tenga en cuenta.
 - 🗂️ **Múltiples sesiones en paralelo**: abre tantas pestañas de conversación como necesites (el botón **+** siempre está disponible) para trabajar en un proyecto distinto por pestaña, cada una con su propio workspace y chat independientes.
 - @️⃣ **Menciones** (`@`): referenciar archivos o elementos concretos del proyecto directamente en tu mensaje.
- 📝 **Respuestas enriquecidas**: markdown, tablas, bloques de código con botón de copiar y **artifacts** que puedes aplicar al proyecto con un clic o descargar.
- 💰 **Monitor de créditos y tokens**: control en tiempo real del consumo y el coste estimado por modelo, para que no gastes de más.

---

## 5. Empezar a usarlo en 4 pasos

1. **Conecta tu modelo**: en la configuración, introduce tu API key y elige el proveedor (por defecto DeepSeek).
2. **Abre tu proyecto**: selecciona la carpeta del workspace sobre la que quieres trabajar.
3. **Pide algo**: escribe tu primera tarea en el chat, en lenguaje natural.
4. **Revisa los cambios**: el agente te mostrará qué hizo; aplica los cambios cuando estés conforme.

---

## 6. Consejos para aprovecharlo mejor

- ✅ **Sé claro y concreto:** en lugar de *"arregla esto"*, di *"arregla el error que aparece al guardar un registro"*.
- ✅ **Pide por pasos si es algo grande:** puedes hacer varias peticiones y el agente continuará hasta completar la tarea.
- ✅ **Revisa siempre los cambios:** el agente es muy capaz, pero el control final es tuyo.
- ✅ **Puedes preguntar "¿por qué?":** si no entiendes una decisión, pídele que te la explique en palabras simples.
- ✅ **Vigila el monitor de tokens:** te ayuda a controlar el consumo de tu API key.

---

## 7. Preguntas frecuentes

**¿Necesito saber programar?**
No. Puedes usar lenguaje natural. Si además sabes programar, aprovecharás aún más sus funciones avanzadas.

**¿Necesito una API key?**
Sí, para los proveedores en la nube (OpenAI, DeepSeek, OpenRouter, Anthropic). Si usas **Ollama**, puedes ejecutar modelos en tu propio equipo sin coste por API.

**¿El agente comete errores?**
Como cualquier herramienta, a veces. Por eso te muestra siempre qué hizo y te pide confirmación en los cambios importantes.

**¿Mis archivos están seguros?**
El agente solo trabaja dentro del workspace que tú abres y sus herramientas están restringidas a esa carpeta. Nada se aplica sin que tú lo veas.

 **¿Puedo interrumpir una tarea?**
 Sí. Si algo no es lo que esperabas, cancela la tarea o dale nuevas instrucciones en cualquier momento.

 **¿Puedo trabajar en varios proyectos a la vez?**
 Sí. Pulsa el botón **+** de las pestañas para abrir una sesión nueva (está siempre disponible) y selecciona en cada una la carpeta del proyecto que quieras. Cada pestaña conserva su propio workspace y conversación, así puedes alternar entre ellas y trabajar en paralelo.

---

## 8. Glosario rápido

| Término | Significado |
|---------|-------------|
 | **Workspace** | La carpeta (o conjunto de carpetas) de tu proyecto donde el agente puede trabajar. |
 | **Sesión / Pestaña** | Conversación independiente con su propio workspace; puedes abrir varias en paralelo con el botón **+**. |
| **API key** | Clave personal que conecta MakoraIDE con el proveedor de IA que elijas. |
| **Agente** | La IA que interpreta tus peticiones y ejecuta acciones sobre el proyecto. |
| **Tool-calling** | La capacidad del agente de usar herramientas (leer, buscar, ejecutar, escribir). |
| **MCP** | Protocolo estándar para conectar herramientas externas adicionales al agente. |
| **Tokens** | Unidades de texto que la IA consume; el monitor te muestra cuánto gastas. |
| **Prompt** | La instrucción o petición que le escribes al agente. |
| **Artifact** | Archivo o bloque generado por el agente que puedes aplicar al proyecto con un clic. |

---

*Documento creado para usuarios estándar. Para detalles técnicos, consulta la documentación del proyecto (CONTEXT.md, docs/architecture.md, docs/contracts.md).*