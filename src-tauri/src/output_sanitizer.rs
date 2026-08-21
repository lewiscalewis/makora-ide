//! Saneamiento especializado de la salida del modelo.
//!
//! Es la ÚNICA fuente de verdad para dos responsabilidades que antes estaban
//! repartidas (y duplicadas) por `gateway.rs`:
//!
//! 1. **Filtro en streaming** ([`StreamFilter`]): los deltas de `content` y de
//!    `reasoning` se pasan por aquí antes de emitirse a la UI, de modo que la
//!    sintaxis de tool-calls / thinking / marcadores NUNCA llega al usuario.
//! 2. **Extracción final** ([`extract_embedded_tool_calls`]): al cerrar el
//!    turno, extrae las tool-calls embebidas como XML/DSML (`<function_calls>`,
//!    `<invoke>`, `<|DSML|…>`, `<|tool_call|>`) y devuelve el texto final limpio.
//!
//! El filtro de streaming y la extracción final comparten la misma rutina de
//! "bloques cerrados" ([`strip_closed_blocks`]) para que NO diverjan (fallo
//! histórico: el streaming no borraba bloques `<thinking>` en medio de prosa).
//!
//! Diseño: máquina de estados simple (buffer + retención de bloques abiertos)
//! en lugar de un montón de regex superpuestos. El texto crudo solo existe
//! internamente para el wire y la extracción; a la UI sale limpio.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::ToolCall;

// ======================================================================
// Regexes (única fuente de verdad, insensibles a mayúsculas donde aplica)
// ======================================================================

/// Bloques COMPLETOS de tool-calls (se eliminan con todo su contenido).
static RE_TOOL_CALLS_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|function_calls)\s*>.*?<\s*/\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|function_calls)\s*>"#,
    )
    .unwrap()
});

/// Bloques COMPLETOS `<invoke>…</invoke>` (solo limpieza; la extracción usa
/// [`RE_INVOKE`] que además captura nombre y parámetros).
static RE_INVOKE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<\s*(?:\|\s*DSML\s*\|\s*)?invoke.*?<\s*/\s*(?:\|\s*DSML\s*\|\s*)?invoke\s*>"#,
    )
    .unwrap()
});

/// Bloques de "pensamiento" (`<thinking>`, `<reasoning>`, …) que el modelo
/// filtra al contenido.
static RE_THINKING_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<\s*(?:thought|thinking|reasoning|scratchpad|analysis)\b[^>]*>.*?<\s*/\s*(?:thought|thinking|reasoning|scratchpad|analysis)\s*>"#,
    )
    .unwrap()
});

/// Pares `<|tool_call|>…</|tool_call|>` (formato pipe).
static RE_PIPE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<\|tool_call\|>.*?</\|tool_call\|>"#).unwrap()
});

/// Bloques HTML-escaped (`&lt;function_calls&gt;…&lt;/function_calls&gt;`).
static RE_HTML_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)&lt;\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|function_calls)\s*&gt;[\s\S]*?&lt;\s*/\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|function_calls)\s*&gt;"#)
        .unwrap()
});

/// Etiquetas sueltas (abiertas o cerradas, con o sin atributos) que quedan tras
/// la limpieza de bloques.
static RE_STRAY_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<\s*/?\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|function_calls|invoke|parameter|DSML|thought|thinking|reasoning|scratchpad|analysis).*?>"#,
    )
    .unwrap()
});

/// Marcadores/tokens que se eliminan al instante (no son etiquetas con cierre).
static RE_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"\[(?:toolu_bdrk_[A-Za-z0-9]+|tool_use|tool_result|tool_call)\]|<\|(?:python_tag|fim_prefix|fim_suffix|fim_middle|endoftext|im_start|im_end)\|>"#,
    )
    .unwrap()
});

/// Apertura de bloque de tool-syntax (para el filtro de streaming).
static RE_OPEN_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<\s*(?:\|\s*DSML\s*\|\s*)?(?:function_calls|tool_calls|tool_call|invoke|parameter|thought|thinking|reasoning|scratchpad|analysis)\b|<\|tool_call\|>|&lt;\s*(?:\|\s*DSML\s*\|\s*)?(?:function_calls|tool_calls)"#,
    )
    .unwrap()
});

/// Cola parcial de etiqueta (`<inv`, `<|`, `</funct`) que se retiene para no
/// dejar escapar mitades de tag.
static RE_PARTIAL_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^</?[A-Za-z|_]{0,80}$"#).unwrap()
});

// --- Extracción de tool-calls embebidas ---

static RE_INVOKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<\s*(?:\|\s*DSML\s*\|\s*)?invoke\s+name=["']([^"']+)["']\s*>(.*?)<\s*/\s*(?:\|\s*DSML\s*\|\s*)?invoke\s*>"#,
    )
    .unwrap()
});

static RE_PARAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<\s*(?:\|\s*DSML\s*\|\s*)?parameter\s+name=["']([^"']+)["'][^>]*>(.*?)<\s*/\s*(?:\|\s*DSML\s*\|\s*)?parameter\s*>"#,
    )
    .unwrap()
});

static RE_TAG_JSON: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<\s*tool_calls?\s*>(.*?)<\s*/\s*tool_calls?\s*>"#).unwrap()
});

// ======================================================================
// Limpieza de bloques cerrados (compartida streaming/final)
// ======================================================================

/// Normaliza variantes de ancho completo a ASCII. DeepSeek emite a veces DSML
/// con tuberías de ancho completo `｜` (U+FF5C) en lugar de `|`, y `＜`/`＞` en
/// lugar de `<`/`>`. Sin esta normalización los regex no casan y el XML crudo
/// se filtra al contenido (causa raíz de los "petes" recurrentes).
fn normalize_syntax(text: &str) -> String {
    if !text.contains(['｜', '＜', '＞', '［', '］']) {
        return text.to_string();
    }
    text.chars()
        .map(|c| match c {
            '｜' => '|',
            '＜' => '<',
            '＞' => '>',
            '［' => '[',
            '］' => ']',
            _ => c,
        })
        .collect()
}

/// Elimina del texto todos los bloques cerrados de tool-syntax y los tokens
/// inline. NO toca bloques abiertos sin cerrar (eso lo gestiona el filtro de
/// streaming reteniéndolos hasta su cierre).
fn strip_closed_blocks(text: &str) -> String {
    let normalized = normalize_syntax(text);
    let mut s = RE_TOOL_CALLS_BLOCK.replace_all(&normalized, "").to_string();
    s = RE_INVOKE_BLOCK.replace_all(&s, "").to_string();
    s = RE_THINKING_BLOCK.replace_all(&s, "").to_string();
    s = RE_PIPE_BLOCK.replace_all(&s, "").to_string();
    s = RE_HTML_BLOCK.replace_all(&s, "").to_string();
    s = RE_TOKEN.replace_all(&s, "").to_string();
    s
}

// ======================================================================
// Filtro de streaming
// ======================================================================

/// Filtra un stream de texto (content o reasoning) en tiempo real.
///
/// Mantiene un buffer interno: elimina bloques cerrados al instante y retiene
/// desde el primer bloque abierto sin cerrar hasta que cierre (o se descarta al
/// final del turno). También retiene colas parciales de etiqueta (`<inv`, `<|`).
pub struct StreamFilter {
    pending: String,
}

impl StreamFilter {
    pub fn new() -> Self {
        Self {
            pending: String::new(),
        }
    }

    /// Empuja un chunk y devuelve SOLO el texto limpio que debe mostrarse.
    pub fn push(&mut self, chunk: &str) -> String {
        self.pending.push_str(chunk);
        // Solo re-escaneamos si hay un candidato a etiqueta; así el caso común
        // (prosa sin `<`) no paga el coste de los regex.
        if self.pending.contains('<') || self.pending.contains('[') || self.pending.contains("&lt;") {
            self.pending = strip_closed_blocks(&self.pending);
        }
        self.drain()
    }

    /// Cierra el stream: descarta lo pendiente (bloques sin cerrar) y devuelve
    /// el texto limpio restante. El caso de uso normal descarta este valor.
    pub fn flush(self) -> String {
        let mut s = strip_closed_blocks(&self.pending);
        // Retirar la cola parcial de etiqueta que quede.
        loop {
            match s.rfind('<') {
                Some(pos) if RE_PARTIAL_TAIL.is_match(&s[pos..]) => s.truncate(pos),
                _ => break,
            }
        }
        s
    }

    fn drain(&mut self) -> String {
        let mut out = String::new();
        if let Some(m) = RE_OPEN_TAG.find(&self.pending) {
            if m.start() > 0 {
                out.push_str(&self.pending[..m.start()]);
                self.pending.drain(..m.start());
            }
            return out;
        }
        let hold = self.partial_tail_len();
        let split = self.pending.len().saturating_sub(hold);
        out.push_str(&self.pending[..split]);
        self.pending.drain(..split);
        out
    }

    fn partial_tail_len(&self) -> usize {
        if let Some(pos) = self.pending.rfind('<') {
            if RE_PARTIAL_TAIL.is_match(&self.pending[pos..]) {
                return self.pending.len() - pos;
            }
        }
        0
    }
}

// ======================================================================
// Extracción de tool-calls embebidas + limpieza final
// ======================================================================

pub struct CleanedText {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

/// Extrae tool-calls embebidas (XML/DSML/JSON) del texto COMPLETO del turno y
/// devuelve el texto limpio. Se usa solo al cierre del turno.
pub fn extract_embedded_tool_calls(text: &str, now_ts: u128) -> CleanedText {
    let text = normalize_syntax(text);
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let lower = text.to_lowercase();
    let has_tool_syntax = lower.contains("dsml")
        || lower.contains("invoke")
        || lower.contains("tool_call")
        || lower.contains("function_calls")
        || lower.contains("<parameter")
        || lower.contains("thinking")
        || lower.contains("reasoning")
        || lower.contains("thought");

    if has_tool_syntax {
        // 1. `<invoke name="…">…</invoke>` (XML estándar y DSML)
        for cap in RE_INVOKE.captures_iter(&text) {
            let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
            let body = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let mut args_map = serde_json::Map::new();
            for p_cap in RE_PARAM.captures_iter(body) {
                let p_name = p_cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                let p_val = p_cap.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                let typed = serde_json::from_str::<Value>(&p_val).unwrap_or(Value::String(p_val));
                args_map.insert(p_name, typed);
            }
            if !name.is_empty() {
                tool_calls.push(ToolCall {
                    id: format!("call_xml_{}_{now_ts}", tool_calls.len()),
                    name,
                    arguments: Value::Object(args_map).to_string(),
                    extra_content: None,
                });
            }
        }

        // 2. `<tool_call>` / `<tool_calls>` con JSON
        for cap in RE_TAG_JSON.captures_iter(&text) {
            if let Some(body) = cap.get(1) {
                if let Ok(v) = serde_json::from_str::<Value>(body.as_str().trim()) {
                    let items: Vec<Value> = match v {
                        Value::Array(arr) => arr,
                        other => vec![other],
                    };
                    for item in items {
                        if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                            let arguments = item
                                .get("arguments")
                                .map(|a| {
                                    if a.is_string() {
                                        a.as_str().unwrap_or_default().to_string()
                                    } else {
                                        a.to_string()
                                    }
                                })
                                .unwrap_or_else(|| "{}".to_string());
                            tool_calls.push(ToolCall {
                                id: format!("call_tag_{}_{now_ts}", tool_calls.len()),
                                name: name.to_string(),
                                arguments,
                                extra_content: None,
                            });
                        }
                    }
                }
            }
        }
    }

    // 3. Limpiar el texto final (bloques + etiquetas sueltas).
    let mut cleaned = strip_closed_blocks(&text);
    if has_tool_syntax {
        cleaned = RE_STRAY_TAG.replace_all(&cleaned, "").to_string();
    }
    CleanedText {
        text: cleaned.trim().to_string(),
        tool_calls,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_filter_strips_complete_xml_block() {
        let mut f = StreamFilter::new();
        let out = f.push(
            "Voy a leer.\n<function_calls><invoke name=\"read_file\"><parameter name=\"path\" string=\"true\">C:\\x\\lib.rs</parameter></invoke></function_calls>\nListo.",
        );
        assert_eq!(out, "Voy a leer.\n\nListo.");
    }

    #[test]
    fn stream_filter_holds_unclosed_and_releases_prose() {
        let mut f = StreamFilter::new();
        assert_eq!(f.push("Antes.\n<function_calls><invoke name=\"read_file\">"), "Antes.\n");
        assert_eq!(f.push("<parameter name=\"path\">a</parameter></invoke>"), "");
        assert_eq!(f.push("</function_calls>\nDespués."), "\nDespués.");
    }

    #[test]
    fn stream_filter_strips_thinking_in_middle_of_prose() {
        let mut f = StreamFilter::new();
        let out = f.push("prosa\n<thinking>razono interno</thinking>\nmás prosa");
        assert_eq!(out, "prosa\n\nmás prosa");
    }

    #[test]
    fn stream_filter_holds_partial_tag_tail() {
        let mut f = StreamFilter::new();
        assert_eq!(f.push("fin del texto <inv"), "fin del texto ");
        assert_eq!(f.push("oke name=\"x\"><parameter name=\"p\">a"), "");
        assert_eq!(f.push("</parameter></invoke>"), "");
    }

    #[test]
    fn stream_filter_strips_tokens_and_pipe() {
        let mut f = StreamFilter::new();
        assert_eq!(f.push("a [toolu_bdrk_01AbC] b"), "a  b");
        assert_eq!(f.push("<|tool_call|>{\"name\":\"x\"}</|tool_call|>c"), "c");
        assert_eq!(f.push("<|python_tag|>print(1)"), "print(1)");
    }

    #[test]
    fn stream_filter_strips_html_escaped_block() {
        let mut f = StreamFilter::new();
        let out = f.push("antes &lt;function_calls&gt;x&lt;/function_calls&gt; después");
        assert_eq!(out, "antes  después");
    }

    #[test]
    fn extract_read_file_range_with_numeric_params() {
        let text = "Tengo el mapa.\n<function_calls> <invoke name=\"read_file_range\"> <parameter name=\"end_line\" string=\"false\">85</parameter> <parameter name=\"path\" string=\"true\">scripts/check_env.py</parameter> <parameter name=\"start_line\" string=\"false\">50</parameter> </invoke> </function_calls>";
        let out = extract_embedded_tool_calls(text, 42);
        assert_eq!(out.text, "Tengo el mapa.");
        assert_eq!(out.tool_calls.len(), 1);
        assert_eq!(out.tool_calls[0].name, "read_file_range");
        let args: Value = serde_json::from_str(&out.tool_calls[0].arguments).unwrap();
        assert_eq!(args["start_line"], 50);
        assert_eq!(args["end_line"], 85);
        assert_eq!(args["path"], "scripts/check_env.py");
    }

    #[test]
    fn extract_uppercase_and_thinking_and_tokens() {
        let text = "Listo.\n<THINKING>razonamiento</THINKING>\n<FUNCTION_CALLS><INVOKE name=\"read_file\"><PARAMETER name=\"path\">a.txt</PARAMETER></INVOKE></FUNCTION_CALLS>\n[toolu_bdrk_01AbC] Fin.";
        let out = extract_embedded_tool_calls(text, 7);
        assert!(out.text.contains("Listo."));
        assert!(out.text.contains("Fin."));
        assert!(!out.text.to_lowercase().contains("function_calls"));
        assert!(!out.text.to_lowercase().contains("thinking"));
        assert!(!out.text.contains("toolu_bdrk"));
        assert_eq!(out.tool_calls.len(), 1);
        assert_eq!(out.tool_calls[0].name, "read_file");
    }

    #[test]
    fn extract_fullwidth_dsml_pipes() {
        // DeepSeek emite DSML con tuberías de ancho completo ｜ (U+FF5C).
        let text = "<\u{FF5C}DSML\u{FF5C}tool_calls>\n<\u{FF5C}DSML\u{FF5C}invoke name=\"read_file_range\">\n<\u{FF5C}DSML\u{FF5C}parameter name=\"path\" string=\"true\">serve/ollama_modelfile.txt</\u{FF5C}DSML\u{FF5C}parameter>\n<\u{FF5C}DSML\u{FF5C}parameter name=\"start_line\" string=\"false\">1</\u{FF5C}DSML\u{FF5C}parameter>\n<\u{FF5C}DSML\u{FF5C}parameter name=\"end_line\" string=\"false\">30</\u{FF5C}DSML\u{FF5C}parameter>\n</\u{FF5C}DSML\u{FF5C}invoke>\n</\u{FF5C}DSML\u{FF5C}tool_calls>";
        let out = extract_embedded_tool_calls(text, 42);
        assert_eq!(out.text, "");
        assert_eq!(out.tool_calls.len(), 1);
        assert_eq!(out.tool_calls[0].name, "read_file_range");
        let args: Value = serde_json::from_str(&out.tool_calls[0].arguments).unwrap();
        assert_eq!(args["path"], "serve/ollama_modelfile.txt");
        assert_eq!(args["start_line"], 1);
        assert_eq!(args["end_line"], 30);
    }

    #[test]
    fn stream_filter_normalizes_fullwidth_dsml() {
        let mut f = StreamFilter::new();
        let xml = "<\u{FF5C}DSML\u{FF5C}tool_calls><\u{FF5C}DSML\u{FF5C}invoke name=\"read_file_range\"><\u{FF5C}DSML\u{FF5C}parameter name=\"path\">x.txt</\u{FF5C}DSML\u{FF5C}parameter></\u{FF5C}DSML\u{FF5C}invoke></\u{FF5C}DSML\u{FF5C}tool_calls>";
        let out = f.push(xml);
        assert!(!out.contains("DSML"), "DSML crudo filtrado: {out}");
        assert!(!out.contains("read_file_range"), "invoke crudo filtrado: {out}");
    }
}
