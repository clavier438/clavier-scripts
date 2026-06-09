// project.mjs — new: 작업 프로젝트 골격 생성.
//
// folder = meaning: 시나리오 슬롯을 하드코딩하지 않는다. 중립적 샘플 3개만 깔고
// (scene_a/b/c) 사용자가 자기 LUT명에 맞춰 rename/추가/삭제. 폴더명 = LUT명 = 진실.
// 마스터 LUT 라이브러리에서 복사하지 않음 — 빈 luts/ 에 사용자가 .cube 를 떨군다
// (루트 하드코딩 0). 나중에 --from <dir> 로 가져오는 건 별도.

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve as resolvePath } from "path";

const SAMPLE_SCENES = ["scene_a", "scene_b", "scene_c"]; // 중립 샘플 (rename/삭제용)
const SYSTEM_DIRS = ["luts", "_preview", "_out", "_review"];

function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const README = `# LUT 작업 프로젝트

폴더 = 설정. 스크립트는 폴더가 시키는 대로만 한다 (밑줄 시작 = 시스템 무시).

- \`luts/\`          여기에 Photomator 등에서 export 한 \`.cube\` 를 떨군다.
    - \`luts/<이름>.cube\`  → 시나리오 \`<이름>/\` 폴더에 적용.
    - \`luts/_base.cube\`   → (있으면) 모든 시나리오에 먼저 체인 적용. 없으면 Scene 단독.
    - \`luts/_<...>.cube\`  → 밑줄 = 비활성 (토글). \`__base.cube\` 처럼.
- \`<이름>/\`         시나리오 폴더 = LUT명과 같은 이름. 안에 원본 사진을 넣는다.
                      (scene_a/b/c 는 샘플 — 네 시나리오명으로 rename 하거나 지워라.)
- \`_preview/\`       watch 가 자동 생성하는 1200px 미리보기 (시스템 영역).
- \`_out/\`           render 최종 고해상도 출력 (시스템 영역).
- \`_review/\`        수동 보정용 — 시스템이 절대 안 건드림.

사용:
    lut watch <이 폴더>     # 저장하면 _preview/ 자동 갱신 (실시간)
    lut render <이 폴더>    # _out/ 에 원본 해상도 최종 출력
`;

/**
 * 새 프로젝트 골격 생성.
 * @param {string} name        프로젝트명
 * @param {string} [parentDir] 부모 경로 (없으면 cwd)
 * @returns {{dir: string, created: boolean}}
 */
export function newProject(name, parentDir) {
  if (!name || !name.trim()) throw new Error("프로젝트명이 필요합니다.");
  const parent = resolvePath(parentDir || process.cwd());
  const dir = join(parent, `${todayStamp()}_${name.trim()}`);

  if (existsSync(dir)) return { dir, created: false };

  mkdirSync(dir, { recursive: true });
  for (const d of [...SYSTEM_DIRS, ...SAMPLE_SCENES]) {
    mkdirSync(join(dir, d), { recursive: true });
  }
  writeFileSync(join(dir, "_README.md"), README);
  return { dir, created: true };
}
