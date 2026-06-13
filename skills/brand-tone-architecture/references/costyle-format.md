# Capture One `.costyle` 포맷 — 검증된 키 사전

> 원칙: **emit 하는 모든 `K` 는 실물 export 또는 GitHub 코퍼스(~616개 `.costyle`)에서 *관측된* 것만.** 추측 금지.
> 검증 출처: 사용자 실제 CO export(Engine 1300) + GitHub `lolochristen/CaptureOne_FilmStyles` 등. hit 수 = `gh api search/code "<key> extension:costyle"`.

## 구조 (Engine 1300, 레이어형 — 현행 CO)

```xml
<?xml version="1.0"?>
<SL Engine="1300">                       <!-- 스타일 메타 -->
	<E K="Name" V="..." />
	<E K="UUID" V="대문자-GUID" />
</SL>
<LDS>                                     <!-- 레이어 컨테이너 -->
	<LD>
		<LA>                              <!-- 이 레이어의 보정값 -->
			<E K="..." V="..." />
		</LA>
		<MDS><MD>                         <!-- 마스크 (전체적용) -->
			<E K="BlendMode" V="0" />
			<E K="Density" V="1" />
			<E K="MaskType" V="1" />
		</MD></MDS>
	</LD>
</LDS>
```

- 레이어 공통: `Name`, `Opacity`(0~100), `Enabled`(1).
- 구버전(Engine 900)은 `<SL>` 안에 보정값을 평면으로 — `StyleSource`/`FilmCurve`/`ICCProfile` 키 등장.

## ★ 레이어 호환 vs 배경 전용 — 라이브 검증으로 확정 (2026-06-13)

> **CO를 실제 조작해 mukayu 스타일을 적용·검사한 결과.** Indoor_Base(Engine 1300 레이어형)를 적용하니
> 이름 붙은 조정 레이어로 살아나고 HDR이 **-90/85/-100/-95 정확히** 박힘(클램프 없음). 그러나
> 같은 레이어 `<LA>`에 넣은 **WhiteBalanceTemperature는 드롭** — WB 도구는 5000 Shot 기본값 그대로.

**Capture One 보정은 두 종류:**
- **레이어 호환** (조정 레이어 `<LA>`에서 작동): ColorBalance 3-way·`ColorCorrections`(Color Editor)·`GradationCurve*`·`Levels`·HDR(`*Recovery*`)·`Clarity`/`ClarityStructure`·Saturation·Contrast 등. → 레이어형 스타일에 넣으면 정확히 박힘.
- **배경 전용** (레이어에서 무시·드롭): **`WhiteBalanceTemperature`/`WhiteBalanceTint`**, `Base Characteristics`/`ICCProfile`/`Curve(Base)`. → 레이어형 `<LA>`에 넣으면 **조용히 사라짐**.

**그래서 작성 규칙 (한 방향 결정):**
1. **브랜드 톤 스타일에는 절대 WhiteBalance를 넣지 않는다.** WB는 *사진마다 다른 촬영 조명값* — 고정하면 다른 빛의 사진을 틀리게 물들인다. CO 벤더 Creative Edits도 절대 WB 대신 *상대* ColorBalance만 쓴다 ([[authoritative-samples]]). 브랜드 톤 = ColorBalance·Color Editor(상대 컬러)로 표현 → 레이어 호환이라 완벽히 작동.
2. **배경 전용 보정(WB 등)을 꼭 스타일에 담아야 하면 → 평면(flat) 스타일** (`<LDS>` 없이 `<SL>` 안에 직접). 평면 스타일은 배경에 적용돼 WB가 먹는다. 벤더가 WB 포함 스타일을 평면으로 배포하는 이유.
3. 레이어 스택 아키텍쳐(BASE 컬러 / mood HDR / Util trim)는 **레이어 호환 보정만 담으므로 레이어형(1300)이 정답.**

## 검증된 보정 키 (값 포맷)

### White Balance ⚠️ 배경 전용 — 레이어형 스타일에선 드롭됨 (위 ★ 섹션)
- `WhiteBalanceTemperature` — 켈빈 float (예 3708.4)
- `WhiteBalanceTint` — float (예 -5.1)
- 브랜드 톤 스타일엔 넣지 말 것(촬영별 값). 꼭 담으려면 평면 스타일로.

### Color Balance (3-way split-toning) — 핵심 컬러 DNA
- `ColorBalanceShadow` / `ColorBalanceMidtone` / `ColorBalanceHighlight`
- 값 = `R;G;B` 배율, **1.0 근방** (예 `0.99;1.00;1.02` = 쿨 섀도우). 1.0=중립.

### Color Editor (Advanced) — 색역별
- `ColorCorrections` — 색역당 18개 콤마값, 색역끼리 `;` 구분. 복잡 — 실물에서 복사·수정만, 손작성 비권장.

### Tone
- `Exposure` (EV float) · `Contrast` (float) · `Saturation` (int, 음수=desat) · `Brightness`
- `GradationCurve` / `GradationCurveRed/Green/Blue/Y` — `x,y;x,y;...` (0~1 좌표쌍)

### HDR (mood/variant)
- `HighlightRecoveryEx` · `ShadowRecovery` · `BlackRecovery` · `WhiteRecovery` — 대략 -100~100. 양수 Shadow/White Recovery = 열기(밝게), 음수 = 누르기.

### Clarity / Structure
- `Clarity` (int) · `ClarityStructure` (int) · `ClarityMethod` (int, 관측값 2)

### Sharpening (Unsharp Mask)
- `UsmAmount` (int, ~0-1000) · `UsmRadius` (float, ~0.5-2.5)

### Vignette / Grain (trim)
- `Vignetting` (int, -100~+100, 음수=어둡게)
- `FilmGrainAmount` · `FilmGrainDensity` · `FilmGrainGranularity` · `FilmGrainType` (int)

## 저장 위치 (Mac)
`~/Library/Application Support/Capture One/Styles/`
- 하위 폴더 = CO UI 의 스타일 *그룹*. (예: `Styles/Mukayu (from photos)/`)
- `.costylepack` = 여러 .costyle + 사이드카를 zip 한 배포 묶음.

## 미확인 (필요시 REF export 로 확정)
- LCC/Vignette method, Levels, Noise Reduction 세부, Black&White 등 — 사용할 때 실물 1회 export 로 키 확인 후 추가.
