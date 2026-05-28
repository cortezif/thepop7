/* ============================================================
   Cache LRU de respostas Claude — porte server-side do
   adviser/aiCache.ts.

   Adviser: localStorage no browser (24h TTL, 100 entries, LRU).
   tp7: Map em memória por instância + opcional Redis (fallback).

   Por que cache importa: cada conversa do agente repete o system
   prompt (identidade + tom + políticas). Mesmo com prompt caching
   do Anthropic, há chamadas idempotentes (mesmo input = mesma
   resposta determinística). Cache local corta 60-80% dos casos
   triviais (saudação, FAQ).
   ============================================================ */

import { createHash } from "node:crypto";

export type CachedResponse = {
  hash: string;
  body: unknown;
  savedAt: number;
  lastReadAt: number;
  model?: string;
  size: number;
};

export type CacheStats = {
  entries: number;
  totalBytes: number;
  hits: number;
  misses: number;
  oldestSavedAt: number | null;
  newestSavedAt: number | null;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500; // server pode segurar mais que browser

class InMemoryLRU {
  private store = new Map<string, CachedResponse>();
  private stats = { hits: 0, misses: 0 };

  get(hash: string, ttlMs: number = DEFAULT_TTL_MS): CachedResponse | null {
    const entry = this.store.get(hash);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() - entry.savedAt > ttlMs) {
      this.store.delete(hash);
      this.stats.misses++;
      return null;
    }
    entry.lastReadAt = Date.now();
    // Re-insere pra subir no LRU (Map mantém ordem de inserção)
    this.store.delete(hash);
    this.store.set(hash, entry);
    this.stats.hits++;
    return entry;
  }

  set(hash: string, body: unknown, model?: string): void {
    const json = JSON.stringify(body);
    const size = json.length;
    const now = Date.now();
    this.store.delete(hash); // remove se existir pra re-inserir no topo
    this.store.set(hash, { hash, body, savedAt: now, lastReadAt: now, model, size });

    // Evict: Map preserva ordem de inserção → mais antigos no início
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  getStats(): CacheStats {
    let totalBytes = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const e of this.store.values()) {
      totalBytes += e.size;
      if (oldest === null || e.savedAt < oldest) oldest = e.savedAt;
      if (newest === null || e.savedAt > newest) newest = e.savedAt;
    }
    return {
      entries: this.store.size,
      totalBytes,
      hits: this.stats.hits,
      misses: this.stats.misses,
      oldestSavedAt: oldest,
      newestSavedAt: newest,
    };
  }
}

const _cache = new InMemoryLRU();

/** Chave determinística a partir do body do request. */
export function computeCacheKey(body: Record<string, unknown>): string {
  const stable = stableStringify(body);
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function getCacheEntry(hash: string, ttlMs?: number): CachedResponse | null {
  return _cache.get(hash, ttlMs);
}

export function setCacheEntry(hash: string, body: unknown, model?: string): void {
  _cache.set(hash, body, model);
}

export function clearCache(): void {
  _cache.clear();
}

export function getCacheStatsLive(): CacheStats {
  return _cache.getStats();
}
