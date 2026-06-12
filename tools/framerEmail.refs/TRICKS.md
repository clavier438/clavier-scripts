# 이메일 HTML 트릭 — framerEmail 학습 레퍼런스

> 이메일은 제약이 극심한 환경 → 패턴이 *유한*하다. 몇 개 트릭만 익히면 거의 끝.
> 정전(canonical) = **Cerberus**(Ted Goas, `cerberus/`), 실물 ESP = **스티비**(`stibee-spread-by-b.html`).
> 출처: https://www.cerberusemail.com/ · https://github.com/emailmonday/Cerberus

---

## ★ 넓은 폭 대응 (사용자 질문: 배경색·선) — 가장 중요

### 트릭 1. 배경색은 **3곳**에 박는다 (Cerberus 주석 line 220-225)
Gmail 은 `body` 배경을 떼버린다 → 한 곳만으론 넓을 때 배경이 안 깔린다.
```html
<body style="background-color:#e6e6e6;" class="email-bg">
  <center style="width:100%; background-color:#e6e6e6;" class="email-bg">   <!-- Gmail/Yahoo/AOL 용 -->
    <!--[if mso]><table width="100%" style="background-color:#e6e6e6;"><tr><td><![endif]-->  <!-- Win10 Mail -->
```
→ 아무리 넓혀도 배경이 화면 전체를 채운다.

### 트릭 2. 콘텐츠는 max-width 로 중앙 고정 + Outlook ghost table (line 247-257)
Outlook(Win)은 `max-width` 를 무시 → mso 조건부 table 로 폭 강제.
```html
<div style="max-width:600px; margin:0 auto;" class="email-container">
  <!--[if mso]><table align="center" width="600"><tr><td><![endif]-->
  ... 콘텐츠 ...
  <!--[if mso]></td></tr></table><![endif]-->
</div>
```
→ 넓으면 600 에서 캡(중앙), 좁으면 squish. 스티비도 동일: `width:94%; max-width:632px; margin:0 auto`.

### 트릭 3. **Full-bleed 배경 밴드** = 풀폭 bg + 안쪽 max-width 중앙 (line 401-427)
섹션 배경/선을 *가장자리까지* 깔되 콘텐츠는 중앙 정렬하고 싶을 때.
```html
<table width="100%" style="background-color:#709f2b;">   <!-- 풀폭 배경(넓을 때 끝까지) -->
  <tr><td>
    <div align="center" style="max-width:600px; margin:auto;">   <!-- 콘텐츠는 중앙 고정 -->
      ... (mso ghost table 동일) ...
    </div>
  </td></tr>
</table>
```
→ "넓을 때 배경색/선" 의 정답. 선(테두리)도 이 밴드나 중앙 컨테이너에 건다.

### 트릭 4. 스티비식 상하 여백 밴드
`.stb-container-full { width:100%; padding:40px 0; background:#e6e6e6 }` — 풀폭 배경 밴드에
상하 패딩만 줘서 숨 쉬는 여백. 모바일 미디어쿼리로 `.stb-container { width:94% !important }`.

---

## 그 외 핵심 트릭 (유한 목록)

| 트릭 | 코드 | 왜 |
|---|---|---|
| **유동 이미지** | `width:100%; max-width:Npx; height:auto; display:block; border:0` | 넓으면 캡, 좁으면 fill |
| **이미지 crop** | `aspect-ratio:W/H; object-fit:cover` (구형은 한계) | 자연비≠표시비 |
| **Outlook 스페이싱** | `mso-table-lspace/rspace:0; mso-line-height-rule:exactly` | Outlook 표 여백 버그 |
| **Outlook 폰트 폴백** | `<!--[if mso]><style>*{font-family:sans-serif!important}</style>` | 웹폰트 무시→Times |
| **Outlook bg이미지 px** | `<!--[if gte mso 9]>…PixelsPerInch 96…` | 72ppi 렌더 교정 |
| **스페이서** | `<td height="40" style="font-size:0;line-height:0">&nbsp;</td>` | margin 못 믿음 |
| **bulletproof 버튼** | `<table><td style="bg;border-radius"><a style="display:block;padding">` | a 만으론 클릭영역/렌더 불안 |
| **인라인 SVG 금지** | 래스터화(webp)→호스팅→`<img>` (data URI 도 Gmail X) | 이메일은 SVG 스트립 |
| **2칼럼→스택** | `<td width="50%">` + `@media(max-width){.col{width:100%!important}}` | 모바일 세로 적층 |
| **preheader** | 숨김 div(미리보기 텍스트) + zwnj 스페이싱 해킹 | 인박스 프리뷰 통제 |
| **Gmail 다운로드버튼 억제** | 큰 비링크 이미지에 `class="a6S"` 트릭 | Gmail UI 간섭 |
| **다크모드** | `@media (prefers-color-scheme: dark)` + `color-scheme` 메타 | |
| **링크 자동검출 차단** | iOS `a[x-apple-data-detectors]`, telephone=no 메타 | 전화/주소 오토링크 |

---

## framerEmail 적용 현황

- [x] 유동 이미지(width:100%+max-width) · 이미지 crop(aspect-ratio+cover)
- [x] max-width 중앙 + 배경(body+table) · % 인셋 fill · SVG 래스터화→R2→img · bulletproof 버튼
- [ ] **배경색 3곳(center/mso)** — 현재 body+table 만 → Gmail 넓은폭에서 배경 빠질 수 있음 ★다음
- [ ] **Outlook ghost table**(max-width 무시 대응) · mso 스페이싱/폰트 폴백
- [ ] full-bleed 배경 밴드(섹션 bg 끝까지) · 상하 여백 밴드
- [ ] preheader · 다크모드 · 2칼럼 스택(가로 그리드)
