---
name: agency-web-collector
description: 디자인/브랜딩 에이전시 이름을 받아 그 에이전시가 **직접 디자인·구축한 웹사이트만**(포트폴리오의 Website/Web/Digital 분류) 수집하고, 각 사이트의 공식 라이브 URL을 찾은 뒤, Desktop에 CSV로 저장하고 Airtable design 베이스 webDesignModel 테이블에 중복 없이 추가하여 tag 필드에 에이전시 slug로 태깅하는 스킬. 전체 클라이언트 명단이 아니라 *에이전시가 웹을 만든 건만* 담는다(book·packaging·identity·전시만 맡은 클라이언트 제외). "baton 포트폴리오 다 긁어줘", "에이전시 클라이언트 URL 수집", "스튜디오 작업물 에어테이블에 넣어", "OO 에이전시 웹사이트 레퍼런스 정리", "에이전시 긁어줘", "클라이언트 사이트 다 모아줘", "OO가 디자인한 웹사이트 정리" 같은 말이 나오면 반드시 이 스킬을 사용할 것.
---

## 목표

한 에이전시가 **직접 디자인·구축한 웹사이트만** 수집 → 라이브 URL 확인 → CSV 저장 → Airtable 추가 + 태깅을 한 번에 처리한다.

> ⚠️ **스코프 = "에이전시가 웹을 만든 건"이지 "에이전시 전체 클라이언트 명단"이 아니다.**
> 이 DB(webDesignModel)는 *웹 디자인 레퍼런스*다. 에이전시가 book·packaging·identity·전시만 맡고 웹은 안 만든 클라이언트는 그 사이트가 에이전시 작업이 아니므로 **넣지 않는다**. (사용자: "디자인한 웹이어야 해")

---

## Step 1: 에이전시 slug 확정

사용자 발화에서 에이전시명을 추출해 slug로 변환한다.
- "플러스엑스" → `plus-x`, "바톤" → `baton`, "propaganda" → `propaganda`
- slug는 Airtable tag 값 + CSV 파일명에 사용된다

---

## Step 2: 디자인한 웹사이트만 수집 (원본 HTML + WebSearch + WebFetch)

**먼저 "웹 작업이 포함된 프로젝트"만 골라낸다.** 포트폴리오는 한 클라이언트에 identity·book·packaging·website가 섞여 있으니, 그중 *에이전시가 웹을 만든 것*만 남긴다.

식별 방법 (우선순위):

1. **포트폴리오 category/discipline 분류로 필터** — 대부분의 에이전시 사이트는 작업을 분야별로 태깅한다(Website / Web / Digital / Interactive). 이게 가장 정확하다.
   - **JS 필터 UI라도 서버 렌더 HTML 원본에 분류가 class/data 속성으로 박혀 있는 경우가 많다.** `curl`로 원본을 받아 분류를 grep:
     ```bash
     curl -sL "<포트폴리오 URL>" -o /tmp/p.html        # ← curl 막히면 sandbox off
     grep -oiE 'data-filter="[^"]*"' /tmp/p.html        # 필터 버튼 = 분야 목록 확인
     grep -iE 'class="[^"]*\b(website|web|digital)\b'   # 각 프로젝트의 분류 class
     ```
   - 함정: zsh에서 `for x in $var`는 단어분리 안 됨 → 슬러그/URL은 `for x in a b c`로 **직접 나열**.
2. **분류가 없으면** 각 프로젝트 케이스스터디를 열어 작업 목록에 web/website/digital이 있는지, 또는 라이브 사이트로 나가는 링크가 있는지 확인.
3. book·packaging·identity·exhibition **만** 있는 클라이언트는 **제외** (그 사이트는 에이전시가 만든 게 아님).

라이브 URL 추출 시 **제작 크레딧 링크 제외** — 케이스스터디 외부 링크엔 사진가·개발 스튜디오(예: `cliff.studio`, `rd-ck.com`)·협업자 사이트가 섞여 있다. 브랜드 *본* 사이트만 취한다.

같은 브랜드/도메인이 여러 프로젝트로 쪼개져 있으면(메인 + 컬렉션 등) **1개로 통합**.

JS 렌더링으로 분류 확인 불가 시: 검색(`"{에이전시명} website"`, `"site:behance.net {에이전시명}"`)·기사로 보완하되 *web 작업이 확실한 것만*. 불완전하면 사용자에게 고지.

수집 결과 형식 (live = 브랜드 본 사이트, ref = 에이전시 케이스스터디):
```json
[{"project": "브랜드명", "live_url": "https://brand.com", "ref_url": "https://agency.com/work/brand" }]
```

---

## Step 3: 라이브 URL 검색 (live_url=null인 항목)

- `"{브랜드명} 공식 사이트"` 또는 `"{브랜드명} official website"` 검색
- 못 찾으면 null 유지 — 추측으로 채우지 않는다

---

## Step 4: Airtable 중복 체크

**Airtable 정보:**
- baseId: `app9b7X9Tn2SXGuMW`
- tableId: `tblP3gahgZd4ro3i7` (webDesignModel)
- `이름` 필드 ID: `fldLspoCxaIf47Jm2`

기존 `이름` 전체를 조회해 대소문자 무시 비교. 중복 항목은 스킵 (업데이트 X).

---

## Step 5: CSV 저장

`~/Desktop/{slug}-clients-live.csv` 생성 (UTF-8, LF):
```csv
project,live_url
클라이언트명,https://...
```
URL 있는 항목만 포함.

---

## Step 6: Airtable 삽입

신규 항목(중복 제외)을 50개씩 배치로 추가한다.

**필드 매핑:**
| 필드 | ID | 값 |
|------|----|----|
| 이름 | `fldLspoCxaIf47Jm2` | project(브랜드)명 |
| 공식 웹사이트 | `fldGZE1lZ8IlKyfX4` | live_url (있을 때만) |
| tag | `fldhY5dgvJ84WFzXx` | `[slug]` |
| url | `fldHu1FEkviN650BP` | ref_url = 에이전시 케이스스터디 URL (있을 때만) |

`typecast: true` 필수 (tag 옵션 자동 생성).

---

## Step 7: 결과 보고

```
✅ {에이전시} 완료
   신규 추가: {N}개 | 중복 스킵: {M}개 | URL 미발견: {K}개
   CSV: ~/Desktop/{slug}-clients-live.csv
```

---

## 주의사항

- **스코프 = 에이전시가 디자인한 웹사이트만.** 전체 클라이언트 명단 ❌ (Step 2 참조). 헷갈리면 "이 사이트를 이 에이전시가 만들었나?"로 자문 — 아니면 제외.
- 라이브 URL은 **브랜드 본 사이트만**. 제작 크레딧(사진가·개발 스튜디오·협업자) 링크는 버린다.
- 같은 도메인 중복은 1행으로 통합한다.
- JS 렌더링 사이트: 분류는 원본 HTML grep 우선, 안 되면 검색 기반으로 전환
- 클라이언트명 원본 표기 유지 (대소문자 그대로)
- 빈 URL 허용 — 빈 문자열로 채우지 않는다
