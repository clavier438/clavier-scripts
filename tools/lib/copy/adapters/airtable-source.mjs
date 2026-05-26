// Adapter — Airtable source factory + 스키마 hash 캐시.
// 추상 인터페이스: { mode, baseId, getSchema(), getRecords(tableId), getAllRecords(), schemaHash() }
// use case 는 이 인터페이스에만 의존 (DIP).

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createLiveSource } from "./airtable-source-live.mjs";
import { createBackupSource } from "./airtable-source-backup.mjs";

const CACHE_DIR = join(homedir(), ".cache", "clavier", "copy-model");

function ensureCacheDir(baseId) {
  const dir = join(CACHE_DIR, baseId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 스키마 → 안정 해시. 필드 추가/이름 변경/타입 변경 감지.
 * id 와 name·type 만 추출하여 정렬 후 해시.
 */
export function hashSchema(schema) {
  const norm = schema.tables.map(t => ({
    id: t.id,
    name: t.name,
    fields: (t.fields || [])
      .map(f => ({ id: f.id, name: f.name, type: f.type }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 16);
}

/**
 * baseId 의 마지막 hash 를 디스크에서 가져옴.
 */
export function loadCachedHash(baseId) {
  const f = join(CACHE_DIR, baseId, "schema-hash.txt");
  if (!existsSync(f)) return null;
  return readFileSync(f, "utf8").trim();
}

export function saveCachedHash(baseId, hash) {
  const dir = ensureCacheDir(baseId);
  writeFileSync(join(dir, "schema-hash.txt"), hash + "\n");
  writeFileSync(join(dir, "last-sync.iso"), new Date().toISOString() + "\n");
}

/**
 * Source factory.
 *
 * mode:
 *   "live"   — Airtable API 직접 (PAT 필요)
 *   "backup" — airtable-backup GDrive dump (PAT 불필요, baseId 가 dump 안에 있어야)
 *   "auto"   — backup 가능하면 backup, 안 되면 live (default)
 *
 * 반환 object 에 schemaHash() 추가됨 (캐시 invalidation 용).
 */
export async function createAirtableSource({ mode = "auto", baseId, pat, gdrivePath }) {
  if (!baseId) throw new Error("createAirtableSource: baseId 필요");

  let source;
  if (mode === "live") {
    source = createLiveSource({ baseId, pat });
  } else if (mode === "backup") {
    source = createBackupSource({ baseId, gdrivePath });
  } else {
    // auto — backup 시도, 실패 시 live
    try {
      source = createBackupSource({ baseId, gdrivePath });
    } catch {
      if (!pat) {
        throw new Error(`createAirtableSource(auto): backup 없고 PAT 도 없음. baseId=${baseId}`);
      }
      source = createLiveSource({ baseId, pat });
    }
  }

  // schemaHash() helper — lazy compute
  let _hash = null;
  source.schemaHash = async function () {
    if (_hash) return _hash;
    const s = await source.getSchema();
    _hash = hashSchema(s);
    return _hash;
  };

  return source;
}

/**
 * 캐시 자가 진단 — live 로 스키마만 가져와 hash 비교.
 * @returns {Promise<{cached: string|null, current: string, changed: boolean}>}
 */
export async function checkSchemaChange({ baseId, pat }) {
  if (!pat) throw new Error("checkSchemaChange: pat 필요");
  const live = createLiveSource({ baseId, pat });
  const schema = await live.getSchema();
  const current = hashSchema(schema);
  const cached = loadCachedHash(baseId);
  return { cached, current, changed: cached !== current };
}
