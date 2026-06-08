// Airtable REST API wrapper — schema fetch + records CRUD + 429 retry + 10-batch chunking
// Self-contained. PAT은 environ AIRTABLE_PAT.

const META = 'https://api.airtable.com/v0/meta';
const API = 'https://api.airtable.com/v0';

export function createClient(pat) {
  if (!pat) throw new Error('AIRTABLE_PAT not provided');

  async function call(method, url, body, attempt = 0) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('Retry-After') || '30', 10) * 1000;
      if (attempt >= 3) throw new Error(`429 after ${attempt} retries: ${url}`);
      await sleep(wait);
      return call(method, url, body, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${url}: ${res.status} ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    getSchema: (baseId) => call('GET', `${META}/bases/${baseId}/tables`),

    // 단일 record fetch (id 로). 기존엔 listRecords 로 우회했음 — 자연스러운 read 갭 보강(순수 추가).
    getRecord: (baseId, tableId, recordId) =>
      call('GET', `${API}/${baseId}/${tableId}/${recordId}`),

    async listRecords(baseId, tableId, opts = {}) {
      const all = [];
      let offset;
      do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (offset) params.set('offset', offset);
        if (opts.fields) opts.fields.forEach(f => params.append('fields[]', f));
        const r = await call('GET', `${API}/${baseId}/${tableId}?${params}`);
        all.push(...r.records);
        offset = r.offset;
      } while (offset);
      return all;
    },

    async createField(baseId, tableId, field) {
      return call('POST', `${META}/bases/${baseId}/tables/${tableId}/fields`, field);
    },

    async batchUpsert(baseId, tableId, records, mergeOn) {
      const results = [];
      for (const batch of chunk(records, 10)) {
        const r = await call('PATCH', `${API}/${baseId}/${tableId}`, {
          performUpsert: { fieldsToMergeOn: mergeOn },
          records: batch,
          typecast: true,
        });
        results.push(...r.records);
      }
      return results;
    },

    async batchPatch(baseId, tableId, records) {
      const results = [];
      for (const batch of chunk(records, 10)) {
        const r = await call('PATCH', `${API}/${baseId}/${tableId}`, {
          records: batch,
          typecast: true,
        });
        results.push(...r.records);
      }
      return results;
    },

    async batchCreate(baseId, tableId, records) {
      const results = [];
      for (const batch of chunk(records, 10)) {
        const r = await call('POST', `${API}/${baseId}/${tableId}`, {
          records: batch,
          typecast: true,
        });
        results.push(...r.records);
      }
      return results;
    },
  };
}

function chunk(a, n) {
  const o = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
