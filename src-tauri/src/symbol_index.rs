// M2: índice semántico del repositorio. Extrae símbolos (fn/struct/class/def…)
// de los archivos fuente y permite consultarlos con ranking BM25 + coincidencia
// de nombre. Es la base del "find definitions" agéntico (equivalente a buscar
// con tree-sitter, pero con extracción por regex por lenguaje para no añadir
// gramáticas C al build). Se cachea por workspace con TTL.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;

#[derive(Clone, Debug)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: usize,
}

struct IndexDoc {
    symbol: Symbol,
    terms: Vec<String>,
}

struct Index {
    docs: Vec<IndexDoc>,
    df: HashMap<String, usize>,
    avg_len: f64,
}

static CACHE: Mutex<Option<HashMap<String, (u64, Arc<Index>)>>> = Mutex::new(None);

const TTL_SECS: u64 = 180;
const MAX_FILES: usize = 5000;
const MAX_FILE_BYTES: u64 = 384 * 1024;

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect()
}

static RE_RUST_FN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_RUST_TYPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:pub\s+)?(struct|enum|trait|union|mod|type)\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_RUST_IMPL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_TS_FN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_TS_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_TS_ITYPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_]\w*)"#).unwrap()
});
static RE_TS_CONST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*="#).unwrap()
});
static RE_PY_DEF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\("#).unwrap()
});
static RE_PY_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*class\s+([A-Za-z_]\w*)\s*[:\(]"#).unwrap()
});

fn line_of(content: &str, byte_offset: usize) -> usize {
    content[..byte_offset.min(content.len())].bytes().filter(|&b| b == b'\n').count() + 1
}

fn push_symbol(symbols: &mut Vec<Symbol>, path: &str, kind: &str, name: &str, content: &str, offset: usize) {
    symbols.push(Symbol {
        name: name.to_string(),
        kind: kind.to_string(),
        path: path.to_string(),
        line: line_of(content, offset),
    });
}

fn extract_symbols(content: &str, path: &str, ext: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    match ext {
        "rs" => {
            for c in RE_RUST_FN.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "fn", m.as_str(), content, m.start());
                }
            }
            for c in RE_RUST_TYPE.captures_iter(content) {
                if let (Some(k), Some(n)) = (c.get(1), c.get(2)) {
                    push_symbol(&mut symbols, path, k.as_str(), n.as_str(), content, n.start());
                }
            }
            for c in RE_RUST_IMPL.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "impl", m.as_str(), content, m.start());
                }
            }
        }
        "ts" | "tsx" | "js" | "jsx" => {
            for c in RE_TS_FN.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "function", m.as_str(), content, m.start());
                }
            }
            for c in RE_TS_CLASS.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "class", m.as_str(), content, m.start());
                }
            }
            for c in RE_TS_ITYPE.captures_iter(content) {
                if let (Some(k), Some(n)) = (c.get(1), c.get(2)) {
                    push_symbol(&mut symbols, path, k.as_str(), n.as_str(), content, n.start());
                }
            }
            for c in RE_TS_CONST.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "const", m.as_str(), content, m.start());
                }
            }
        }
        "py" => {
            for c in RE_PY_DEF.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "def", m.as_str(), content, m.start());
                }
            }
            for c in RE_PY_CLASS.captures_iter(content) {
                if let Some(m) = c.get(1) {
                    push_symbol(&mut symbols, path, "class", m.as_str(), content, m.start());
                }
            }
        }
        _ => {}
    }
    symbols
}

fn rel_path(root: &str, path: &std::path::Path) -> String {
    let root_p = std::path::Path::new(root);
    match path.strip_prefix(root_p) {
        Ok(rel) => rel.to_string_lossy().to_string(),
        Err(_) => path.to_string_lossy().to_string(),
    }
}

fn build_index(folders: &[String]) -> Index {
    let mut docs: Vec<IndexDoc> = Vec::new();
    for f in folders {
        if f.trim().is_empty() {
            continue;
        }
        let mut builder = ignore::WalkBuilder::new(f);
        builder
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .follow_links(false)
            .require_git(false);
        let mut file_count = 0usize;
        for entry in builder.build().flatten() {
            if file_count >= MAX_FILES {
                break;
            }
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(ext.as_str(), "rs" | "ts" | "tsx" | "js" | "jsx" | "py") {
                continue;
            }
            if entry
                .metadata()
                .map(|m| m.len() > MAX_FILE_BYTES)
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            file_count += 1;
            let rel = rel_path(f, path);
            let path_terms = tokenize(&rel);
            for s in extract_symbols(&content, &rel, &ext) {
                let mut terms = tokenize(&s.name);
                terms.extend(path_terms.iter().cloned());
                docs.push(IndexDoc { symbol: s, terms });
            }
        }
    }

    let mut df: HashMap<String, usize> = HashMap::new();
    let mut total_len = 0usize;
    for d in &docs {
        total_len += d.terms.len();
        let mut seen: HashSet<String> = HashSet::new();
        for t in &d.terms {
            if seen.insert(t.clone()) {
                *df.entry(t.clone()).or_insert(0) += 1;
            }
        }
    }
    let avg_len = if docs.is_empty() {
        1.0
    } else {
        total_len as f64 / docs.len() as f64
    };
    Index { docs, df, avg_len }
}

fn bm25(idx: &Index, query_terms: &[String]) -> Vec<(Symbol, f64)> {
    let n = idx.docs.len() as f64;
    let k1 = 1.5f64;
    let b = 0.75f64;
    let mut scored: Vec<(Symbol, f64)> = Vec::new();
    for doc in &idx.docs {
        let dl = doc.terms.len() as f64;
        let mut tf: HashMap<&str, usize> = HashMap::new();
        for t in &doc.terms {
            *tf.entry(t.as_str()).or_insert(0) += 1;
        }
        let mut score = 0.0f64;
        for q in query_terms {
            let f = *tf.get(q.as_str()).unwrap_or(&0) as f64;
            if f == 0.0 {
                continue;
            }
            let df = idx.df.get(q.as_str()).copied().unwrap_or(0) as f64;
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
            let denom = f + k1 * (1.0 - b + b * dl / idx.avg_len.max(1.0));
            score += idf * (f * (k1 + 1.0)) / denom;
        }
        let name_lower = doc.symbol.name.to_lowercase();
        for q in query_terms {
            if name_lower == *q {
                score += 2.5;
            } else if name_lower.contains(q.as_str()) {
                score += 1.2;
            }
        }
        if score > 0.0 {
            scored.push((doc.symbol.clone(), score));
        }
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

fn get_index(folders: &[String]) -> Arc<Index> {
    let key = folders.join("\u{1f}");
    {
        let g = guard(&CACHE);
        if let Some(m) = g.as_ref() {
            if let Some((ts, idx)) = m.get(&key) {
                if now_secs().saturating_sub(*ts) < TTL_SECS {
                    return Arc::clone(idx);
                }
            }
        }
    }
    let idx = Arc::new(build_index(folders));
    let mut g = guard(&CACHE);
    g.get_or_insert_with(HashMap::new)
        .insert(key, (now_secs(), Arc::clone(&idx)));
    idx
}

/// Devuelve un texto legible con los símbolos más relevantes para `query`.
pub fn query(folders: &[String], query: &str, top_n: usize) -> String {
    let q = query.trim();
    if q.is_empty() {
        return "sin consulta".into();
    }
    let idx = get_index(folders);
    let terms = tokenize(q);
    let results = bm25(&idx, &terms);
    if results.is_empty() {
        return "sin coincidencias de símbolos".into();
    }
    let top = top_n.clamp(1, 30);
    let mut out = String::from("Símbolos más relevantes (kind nombre — ruta:línea):\n");
    for (sym, _) in results.into_iter().take(top) {
        out.push_str(&format!("{:<9} {}  {}:{}\n", sym.kind, sym.name, sym.path, sym.line));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize() {
        assert_eq!(tokenize("calculate_Correlations"), vec!["calculate_correlations"]);
        assert_eq!(tokenize("src/App.tsx"), vec!["src", "app", "tsx"]);
    }

    #[test]
    fn test_extract_rust_symbols() {
        let content = "pub async fn main() {}\nstruct Foo {}\nimpl Foo {\n    fn bar(&self) {}\n}\ntrait Baz {}\n";
        let syms = extract_symbols(content, "src/main.rs", "rs");
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"Foo"));
        assert!(names.contains(&"bar"));
        assert!(names.contains(&"Baz"));
    }

    #[test]
    fn test_extract_python_symbols() {
        let content = "def calc(x):\n    pass\n\nclass Regime:\n    def run(self): pass\n";
        let syms = extract_symbols(content, "core.py", "py");
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"calc"));
        assert!(names.contains(&"Regime"));
        assert!(names.contains(&"run"));
    }

    #[test]
    fn test_query_returns_matches() {
        let dir = std::env::temp_dir().join("makora_sym_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("lib.rs"),
            "pub fn calculate_correlations() -> f64 { 0.0 }\npub fn other() {}\n",
        )
        .unwrap();
        let folders = vec![dir.to_string_lossy().to_string()];
        let out = query(&folders, "calculate_correlations", 5);
        assert!(out.contains("calculate_correlations"));
        assert!(out.contains("fn"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
