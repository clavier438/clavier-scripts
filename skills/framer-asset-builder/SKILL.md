---
name: framer-asset-builder
description: >-
  Framer 코드 컴포넌트(에셋) 를 만들거나 고칠 때 따르는 규칙·체크리스트·함정 모음. 핵심은
  **"변수 형태로 내보낼 수 있는 모든 값은 반드시 prop(바인딩 가능한 ControlType)으로 노출"** —
  자꾸 놓치는 값 목록과 감사(audit) 한 줄 스크립트를 박아둠. 워크플로(기능 하나씩 → esbuild 구문검증
  → git commit → 마지막에 updateCodeFile 푸시 1회), 비파괴 CSS/SVG 그레이딩 패턴(feComponentTransfer·
  feComposite arithmetic·언샤프 마스크), Framer 함정(ts-nocheck·@framerSupportedLayout·useId·
  이미지는 Array 금지 개별 슬롯·ResponsiveImage·토글 게이트 그룹)도 담음. Framer 코드 컴포넌트/에셋/
  캐러셀/그레이딩/property control/ControlType/변수 바인딩/updateCodeFile 작업을 시작하거나, "프레이머
  컴포넌트 만들어/고쳐", "framer asset", "프레이머에셋빌더", "이 값도 변수로 빼", "변수로 내보낼 수 있는
  거 다 prop 으로 됐는지 확인" 같은 말이 나오면 이 스킬을 사용할 것.
---

## 목표

Framer **코드 컴포넌트(에셋)** 를 만들 때 매번 같은 품질을 내고, 같은 실수를 반복하지 않는다.
이 문서의 **1번(변수 노출 체크리스트)** 이 핵심이다 — 나머지는 워크플로·함정 메모.

> 이 스킬은 권유가 아니라 **체크리스트**다. 컴포넌트를 push 하기 전에 §1 audit 을 *실제로 돌려서* 통과시킨다.

---

## 1. ★ 변수 노출 체크리스트 (가장 중요 — 자꾸 놓침)

**원칙: 디자이너가 Framer Variable / CMS 필드로 제어하고 싶을 법한 모든 값은, 바인딩 가능한 ControlType 의 property control 로 노출한다.** 하드코딩 금지.

### 1.1 바인딩 메커니즘 (검증됨)
- Framer 변수/CMS 바인딩은 **코드측 플래그가 없다.** `addPropertyControls` 의 **ControlType 만으로** 캔버스에서 자동 활성화된다. (출처: Framer 공식 코드 가이드 `mcp://mcp.unframer.co/prompts/how-to-write-framer-code-files.md` / https://www.framer.com/developers/property-controls — 24개 ControlType 어디에도 바인딩 enable 옵션 없음.)
- 즉 **"변수로 노출 = 올바른 타입의 prop 으로 내보내는 것 자체"** 다. 그 외에 할 일 없다.

### 1.2 바인딩 가능 ↔ 불가 타입
| 변수 바인딩 **가능** (이 타입이면 자동으로 변수/CMS 연결됨) | 변수 타입 **없음** (코드로 못 바꿈 — 플랫폼 한계) |
|---|---|
| `Color` · `Number` · `Boolean` · `String` · `ResponsiveImage` · `Link` · `Date` · `File` | `Enum` · `Padding` · `BorderRadius` · `Border` · `BoxShadow` · `Gap` · `Font` · `Cursor` · `Object` · `Array` |
| `Transition` → 공유 **Transition 변수**에 바인딩됨 | `ComponentInstance` → 슬롯(값 아님) |

→ 값이 위 왼쪽 타입에 해당하면 **무조건 prop 으로**. Enum/Padding 등은 대응 변수 타입이 없어서 안 되는 것이라 어쩔 수 없다(우회 설계는 가능하나 보통 표준 유지).

### 1.3 자꾸 놓치는 값들 (= 하드코딩 했다가 나중에 "이것도 빼줘" 듣는 것들)
- **강도/양/세기 (%, 0~1)** — 효과는 거의 항상 amount/intensity prop 이 있어야 한다. *(실제 사례: duotone 을 on/off 로만 만들었다가 "20%만 살짝" 요청 받고 `duoAmount` 추가)* → **효과 추가할 땐 amount 부터 같이.**
- **색 (tint / overlay / shadow / highlight / dim)** — 디자이너가 바꾸고 싶어함 → `ControlType.Color`.
- **반경 radius** (corner, blur, mask, vignette) → `Number`.
- **시간 duration / interval / delay** → `Number`.
- **불투명도 opacity / 임계값 threshold / 개수 count / 간격 gap** → `Number`.
- **토글** (기능 on/off) → `Boolean`.
- **이미지** → `ResponsiveImage` (각각 개별 슬롯, §3.4).
- ⚠ 구분: 사용자가 만지는 **노브**는 prop / 내부 **매핑 상수**(예: warmth 오버레이 색 `rgb(255,166,87)`, vignette 농도계수 0.85)는 구현값이라 노출 X. 헷갈리면 "디자이너가 이걸 슬라이더로 만지고 싶을까?" 로 판단.

### 1.4 푸시 전 audit (실제로 돌려라)
컴포넌트 파일에서 모든 컨트롤의 ControlType 을 뽑아 분류:
```bash
node -e '
const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");
const b=t.slice(t.indexOf("addPropertyControls("));
const re=/\n    (\w+): \{/g; let m, keys=[];
while((m=re.exec(b))) keys.push({name:m[1],idx:m.index});
const BIND=new Set(["Color","Number","Boolean","String","ResponsiveImage","Image","Link","Date","File","Transition"]);
const out=keys.map((k,i)=>{const seg=b.slice(k.idx,keys[i+1]?keys[i+1].idx:undefined);const tm=/ControlType\.(\w+)/.exec(seg);return{n:k.name,t:tm?tm[1]:"?"}});
const bind=out.filter(c=>BIND.has(c.t)), nov=out.filter(c=>!BIND.has(c.t));
console.log("바인딩가능("+bind.length+"):",bind.map(c=>c.n+"("+c.t+")").join(", "));
console.log("\n변수타입없음/슬롯("+nov.length+"):",nov.map(c=>c.n+"("+c.t+")").join(", "));
' <컴포넌트.tsx>
```
→ "변수타입없음/슬롯" 목록을 눈으로 보고, **Enum/Padding/슬롯이 아닌데 거기 끼어있으면 = 놓친 것.** 그리고 코드의 하드코딩 숫자/색이 §1.3 에 해당하면 prop 으로 끌어올린다.

---

## 2. 워크플로 (사용자 지시 표준)

1. **기능 하나씩 구현 → esbuild 구문검증 → git commit.** (커밋 충실히, 되돌릴 수 있게. 되돌릴 땐 `git revert` 로 히스토리 보존.)
2. esbuild 구문검증: `<node_modules>/.bin/esbuild "<파일>.tsx" --format=esm`  (성공만 확인. `// @ts-nocheck` 라 타입에러는 무시됨.)
3. **MCP 푸시 = `mcp__framer__updateCodeFile(codeFileId, content=<파일 전체>)`.** 자동 typecheck(`typecheck: []` = 통과). 라이브 iterate(사용자가 Framer 에서 시각 확인) 중에는 요청마다 푸시 OK. 한 묶음 신규 기능을 처음 올릴 때는 마지막 1회로 몰아도 됨.
4. 버전/체인지로그는 기능 완료 후(esbuild 통과 후) 올린다 — documentation-ahead-of-code 금지.
5. `codeFileId` · `insertURL` 은 **프로젝트마다 다름** — 여기 하드코딩하지 말고 그때 `getProjectXml` 로 확인.

### 2.1 검증 분담
- **내가 할 수 있는 것**: esbuild 구문 / updateCodeFile typecheck / 순수함수 단위테스트(노브→CSS/SVG 문자열 매핑을 node 로 검증) / 로직 리뷰.
- **사용자 몫**: 캔버스 픽셀(실제 렌더 모양) — 내가 못 봄. push 후 Framer 에서 시각 확인이 합의된 분담. 이건 떠넘김이 아니라 구조적 분담이지만, 내 쪽 객관 검증(esbuild+단위테스트)은 *먼저 끝내고* 보고한다.

---

## 3. Framer 함정 (반복 실수 방지)

- **`// @ts-nocheck`** 파일 맨 위 (Framer 가 타입 느슨).
- **`@framerSupportedLayoutWidth/Height fixed`** export default 함수 위 JSDoc 필수 — 없으면 높이 0 붕괴.
- **SSR 안전 id = `React.useId()`** (`Math.random()` 금지 — 서버/클라 하이드레이션 불일치). `url(#id)` 용이면 콜론 제거: `useId().replace(/:/g,"")`.
- **이미지는 개별 슬롯 `image1..imageN`** (각 `ControlType.ResponsiveImage`). **절대 `Array` 로 묶지 말 것** — Array 로 묶으면 CMS 필드 바인딩이 죽는다. 슬롯이라야 각각 따로 CMS 바인딩.
- **`ControlType.Image` deprecated → `ResponsiveImage`** ({src, srcSet, alt}). 옛 문자열 URL 도 방어적으로 수용.
- **`ControlType.Transition` 은 변수 바인딩 됨** (과거 "불가"는 오답).
- **패널 그루핑**: 선택 기능은 `Boolean` 토글로 게이트(`xxxOn`, 기본 false → 패널 깔끔). 토글 켜야 옵션 `hidden:(p)=>!p.xxxOn`. 서로 독립이어야 할 기능은 enum 한 개로 배타시키지 말고 **각자 토글**(예: Duotone·Film Tone 분리 → 동시 적용 가능).
- **카테고리 간격** = 각 그룹 *마지막 보이는 컨트롤*의 `description: "\n\n"`(2줄). 토글 자체엔 간격 X(펼친 옵션 밀착).
- **컨트롤 타이틀은 모드 값과 겹치지 않게** (예: transition 모드값 Slide/Fade 와 곡선 컨트롤 이름이 겹쳐 오해 → "Transition Type" / "Transition Graph" 로 분리).
- 슬롯/레이아웃은 **밖으로 위임**: 점·화살표는 `ComponentInstance`(외형 소유), 레이아웃 엔진은 사용자가 만든 Stack 에 children 주입. 컴포넌트는 index·active variant·onClick 만.

---

## 4. 비파괴 그레이딩 (CSS/SVG 필터 — CORS 안전, 픽셀 안 읽음)

이미지 보정은 **전부 CSS/SVG 필터**로. 캔버스에서 픽셀을 읽지 않으니 CORS 안전 + 비파괴.

- **Levels / Curves / 채널 매핑** = SVG `feComponentTransfer` (`type="linear"|"gamma"|"table"`). 여러 개는 한 `<filter>` 안에서 implicit chain.
- **블렌드/강도 보간** = `feComposite operator="arithmetic"` → `result = k1·i1·i2 + k2·i1 + k3·i2 + k4`. **두 입력을 amt:1−amt 로 섞으려면 `k2=amt, k3=1−amt` (합=1 → 색역 안전).** (예: 듀오톤 강도 = duoFull 과 SourceGraphic 보간.)
- **언샤프 마스크(샤픈/소프트포커스)** = `feGaussianBlur` + `feComposite arithmetic`: `out=(1+amt)·src − amt·blur` → `k2=1+amt, k3=−amt`. `k2+k3=1` 항상 → **amt>0=선명(외삽, 엣지 헤일로), amt<0=소프트포커스(보간, 가우시안 풀블러보다 부드러움)**. 슬라이더 0=무보정 중앙(`min:-100,max:100,default:0`).
- **조건부 필터 체인 위에 얹기**: implicit chain 의 마지막 결과를 `feOffset dx=0 dy=0 result="gbase"` 로 **명시 네이밍** 후 blur/composite 의 `in`/`in2` 를 명시 배선. 안 그러면 체인 깨짐. grade 없으면 기준 = 내장 `SourceGraphic`.
- **듀오톤** = `feColorMatrix`(luminance) → `feComponentTransfer type="table"`(shadow/highlight 색) → (강도 보간).
- **오버레이형 톤**(warmth/fade/vignette/grain) = blend-mode `<div>` 오버레이 (`mixBlendMode`, `radial-gradient`, `feTurbulence` 그레인). `isolation:isolate` 로 슬라이드 안에서만 합성.
- 색 파싱은 SSR 안전 헬퍼로 hex/rgb → 0~1 (`Math.random`·DOM 의존 X).
- **밝기/대비/채도/흑백은 Framer 네이티브 Styles ▸ Filters 와 중복** → 컴포넌트에 넣지 말고 네이티브로 (단, *마스크/부분 적용*이 필요하면 컴포넌트에서).

---

## 5. 보류/안 되는 것
- **프리셋 자가 저장** — 코드 컴포넌트로 불가(앱 기능). Framer **배리언트**가 그 역할.
- **조정 레이어 스택**(이미지 복제 겹 + per-layer mask) — 가능하지만 무겁고, 한 번 시도했다가 사용자가 "레이어 개념 빼자"로 revert. 필요 시 §4 의 단일 필터 + CSS `mask-image`(radial/linear gradient) 로 가볍게.
- **backdrop-filter** 다단 — Safari 프리픽스·성능·겹침 합성 까다로움. 비추.

---

## 부록: 참고 레퍼런스
- Framer 공식 코드 가이드(권위): MCP 리소스 `mcp://mcp.unframer.co/prompts/how-to-write-framer-code-files.md` (ControlType 전체 정의·예시).
- Property Controls 문서: https://www.framer.com/developers/property-controls
- 실작업 인계 예시: `…/works/asset/framer/HANDOFF.md` (CMSGalleryCarousel — 이 스킬의 규칙들이 처음 도출된 컴포넌트).
