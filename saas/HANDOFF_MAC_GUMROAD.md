# Gumroad 등록 인수인계

> 이 파일 하나만 읽으면 됩니다. 목표: webSiteExporter Gumroad 에 올리기.

---

## 할 것 (순서대로)

### 1. zip 만들기

```bash
cd ~/dev/clavier/clavier-scripts/webExporter
zip webSiteExporter.zip webSiteExporter.py README.md
```

### 2. Gumroad 등록

1. gumroad.com 가입 (없으면)
2. `+ New product` → `Digital product`
3. 파일: `webSiteExporter.zip` 업로드
4. 이름: `WebSiteExporter — Full-page website to PDF`
5. 가격: `$19`
6. 설명: 아래 텍스트 그대로 복붙

---

### 설명 본문 (복붙용)

**Give it a URL. Get a PDF of the entire site — every page, every viewport.**

Most screenshot tools capture only what's visible on screen. WebSiteExporter scrolls through every page to trigger lazy-loaded images and scroll animations, then stitches everything into a single clean PDF.

**What you get:**
- Desktop (1440px), tablet (768px), and mobile (390px) — all in one run
- Full-page scroll capture — nothing hidden, nothing cut off
- Automatic site crawl — follows navigation links, no manual URL list needed
- One PDF output, pages ordered by viewport then by page

**Who it's for:**
- Designers reviewing a site before a redesign pitch
- Agencies documenting client sites for handoff
- Marketers capturing competitor sites for reference
- Anyone who needs a complete offline snapshot of a website

**How it works:**
```
pip install playwright pillow
playwright install chromium
python webSiteExporter.py https://example.com
```

One command, one PDF in your output folder.

**Requirements:** Python 3.9+, runs on Mac and Linux.

---

### 태그 (Gumroad 검색 노출용)

```
website screenshot, pdf export, playwright, web scraping, design tool, site capture, full page screenshot
```

### 카테고리
`Software & Tools → Developer Tools`

---

## 완료 기준

- [ ] zip 파일 생성됨
- [ ] Gumroad 상품 published
- [ ] 상품 URL 복사해두기 (나중에 랜딩 페이지에 넣을 수도 있음)

---

## 끝나면

Gumroad 상품 URL 어딘가 기록해두고, 그냥 두면 됩니다.
팔리면 이메일 알림 옵니다.
