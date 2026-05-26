// input-loader — 폴더 안 .md 재귀 walk → 정렬 → concat.
//
// 정신: 도구는 cat. 어떤 .md 가 어디 들어갈지는 사용자가 파일명·폴더명·정렬 순서로
// 결정. 코드는 의미를 모름. (memory/feedback_folder_is_meaning.md)

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * 폴더 재귀 walk → .md 만 → 경로 알파벳/숫자순 정렬 → "\n\n" concat.
 *
 * @param {string} folder  존재 안 하면 빈 결과.
 * @returns {{text: string, files: Array<{relPath, absPath, content, bytes}>}}
 */
export function loadInputFolder(folder) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return { text: "", files: [] };
  }
  const files = [];
  walk(folder, files, folder);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const text = files.map(f => f.content).join("\n\n");
  return { text, files };
}

function walk(dir, out, base) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out, base);
    else if (s.isFile() && name.endsWith(".md")) {
      const content = readFileSync(p, "utf8");
      out.push({
        relPath: p.slice(base.length + 1),
        absPath: p,
        content,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }
}
