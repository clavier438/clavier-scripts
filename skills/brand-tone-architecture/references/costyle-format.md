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
- 구버전(Engine 900)은 `<SL>` 안에 보정값을 평면으로 — `StyleSource`/`FilmCurve`/`ICCProfile` 키 등장. **신규 작성은 1300 레이어형으로.**

## 검증된 보정 키 (값 포맷)

### White Balance
- `WhiteBalanceTemperature` — 켈빈 float (예 3708.4)
- `WhiteBalanceTint` — float (예 -5.1)

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
