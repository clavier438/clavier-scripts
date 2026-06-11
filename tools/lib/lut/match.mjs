// match.mjs — 사진 시작값을 한 목표로 정규화 (lut match 의 코어). transfer 의 per-photo 형제.
//
//   transfer  = 폴더 평균→평균 LUT 1개 (배치를 같은 양 이동, 개별 편차 잔존).
//   match     = 사진마다 다른 정규화 cube → *시작값을 똑같이* (일괄 LUT 의 전제).
//
//   정신 (extract.mjs 미러):
//     ① 몽타주 먼저 — before/after 한 시트로 깔아 *균일해졌는지* 한눈에 판단.
//     ② 색수학·베이크는 photo-normalize.py(Reinhard mean+std)에 위임 — Node 색수학 0.
//     ③ 적용은 apply.mjs(ffmpeg) 재사용 — 단, 사진마다 *다른* cube (manifest 매핑).

import { existsSync, readFileSync } from "fs";
import { join, resolve, relative } from "path";
import { applyOne, runPool } from "./apply.mjs";
import { walkPhotos, requireDir, runPy } from "./extract.mjs";
import { bold, dim, cyan, green, yellow } from "../cli-color.mjs";

/**
 * match — 적용 폴더 사진을 목표 분포로 per-photo 정규화.
 *   목표: ref(사진) > model(폴더) > 자기 폴더 평균.
 *   산출(적용 폴더 안): _normalize/ (cube+manifest) · _preview/ · _montage/{before,after}/
 */
export async function runMatch(srcFolder, { model, ref, strength } = {}) {
  const src = requireDir(srcFolder, "적용");
  const srcPhotos = walkPhotos(src);
  if (!srcPhotos.length) throw new Error(`적용 사진 없음: ${src}`);
  const modelDir = model ? requireDir(model, "모델") : null;

  const targetDesc = ref ? `기준컷 ${relative(src, resolve(ref)) || ref}`
    : modelDir ? `모델 ${modelDir}` : "자기 폴더 평균";

  console.log(bold(cyan(`\n① 몽타주(before) — 적용 ${srcPhotos.length}장 한눈에`)));
  runPy("photo-montage.py", [src, "--out", join(src, "_montage", "before")], "montage(before)");

  console.log(bold(cyan(`\n② 정규화 cube 베이크 — 목표: ${targetDesc} (photo-normalize)`)));
  const cubedir = join(src, "_normalize");
  const manifest = join(cubedir, "manifest.json");
  const args = [src, "--cubedir", cubedir, "--manifest", manifest, "--strength", String(strength ?? 1.0)];
  if (ref) args.push("--ref", resolve(ref));
  else if (modelDir) args.push("--model", modelDir);
  runPy("photo-normalize.py", args, "photo-normalize");
  if (!existsSync(manifest)) throw new Error(`manifest 생성 실패: ${manifest}`);

  const { entries } = JSON.parse(readFileSync(manifest, "utf8"));
  if (!entries?.length) throw new Error("정규화된 사진 없음");

  console.log(bold(cyan(`\n③ per-photo 적용 → _preview/ (사진마다 자기 cube)`)));
  const preview = join(src, "_preview");
  const thunks = entries.map(e => () => applyOne({
    input: e.photo,
    output: join(preview, e.rel.replace(/\.[^.]+$/, "") + ".jpg"),
    chain: [e.cube], scale: 1200, quality: 2, preserveMetadata: false,
  }));
  const results = await runPool(thunks, {
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}   `),
  });
  process.stdout.write("\n");
  const ok = results.filter(r => r.ok).length;

  console.log(bold(cyan(`\n④ 몽타주(after) — 정규화 결과 한눈에 (균일해졌나)`)));
  runPy("photo-montage.py", [preview, "--out", join(src, "_montage", "after")], "montage(after)");

  console.log(green(`\n✓ match 완료 — ${src}`));
  console.log(`  ${cyan("_preview/")}   정규화 미리보기 ${ok}/${entries.length}장`);
  console.log(`  ${cyan("_montage/before")} vs ${cyan("after")}  시작값이 균일해졌는지 두 시트 비교`);
  console.log(`  ${cyan("_normalize/")}  사진별 정규화 cube + manifest.json`);
  console.log(dim(`  · 다음: after 가 충분히 균일하면 여기서 멈추고 이 폴더에 브랜드 LUT 일괄 적용.`));
  console.log(dim(`    아직 들쭉날쭉하면 MKL(공분산 매칭)로 올리거나 --ref/룩별 분리 고려.`));
}
