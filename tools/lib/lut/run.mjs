// run.mjs — scan → ffmpeg 작업 빌드 → 동시성 풀 실행. watch(초기/증분)·render 공유.
//
// mode:
//   preview → _preview/ · scale 1200px · -q:v 2 · 메타데이터 버림 (빠른 미리보기)
//   final   → _out/      · 원본 해상도   · -q:v 1 · -map_metadata 0 (최종)

import { join } from "path";
import { scanProject } from "./scan.mjs";
import { applyOne, runPool, outputName } from "./apply.mjs";
import { bold, dim, cyan, green, yellow, red } from "../cli-color.mjs";

const MODES = {
  preview: { outDir: "_preview", scale: 1200, quality: 2, preserveMetadata: false },
  final:   { outDir: "_out",     scale: null, quality: 1, preserveMetadata: true  },
};

function hhmmss() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 프로젝트 처리.
 * @param {string} projectDir
 * @param {object} [o]
 * @param {'preview'|'final'} [o.mode='preview']
 * @param {Set<string>|null} [o.only]  특정 시나리오명만 (증분). null=전체.
 * @param {boolean} [o.quiet]
 * @returns {Promise<{scenes:number, total:number, ok:number, failed:Array}>}
 */
export async function processProject(projectDir, { mode = "preview", only = null, quiet = false } = {}) {
  const cfg = MODES[mode];
  if (!cfg) throw new Error(`알 수 없는 mode: ${mode}`);

  const scan = scanProject(projectDir);
  let scenes = scan.scenes;
  if (only) scenes = scenes.filter(s => only.has(s.name));

  const log = (...a) => { if (!quiet) console.log(...a); };

  // 경고: 매칭 안 된 폴더 / 고아 LUT (시작 1회만 — 증분 땐 생략)
  if (!only && !quiet) {
    if (scan.unmatched.length)
      log(yellow(`  ⚠ luts/<name>.cube 없어 skip: ${scan.unmatched.join(", ")}`));
    if (scan.orphanLuts.length)
      log(dim(`  · 폴더 없는 LUT: ${scan.orphanLuts.map(n => n + ".cube").join(", ")}`));
    if (scan.emptyScenes.length)
      log(dim(`  · 사진 0장: ${scan.emptyScenes.join(", ")}`));
  }

  if (scenes.length === 0) {
    log(yellow(`  처리할 시나리오 없음 (luts/<name>.cube + <name>/사진 매칭 필요)`));
    return { scenes: 0, total: 0, ok: 0, failed: [] };
  }

  // 작업 빌드
  const thunks = [];
  for (const s of scenes) {
    for (const img of s.images) {
      const output = join(projectDir, cfg.outDir, s.name, outputName(img));
      thunks.push(() => applyOne({
        input: img, output,
        baseLut: scan.baseLut, sceneLut: s.lut,
        scale: cfg.scale, quality: cfg.quality, preserveMetadata: cfg.preserveMetadata,
      }));
    }
  }

  const total = thunks.length;
  const base = scan.baseLut ? green("_base ✓") : dim("_base ✗");
  log(`${dim(hhmmss())} ${bold(mode)} 시작 — ${cyan(scenes.length + "개 시나리오")} · ${cyan(total + "장")} · ${base} → ${cfg.outDir}/`);

  const results = await runPool(thunks, {
    onProgress: (done, t, r) => {
      if (quiet) return;
      if (!r.ok) console.log(red(`  ✗ ${r.input}\n    ${r.err.split("\n")[0]}`));
      process.stdout.write(`\r  ${done}/${t}   `);
    },
  });
  if (!quiet) process.stdout.write("\n");

  const failed = results.filter(r => !r.ok);
  const ok = total - failed.length;
  log(`${dim(hhmmss())} ${failed.length ? yellow(`완료 (실패 ${failed.length})`) : green("완료")} — ${ok}/${total}`);

  return { scenes: scenes.length, total, ok, failed };
}
