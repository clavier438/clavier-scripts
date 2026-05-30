// repl — copy 대화 루프. :exit 칠 때까지 안 끝남. 매 턴 전사에 즉시 기록.
//
// 사용자 결정 2026-05-29: 읽기(input/ + model/project base) ≠ 쓰기(late-bound).
//   "어디다 쓸지" 는 대화 중 :out 메뉴로 그때그때. 목적지 3종(airtable/md/csv)만
//   결정적 메뉴, 그 안 디테일은 대화로. (memory/feedback_single_solution.md)

import { writeFileSync } from "fs";
import { basename } from "path";
import { bold, dim, cyan, green, yellow, red } from "../cli-color.mjs";
import { makeAsk, pickOutputDestination } from "./menu.mjs";
import { runClaude, stripCodeFence, appendTranscript, nextNumbered } from "./runner.mjs";
import { pushBasePayload, compactSchema } from "./airtable.mjs";

const HELP = `${dim("대화 명령:")}
  ${cyan(":out")}   어디다 쓸지 메뉴 (에어테이블 / 마크다운 / 표 CSV)
  ${cyan(":help")}  이 도움말
  ${cyan(":exit")}  종료  (Ctrl-D 도) — 대화 전문은 이미 전사에 저장돼 있음`;

function costLine(r) {
  return dim(`  ${r.elapsedSec.toFixed(1)}s · ${r.usage.input_tokens ?? "?"}in/${r.usage.output_tokens ?? "?"}out · $${(r.totalCostUsd || 0).toFixed(4)}`);
}

/**
 * @param firstPrompt  1턴째 전체 컨텍스트 (input/ + base들 + 여는 지시)
 * @param projectBase  {baseId, schema, records} | null — 에어테이블 출력 시 유일한 쓰기 대상
 */
export async function runRepl({ model, sessionId, firstPrompt, outputDir, sessionPath, projectBase, pat }) {
  appendTranscript(sessionPath, `<!-- copy 대화 — ${new Date().toISOString()} · model ${model} · session ${sessionId} -->\n`);

  let lastAnswer = "";

  // 한 턴 (대화). claude 실패해도 REPL 안 죽음 — null 반환.
  async function converse(userText, { resume }) {
    try {
      const r = await runClaude({ userPrompt: userText, model, sessionId, resume });
      if (r.isError) { console.error(red(`✗ claude: ${r.errorMessage}`)); return null; }
      const text = stripCodeFence(r.result);
      console.log(text);
      console.log(costLine(r));
      return text;
    } catch (e) {
      console.error(red(`✗ ${e.message.split("\n")[0]}`));
      return null;
    }
  }

  // ── 1턴: 전체 컨텍스트 주입 ──
  console.log(dim(`→ 자료 읽는 중 (input/ + base)...`));
  const opening = await converse(firstPrompt, { resume: false });
  if (opening !== null) {
    lastAnswer = opening;
    appendTranscript(sessionPath, `\n## 🤖 claude (시작)\n\n${opening}\n`);
  }
  console.log();
  console.log(HELP);

  // ── 출력 핸들러 ──
  async function doOutput(dest) {
    if (dest === "md") {
      if (!lastAnswer) { console.log(yellow(`⚠ 아직 저장할 답이 없음.`)); return; }
      const { path } = nextNumbered(outputDir, "output_v", ".md");
      writeFileSync(path, lastAnswer + "\n");
      console.log(green(`✓ md`) + dim(`  ${basename(path)}`));
      appendTranscript(sessionPath, `\n## → 출력: 마크다운 (${basename(path)})\n`);
      return;
    }
    if (dest === "csv") {
      console.log(dim(`→ CSV 직렬화...`));
      const text = await converse(
        `지금까지 다룬 내용을 CSV 로만 출력해. 첫 줄 헤더 포함. 펜스·설명 없이 CSV 본문만.`,
        { resume: true },
      );
      if (text === null) return;
      const { path } = nextNumbered(outputDir, "output_v", ".csv");
      writeFileSync(path, text + "\n");
      console.log(green(`✓ csv`) + dim(`  ${basename(path)}`));
      appendTranscript(sessionPath, `\n## → 출력: 표 CSV (${basename(path)})\n`);
      return;
    }
    // airtable — 프로젝트 base 가 유일한 쓰기 대상
    if (!projectBase) { console.log(yellow(`⚠ --project-base 안 받음 → 에어테이블 출력 불가.`)); return; }
    console.log(dim(`→ 프로젝트 base JSON 직렬화...`));
    const text = await converse(
      `지금까지 합의된 내용을, 아래 프로젝트 base 에 반영할 JSON 으로만 출력해.\n` +
      `형식: { "테이블명": [ { "id"?: "rec...", "fields": { 필드명: 값 } } ] }\n` +
      `기존 record 수정이면 id 포함, 신규면 id 생략. 펜스·설명 없이 JSON 만.\n\n` +
      `<project-schema>\n${JSON.stringify(compactSchema(projectBase.schema), null, 2)}\n</project-schema>`,
      { resume: true },
    );
    if (text === null) return;
    let payload;
    try { payload = JSON.parse(text); }
    catch (e) {
      console.error(red(`✗ JSON 파싱 실패: ${e.message}`));
      appendTranscript(sessionPath, `\n## → 출력: 에어테이블 (실패: JSON 파싱)\n\n\`\`\`\n${text.slice(0, 500)}\n\`\`\`\n`);
      return;
    }
    const { path: jsonPath } = nextNumbered(outputDir, "output_v", ".json");
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");  // 감사용
    try {
      const results = await pushBasePayload({ targetData: projectBase, payload, pat });
      for (const res of results) {
        if (res.skipped) console.log(yellow(`⚠ ${res.table} — ${res.skipped}`));
        else console.log(green(`✓ ${res.table}`) + dim(`  patched=${res.patched} created=${res.created}`));
      }
      appendTranscript(sessionPath, `\n## → 출력: 에어테이블 push (${basename(jsonPath)})\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\`\n`);
    } catch (e) {
      console.error(red(`✗ push 실패: ${e.message.split("\n")[0]}`));
      appendTranscript(sessionPath, `\n## → 출력: 에어테이블 (push 실패: ${e.message.split("\n")[0]})\n`);
    }
  }

  // ── 대화 루프 ──
  const { ask, close } = makeAsk();
  try {
    for (;;) {
      const line = await ask(bold(cyan(`\ncopy> `)));
      if (line === null) break;                 // EOF (Ctrl-D)
      const t = line.trim();
      if (!t) continue;
      if (t === ":exit" || t === ":q" || t === ":quit") break;
      if (t === ":help") { console.log(HELP); continue; }
      if (t === ":out") {
        const dest = await pickOutputDestination(ask);
        if (!dest) { console.log(dim(`취소.`)); continue; }
        await doOutput(dest);
        continue;
      }
      appendTranscript(sessionPath, `\n## 🙂 you\n\n${t}\n`);
      const ans = await converse(t, { resume: true });
      if (ans !== null) {
        lastAnswer = ans;
        appendTranscript(sessionPath, `\n## 🤖 claude\n\n${ans}\n`);
      }
    }
  } finally {
    close();
  }
  console.log();
  console.log(dim(`전사: ${sessionPath}`));
}
