// menu.mjs — lut 인자 없이 실행 시 workerCtl 스타일 인터랙티브.
//   최근 프로젝트 선택 / 경로 paste / 새 프로젝트 → 액션 (watch / preview / render).

import { existsSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { bold, dim, cyan, green, yellow, gray } from "../cli-color.mjs";
import { ask, selectNumber } from "../cli-prompt.mjs";
import { scanInput } from "./scan.mjs";

/** 최근 프로젝트 목록 + paste + 새로 만들기. @returns {string|'NEW'|null} */
export async function pickProject(recent) {
  console.log(bold(cyan(`\n━━━ lut ━━━`)));
  if (recent && recent.length) {
    console.log(bold(`\n최근 프로젝트:`));
    recent.forEach((r, i) => {
      const exists = existsSync(r.path);
      const tail = r.path.split("/").pop();
      console.log(`  ${green(String(i + 1).padStart(2))}. ${exists ? tail : gray(tail + " (없음)")}`);
    });
  }
  console.log();
  const pick = await ask(`번호 / 폴더경로 paste / ${cyan("n")}=새 프로젝트 ${dim("(Enter=취소)")}: `);
  if (pick === null || pick === "") return null;
  if (pick.toLowerCase() === "n") return "NEW";
  if (/^\d+$/.test(pick)) {
    const i = parseInt(pick, 10) - 1;
    return recent && recent[i] ? recent[i].path : null;
  }
  return resolvePath(pick);
}

/** 프로젝트 상태 패널 + 액션 선택. @returns {'watch'|'preview'|'render'|'exit'} */
export async function chooseAction(projectDir) {
  const scan = scanInput(join(projectDir, "input"));
  const imgCount = scan.units.reduce((s, u) => s + u.images.length, 0);

  console.log();
  console.log(`  ${dim("project")} ${projectDir.split("/").pop()}`);
  console.log(`  ${dim("folders")} ${cyan(scan.units.length + "개")} · ${cyan(imgCount + "장")}`);
  if (scan.warnings.length) console.log(`  ${dim("⚠      ")} ${yellow(scan.warnings.map(w => w.rel).join(", "))} ${dim("(활성 cube 여러개)")}`);
  console.log();

  const items = [
    { id: "watch",   label: green("watch") + dim("   — 실시간 미리보기 (저장 시 _preview 자동)") },
    { id: "preview", label: cyan("preview") + dim(" — _preview 1회 처리 후 종료") },
    { id: "render",  label: yellow("render") + dim("  — output/vNN 원본 해상도 (버전 누적)") },
  ];
  const picked = await selectNumber(items, it => it.label);
  return picked ? picked.id : "exit";
}
