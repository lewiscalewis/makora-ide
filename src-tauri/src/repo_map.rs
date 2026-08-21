// M2 (ligero): mapa del repositorio (repo-map) inyectado en el prompt de
// sistema. Un árbol de directorios conciso que respeta .gitignore y se cachea
// por workspace (TTL) para que el modelo navegue sin gastar tokens en
// list_dir/grep exploratorios. Inspirado en el "@codebase" de Continue/Cline y
// en el componente "repo-map" de opencode.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CACHE: Mutex<Option<HashMap<String, (u64, String)>>> = Mutex::new(None);

const TTL_SECS: u64 = 120;
const MAX_ENTRIES: u32 = 260;
const MAX_DEPTH: usize = 3;
const MAX_CHARS: usize = 4000;

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cached(key: &str) -> Option<String> {
    let g = guard(&CACHE);
    let m = g.as_ref()?;
    m.get(key)
        .filter(|(ts, _)| now_secs().saturating_sub(*ts) < TTL_SECS)
        .map(|(_, s)| s.clone())
}

fn walk(dir: &str, out: &mut String, count: &mut u32) {
    let mut builder = ignore::WalkBuilder::new(dir);
    builder
        .max_depth(Some(MAX_DEPTH))
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false)
        .require_git(false);

    for entry in builder.build().flatten() {
        if *count >= MAX_ENTRIES {
            return;
        }
        let depth = entry.depth();
        if depth == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let pad = "  ".repeat(depth.saturating_sub(1));
        out.push_str(&format!("{pad}{}{}\n", name, if is_dir { "/" } else { "" }));
        *count += 1;
    }
}

fn generate(folders: &[String]) -> String {
    if folders.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    let mut count = 0u32;
    for f in folders {
        if f.trim().is_empty() || count >= MAX_ENTRIES {
            continue;
        }
        let name = std::path::Path::new(f)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| f.clone());
        out.push_str(&format!("{}/\n", name));
        count += 1;
        walk(f, &mut out, &mut count);
    }
    if out.chars().count() > MAX_CHARS {
        let trimmed: String = out.chars().take(MAX_CHARS).collect();
        out = format!("{trimmed}\n…[mapa truncado]");
    }
    out
}

pub fn repo_map_for(folders: &[String]) -> String {
    let key = folders.join("\u{1f}");
    if let Some(map) = cached(&key) {
        return map;
    }
    let map = generate(folders);
    if map.trim().is_empty() {
        return String::new();
    }
    let mut g = guard(&CACHE);
    let cache = g.get_or_insert_with(HashMap::new);
    cache.insert(key, (now_secs(), map.clone()));
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_repo_map_empty() {
        assert_eq!(repo_map_for(&[]), "");
    }

    #[test]
    fn test_repo_map_generates_tree() {
        let dir = std::env::temp_dir().join("makora_repo_map_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("README.md"), "# test").unwrap();
        std::fs::write(dir.join("src").join("main.rs"), "fn main() {}").unwrap();
        let map = generate(&[dir.to_string_lossy().to_string()]);
        assert!(map.contains("README.md"));
        assert!(map.contains("main.rs"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
