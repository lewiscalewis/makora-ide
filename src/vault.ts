import { keyringDelete, keyringGet, keyringSet } from "./api";
import type { VaultKeyEntry } from "./types";

const VAULT_KEY = "makora.vault.v1";
const MAX_ENTRIES = 60;

// Metadata (id, name, provider, timestamps) lives in localStorage; the
// secrets themselves only ever live in the OS keyring under a vault id.

function persist(entries: VaultKeyEntry[]): void {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore */
  }
}

function credentialId(entryId: string): string {
  return `vault_${entryId}`;
}

export function loadVault(): VaultKeyEntry[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is Record<string, unknown> =>
          !!e &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).id === "string" &&
          typeof (e as Record<string, unknown>).name === "string" &&
          typeof (e as Record<string, unknown>).providerId === "string",
      )
      .map((e) => ({
        id: String(e.id),
        name: String(e.name).slice(0, 60),
        providerId: String(e.providerId),
        createdAt: Number(e.createdAt) || Date.now(),
        lastUsedAt: Number(e.lastUsedAt) || 0,
      }))
      .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
  } catch {
    return [];
  }
}

export async function addVaultEntry(name: string, providerId: string, apiKey: string): Promise<VaultKeyEntry> {
  const id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const entry: VaultKeyEntry = {
    id,
    name: name.trim().slice(0, 60) || providerId,
    providerId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  persist([entry, ...loadVault()]);
  if (apiKey.trim()) {
    try {
      await keyringSet(credentialId(id), apiKey.trim());
      await keyringSet(providerId, apiKey.trim());
    } catch {
      /* ignore */
    }
  }
  return entry;
}

export function removeVaultEntry(id: string): void {
  persist(loadVault().filter((e) => e.id !== id));
  keyringDelete(credentialId(id)).catch(() => undefined);
}

export async function getVaultKey(id: string): Promise<string | null> {
  try {
    const direct = await keyringGet(credentialId(id));
    if (direct && direct.trim()) return direct.trim();

    // Fallback: look up provider from vault metadata
    const entry = loadVault().find((e) => e.id === id);
    if (entry && entry.providerId) {
      const provKey = await keyringGet(entry.providerId);
      if (provKey && provKey.trim()) return provKey.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function touchVaultEntry(id: string): void {
  persist(loadVault().map((e) => (e.id === id ? { ...e, lastUsedAt: Date.now() } : e)));
}
