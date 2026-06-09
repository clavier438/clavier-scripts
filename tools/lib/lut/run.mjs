// run.mjs — input/ 재귀 스캔 → ffmpeg 체인 작업 → 동시성 풀. watch(preview)·render(final) 공유.
//
// preview → _preview/        · 1200px · -q:v 2 · 덮어쓰기 (빠른 확인). 폴더당 _recipe.
// final   → output/vNN/      · 원본    · -q:v 1 · -map_metadata 0 · 매번 새 버전. 폴더당 _recipe.

import { join } from "path";
import { existsSync, readdirSync } from "fs";
import { scanInput } from "./scan.mjs";
import { applyOne, runPool, outputName } from "./apply.mjs";
import { writeRecipe } from "./recipe.mjs";
import { bold, dim, cyan, green, yellow, red } from "../cli-color.mjs";

const MODES = {
  preview: { scale: 1200, quality: 2, preserveMetadata: false },
  final:   { scale: null, quality: 1, preserveMetadata: true  },
};

function hhmmss() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** output/ 안 v01,v02… 중 다음 버전 폴더명. */
export function nextVersion(outputDir) {
  let max = 0;
  if (existsSync(outputDir)) {
    for (const n of readdirSync(outputDir)) {
      const m = /^v(\d+)$/.exec(n);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `v${String(max + 1).padStart(2, "0")}`;
}

/**
 * 프로젝트 처리.
 * @param {string} projectDir
 * @param {object} [o]
 * @param {'preview'|'final'} [o.mode='preview']
 * @param {Set<string>|null} [o.only]  특정 rel 폴더만 (preview 증분). null=전체.
 * @param {boolean} [o.quiet]
 * @returns {Promise<{units:number, total:number, ok:number, failed:Array, outRoot:string}>}
 */
export async function processProject(projectDir, { mode = "preview", only = null, quiet = false } = {}) {
  const cfg = MODES[mode];
  if (!cfg) throw new Error(`알 수 없는 mode: ${mode}`);

  const inputDir = join(projectDir, "input");
  const scan = scanInput(inputDir);
  let units = scan.units;
  if (only) units = units.filter(u => only.has(u.rel));

  const log = (...a) => { if (!quiet) console.log(...a); };

  if (!only && !quiet) {
    for (const w of scan.warnings)
      log(yellow(`  ⚠ ${w.rel}: 활성 .cube 여러 개(${w.cubes.join(", ")}) → 이 폴더+하위 스킵. 하나만 남기고 _ 토글.`));
    if (scan.skippedNoLut.length)
      log(dim(`  · cube 없어 스킵: ${scan.skippedNoLut.join(", ")}`));
  }

  if (units.length === 0) {
    log(yellow(`  처리할 사진 없음 (input/ 폴더에 .cube + 사진 필요)`));
    return { units: 0, total: 0, ok: 0, failed: [], outRoot: "" };
  }

  // 출력 루트 결정
  const outRoot = mode === "final"
    ? join(projectDir, "output", nextVersion(join(projectDir, "output")))
    : join(projectDir, "_preview");

  // 작업 빌드
  const thunks = [];
  for (const u of units) {
    for (const img of u.images) {
      const output = join(outRoot, u.rel === "." ? "" : u.rel, outputName(img));
      thunks.push(() => applyOne({
        input: img, output, chain: u.chain,
        scale: cfg.scale, quality: cfg.quality, preserveMetadata: cfg.preserveMetadata,
      }));
    }
  }

  const total = thunks.length;
  const outLabel = mode === "final" ? `output/${outRoot.split("/").pop()}/` : "_preview/";
  log(`${dim(hhmmss())} ${bold(mode)} 시작 — ${cyan(units.length + "개 폴더")} · ${cyan(total + "장")} → ${outLabel}`);

  const results = await runPool(thunks, {
    onProgress: (done, t, r) => {
      if (quiet) return;
      if (!r.ok) console.log(red(`  ✗ ${r.input}\n    ${r.err.split("\n")[0]}`));
      process.stdout.write(`\r  ${done}/${t}   `);
    },
  });
  if (!quiet) process.stdout.write("\n");

  // 폴더당 recipe
  for (const u of units) {
    writeRecipe(join(outRoot, u.rel === "." ? "" : u.rel),
      { chain: u.chain, inputDir, mode, scale: cfg.scale, images: u.images.length });
  }

  const failed = results.filter(r => !r.ok);
  const ok = total - failed.length;
  log(`${dim(hhmmss())} ${failed.length ? yellow(`완료 (실패 ${failed.length})`) : green("완료")} — ${ok}/${total}  ${dim(outLabel)}`);

  return { units: units.length, total, ok, failed, outRoot };
}
