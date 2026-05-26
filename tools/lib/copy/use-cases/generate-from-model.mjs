// Use case — 이미 채워진 reference Airtable 을 모델로 삼아 새 records 생성.
// 두 모드:
//   "ia"         — reference 의 IA(테이블·필드 구성, 항목 수 결정 로직) 만 모델삼음. 컨텐츠는 새로.
//   "ia+content" — reference records 를 few-shot 으로 추가. 톤·문장 길이·정보 밀도까지 모델삼음.

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

const DEFAULT_SAMPLE_PER_TABLE = 10;

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

/**
 * IA 만 추출 — 컨텐츠는 제거, 테이블·필드·count·링크 패턴만.
 */
function extractIaOnly(modelSchema, modelRecordsByTable) {
  return modelSchema.tables.map(t => {
    const records = modelRecordsByTable[t.name] || [];
    const linkFields = (t.fields || [])
      .filter(f => f.type === "multipleRecordLinks" || f.type === "singleRecordLink")
      .map(f => ({ name: f.name, type: f.type, linkedTo: f.options?.linkedTableId }));
    return {
      name: t.name,
      fieldNames: (t.fields || []).filter(f => !COMPUTED_TYPES.has(f.type)).map(f => f.name),
      recordCount: records.length,
      links: linkFields,
      // 첫 record 의 *키 모양* 만 (값은 X)
      sampleKeys: records[0] ? Object.keys(records[0].fields || {}) : [],
    };
  });
}

/**
 * 표현까지 모델삼음 — N개 샘플의 fields 전체.
 */
function extractIaPlusContent(modelSchema, modelRecordsByTable, samplePerTable) {
  return modelSchema.tables.map(t => {
    const records = (modelRecordsByTable[t.name] || []).slice(0, samplePerTable);
    return {
      name: t.name,
      sampleRecords: records.map(r => r.fields || {}),
      totalRecords: (modelRecordsByTable[t.name] || []).length,
    };
  });
}

/**
 * @param {{
 *   folder, targetSource, modelSource, modelMode: "ia"|"ia+content",
 *   model, commonLayersDir, samplePerTable?
 * }} args
 */
export async function generateFromModel({
  folder, targetSource, modelSource, modelMode, model, commonLayersDir,
  samplePerTable = DEFAULT_SAMPLE_PER_TABLE,
}) {
  if (modelMode !== "ia" && modelMode !== "ia+content") {
    throw new Error(`modelMode 는 "ia" 또는 "ia+content" — 받음: ${modelMode}`);
  }

  const layers = loadAllLayers(folder, commonLayersDir);
  if (!layers.layer1) {
    throw new Error(`Layer 1 없음. ${commonLayersDir}/1-core/ 또는 ${folder}/layers/1-core/`);
  }
  const contextFiles = loadInputs(folder);
  if (contextFiles.length === 0) {
    throw new Error(`inputs/*.md 없음 — ${folder}/inputs/ 에 .md 필요`);
  }

  const [modelSchema, modelRecords, targetSchema] = await Promise.all([
    modelSource.getSchema(),
    modelSource.getAllRecords(),
    targetSource.getSchema(),
  ]);

  const targetSchemaSlim = schemaForClaude(targetSchema);

  const modelBlock = modelMode === "ia"
    ? extractIaOnly(modelSchema, modelRecords)
    : extractIaPlusContent(modelSchema, modelRecords, samplePerTable);

  const modelInstruction = modelMode === "ia"
    ? `위 model_ia 는 reference Airtable 의 **IA 구조만** 추출한 것이다 (테이블 구성·필드 이름·항목 수·테이블 간 링크). 컨텐츠 표현은 reference 의 것을 따르지 말고, Layer 2 (\`<layer2_brand>\`) 의 톤·문장 길이·정보 밀도로 새로 짠다. IA 구조 자체 — 어떤 테이블에 어떤 종류 row 가 몇 개쯤 들어가는지, 어떤 필드가 채워지는지, 테이블 간 어떻게 연결되는지 — 는 그대로 따른다. 새 inputs 의 자료량에 맞춰 record 수는 조절한다.`
    : `위 model_records 는 reference Airtable 의 records 샘플이다. 각 record 의 **표현·문장 길이·정보 단위·고유명사 사용 패턴**을 few-shot 모범으로 삼는다. 새 inputs 의 사실을 그 패턴에 맞춰 채워 새 records 를 만든다. IA(테이블 구성·필드·항목 수 로직) 도 같이 따른다. Layer 2 의 톤은 reference 의 톤이 곧 Layer 2 의 살아있는 구현체임을 알아둔다.`;

  const SYSTEM_HEAD = `너는 호텔/브랜드 카피라이터다. 아래 Layer 들과 reference 모델을 정확히 따른다.`;
  const SYSTEM_TAIL = `응답은 반드시 단일 JSON 객체로 시작·종료. 설명·서두·코드 펜스 절대 X.`;
  const systemPrompt = [SYSTEM_HEAD, "", layersAsXml(layers), "", SYSTEM_TAIL].join("\n");

  const inputsBody = contextFiles.map(f => `## ${f.name}\n\n${f.content}`).join("\n\n---\n\n");

  const modelTag = modelMode === "ia" ? "model_ia" : "model_records";
  const userPrompt = [
    wrapXml(modelTag, JSON.stringify(modelBlock, null, 2)),
    wrapXml("new_inputs", inputsBody),
    wrapXml("target_schema", JSON.stringify(targetSchemaSlim, null, 2)),
    "",
    modelInstruction,
    "",
    `규칙:`,
    `- target 테이블 이름·필드 이름은 target_schema 에 명시된 것 그대로.`,
    `- multipleRecordLinks 는 연결될 row 의 name 값을 배열로 (예: items 의 group 필드 = ["룸 오버뷰"]). airtableCtl 이 resolve.`,
    `- singleSelect 는 target_schema 의 options 안에서 선택.`,
    `- 형용사·자기자랑·약속 금지. 사실·고유명사·동사로.`,
    `- 카피 톤은 Layer 2 + reference 모델의 정신 정확히 따름.`,
    ``,
    `출력 형식 (오직 JSON 객체):`,
    `{ "<table_name>": [ { "<field_name>": "<value>", ... }, ... ], ... }`,
  ].join("\n");

  // 트리 요약
  const modelRecCount = Object.values(modelRecords).reduce((s, arr) => s + arr.length, 0);
  const modelRecordsSummary =
    modelMode === "ia"
      ? `mode=ia · 모델 base 의 IA 구조만 (records ${modelRecCount}개 → IA 패턴 추출)`
      : `mode=ia+content · 각 테이블 최대 ${samplePerTable} records 샘플 (총 ${Object.values(modelBlock).reduce((s, t) => s + (t.sampleRecords?.length || 0), 0)}개)`;
  const totalFields = targetSchemaSlim.reduce((s, t) => s + t.fields.length, 0);
  const schemaSummary = `target: ${targetSchemaSlim.length} tables, ${totalFields} fields`;

  const paths = nextVersionPaths(folder, "model_v");

  const { claudeResult, version, promptPath } = await runWithPaths({
    ...paths,
    folder,
    systemPrompt,
    userPrompt,
    model,
    layers,
    contextFiles,
    schemaSummary,
    modelRecordsSummary,
  });

  // JSON 파싱
  let data;
  try {
    data = JSON.parse(stripCodeFence(claudeResult.result));
  } catch (e) {
    const rawPath = join(folder, `model_${version}.raw.txt`);
    writeFileSync(rawPath, String(claudeResult.result || ""));
    throw new Error(`JSON 파싱 실패. raw: ${rawPath}`);
  }

  // CSV 저장 (generate-from-scratch 과 같은 형식)
  const written = [];
  for (const [tableName, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
    const csvEscape = v => {
      if (v === null || v === undefined) return "";
      const s = Array.isArray(v) ? v.join("|") : String(v);
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(","))].join("\n") + "\n";
    const csvPath = join(folder, `${tableName}.csv`);
    writeFileSync(csvPath, csv);
    written.push({ tableName, csvPath, rows: rows.length });
  }

  return { version, promptPath, written, claudeResult, modelMode };
}
