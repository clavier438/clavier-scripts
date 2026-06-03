---
name: site-layout-capture
description: >-
  Survey a website's distinct page-layout types and capture N representative
  pages (default 3) of each type as PDFs using webExporter's --urls option.
  This is "sample by template", NOT a full crawl. Use whenever the user wants to
  capture every layout type / 모든 레이아웃 종류 / 각 레이아웃 종류 3개씩 / 페이지
  유형별 PDF / layout survey / 대표 페이지 캡처, or to sample a site's design
  system by page template (list / detail / about / board …) rather than every
  page. Korean triggers: 레이아웃 종류, 레이아웃 3개씩, 페이지 유형별, 템플릿별
  캡처, 사이트 레이아웃 떠줘. English: layout survey, capture each layout type,
  representative pages per template, webExporter --urls.
---

# Site Layout Capture — 레이아웃 종류별 대표 캡처

한 사이트의 **시각적 레이아웃 종류(템플릿)를 주체적으로 분류**하고, 각 종류 대표 N개(기본 3, 메인은 보통 1)를 webExporter로 PDF 캡처한다. 전체 크롤이 아니라 "종류별 샘플" — 디자인 시스템을 유형별로 빠르게 훑는 용도.

## 워크플로우

### 1. 사이트 구조 파악
순서대로 시도:
```bash
curl -s -L SITE/sitemap.xml | grep -oE '<loc>[^<]+</loc>' | sed 's/<[^>]*>//g'   # 있으면 URL 목록
curl -s -L SITE/robots.txt                                                       # 솔루션 단서
curl -s -L SITE/ | grep -oE 'href="[^"]*"' | sed 's/href="//;s/"$//' | sort -u   # 메인 네비/링크
```
robots 패턴으로 솔루션 추정 — 예: `/exec/front/` `/myshop/` `/skin-*` `/board/` = **카페24 쇼핑몰**, `/wp-` = WordPress 등. 솔루션을 알면 레이아웃 종류가 예측된다.

### 2. 레이아웃 종류 분류 (주체적 — 핵심)
**URL prefix ≠ 레이아웃.** 같은 템플릿이 여러 prefix 로 나뉠 수 있다 (예: `/magazine/list`, `/books/list`, `/new/list` 는 전부 같은 "목록형"). prefix 가 아니라 **시각 템플릿 단위**로 묶어라:
- 메인/홈 · 목록형(list/grid) · 상세형(detail) · 정보형(static/about) · 게시판형(board/cs) · 검색 · 장바구니/주문 …
대표적인 5종이면 5종으로, 사이트 특성대로. 빠진 종류 없는지 네비/푸터 링크로 교차 확인.

### 3. JS 렌더 detail URL 추출
상품 상세 등은 JS 템플릿(`'/product/detail.html?product_no='+item.product_no`)이라 curl 로 안 잡힌다. webExporter venv 의 playwright 로 렌더 후 추출:
```bash
cd webExporter
.venv/bin/python -c "
import asyncio
from playwright.async_api import async_playwright
async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page()
        await pg.goto('LIST_URL', wait_until='networkidle', timeout=40000)
        await pg.wait_for_timeout(2000)
        print('\n'.join(await pg.evaluate('()=>[...new Set([...document.querySelectorAll(\"a[href*=product_no]\")].map(a=>a.href))].slice(0,4)')))
        await b.close()
asyncio.run(m())"
```
셀렉터(`a[href*=product_no]`)는 사이트마다 조정.

### 4. 종류별 대표 N개 선정
각 종류에서 다양성 있게 3개 (다른 카테고리·다른 길이). 메인은 1개. 정적 URL 은 직접, JS URL 은 3번에서.

### 5. webExporter --urls 로 종류별 캡처
`--urls` = discover 크롤을 스킵하고 콤마구분 URL 리스트만 캡처. webExporter 의 핵심 옵션(이 스킬을 위해 추가됨).
```bash
cd webExporter
BASE="https://SITE"
OUT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/works/study/books/SITE-layouts"
cap(){ WEBEXP_SKIP_VIEWPORTS=tablet,mobile .venv/bin/python webSiteExporter.py "$BASE" --urls "$2" --output "$OUT/$1" 2>&1 | grep -E "urls\]|완료!|✓ |REFUSED"; }
cap "01-main"   "$BASE/"
cap "02-list"   "$BASE/a/list,$BASE/b/list,$BASE/c/list"
cap "03-detail" "$BASE/product/detail.html?product_no=435,..."
# ...
```
- `WEBEXP_SKIP_VIEWPORTS=tablet,mobile` → desktop 만 (레이아웃 비교 목적). 반응형 비교가 필요하면 빼서 3뷰포트.
- 출력: `books/<site>-layouts/<NN-type>/<site>.pdf` — 종류별 폴더 = 종류별 PDF.
- 봇 차단 잦은 사이트면 종류 사이 cooldown(sleep) 추가.

## 사례 (검증됨)
magazine-b.com — 카페24 쇼핑몰(baton 스킨). 5종: `01-main`(/) · `02-list`(magazine/books/new 목록) · `03-detail`(product 435/439/389) · `04-about`(company/partnership/stockists) · `05-board`(notice/faq/inquiry).

## 도구
| 도구 | 역할 |
|---|---|
| `webExporter --urls` (clavier-scripts/webExporter) | 지정 URL 리스트 → PDF (크롤 스킵) |
| playwright (webExporter `.venv`) | JS 렌더 detail URL 추출 |
| curl | 구조 파악 (sitemap / robots / 메인 링크) |
