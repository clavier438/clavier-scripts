// Adapter — airtable-backup 가 GDrive 에 dump 한 JSON 을 읽음.
// 외부 호출 0. 캐시·offline 동작.
// 경로 컨벤션 (airtable-backup.mjs 와 동일):
//   $GDRIVE_PATH/{wsLabel}/{baseName}/_meta.json
//   $GDRIVE_PATH/{wsLabel}/{baseName}/{tableId}_{tableName}.json

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * GDRIVE_PATH 환경변수 우선, 없으면 ~/Library/CloudStorage 마운트 탐색.
 */
function resolveGdrivePath() {
  if (process.env.GDRIVE_PATH) return process.env.GDRIVE_PATH;
  const cloudStorage = join(homedir(), "Library", "CloudStorage");
  if (!existsSync(cloudStorage)) return null;
  const accountDir = readdirSync(cloudStorage).find(d => d.startsWith("GoogleDrive-"));
  if (!accountDir) return null;
  const accountPath = join(cloudStorage, accountDir);
  const myDrive = readdirSync(accountPath).find(d => d === "My Drive" || d === "내 드라이브");
  if (!myDrive) return null;
  return join(accountPath, myDrive);
}

/**
 * baseId 가 든 _meta.json 을 찾아 해당 base 의 dump 디렉토리 반환.
 * @returns {{baseDir: string, meta: object}|null}
 */
function findBaseDir(gdrivePath, baseId) {
  if (!gdrivePath || !existsSync(gdrivePath)) return null;
  for (const ws of readdirSync(gdrivePath)) {
    const wsPath = join(gdrivePath, ws);
    if (!statSync(wsPath).isDirectory()) continue;
    for (const b of readdirSync(wsPath)) {
      const baseDir = join(wsPath, b);
      const metaPath = join(baseDir, "_meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        if (meta.baseId === baseId) return { baseDir, meta };
      } catch { /* skip malformed */ }
    }
  }
  return null;
}

export function createBackupSource({ baseId, gdrivePath } = {}) {
  if (!baseId) throw new Error("createBackupSource: baseId 필요");
  const root = gdrivePath || resolveGdrivePath();
  const found = findBaseDir(root, baseId);
  if (!found) {
    throw new Error(
      `backup 에 baseId=${baseId} 없음. airtable-backup 으로 먼저 dump 가 필요합니다.` +
      (root ? `  (탐색 위치: ${root})` : `  (GDrive 마운트 못 찾음 — GDRIVE_PATH 지정 필요)`)
    );
  }
  const { baseDir, meta } = found;

  let _schema = null;
  async function getSchema() {
    if (_schema) return _schema;
    // 각 tableId_*.json 의 fields 를 모아 schema 재구성
    const tables = meta.tables.map(t => {
      const fname = readdirSync(baseDir).find(f => f.startsWith(t.id + "_") && f.endsWith(".json"));
      if (!fname) throw new Error(`backup 손상 — table ${t.id} (${t.name}) 의 dump 파일 없음`);
      const tdata = JSON.parse(readFileSync(join(baseDir, fname), "utf8"));
      return {
        id: t.id,
        name: t.name,
        primaryFieldId: tdata.primaryFieldId,
        fields: tdata.fields || [],
      };
    });
    _schema = { tables };
    return _schema;
  }

  async function getRecords(tableId) {
    const fname = readdirSync(baseDir).find(f => f.startsWith(tableId + "_") && f.endsWith(".json"));
    if (!fname) throw new Error(`backup 에 tableId=${tableId} 없음`);
    const tdata = JSON.parse(readFileSync(join(baseDir, fname), "utf8"));
    return tdata.records || [];
  }

  async function getAllRecords() {
    const s = await getSchema();
    const out = {};
    for (const t of s.tables) {
      out[t.name] = await getRecords(t.id);
    }
    return out;
  }

  return {
    mode: "backup",
    baseId,
    baseDir,
    syncedAt: meta.syncedAt,
    getSchema,
    getRecords,
    getAllRecords,
  };
}
