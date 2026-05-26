// Use case — Airtable 한 record 의 빈 텍스트 필드를 채워 PATCH (copyGen 코어).
// 의존: domain + airtable-source(live 권장) + claude-runner.
// 인터랙티브 메뉴는 entry CLI 가 담당. 이 use case = 생성 + (옵션) PATCH.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { runWithPaths, nextVersionPaths, stripCodeFence } from "../adapters/claude-runner.mjs";
import { extractBaseId } from "../../airtable-input.mjs";

const TEXT_TYPES = new Set([
  "singleLineText", "multilineText", "richText", "longText", "url", "email", "phoneNumber",
]);

const CACHE_BASE = join(homedir(), ".cache", "clavier", "copyGen-history");

/**
 * URL 또는 raw ID 문자열에서 base/table/record 추출.
 */
export function parseRecordUrl(input) {
  if (/^rec[A-Za-z0-9]{14}$/.test(input)) {
    throw new Error("record-id 단독은 지원 안 함. base/table 컨텍스트 필요 — URL 전체를 paste.");
  }
  const baseId = extractBaseId(input);
  const tblMatch = input.match(/\b(tbl[A-Za-z0-9]{14})\b/);
  const recMatch = input.match(/\b(rec[A-Za-z0-9]{14})\b/);
  if (!baseId || !tblMatch || !recMatch) {
    throw new Error(`URL 파싱 실패. base/table/record id 모두 필요. 입력: ${input}`);
  }
  return { baseId, tableId: tblMatch[1], recordId: recMatch[1] };
}

/**
 * copyGen 스타일 브랜드별 Layer 로드 (copy-layers/2-brand/{brand}.md).
 * claude-runner 가 기대하는 {dir, items, content} 형태로 반환.
 */
function loadCopyGenLayers({ commonLayersDir, brand, section }) {
  const out = { layer1: null, layer2: null, layer3: null };

  const coreDir = join(commonLayersDir, "1-core");
  if (existsSync(coreDir) && statSync(coreDir).isDirectory()) {
    const files = readdirSync(coreDir).filter(f => f.endsWith(".md")).sort();
    if (files.length > 0) {
      const items = files.map(f => ({
        name: f,
        path: join(coreDir, f),
        content: readFileSync(join(coreDir, f), "utf8"),
      }));
      out.layer1 = { dir: coreDir, items, content: items.map(i => i.content).join("\n\n") };
    }
  }

  if (brand) {
    const brandPath = join(commonLayersDir, "2-brand", `${brand}.md`);
    if (!existsSync(brandPath)) throw new Error(`Layer 2 (${brand}) 없음: ${brandPath}`);
    const content = readFileSync(brandPath, "utf8");
    out.layer2 = {
      dir: join(commonLayersDir, "2-brand"),
      items: [{ name: `${brand}.md`, path: brandPath, content }],
      content,
    };
  }

  if (section) {
    const sectionPath = join(commonLayersDir, "3-section", `${section}.md`);
    if (!existsSync(sectionPath)) throw new Error(`Layer 3 (${section}) 없음: ${sectionPath}`);
    const content = readFileSync(sectionPath, "utf8");
    out.layer3 = {
      dir: join(commonLayersDir, "3-section"),
      items: [{ name: `${section}.md`, path: sectionPath, content }],
      content,
    };
  }

  return out;
}

/**
 * @param {{url, brand, section?, fieldsFilter?, model, commonLayersDir, source}} args
 *   source = airtable-source (live 권장 — 단일 record 라 캐시 의미 적음)
 * @returns {Promise<{baseId, tableId, recordId, rowName, currentFields, newCopy, claudeResult, promptPath}>}
 */
export async function generatePatchForRecord({
  url, brand, section, fieldsFilter, model, commonLayersDir, source,
}) {
  const { baseId, tableId, recordId } = parseRecordUrl(url);

  const layers = loadCopyGenLayers({ commonLayersDir, brand, section });
  if (!layers.layer1) throw new Error(`Layer 1 없음: ${commonLayersDir}/1-core/*.md`);
  if (!layers.layer2) throw new Error(`Layer 2 (${brand}) 없음`);

  // 스키마 + 테이블 찾기
  const schema = await source.getSchema();
  const table = schema.tables.find(t => t.id === tableId);
  if (!table) throw new Error(`테이블 ${tableId} 못 찾음 in base ${baseId}`);

  // 현재 record fetch — source 의 getRecords 로 가져온 뒤 recordId 매칭
  // (live source 면 listRecords 가 페이지네이션 포함. 큰 테이블은 비쌀 수 있음 — 추후 getRecord 추가 고려)
  const records = await source.getRecords(tableId);
  const record = records.find(r => r.id === recordId);
  if (!record) throw new Error(`record ${recordId} 못 찾음`);
  const currentFields = record.fields || {};
  const rowName = currentFields.name || "(no name)";

  // 채울 필드
  const textFields = table.fields.filter(f => TEXT_TYPES.has(f.type));
  let targetFields;
  if (fieldsFilter) {
    targetFields = table.fields.filter(f => fieldsFilter.includes(f.name));
  } else {
    targetFields = textFields.filter(f => {
      const v = currentFields[f.name];
      return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    });
  }
  if (targetFields.length === 0) {
    return {
      baseId, tableId, recordId, rowName, currentFields,
      newCopy: null,
      reason: "채울 필드 없음 (모든 텍스트 필드 차 있음). --fields 로 강제 가능.",
    };
  }

  // 프롬프트 빌드
  const fieldsForClaude = targetFields.map(f => ({
    name: f.name, type: f.type,
    description: f.description || null,
    options: f.options || null,
  }));
  const otherFields = table.fields
    .filter(f => !targetFields.find(t => t.id === f.id))
    .map(f => ({ name: f.name, type: f.type, value: currentFields[f.name] ?? null }))
    .filter(f => f.value !== null && f.value !== "");

  const systemPrompt = `너는 호텔/브랜드 카피라이터다. 아래 Layer 들을 정확히 따른다 (Layer 3 > 2 > 1 우선순위).

<layer1_core>
${layers.layer1.content}
</layer1_core>

<layer2_brand name="${brand}">
${layers.layer2.content}
</layer2_brand>${layers.layer3 ? `

<layer3_section name="${section}">
${layers.layer3.content}
</layer3_section>` : ""}

응답은 반드시 단일 JSON 객체로 시작하고 끝난다. 설명·서두·코드 펜스(\`\`\`) 절대 X.`;

  const userPrompt = `<table_metadata>
${table.description || "(no description)"}
</table_metadata>

<row_context name="${rowName}">
${otherFields.map(f => `${f.name} (${f.type}): ${JSON.stringify(f.value)}`).join("\n")}
</row_context>

<fields_to_fill>
${JSON.stringify(fieldsForClaude, null, 2)}
</fields_to_fill>

위 row 컨텍스트와 채울 필드를 보고, Layer 1·Layer 2를 따르는 카피를 JSON으로 출력해.

출력 형식 (오직 단일 JSON 객체):
{
  "필드명1": "카피 텍스트",
  "필드명2": "카피 텍스트"
}

필드 description 이 있으면 그 의도를 따르고, options(singleSelect 등) 가 있으면 그 안에서 선택.`;

  // 이력 폴더에 prompt 저장 (record 단위 누적)
  const historyDir = join(CACHE_BASE, `${baseId}_${tableId}_${recordId}`);
  if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
  const paths = nextVersionPaths(historyDir, "patch_v");

  const schemaSummary = `'${table.name}' (${table.fields.length} fields) → target ${targetFields.length}개: ${targetFields.map(f => f.name).join(" · ")}`;

  const { claudeResult, promptPath, version } = await runWithPaths({
    ...paths,
    folder: historyDir,
    systemPrompt,
    userPrompt,
    model,
    layers,
    contextFiles: [],   // copyGen 은 inputs 폴더 안 씀
    schemaSummary,
  });

  let newCopy;
  try {
    newCopy = JSON.parse(stripCodeFence(claudeResult.result));
  } catch (e) {
    throw new Error(`JSON 파싱 실패: ${e.message}\nraw: ${String(claudeResult.result).slice(0, 300)}`);
  }

  return {
    baseId, tableId, recordId, rowName, currentFields, newCopy,
    claudeResult, promptPath, version,
    table, targetFields,
  };
}

/**
 * Airtable 에 PATCH 실행. (entry CLI 가 사용자 확인 후 호출.)
 */
export async function applyPatch({ baseId, tableId, recordId, newCopy, pat }) {
  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: newCopy, typecast: true }),
    }
  );
  if (!res.ok) {
    throw new Error(`PATCH 실패: ${res.status} ${await res.text()}`);
  }
  return { url: `https://airtable.com/${baseId}/${tableId}/${recordId}` };
}
