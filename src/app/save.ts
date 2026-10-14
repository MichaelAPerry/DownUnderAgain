/**
 * Persistent progress in localStorage. Everything read back is treated as
 * untrusted: unknown or malformed fields fall back to defaults, never throw.
 */
import { isValidSpec } from '../data/sandbox';
import type { CustomFishSpec } from '../data/sandbox';

export const MODE_IDS = ['freeSwim', 'evolution', 'tournament', 'challenge'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export interface SaveData {
  v: 1;
  muted: boolean;
  cues: boolean;
  codex: string[];
  best: Partial<Record<ModeId, number>>;
  custom: CustomFishSpec | null;
}

const KEY = 'downUnderAgain.save.v1';
const MAX_BYTES = 64 * 1024;

export function defaultSave(): SaveData {
  return { v: 1, muted: false, cues: true, codex: [], best: {}, custom: null };
}

/** Parse and validate raw JSON text; anything suspicious is dropped. */
export function parseSave(raw: string | null, knownIds: ReadonlySet<string>): SaveData {
  const out = defaultSave();
  if (!raw || raw.length > MAX_BYTES) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return out;
  const o = data as Record<string, unknown>;
  if (o.v !== 1) return out;
  if (typeof o.muted === 'boolean') out.muted = o.muted;
  if (typeof o.cues === 'boolean') out.cues = o.cues;
  if (Array.isArray(o.codex)) {
    out.codex = [...new Set(o.codex.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))];
  }
  if (typeof o.best === 'object' && o.best !== null) {
    const b = o.best as Record<string, unknown>;
    for (const m of MODE_IDS) {
      const n = b[m];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e9) out.best[m] = Math.floor(n);
    }
  }
  if (isValidSpec(o.custom)) out.custom = o.custom;
  return out;
}

export function loadSave(knownIds: ReadonlySet<string>): SaveData {
  try {
    return parseSave(window.localStorage.getItem(KEY), knownIds);
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, quota): progress just isn't kept.
  }
}
