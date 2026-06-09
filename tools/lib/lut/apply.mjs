// apply.mjs — ffmpeg lut3d 필터 빌드 + 병렬 실행 (AI 없음, 100% 결정론).
//
// 색공간 (reference-class 확인, 2026-06-09):
//   ffmpeg lut3d 는 암묵적 색관리 없이 입력 RGB 값에 직접 테이블 룩업만 한다
//   (FFmpeg vf_lut3d.c / 공식 filter docs). Photomator 가 export 한 .cube 도
//   display-referred(sRGB 감마) 도메인에서 동작하므로, 8-bit sRGB JPG 입출력에서
//   둘이 같은 값에 같은 테이블을 적용 → 결과 일치 (검증① difference 검게).
//
//   단 가드 1개: JPG 는 디코딩 시 full-range YUV(yuvj)를 거치므로 lut3d 앞에
//   `format=rgb24` 를 명시 체인 — LUT 가 full-range RGB 를 보게 해야 함.
//   ref: https://ayosec.github.io/ffmpeg-filters-docs/2.3/Filters/Video/lut3d.html
//        https://discuss.pixls.us/t/lut-in-different-color-space/25103

import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { dirname, basename } from "path";
import { cpus } from "os";

const INTERP = "tetrahedral"; // 8점 사면체 보간 — Photomator 등 일반 .cube 표준

/** ffmpeg 필터그래프 값 escape — 단일 인용 + 내부 ' 는 '\'' 로. */
function ffQuote(p) {
  return "'" + p.split("'").join("'\\''") + "'";
}

/**
 * vf 필터 문자열 빌드.
 * @param {object} o
 * @param {string|null} o.baseLut  _base.cube 절대경로 (없으면 null)
 * @param {string} o.sceneLut      scene .cube 절대경로
 * @param {number|null} o.scale    미리보기 가로폭(px). null = 원본 해상도 유지(render)
 */
export function buildFilter({ baseLut, sceneLut, scale }) {
  const parts = ["format=rgb24"]; // full-range RGB 가드
  if (baseLut) parts.push(`lut3d=file=${ffQuote(baseLut)}:interp=${INTERP}`);
  parts.push(`lut3d=file=${ffQuote(sceneLut)}:interp=${INTERP}`);
  if (scale) parts.push(`scale=${scale}:-1`);
  return parts.join(",");
}

/**
 * 한 장 처리. ffmpeg 1회 spawn.
 * @returns {Promise<{input, output, ok, code, err}>}  (reject 안 함 — 결과로 보고)
 */
export function applyOne({ input, output, baseLut, sceneLut, scale, quality, preserveMetadata }) {
  return new Promise(resolve => {
    mkdirSync(dirname(output), { recursive: true });
    const vf = buildFilter({ baseLut, sceneLut, scale });
    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", input,
      "-vf", vf,
      "-q:v", String(quality),
    ];
    if (preserveMetadata) args.push("-map_metadata", "0");
    args.push(output);

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("error", e => resolve({ input, output, ok: false, code: -1, err: e.message }));
    proc.on("close", code =>
      resolve({ input, output, ok: code === 0, code, err: code === 0 ? "" : stderr.trim() }));
  });
}

/** 동시성 = 코어 수. (각 ffmpeg 는 이미지 1장이라 가벼움 — 장 단위 병렬이 이득.) */
export const DEFAULT_CONCURRENCY = Math.max(2, cpus().length);

/**
 * 작업 배열을 동시성 풀로 실행. GNU parallel 의존성 제거 — node 자체 풀.
 * @param {Array<()=>Promise>} thunks
 * @param {object} [o]
 * @param {number} [o.concurrency]
 * @param {(done:number, total:number, result:object)=>void} [o.onProgress]
 * @returns {Promise<Array>}  각 thunk 의 resolve 값
 */
export async function runPool(thunks, { concurrency = DEFAULT_CONCURRENCY, onProgress } = {}) {
  const total = thunks.length;
  const results = new Array(total);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < total) {
      const i = next++;
      const r = await thunks[i]();
      results[i] = r;
      done++;
      if (onProgress) onProgress(done, total, r);
    }
  }

  const n = Math.min(concurrency, total) || 0;
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** 출력 경로 = 입력 stem + .jpg (입력이 png/tif 여도 jpg 산출). */
export function outputName(inputPath) {
  const b = basename(inputPath);
  const stem = b.includes(".") ? b.slice(0, b.lastIndexOf(".")) : b;
  return `${stem}.jpg`;
}
