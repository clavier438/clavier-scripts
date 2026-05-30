// menu — readline 인터랙티브 (폴더 고르기 + 대화 중 출력 목적지 고르기).
//
// workerCtl 패턴. 외부 inquirer 의존성 X — node 내장 readline 만.

import { createInterface } from "readline";
import { bold, dim, cyan, green } from "../cli-color.mjs";

export function makeAsk() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];          // 응답 대기 중(긴 claude 호출 등) 들어온 줄을 잃지 않게 버퍼링
  let pending = null;        // 한 줄을 기다리는 resolver
  let closed = false;

  rl.on("line", line => {
    if (pending) { const p = pending; pending = null; p(line); }
    else queue.push(line);
  });
  // EOF(Ctrl-D·파이프 종료): 대기 중이면 null 로 resolve → 호출자 루프 탈출.
  rl.on("close", () => {
    closed = true;
    if (pending) { const p = pending; pending = null; p(null); }
  });

  const ask = (q = "") => {
    if (q) { rl.setPrompt(q); rl.prompt(); }
    return new Promise(r => {
      if (queue.length) return r(queue.shift().trim());
      if (closed) return r(null);
      pending = line => r(line === null ? null : line.trim());
    });
  };
  const close = () => rl.close();
  return { ask, close };
}

/**
 * 폴더 결정 메뉴 — 최근 폴더 목록 + paste. (REPL 시작 전 1회, 자체 readline)
 */
export async function pickFolder(recentFolders) {
  const { ask, close } = makeAsk();
  try {
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
  } finally {
    close();
  }
}

/**
 * 대화 중 `:out` → "어디다 쓸까" 3지선다. 큰 목적지만 결정적 메뉴, 디테일은 대화로.
 * REPL 의 readline 을 공유해야 하므로 ask 를 받음 (자체 생성 X — stdin 충돌 방지).
 *
 * @param {(q:string)=>Promise<string>} ask
 * @returns {Promise<"airtable"|"md"|"csv"|null>}  null = 취소
 */
export async function pickOutputDestination(ask) {
  console.log(bold(cyan(`━━━ 어디다 쓸까 ━━━`)));
  console.log(`  ${green("1")}. 에어테이블  ${dim("(프로젝트 base 에 push)")}`);
  console.log(`  ${green("2")}. 마크다운    ${dim("(output_vNN.md — 직전 답 그대로)")}`);
  console.log(`  ${green("3")}. 표 (CSV)    ${dim("(output_vNN.csv)")}`);
  const pick = await ask(`번호 ${dim("(Enter=취소)")}: `);
  return { "1": "airtable", "2": "md", "3": "csv" }[pick] || null;
}
