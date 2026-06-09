// menu — workerCtl 스타일 인터랙티브 (airtable 모드 함수 메뉴 + 컨텍스트 변경).
//
// 패턴 (workerCtl.mjs:selectFromList / pickAndRun 동일):
//   상태 패널 → 번호 메뉴 → 함수 실행 → 메뉴로 복귀 → '0' 또는 'q' 시 종료.
//
// readline 싱글톤·ask·selectNumber·closeAsk 는 공유 lib(cli-prompt.mjs)에서 가져온다.
// 이 파일은 copy 전용 메뉴 함수(airtableMenuTick / pickFolder / pickCsvDir …)만 보유.

import { bold, dim, cyan, green, yellow, red, gray } from "../cli-color.mjs";
import { ask, selectNumber, closeAsk, confirm as cliConfirm } from "../cli-prompt.mjs";

// copy.mjs 가 이 모듈에서 closeAsk 를 import — 공유 구현 그대로 re-export.
export { closeAsk };

/** y/N 확인 — live upsert 등 위험한 작업 직전. copy 는 ⚠ 머리표를 붙인다. */
export function confirm(message) {
  return cliConfirm(`${yellow("⚠")}  ${message}`);
}

/**
 * airtable 모드 메뉴 1 사이클. workerCtl pickAndRun 동일 의미.
 *
 * @returns {Promise<{action, ctx, done?}>}  action: 'csv'|'upsert-dry'|'upsert-live'|'push'|'md'|'change'|'exit'
 */
export async function airtableMenuTick(ctx) {
  const { folder, target, ref, instruction, model,
          targetData, refData, refSample } = ctx;

  console.log();
  console.log(bold(cyan("━━━ copy — airtable 모드 ━━━")));
  console.log();
  console.log(`  ${dim("folder ")} ${folder}`);
  console.log(`  ${dim("target ")} ${formatBase(target, targetData)}`);
  console.log(`  ${dim("ref    ")} ${formatBase(ref, refData, refSample)}`);
  console.log(`  ${dim("-i     ")} ${instruction ? instruction.slice(0, 70) + (instruction.length > 70 ? "…" : "") : dim("(없음)")}`);
  console.log(`  ${dim("model  ")} ${model}`);
  console.log();

  const items = [
    { id: "csv",    label: green("CSV 생성") + dim(" — output_v<NN>_<model>/<table>.csv (review 후 [2]/[3] 으로 upsert)") },
    { id: "upsert-dry", label: yellow("CSV → upsert dry-run") + dim(" — 최근 CSV 폴더, 변경 없이 미리보기") },
    { id: "upsert-live", label: red("CSV → upsert LIVE") + dim(" — 최근 CSV 폴더, target 에 실제 push") },
    { id: "push",   label: yellow("직접 push (JSON)") + dim(" — LLM → PATCH/POST 즉시 (CSV 우회, 빠르지만 review X)") },
    { id: "md",     label: dim("md 생성 — airtable 안 쓰는 카피 마크다운") },
    { id: "change", label: cyan("컨텍스트 변경") + dim(" — target / ref / -i / model") },
  ];

  const picked = await selectNumber(items, it => it.label);
  if (!picked) return { action: "exit", ctx };

  if (picked.id === "change") {
    const newCtx = await changeContextSubmenu(ctx);
    return { action: "change", ctx: newCtx };
  }
  return { action: picked.id, ctx };
}

function formatBase(url, data, sample) {
  if (!url) return dim("(없음)");
  if (!data) return url.slice(0, 60) + (url.length > 60 ? "…" : "");
  const recCount = data.records
    ? Object.values(data.records).reduce((s, r) => s + r.length, 0)
    : null;
  const recStr = recCount !== null ? ` · ${recCount} records` + (sample ? ` (sample=${sample})` : "") : "";
  return `${data.baseId} · ${data.schema.tables.length} tables${recStr}`;
}

/**
 * 컨텍스트 변경 서브메뉴 — target / ref / -i / model 중 하나 바꿈.
 */
async function changeContextSubmenu(ctx) {
  console.log();
  console.log(bold(`  ━ 컨텍스트 변경 ━`));
  const items = [
    { id: "target", label: `target  ${dim("현재: " + (ctx.target || "(없음)"))}` },
    { id: "ref",    label: `ref     ${dim("현재: " + (ctx.ref || "(없음)"))}` },
    { id: "i",      label: `-i      ${dim("현재: " + (ctx.instruction || "(없음)"))}` },
    { id: "model",  label: `model   ${dim("현재: " + ctx.model)}` },
  ];
  const picked = await selectNumber(items, it => it.label);
  if (!picked) return ctx;
  const newVal = await ask(`${gray("새 값 (Enter=취소, '-' = 비우기): ")}`);
  if (!newVal) return ctx;
  const setVal = newVal === "-" ? null : newVal;
  const updated = { ...ctx };
  if (picked.id === "target") { updated.target = setVal; updated.targetData = null; }
  if (picked.id === "ref")    { updated.ref = setVal; updated.refData = null; }
  if (picked.id === "i")      updated.instruction = setVal;
  if (picked.id === "model")  updated.model = setVal || "haiku";
  return updated;
}

/**
 * 폴더 메뉴 — 최근 폴더 목록 + paste.
 */
export async function pickFolder(recentFolders) {
  if (recentFolders && recentFolders.length > 0) {
    console.log(bold(`최근 폴더:`));
    recentFolders.forEach((r, i) => {
      const dateStr = r.at?.slice(0, 10) ?? "";
      console.log(`  ${green(String(i + 1).padStart(2))}. ${r.path}  ${dim(dateStr)}`);
    });
    console.log();
  }
  const pick = await ask(`번호 선택 또는 폴더 경로 paste ${dim("(Enter=취소)")}: `);
  if (!pick) return null;
  if (/^\d+$/.test(pick)) {
    const i = parseInt(pick, 10) - 1;
    if (i >= 0 && i < (recentFolders?.length ?? 0)) return recentFolders[i].path;
    return null;
  }
  return pick;
}

/**
 * 최근 CSV 폴더 picker — output_v<NN>_<model>/ 디렉토리 중에서.
 */
export async function pickCsvDir(csvDirs) {
  if (!csvDirs || csvDirs.length === 0) {
    console.log(yellow(`  ⚠ CSV 폴더 없음 — 먼저 [1] CSV 생성`));
    return null;
  }
  console.log();
  console.log(bold(`  ━ CSV 폴더 선택 ━`));
  csvDirs.forEach((d, i) => {
    const stem = d.split("/").pop();
    console.log(`  ${bold(String(i + 1).padStart(2))}. ${stem}`);
  });
  console.log();
  while (true) {
    const input = await ask(`${gray("선택 (1-" + csvDirs.length + ", 0=취소): ")}`);
    if (input === null || input === "0" || input === "") return null;
    const n = parseInt(input, 10);
    if (n >= 1 && n <= csvDirs.length) return csvDirs[n - 1];
    console.log(red(`  ✗ 1~${csvDirs.length} 또는 0 입력`));
  }
}
