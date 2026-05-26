// Adapter — Airtable Web/Metadata API 직접 호출.
// PAT 필요. fresh 데이터 보장. 비용은 매 호출 = 1 API roundtrip.

import { createClient } from "../../airtable-api.mjs";

export function createLiveSource({ baseId, pat }) {
  if (!baseId) throw new Error("createLiveSource: baseId 필요");
  if (!pat) throw new Error("createLiveSource: pat 필요 (Doppler AIRTABLE_PAT)");
  const client = createClient(pat);

  let _schema = null;
  async function getSchema() {
    if (_schema) return _schema;
    _schema = await client.getSchema(baseId);
    return _schema;
  }

  async function getRecords(tableId, opts = {}) {
    return await client.listRecords(baseId, tableId, opts);
  }

  async function getAllRecords() {
    const s = await getSchema();
    const out = {};
    for (const t of s.tables) {
      out[t.name] = await client.listRecords(baseId, t.id);
    }
    return out;
  }

  return {
    mode: "live",
    baseId,
    getSchema,
    getRecords,
    getAllRecords,
  };
}
