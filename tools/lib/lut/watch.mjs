// watch.mjs — fswatch 감시 + debounce + 증분 재처리 (실시간 미리보기).
//
// 감시 범위 (합의 ③): luts/ + 시나리오 폴더 둘 다. LUT 수정·새 사진 추가 모두 반영.
// 증분 (합의 ①): 바뀐 LUT 의 시나리오만 재처리. 단 _base.cube 가 바뀌면 전체.
// 피드백 루프 차단: _preview/_out/_review/.git 은 fswatch 에서 제외 (출력이 이벤트 유발 X).
// debounce 1s: Photomator 저장이 파일을 여러 번 써도 마지막 한 번만 처리.

import { spawn } from "child_process";
import { realpathSync } from "fs";
import { processProject } from "./run.mjs";
import { sceneOfPath } from "./scan.mjs";
import { bold, dim, cyan, green, gray } from "../cli-color.mjs";

const DEBOUNCE_MS = 1000;
const ALL = "*"; // 전체 재처리 sentinel (_base 변경 시)

/**
 * 프로젝트 watch 시작. 블로킹 (Ctrl+C 까지). 초기 1회 전체 처리 후 감시.
 * @param {string} projectDir
 */
export async function watchProject(projectDir) {
  // canonical 경로로 통일 — fswatch 가 내보내는 realpath(예: /private/tmp/…)와
  // sceneOfPath 비교 prefix 를 일치시킨다 (심링크 하위 폴더 대응).
  projectDir = realpathSync(projectDir);
  console.log(bold(cyan(`\n━━━ lut watch ━━━`)));
  console.log(`  ${dim("project")} ${projectDir}`);
  console.log(`  ${dim("watch  ")} luts/ + 시나리오 폴더  ${dim("(_preview/_out/_review 제외)")}`);
  console.log();

  // 1) 시작 시 1회 전체 처리
  await processProject(projectDir, { mode: "preview" });

  // 2) fswatch 감시
  const fsw = spawn("fswatch", [
    "-r",
    "-e", "/_preview/", "-e", "/_out/", "-e", "/_review/", "-e", "/\\.git/",
    projectDir,
  ], { stdio: ["ignore", "pipe", "inherit"] });

  console.log(green(`\n  ▶ 감시 중 — 저장하면 자동 갱신. ${gray("Ctrl+C 종료")}\n`));

  // 증분 상태
  const pending = new Set();   // 이번 debounce 창에 모인 시나리오명 (또는 ALL)
  const queued = new Set();    // 처리 중 들어온 다음 배치
  let timer = null;
  let busy = false;

  function note(scene) {
    if (scene === ALL) { pending.clear(); pending.add(ALL); }
    else if (!pending.has(ALL)) pending.add(scene);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  async function flush() {
    if (pending.size === 0) return;
    const batch = new Set(pending);
    pending.clear();
    if (busy) { batch.forEach(s => queued.add(s)); return; }

    busy = true;
    let toRun = batch;
    while (toRun) {
      const only = toRun.has(ALL) ? null : toRun;
      const label = toRun.has(ALL) ? "전체" : [...toRun].join(", ");
      console.log(dim(`  ↻ 변경 감지: ${label}`));
      await processProject(projectDir, { mode: "preview", only });
      console.log(green(`  ▶ 감시 중\n`));
      if (queued.size) {
        toRun = new Set(queued);
        queued.clear();
        if (toRun.has(ALL)) { toRun.clear(); toRun.add(ALL); }
      } else {
        toRun = null;
      }
    }
    busy = false;
  }

  let buf = "";
  fsw.stdout.on("data", chunk => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const path = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!path) continue;
      const scene = sceneOfPath(projectDir, path);
      if (scene === null) continue; // 무관한 변경 (밑줄 폴더·비image 등)
      note(scene);
      schedule();
    }
  });

  return new Promise(resolve => {
    const stop = () => {
      try { fsw.kill(); } catch {}
      console.log(dim("\n  watch 종료."));
      resolve();
    };
    process.on("SIGINT", stop);
    fsw.on("close", resolve);
  });
}
