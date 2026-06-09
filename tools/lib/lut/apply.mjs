// apply.mjs — ffmpeg lut3d 체인 빌드 + 병렬 실행 (AI 없음, 100% 결정론).
//
// 체인: 한 사진에 cube N개를 바깥→안 순서로 누적 적용 (재귀 폴더 체인, scan.mjs).
//
// 색공간 (reference-class 확인, 2026-06-09):
//   ffmpeg lut3d 는 암묵적 색관리 없이 입력 RGB 값에 직접 테이블 룩업만 한다
//   (FFmpeg vf_lut3d.c / 공식 docs). Photomator .cube 는 sRGB 도메인(파일 헤더
//   #Color profile "sRGB" 명시)에서 동작 → 8-bit sRGB JPG 입출력에서 결과 일치.
//   가드: lut3d 앞 `format=rgb24` — JPG 의 full-range YUV(yuvj) 디코드를 RGB 로 고정.
//   ref: https://ayosec.github.io/ffmpeg-filters-docs/2.3/Filters/Video/lut3d.html

import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { dirname, basename } from "path";
import { cpus } from "os";

const INTERP = "tetrahedral";

/** ffmpeg 필터그래프 값 escape — 단일 인용 + 내부 ' 는 '\'' 로. */
function ffQuote(p) {
  return "'" + p.split("'").join("'\\''") + "'";
}

/**
 * vf 필터 문자열 빌드.
 * @param {string[]} chain  cube 절대경로 배열 (바깥→안 순서)
 * @param {number|null} scale  미리보기 가로폭(px). null = 원본 해상도(render)
 */
export function buildFilter(chain, scale) {
  const parts = ["format=rgb24"]; // full-range RGB 가드
  for (const cube of chain) parts.push(`lut3d=file=${ffQuote(cube)}:interp=${INTERP}`);
  if (scale) parts.push(`scale=${scale}:-1`);
  return parts.join(",");
}

/**
 * 한 장 처리. ffmpeg 1회 spawn. reject 안 함 — 결과로 보고.
 * @returns {Promise<{input, output, ok, code, err}>}
 */
export function applyOne({ input, output, chain, scale, quality, preserveMetadata }) {
  return new Promise(resolve => {
    mkdirSync(dirname(output), { recursive: true });
    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", input,
      "-vf", buildFilter(chain, scale),
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
 */
export async function runPool(thunks, { concurrency = DEFAULT_CONCURRENCY, onProgress } = {}) {
  const total = thunks.length;
  const results = new Array(total);
  let next = 0, done = 0;

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

/** 출력 파일명 = 입력 stem + .jpg. */
export function outputName(inputPath) {
  const b = basename(inputPath);
  const stem = b.includes(".") ? b.slice(0, b.lastIndexOf(".")) : b;
  return `${stem}.jpg`;
}
