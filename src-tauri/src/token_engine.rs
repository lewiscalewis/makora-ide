// Motor de tokens M2: conteo exacto (tiktoken) + composición con presupuestos
// por componente y poda con validez sintáctica (límites de línea/bloque).
// Diseño: docs/token-engine.md §2.1-§2.2.

use std::sync::{LazyLock, Mutex};

use tiktoken_rs::CoreBPE;

use crate::ChatMessage;

static GLOBAL_COUNTER: LazyLock<TokenCounter> = LazyLock::new(TokenCounter::new);

pub fn global() -> &'static TokenCounter {
    &GLOBAL_COUNTER
}

pub struct TokenCounter {
    bpe: Mutex<Option<CoreBPE>>,
}

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl TokenCounter {
    pub fn new() -> Self {
        let bpe = tiktoken_rs::cl100k_base().ok();
        Self {
            bpe: Mutex::new(bpe),
        }
    }

    pub fn count(&self, text: &str) -> usize {
        if let Some(bpe) = guard(&self.bpe).as_ref() {
            bpe.encode_ordinary(text).len()
        } else {
            text.chars().count() / 4
        }
    }

    pub fn count_messages(&self, system: &str, msgs: &[ChatMessage]) -> usize {
        let mut total = if system.is_empty() {
            0
        } else {
            self.count(system) + 4
        };
        for m in msgs {
            total += 4 + self.count(&m.content);
            for img in &m.images {
                total += img.len() / 3 + 20;
            }
            if let Some(tcs) = &m.tool_calls {
                for tc in tcs {
                    total += 12 + self.count(&tc.name) + self.count(&tc.arguments);
                }
            }
        }
        total
    }

    /// Trunca a `max_tokens` sin cortar a mitad de línea: corta por saltos de
    /// línea decrecientes hasta entrar en presupuesto (validez sintáctica básica;
    /// tree-sitter por símbolo llega en M2 completo).
    pub fn truncate(&self, text: &str, max_tokens: usize) -> String {
        if self.count(text) <= max_tokens {
            return text.to_string();
        }
        let marker = format!("\n[Truncado por presupuesto de tokens: {max_tokens}]\n");
        let budget = max_tokens.saturating_sub(self.count(&marker)).max(1);
        let mut lo = 0usize;
        let mut hi = text.len();
        while lo + 1 < hi {
            let mid = (lo + hi) / 2;
            let cut = match text[..mid].rfind('\n') {
                Some(pos) if pos > lo => pos,
                _ => mid,
            };
            if self.count(&text[..cut]) <= budget {
                lo = cut;
            } else {
                hi = cut.max(lo + 1);
            }
        }
        let kept = &text[..lo.max(1)];
        format!("{kept}{marker}")
    }
}

// Composer M2: presupuestos por componente y orden estable para el prefijo.
// La integración completa con el ensamblado del contexto llega con el repo-map
// (tree-sitter); esta es la API pública que consume el bucle del agente.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct ComponentQuotas {
    pub system: f64,
    pub tools: f64,
    pub memory: f64,
    pub files: f64,
    pub history: f64,
    pub repo_map: f64,
}

impl Default for ComponentQuotas {
    fn default() -> Self {
        Self {
            system: 0.05,
            tools: 0.08,
            memory: 0.04,
            files: 0.45,
            history: 0.30,
            repo_map: 0.08,
        }
    }
}

pub struct ContextComposer {
    pub budget_tokens: usize,
    pub quotas: ComponentQuotas,
}

#[allow(dead_code)]
impl ContextComposer {
    /// Presupuesto total = min(ventana * 0.75, presupuesto del usuario).
    pub fn for_window(context_window: u32, user_budget: Option<u32>) -> Self {
        let budget = context_window as usize * 3 / 4;
        let budget = match user_budget {
            Some(b) if (b as usize) < budget => b as usize,
            _ => budget,
        };
        Self {
            budget_tokens: budget,
            quotas: ComponentQuotas::default(),
        }
    }

    pub fn quota_tokens(&self, share: f64) -> usize {
        ((self.budget_tokens as f64) * share) as usize
    }

    /// Poda de historia dentro de su cuota respetando el orden estable y la atomicidad de turnos
    /// (los bloques asistente + respuestas de herramientas nunca se fragmentan a la mitad;
    /// los mensajes antiguos se resumen en un CompactBoundary cuando se excede la cuota).
    pub fn fit_history<'a>(
        &self,
        counter: &TokenCounter,
        msgs: &'a [ChatMessage],
    ) -> Vec<ChatMessage> {
        let quota = self.quota_tokens(self.quotas.history);

        // Agrupar mensajes en bloques atómicos indivisibles:
        // - Cada llamada de asistente con sus respuestas de herramientas forma un bloque atómico.
        // - Mensajes de usuario, sistema o asistente simple forman bloques individuales.
        let mut atomic_blocks: Vec<Vec<ChatMessage>> = Vec::new();
        let mut i = 0;
        let n = msgs.len();

        while i < n {
            let m = &msgs[i];
            if m.role == "assistant" && m.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false) {
                let mut block = vec![m.clone()];
                let mut j = i + 1;
                while j < n && msgs[j].role == "tool" {
                    block.push(msgs[j].clone());
                    j += 1;
                }
                atomic_blocks.push(block);
                i = j;
            } else {
                atomic_blocks.push(vec![m.clone()]);
                i += 1;
            }
        }

        let mut out: Vec<ChatMessage> = Vec::new();
        let mut used = 0usize;
        let mut skipped = 0usize;

        for block in atomic_blocks.iter().rev() {
            let block_tokens: usize = block
                .iter()
                .map(|m| {
                    let mut s = counter.count(&m.content) + 4;
                    if let Some(tcs) = &m.tool_calls {
                        for tc in tcs {
                            s += 12 + counter.count(&tc.name) + counter.count(&tc.arguments);
                        }
                    }
                    s
                })
                .sum();

            if used + block_tokens <= quota || out.is_empty() {
                for m in block.iter().rev() {
                    out.push(m.clone());
                }
                used += block_tokens;
            } else {
                skipped += block.len();
            }
        }

        out.reverse();
        if skipped > 0 {
            out.insert(
                0,
                ChatMessage {
                    role: "system".into(),
                    content: format!(
                        "[CompactBoundary: {skipped} mensajes anteriores omitidos por presupuesto de historia]"
                    ),
                    images: vec![],
                    tool_calls: None,
                    tool_call_id: None,
                },
            );
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".into(),
            content: content.into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
        }
    }

    #[test]
    fn truncate_respects_budget_and_lines() {
        let c = TokenCounter::new();
        let text = "linea uno\nlinea dos\nlinea tres\nlinea cuatro".repeat(10);
        let out = c.truncate(&text, 20);
        assert!(c.count(&out) <= 20 + 10);
        assert!(out.ends_with('\n'));
        assert!(out.contains("Truncado por presupuesto"));
    }

    #[test]
    fn counter_counts_messages() {
        let c = TokenCounter::new();
        let msgs = vec![msg("hola mundo"), msg("otro mensaje más largo con tokens")];
        let n = c.count_messages("system prompt", &msgs);
        assert!(n > 0);
    }

    #[test]
    fn history_fit_drops_oldest_and_marks_boundary() {
        let c = TokenCounter::new();
        let composer = ContextComposer::for_window(400, None);
        let msgs: Vec<ChatMessage> = (0..200).map(|i| msg(&format!("mensaje {i}"))).collect();
        let fitted = composer.fit_history(&c, &msgs);
        assert!(fitted.len() < msgs.len());
        assert!(fitted.first().unwrap().content.contains("CompactBoundary"));
        assert!(fitted.last().unwrap().content.contains("mensaje 199"));
    }

    #[test]
    fn history_fit_preserves_atomic_tool_blocks() {
        let c = TokenCounter::new();
        let composer = ContextComposer::for_window(300, None);
        let mut msgs: Vec<ChatMessage> = Vec::new();
        for i in 0..10 {
            msgs.push(msg(&format!("peticion usuario {i}")));
            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: format!("voy a consultar {i}"),
                images: vec![],
                tool_calls: Some(vec![crate::ToolCall {
                    id: format!("call_{i}"),
                    name: "read_file".into(),
                    arguments: format!("{{\"path\":\"file_{i}.rs\"}}"),
                    extra_content: None,
                }]),
                tool_call_id: None,
            });
            msgs.push(ChatMessage {
                role: "tool".into(),
                content: format!("contenido del archivo {i}... lineas y mas lineas"),
                images: vec![],
                tool_calls: None,
                tool_call_id: Some(format!("call_{i}")),
            });
        }
        let fitted = composer.fit_history(&c, &msgs);
        // Ensure no assistant with tool_calls is ever detached from its tool message in fitted history
        for (idx, m) in fitted.iter().enumerate() {
            if m.role == "assistant" && m.tool_calls.is_some() {
                assert!(idx + 1 < fitted.len());
                assert_eq!(fitted[idx + 1].role, "tool");
            }
        }
    }
}
