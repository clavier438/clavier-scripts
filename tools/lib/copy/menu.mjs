// menu — readline 인터랙티브 (airtable 모드에서 부족한 인자 묻기).
//
// workerCtl 패턴. 외부 inquirer 의존성 X — node 내장 readline 만.

import { createInterface } from "readline";
import { bold, dim, cyan, green, red } from "../cli-color.mjs";

export function makeAsk() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, a => r(a.trim())));
  const close = () => rl.close();
  return { ask, close };
}

/**
 * airtable 모드에서 부족한 인자를 차례로 묻는다.
 * 인자가 다 박혀 들어오면 확인만.
 *
 * @returns {Promise<{target, ref, instruction}|null>}  null = 사용자 취소.
 */
export async function fillAirtableArgs({ folder, target, ref, instruction }) {
  const { ask, close } = makeAsk();
  try {
    console.log(bold(cyan(`━━━ copy — airtable 모드 ━━━`)));
    console.log(dim(`folder = ${folder}`));
    console.log(dim(`target = ${target}`));
    if (ref) console.log(dim(`ref    = ${ref}`));
    if (instruction) console.log(dim(`-i     = ${instruction}`));
    console.log();

    if (!ref) {
      const r = await ask(`reference URL ${dim("(선택, Enter=skip)")}: `);
      if (r) ref = r;
    }
    if (!instruction) {
      const i = await ask(`-i 자유 명령 ${dim("(선택, Enter=skip)")}: `);
      if (i) instruction = i;
    }

    console.log();
    console.log(bold(`확인:`));
    console.log(`  target      ${target}`);
    if (ref) console.log(`  ref         ${ref}`);
    if (instruction) console.log(`  instruction ${instruction.length > 60 ? instruction.slice(0, 60) + "…" : instruction}`);
    console.log();
    const ok = await ask(`${bold("실행?")}  ${green("[y]")} 진행  ${red("[n]")} 종료  ${dim("(Enter=y)")}: `);
    if (ok && ok.toLowerCase() !== "y" && ok.toLowerCase() !== "yes") return null;
    return { folder, target, ref, instruction };
  } finally {
    close();
  }
}

/**
 * 폴더 결정 메뉴 — 최근 폴더 목록 + paste.
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
