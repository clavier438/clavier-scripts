// snapshot — push 직전 target 의 영향받는 테이블 record 전체를 디스크에 떠둠 + diff preview.
//
// 메타기억 #1 (feedback_single_solution): 권유는 X, 구조적 강제만.
// "조심하세요" 가 아니라 *변경 전에 자동으로 백업* 되고 *바뀔 값이 표로 보임*.
//
// 파일: <folder>/output/snapshots/<timestamp>.json
//   { timestamp, baseId, tables: { <tableName>: [{id, fields}, ...] } }

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * push 영향받는 테이블의 *모든* 현재 records 를 fetch + 디스크 저장.
 *
 * 주의: 큰 base 면 시간 소요 (테이블당 record 100개 단위 paginate).
 * 그래도 안전망 — push 잘못되면 이 snapshot 으로 복원.
 *
 * @returns {{path, snap: {timestamp, baseId, tables}}}
 */
export async function takeSnapshot(api, baseId, schema, tableNames, outputDir) {
  const snapDir = join(outputDir, "snapshots");
  if (!existsSync(snapDir)) mkdirSync(snapDir, { recursive: true });
  const snap = {
    timestamp: new Date().toISOString(),
    baseId,
    tables: {},
  };
  for (const tableName of tableNames) {
    const t = schema.tables.find(t => t.name === tableName);
    if (!t) continue;
    const all = await api.listRecords(baseId, t.id);
    snap.tables[tableName] = all.map(r => ({ id: r.id, fields: r.fields }));
  }
  const ts = snap.timestamp.replace(/[:.]/g, "-");
  const path = join(snapDir, `${ts}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return { path, snap };
}

/**
 * payload 와 snapshot 의 diff 를 사람-readable 표로.
 *
 * payload: { tableName: [{id?, fields}, ...] }   ← LLM 응답
 * snap:    { tables: { tableName: [{id, fields}] } }   ← 현재 상태
 *
 * 각 record 마다:
 *   - id 있으면 = PATCH. 기존값 → 새값 비교, 변경되는 필드 개수 표시.
 *   - id 없으면 = POST. name/slugKey 만 표시.
 */
export function buildDiffPreview(payload, snap) {
  const lines = [];
  for (const [tableName, records] of Object.entries(payload)) {
    if (!Array.isArray(records)) continue;
    const preById = new Map((snap.tables[tableName] || []).map(r => [r.id, r.fields]));
    const patches = records.filter(r => r.id);
    const posts = records.filter(r => !r.id);

    lines.push(`  ${tableName}: ${patches.length} PATCH · ${posts.length} POST  (현재 ${snap.tables[tableName]?.length ?? 0} records)`);

    // PATCH preview
    patches.slice(0, 6).forEach(r => {
      const oldFields = preById.get(r.id) || {};
      const changedKeys = Object.keys(r.fields).filter(k => {
        const newV = r.fields[k];
        const oldV = oldFields[k];
        return JSON.stringify(newV) !== JSON.stringify(oldV);
      });
      const oldName = String(oldFields.name ?? oldFields.slugKey ?? "(no name)").slice(0, 30);
      const newName = String(r.fields.name ?? r.fields.slugKey ?? "?").slice(0, 30);
      const idShort = r.id.slice(0, 8) + "…";
      const arrow = oldName === newName ? "═══" : "→";
      lines.push(`    PATCH ${idShort}  "${oldName}" ${arrow} "${newName}"  [${changedKeys.length} fields]`);
    });
    if (patches.length > 6) lines.push(`         ... +${patches.length - 6} more PATCH`);

    // POST preview
    posts.slice(0, 6).forEach(r => {
      const name = String(r.fields.name ?? r.fields.slugKey ?? "?").slice(0, 40);
      lines.push(`    POST  (new)       "${name}"`);
    });
    if (posts.length > 6) lines.push(`         ... +${posts.length - 6} more POST`);
  }
  return lines.join("\n");
}

/**
 * <folder>/output/snapshots/ 안 모든 .json 파일을 최신순으로.
 */
export function listSnapshots(outputDir) {
  const snapDir = join(outputDir, "snapshots");
  if (!existsSync(snapDir)) return [];
  return readdirSync(snapDir)
    .filter(f => f.endsWith(".json"))
    .map(f => join(snapDir, f))
    .sort()
    .reverse();
}

/**
 * snapshot 로드 (revert 등에서 사용).
 */
export function readSnapshot(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
