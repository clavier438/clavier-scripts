// Domain — inputs/ 로더.
// 카피 자료의 정의 = "<folder>/inputs/*.md 만". 다른 위치 자동 로드 안 함.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * @returns {Array<{name, path, content}>}  inputs/*.md (없거나 비어있으면 [])
 */
export function loadInputs(folder) {
  const dir = join(folder, "inputs");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .map(f => {
      const path = join(dir, f);
      return { name: f, path, content: readFileSync(path, "utf8") };
    });
}
