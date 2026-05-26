// Domain — Layer 1·2·3 로더.
// 외부 무의존 (fs/path 만). 폴더 우선, 공통 fallback.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * 단일 카테고리(예: "1-core") 로드.
 * @returns {null | {dir: string, items: Array<{name, path, content}>, content: string}}
 */
export function loadLayer(folder, commonLayersDir, category) {
  const folderDir = join(folder, "layers", category);
  const commonDir = join(commonLayersDir, category);
  const dir = existsSync(folderDir) && statSync(folderDir).isDirectory()
    ? folderDir
    : (existsSync(commonDir) && statSync(commonDir).isDirectory() ? commonDir : null);
  if (!dir) return null;
  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  if (files.length === 0) return null;
  const items = files.map(f => {
    const path = join(dir, f);
    return { name: f, path, content: readFileSync(path, "utf8") };
  });
  return { dir, items, content: items.map(i => i.content).join("\n\n") };
}

/**
 * 세 카테고리 한 번에.
 */
export function loadAllLayers(folder, commonLayersDir) {
  return {
    layer1: loadLayer(folder, commonLayersDir, "1-core"),
    layer2: loadLayer(folder, commonLayersDir, "2-brand"),
    layer3: loadLayer(folder, commonLayersDir, "3-section"),
  };
}
