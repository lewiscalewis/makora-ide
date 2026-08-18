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

impl TokenCounter {
    pub fn new() -> Self {
        let bpe = tiktoken_rs::cl100k_base().ok();
        Self {
            bpe: Mutex::new(bpe),
        }
    }

    pub fn count(&self, text: &str) -> usize {
        if let Some(bpe) = self.bpe.lock().unwrap().as_ref() {
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

    /// Poda de historia dentro de su cuota respetando el orden estable
    /// (los mensajes recientes prevalecen; los antiguos se resumen en un
    /// CompactBoundary cuando se excede la cuota).
    pub fn fit_history<'a>(
        &self,
        counter: &TokenCounter,
        msgs: &'a [ChatMessage],
    ) -> Vec<ChatMessage> {
        let quota = self.quota_tokens(self.quotas.history);
        let mut out: Vec<ChatMessage> = Vec::new();
        let mut used = 0usize;
        let mut skipped = 0usize;
        for m in msgs.iter().rev() {
            let size = counter.count(&m.content) + 4;
            if used + size <= quota || out.is_empty() {
                out.push(m.clone());
                used += size;
            } else {
                skipped += 1;
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
}
