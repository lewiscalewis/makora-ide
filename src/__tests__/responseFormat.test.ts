import { describe, it, expect } from "vitest";
import { formatResponse, stripToolSyntax, cleanUnicode, TOOL_ONLY_NOTE } from "../responseFormat";

describe("formatResponse — sintaxis de tool-calls filtrada", () => {
  it("elimina el bloque <function_calls> XML de DeepSeek dejando la prosa", () => {
    const raw = `Tengo ya el mapa interno. Ahora consulto las mejores prácticas.

<function_calls> <invoke name="webfetch"> <parameter name="url" string="true">https://agentmd.dev/</parameter> </invoke> <invoke name="webfetch"> <parameter name="url" string="true">https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents</parameter> </invoke> </function_calls>`;
    const out = formatResponse(raw);
    expect(out).toContain("Tengo ya el mapa interno.");
    expect(out).not.toContain("function_calls");
    expect(out).not.toContain("invoke");
    expect(out).not.toContain("agentmd.dev");
  });

  it("elimina el bloque exacto reportado en modo plan (read_file_range con string=true y rutas Windows)", () => {
    const raw = `Tengo ya el mapa interno.

<function_calls> <invoke name="read_file_range"> <parameter name="end_line" string="true">778</parameter> <parameter name="path" string="true">C:\\Users\\lewis\\Projects\\makora-ide\\src-tauri\\src\\lib.rs</parameter> <parameter name="start_line" string="true">764</parameter> </invoke> <invoke name="read_file_range"> <parameter name="end_line" string="true">790</parameter> <parameter name="path" string="true">C:\\Users\\lewis\\Projects\\makora-ide\\src-tauri\\src\\lib.rs</parameter> <parameter name="start_line" string="true">778</parameter> </invoke> </function_calls>`;
    const out = formatResponse(raw);
    expect(out).toContain("Tengo ya el mapa interno.");
    expect(out).not.toContain("function_calls");
    expect(out).not.toContain("invoke");
    expect(out).not.toContain("read_file_range");
    expect(out).not.toContain("lib.rs");
  });

  it("elimina el mismo bloque si el stream se cortó sin </function_calls>", () => {
    const raw = `Tengo ya el mapa interno.

<function_calls> <invoke name="read_file_range"> <parameter name="end_line" string="true">778</parameter> <parameter name="path" string="true">C:\\x\\y\\lib.rs</parameter> <parameter name="start_line" string="true">764</parameter> </invoke>`;
    const out = formatResponse(raw);
    expect(out).toContain("Tengo ya el mapa interno.");
    expect(out).not.toContain("function_calls");
    expect(out).not.toContain("invoke");
  });

  it("elimina DSML tool_calls e invoke con parámetros", () => {
    const raw = "Voy a leer:\n<|DSML|tool_calls>\n<|DSML|invoke name=\"read_file\"><parameter name=\"path\">a.ts</parameter></|DSML|invoke>\n</|DSML|tool_calls>\nListo.";
    const out = formatResponse(raw);
    expect(out).toContain("Voy a leer:");
    expect(out).toContain("Listo.");
    expect(out).not.toContain("DSML");
    expect(out).not.toContain("a.ts");
  });

  it("corta un <function_calls> sin cerrar al final (streaming interrumpido)", () => {
    const raw = "Plan:\n<function_calls>\n<invoke name=\"webfetch\">";
    expect(formatResponse(raw)).toBe("Plan:");
  });

  it("corta un <invoke> sin cerrar conservando la prosa previa", () => {
    const raw = "Voy a buscar.\n<invoke name=\"webfetch\"><parameter name=\"url\">https://x</parameter>";
    expect(formatResponse(raw)).toBe("Voy a buscar.");
  });

  it("tolera mayúsculas y espacios dentro de las etiquetas", () => {
    const raw = "A.\n<  Function_Calls  >x</ function_calls >\nB.";
    expect(formatResponse(raw)).toBe("A.\nB.");
  });

  it("elimina bloques con atributos que contienen > dentro de comillas", () => {
    const raw = 'Pre.\n<invoke name="if (a>b)">cuerpo</invoke>\nPost.';
    expect(formatResponse(raw)).toBe("Pre.\nPost.");
  });

  it("elimina restos sueltos: cierres huérfanos y self-closing", () => {
    const raw = "texto </invoke> más <parameter name=\"x\" /> fin";
    expect(formatResponse(raw)).toBe("texto más fin");
  });

  it("elimina marcadores toolu_bdrk y tokens especiales sin comerse el contenido", () => {
    const raw = "[toolu_bdrk_01AbC123] <|python_tag|>print(\"hola\")";
    expect(formatResponse(raw)).toBe('print("hola")');
  });

  it("elimina bloques <thinking>/<reasoning> filtrados al contenido", () => {
    const raw = "<thinking>déjame pensar</thinking>Respuesta.";
    expect(formatResponse(raw)).toBe("Respuesta.");
  });

  it("elimina la variante HTML-escaped de function_calls", () => {
    const raw = "A &lt;function_calls&gt;x&lt;/function_calls&gt; B";
    expect(formatResponse(raw)).toBe("A B");
  });

  it("devuelve nota cuando toda la respuesta era solo sintaxis de tools", () => {
    const raw = '<function_calls><invoke name="webfetch"><parameter name="url">https://x</parameter></invoke></function_calls>';
    expect(formatResponse(raw)).toBe(TOOL_ONLY_NOTE);
  });

  it("no rompe bloques de código que contienen XML legítimo", () => {
    const raw = "Ejemplo:\n```xml\n<invoke name=\"x\">a</invoke>\n```\nFin";
    const out = formatResponse(raw);
    expect(out).toContain("<invoke name=\"x\">a</invoke>");
    expect(out).toContain("Fin");
  });

  it("no rompe fences sin cerrar con XML dentro (streaming)", () => {
    const raw = "```ts\nconst a = `<tool_call>${x}`;\n";
    const out = formatResponse(raw);
    expect(out).toContain("<tool_call>");
  });

  it("deja intacto el markdown normal", () => {
    const raw = "## Título\n\n- lista **negrita** `code`\n\n[enlace](https://x.com)";
    expect(formatResponse(raw)).toBe(raw);
  });

  it("colapsa líneas en blanco y trims", () => {
    const raw = "  a  \n\n\n\nb\n";
    expect(formatResponse(raw)).toBe("a\n\nb");
  });
});

describe("formatResponse — fallos programáticos", () => {
  it("devuelve \"\" para entradas no string", () => {
    expect(formatResponse(null)).toBe("");
    expect(formatResponse(undefined)).toBe("");
    expect(formatResponse(42)).toBe("");
    expect(formatResponse({ text: "x" })).toBe("");
    expect(formatResponse(["a"])).toBe("");
  });

  it("devuelve \"\" para string vacío sin nota", () => {
    expect(formatResponse("")).toBe("");
    expect(formatResponse("   \n  ")).toBe("");
  });

  it("normaliza CRLF", () => {
    expect(formatResponse("Hola\r\nmundo\r\n")).toBe("Hola\nmundo");
  });

  it("elimina secuencias ANSI (salida de terminal copiada por el modelo)", () => {
    expect(formatResponse("\u001b[31mError\u001b[0m ok \u001b]0;titulo\u0007")).toBe("Error ok");
  });
});

describe("formatResponse — idiomas y caracteres", () => {
  it("elimina controles bidi (ataque Trojan Source)", () => {
    expect(formatResponse("Hola\u202Ehacked\u202C")).toBe("Holahacked");
    expect(formatResponse("Hola\u2066evil\u2069")).toBe("Holaevil");
    expect(formatResponse("مرحبا\u061C")).toBe("مرحبا");
  });

  it("convierte separadores unicode de línea y BOM", () => {
    expect(formatResponse("a\u2028b\u2029c\uFEFFd")).toBe("a\nb\ncd");
  });

  it("sustituye surrogates solitarios por U+FFFD", () => {
    expect(formatResponse("a\uD800b")).toBe("a\uFFFDb");
    expect(formatResponse("a\uDC00b")).toBe("a\uFFFDb");
  });

  it("elimina invisibles (ZWSP, word-joiner, soft-hyphen)", () => {
    expect(formatResponse("a\u200Bb\u2060c\u00ADd")).toBe("abcd");
  });

  it("preserva emoji ZWJ y ZWNJ de escrituras que los necesitan", () => {
    expect(formatResponse("👩\u200D💻")).toBe("👩\u200D💻");
    expect(formatResponse("می\u200Cخواهم")).toBe("می\u200Cخواهم");
  });

  it("preserva CJK, árabe y acentos combinados (NFC)", () => {
    expect(formatResponse("計画を立てる")).toBe("計画を立てる");
    expect(formatResponse("مرحبا بالعالم")).toBe("مرحبا بالعالم");
    expect(formatResponse("cafe\u0301")).toBe("café");
  });

  it("elimina caracteres de control C0 excepto \\n y \\t", () => {
    expect(formatResponse("a\u0000b\u0007c\nd\te")).toBe("abc\nd\te");
  });
});

describe("stripToolSyntax / cleanUnicode — unidades aisladas", () => {
  it("stripToolSyntax converge con anidamiento mixto", () => {
    const s = stripToolSyntax("<function_calls><invoke name=\"a\">1</invoke></function_calls>");
    expect(s.trim()).toBe("");
  });

  it("cleanUnicode normaliza a NFC sin romper nada", () => {
    expect(cleanUnicode("ñoño e\u0301")).toBe("ñoño é");
  });
});
