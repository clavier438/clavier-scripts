// recipe.mjs — 출력 폴더마다 "무엇을 적용했는지" 기록 (copy 의 output+prompt 정신).
//
// 체인이 폴더 단위로 같으므로 사진마다가 아니라 출력 폴더당 _recipe.txt 하나.
// md5 까지 박아 "그때 어떤 LUT 버전이었나" 추적 가능 (감사).

import { writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join, basename, relative } from "path";

function md5short(file) {
  try { return createHash("md5").update(readFileSync(file)).digest("hex").slice(0, 8); }
  catch { return "????????"; }
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 출력 폴더에 _recipe.txt 작성.
 * @param {string} outFolder
 * @param {object} o
 * @param {string[]} o.chain     적용된 cube 절대경로 (바깥→안)
 * @param {string} o.inputDir    상대경로 표시 기준
 * @param {string} o.mode        preview | final
 * @param {number|null} o.scale
 * @param {number} o.images
 */
export function writeRecipe(outFolder, { chain, inputDir, mode, scale, images }) {
  const lines = [];
  lines.push(`# LUT 적용 내역 (_recipe — 시스템 무시)`);
  lines.push(``);
  lines.push(`적용 체인 (바깥→안):`);
  if (chain.length) {
    chain.forEach((c, i) =>
      lines.push(`  ${i + 1}. ${basename(c)}   (input/${relative(inputDir, c)} · md5 ${md5short(c)})`));
  } else {
    lines.push(`  (없음)`);
  }
  lines.push(``);
  lines.push(`mode: ${mode} · 해상도: ${scale ? scale + "px" : "원본"} · interp: tetrahedral · ${images}장`);
  lines.push(`생성: ${stamp()}`);
  writeFileSync(join(outFolder, "_recipe.txt"), lines.join("\n") + "\n");
}
