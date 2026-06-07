# 2026-06-07 — photo-lut: 사진에서 컬러그레이딩 .cube LUT 역추출 (정책별 자동 분리)

> 이 ADR 은 **repo-scoped (leaf)** — Layer 1 system ADR 아님.
> 전파 적소 = `DESIGN_RECON.md` (포토디렉션 레이어·툴킷). doc-coverage 12-doc cascade **불요**.

---

## 맥락

`image-tagger` 가 "무엇을(피사체·톤·후보정)" *분류*한다면, 사용자는 한 걸음 더 — **"이 브랜드의 컬러그레이딩을 내 사진에 입히는 LUT"** 를 원했다. 요구 두 가지:
1. 단순 평균색이 아니라 *톤을 만드는 세부 보정*(split-toning: 섀도우/하이라이트를 각각 다른 색으로) 포착.
2. 디렉션(그레이딩 정책)이 갈리면 *각기 다른 LUT* 를 다 뽑기.

## 결정

`tools/photo-lut.py` — 사진 **출력만으로(보정 전 원본 불필요)** 그레이딩을 `.cube` 3D LUT 로 역추출.

- **그레이딩 서명**: 톤 구간별(섀도우/미드/하이라이트) LAB 평균 = 구간별 색조. split-toning·톤 형성을 잡는다 (전역 평균 1개로는 못 잡음).
- **베이크**: identity 격자(17³)의 각 점을 휘도에 따라 구간별 (a,b) 시프트 → `.cube`. (Reinhard 2001 색전이를 톤 구간으로 확장)
- **정책 클러스터**: 사진별 서명 벡터를 거리(`--threshold`) 응집 클러스터 → 정책이 벌어지면 별도 그룹 → 그룹마다 `<host>_N.cube`.
- **기본 기능 통합**: `recon.organize` 가 photos 변환 직후 자동 호출 → `recon/luts/`. 색만 보므로 `tag`(비전) 불필요.
- 의존성 0 — numpy 없이 PIL + stdlib (격자 작아 가벼움).

## 검증

- LAB round-trip err **0.00012**.
- split-toning 테스트(섀도우 쿨 / 하이라이트 웜) → `shadow b−17`, `high b+36.7` 정확 포착.
- `.cube` 4913줄(17³) 유효 포맷.
- 웜3 + 쿨2 → **2개 정책 그룹 자동 분리** (`_1.cube` 쿨 / `_2.cube` 웜).
- `brandRe folder` → organize → `recon/luts/` 자동 생성 end-to-end.

## 한계 / 후속

- Reinhard 류 **전역 그레이딩** — 색온도·split·콘트라스트 무드는 잡지만 로컬 마스킹/정밀 톤커브는 근사. 부족하면 채널 히스토그램(CDF) 매칭으로 정밀화.
- `_layers.json`/brandguide 의 LUT 섹션은 후속 (현재 `recon/luts/` + `summary.md` 까지).
- `image-dedup` 이 photos 를 줄이므로 LUT 도 대표 사진 기준 (실사진엔 영향 적음).

## reference

- Reinhard color transfer (LAB mean/std): https://pyimagesearch.com/2014/06/30/super-fast-color-transfer-images/
- .cube 포맷 생성: https://colorscience.medium.com/get-any-preset-filter-look-in-minutes-fb7500c67315
