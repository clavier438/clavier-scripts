// watch.mjs — fswatch 로 input/ 감시 + debounce + 증분 재처리 (실시간 미리보기).
//
// 출력(_preview/·output/)은 input/ 밖이라 input/ 만 감시하면 피드백 루프 자체가 없다.
// 증분: cube 변경 → 그 폴더+하위(체인 영향) 재처리. 이미지 변경 → 그 폴더만.
// debounce 1s: Photomator 저장이 파일을 여러 번 써도 마지막 한 번만.

import { spawn } from "child_process";
import { realpathSync, existsSync } from "fs";
import { join } from "path";
import { processProject } from "./run.mjs";
import { scanInput, folderRelOf, isCubePath, isImagePath } from "./scan.mjs";
import { bold, dim, cyan, green, gray } from "../cli-color.mjs";

const DEBOUNCE_MS = 1000;

/** 프로젝트 watch 시작. 블로킹 (Ctrl+C 까지). 초기 1회 전체 처리 후 감시. */
export async function watchProject(projectDir) {
  projectDir = realpathSync(projectDir);
  const inputDir = join(projectDir, "input");
  if (!existsSync(inputDir)) throw new Error(`input/ 폴더 없음: ${inputDir}`);

  console.log(bold(cyan(`\n━━━ lut watch ━━━`)));
  console.log(`  ${dim("project")} ${projectDir}`);
  console.log(`  ${dim("watch  ")} input/  ${dim("(저장 시 _preview/ 증분 갱신)")}`);
  console.log();

  await processProject(projectDir, { mode: "preview" });

  const fsw = spawn("fswatch", ["-r", inputDir], { stdio: ["ignore", "pipe", "inherit"] });
  console.log(green(`\n  ▶ 감시 중 — 저장하면 자동 갱신. ${gray("Ctrl+C 종료")}\n`));

  const pendingPaths = new Set();
  let timer = null, busy = false;
  const queued = new Set();

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  /** 변경 경로 집합 → 영향받는 rel 폴더 집합 (cube 변경은 서브트리). */
  function affectedRels(paths) {
    const units = scanInput(inputDir).units;
    const rels = new Set();
    for (const p of paths) {
      const folder = folderRelOf(inputDir, p);
      if (folder === null) continue;
      if (isCubePath(p)) {
        // 그 폴더 + 하위 전부 (체인 영향)
        for (const u of units)
          if (u.rel === folder || u.rel.startsWith(folder === "." ? "" : folder + "/")) rels.add(u.rel);
      } else if (isImagePath(p)) {
        for (const u of units) if (u.rel === folder) rels.add(u.rel);
      }
    }
    return rels;
  }

  async function flush() {
    if (pendingPaths.size === 0) return;
    const paths = [...pendingPaths];
    pendingPaths.clear();
    const rels = affectedRels(paths);
    if (rels.size === 0) return;
    if (busy) { rels.forEach(r => queued.add(r)); return; }

    busy = true;
    let toRun = rels;
    while (toRun && toRun.size) {
      console.log(dim(`  ↻ 변경 감지: ${[...toRun].join(", ")}`));
      await processProject(projectDir, { mode: "preview", only: toRun });
      console.log(green(`  ▶ 감시 중\n`));
      if (queued.size) { toRun = new Set(queued); queued.clear(); }
      else toRun = null;
    }
    busy = false;
  }

  let buf = "";
  fsw.stdout.on("data", chunk => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const p = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (p) { pendingPaths.add(p); schedule(); }
    }
  });

  return new Promise(resolve => {
    const stop = () => { try { fsw.kill(); } catch {} console.log(dim("\n  watch 종료.")); resolve(); };
    process.on("SIGINT", stop);
    fsw.on("close", resolve);
  });
}
