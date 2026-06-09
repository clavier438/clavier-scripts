// project.mjs — new: 작업 프로젝트 골격 생성.
//
// folder = meaning: 슬롯 하드코딩 없음. 바로 돌아가는 샘플 1세트만 깐다 —
//   input/sample/ 에 identity placeholder cube(replaceThis.cube) 1개 + 솔리드 jpg 1장.
//   사용자는 sample/ 를 자기 신 이름으로 rename, replaceThis.cube 를 진짜 LUT 으로 교체.
//   베이스가 필요하면 input/ 루트에 cube 를 하나 놓으면 됨 (재귀 체인 — 아래 전부에 첫 적용).

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { spawnSync } from "child_process";

// identity LUT (size 2) — 색을 안 바꾸는 placeholder. 진짜 LUT 으로 교체 전까지 통과만.
const IDENTITY_CUBE = `# replaceThis — identity placeholder. 진짜 .cube 로 교체하세요.
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

const README = `# LUT 작업 프로젝트

폴더 = 설정. 폴더 계층 자체가 LUT 체인이다 (밑줄 _ 시작 = 비활성/무시).

  input/                  원본 사진 + .cube 를 넣는 곳 (재귀)
    <신폴더>/
      아무이름.cube        ← 이 폴더(+하위) 사진에 적용. 이름 자유. 활성 1개만.
      DSC001.jpg
      <하위신>/            ← 하위 폴더는 위 cube + 자기 cube 를 체인 적용 (재귀)
        다른.cube
        DSC010.jpg
    베이스.cube            ← input/ 루트에 두면 모든 신에 먼저 체인 (베이스)

  _preview/               watch 가 1200px 로 덮어쓰는 빠른 확인용 (scratch)
  output/v01, v02, …      render 가 매번 새 버전으로 쌓는 최종 (원본 해상도, history)
  각 출력 폴더의 _recipe.txt = 그 폴더에 적용된 체인·md5·시각

규칙:
  - 폴더당 활성 .cube(밑줄 안 붙은 것)는 1개. 대안은 _쿨버전.cube 처럼 _ 로 토글.
  - 밑줄 _ 시작 = 비활성/무시 (cube·폴더 공통).

사용:
  lut watch <이 폴더>     # 저장하면 _preview/ 자동 갱신 (실시간)
  lut render <이 폴더>    # output/vNN/ 에 원본 해상도 최종 (버전 누적)
`;

function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 새 프로젝트 골격 생성.
 * @param {string} name        프로젝트명
 * @param {string} [parentDir] 부모 경로 (없으면 cwd)
 * @returns {{dir: string, created: boolean, sampleJpg: boolean}}
 */
export function newProject(name, parentDir) {
  if (!name || !name.trim()) throw new Error("프로젝트명이 필요합니다.");
  const parent = resolvePath(parentDir || process.cwd());
  const dir = join(parent, `${todayStamp()}_${name.trim()}`);
  if (existsSync(dir)) return { dir, created: false, sampleJpg: false };

  const sampleDir = join(dir, "input", "sample");
  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(join(dir, "_README.md"), README);
  writeFileSync(join(sampleDir, "replaceThis.cube"), IDENTITY_CUBE);

  // 솔리드 샘플 jpg (ffmpeg). 없으면 best-effort 스킵.
  const r = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x8899AA:s=1200x800",
    "-frames:v", "1", join(sampleDir, "sample.jpg"),
  ], { stdio: "ignore" });

  return { dir, created: true, sampleJpg: r.status === 0 };
}
