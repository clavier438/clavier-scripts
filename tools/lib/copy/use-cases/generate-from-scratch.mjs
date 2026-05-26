// Use case — Airtable 빈 base 를 inputs 기반으로 채움 → CSV 다발.
// (copyDraft 의 현재 동작 — --model 없을 때.)
// 의존: domain 전부 + airtable-source + claude-runner.

import { writeFileSync } from "fs";
import { join } from "path";
import { loadAllLayers } from "../domain/layer-loader.mjs";
import { loadInputs } from "../domain/inputs-loader.mjs";
import { layersAsXml, wrapXml } from "../domain/prompt-builder.mjs";
import { runWithPaths, nextVersionPaths, stripCodeFence } from "../adapters/claude-runner.mjs";

const COMPUTED_TYPES = new Set([
  "formula", "multipleLookupValues", "rollup", "count",
  "autoNumber", "createdTime", "lastModifiedTime",
  "createdBy", "lastModifiedBy", "button",
]);

const SYSTEM_HEAD = `너는 호텔/브랜드 카피라이터다. 아래 Layer 들을 정확히 따른다.`;
const SYSTEM_TAIL = `응답은 반드시 단일 JSON 객체로 시작·종료. 설명·서두·코드 펜스 절대 X.`;

function schemaForClaude(schema) {
  return schema.tables.map(t => ({
    name: t.name,
    description: t.description || null,
    fields: (t.fields || [])
      .filter(f => !COMPUTED_TYPES.has(f.type))
      .map(f => ({
        name: f.name,
        type: f.type,
        description: f.description || null,
        options: f.type === "singleSelect" || f.type === "multipleSelects"
          ? f.options?.choices?.map(c => c.name)
          : undefined,
      })),
  }));
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join("|") : String(v);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCSV(rows) {
  if (!rows.length) return "";
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(","));
  return lines.join("\n") + "\n";
}

/**
 * @param {{folder, source, model, commonLayersDir}} args
 *   source = airtable-source 인스턴스 (target)
 */
export async function generateFromScratch({ folder, source, model, commonLayersDir }) {
  const layers = loadAllLayers(folder, commonLayersDir);
  if (!layers.layer1) {
    throw new Error(`Layer 1 없음. ${commonLayersDir}/1-core/ 또는 ${folder}/layers/1-core/ 확인.`);
  }
  const contextFiles = loadInputs(folder);
  if (contextFiles.length === 0) {
    throw new Error(`inputs/*.md 없음 — ${folder}/inputs/ 에 .md 파일 필요`);
  }

  const schema = await source.getSchema();
  const schemaSlim = schemaForClaude(schema);

  const systemPrompt = [SYSTEM_HEAD, "", layersAsXml(layers), "", SYSTEM_TAIL].join("\n");

  const inputsBody = contextFiles.map(f => `## ${f.name}\n\n${f.content}`).join("\n\n---\n\n");
  const userPrompt = [
    wrapXml("inputs", inputsBody),
    wrapXml("airtable_schema", JSON.stringify(schemaSlim, null, 2)),
    "",
    `위 inputs 와 Airtable 스키마를 바탕으로, **Layer 들의 원칙을 정확히 따르는 카피가 채워진 row 들**을 만들어.`,
    ``,
    `규칙:`,
    `- inputs 의 IA(섹션 구조) 를 따라 \`group\` 테이블에 섹션 별 row, \`items\` 테이블에 각 섹션의 항목 row.`,
    `- \`multipleRecordLinks\` (group/items/topics/tags 등) 는 *연결될 row 의 name 값*을 배열로. 예: items 의 group 필드 = ["룸 오버뷰"]. airtableCtl 이 나중에 resolve.`,
    `- \`singleSelect\` 는 옵션 리스트 안에서 선택 (options 에 명시됨).`,
    `- 빈 카피 X — 모든 텍스트 필드 채움.`,
    `- 형용사·자기자랑·약속 금지. 사실·고유명사·동사로.`,
    `- 카피 톤은 Layer 2 의 정신 정확히 따름.`,
    ``,
    `출력 형식 (오직 JSON 객체, 다른 텍스트·코드 펜스 절대 X):`,
    `{`,
    `  "<table_name>": [ { "<field_name>": "<value>", ... }, ... ],`,
    `  ...`,
    `}`,
  ].join("\n");

  // 트리에서 보여줄 스키마 요약
  const totalFields = schemaSlim.reduce((s, t) => s + t.fields.length, 0);
  const schemaSummary = `${schemaSlim.length} tables, ${totalFields} fields (computed 제외)`;

  const paths = nextVersionPaths(folder, "draft_v");

  const { claudeResult, version, promptPath } = await runWithPaths({
    ...paths,
    folder,
    systemPrompt,
    userPrompt,
    model,
    layers,
    contextFiles,
    schemaSummary,
  });

  // JSON 파싱
  let data;
  try {
    const text = stripCodeFence(claudeResult.result);
    data = JSON.parse(text);
  } catch (e) {
    const rawPath = join(folder, `draft_${version}.raw.txt`);
    writeFileSync(rawPath, String(claudeResult.result || ""));
    throw new Error(`JSON 파싱 실패. raw 응답: ${rawPath}`);
  }

  // CSV 저장
  const written = [];
  for (const [tableName, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const csv = rowsToCSV(rows);
    const csvPath = join(folder, `${tableName}.csv`);
    writeFileSync(csvPath, csv);
    written.push({ tableName, csvPath, rows: rows.length });
  }

  return { version, promptPath, written, claudeResult };
}
