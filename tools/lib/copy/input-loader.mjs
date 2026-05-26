// input-loader — input/ 안 "숫자 이름 폴더" 들 → 그 안 .md → concat.
//
// 정신: 도구는 cat. 어떤 .md 가 어디 들어갈지는 사용자가 폴더 번호·파일명·정렬로
// 결정. 코드는 의미를 모름. (memory/feedback_folder_is_meaning.md)
//
// 규칙 (사용자 결정 2026-05-26):
// - input/ 직속 자식 중 *이름이 자연수* 인 폴더만 봄.
// - 폴더 이름 숫자순 (1, 2, 3, 10, 11, ...) 정렬.
// - 각 폴더 안 .md 알파벳순 (한 level — 하위 폴더 재귀 X).
// - input/ 직속 .md, 비-숫자 폴더, 하위 폴더 모두 무시.
// - 순수 "\n\n" concat. 파일명·폴더명 헤딩 박지 않음.

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * @param {string} folder  존재 안 하면 빈 결과.
 * @returns {{text: string, files: Array<{relPath, absPath, content, bytes}>}}
 */
export function loadInputFolder(folder) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return { text: "", files: [] };
  }
  const layerDirs = readdirSync(folder)
    .filter(name => /^\d+$/.test(name))
    .filter(name => {
      try { return statSync(join(folder, name)).isDirectory(); }
      catch { return false; }
    })
    .sort((a, b) => Number(a) - Number(b));

  const files = [];
  for (const layer of layerDirs) {
    const layerDir = join(folder, layer);
    const mdNames = readdirSync(layerDir)
      .filter(n => n.endsWith(".md"))
      .filter(n => {
        try { return statSync(join(layerDir, n)).isFile(); }
        catch { return false; }
      })
      .sort();
    for (const md of mdNames) {
      const p = join(layerDir, md);
      const content = readFileSync(p, "utf8");
      files.push({
        relPath: `${layer}/${md}`,
        absPath: p,
        content,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }
  const text = files.map(f => f.content).join("\n\n");
  return { text, files };
}
