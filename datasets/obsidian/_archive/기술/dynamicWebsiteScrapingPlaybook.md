# 동적 웹사이트 스크래핑 플레이북

> 📅 작성일: 2024-12-02  
> 🎯 목적: JavaScript로 동적 렌더링되는 웹사이트 스크래핑 방법론  
> 📚 실전 사례: Onda API 문서 수집

---

## 🔍 문제 인식

### 웹사이트의 두 가지 유형

#### 1. 정적 웹사이트
```
특징:
- URL 입력 → 바로 HTML 렌더링
- 소스 보기로 모든 내용 확인 가능
- HTTP Request만으로 수집 가능

수집 방법:
✅ curl
✅ requests (Python)
✅ HTTP Request (n8n)
```

#### 2. 동적 웹사이트 ⚠️
```
특징:
- JavaScript로 DOM을 동적 구성
- 소스 보기 = 빈 껍데기만 보임
- API 호출로 데이터를 가져옴
- 예: 쿠팡, Docusaurus, React/Vue/Angular 앱

수집 방법:
❌ 일반 HTTP Request (내용 없음)
✅ 특수 방법 필요
```

---

## 💡 해결 방법 3가지

### 방법 1: 브라우저 자동화 (비추천)

```yaml
도구:
  - Puppeteer
  - Playwright
  - Selenium
  - Apify
  - AgentQL

원리:
  헤드리스 브라우저로 JavaScript 실행 후
  완성된 HTML 수집

단점:
  ❌ 컴퓨팅 자원 많이 소모
  ❌ 느림 (페이지당 3-10초)
  ❌ 대부분 유료
  ❌ 셀프호스팅 시 24시간 켜두어야 함
  ❌ 서버 부담 큼
```

### 방법 2: API 리퀘스트 가로채기 ⭐ (핵심)

```yaml
핵심 개념:
  "DOM이 데이터를 가져오는 게 아니라
   API 호출을 직접 가로챈다"

효율성:
  ✅ 동적 사이트의 90% 이상 적용 가능
  ✅ 브라우저 구동 불필요
  ✅ 빠름 (페이지당 0.5-1초)
  ✅ 서버 부담 최소
  ✅ 무료

적용 대상:
  - 쿠팡
  - 아마존
  - 인스타그램
  - 트위터
  - Docusaurus 문서 사이트
  - 대부분의 React/Vue 앱
```

### 방법 3: Jina AI Reader (최신 솔루션)

```yaml
서비스:
  https://r.jina.ai/[원하는_URL]

특징:
  ✅ JavaScript 렌더링 완료 후 내용 추출
  ✅ 마크다운으로 변환
  ✅ 무료
  ✅ API 호출 한 번만
  ✅ 브라우저 불필요

사용법:
  curl "https://r.jina.ai/https://example.com"
```

---

## 🛠 실전 적용: API 가로채기

### 1단계: 개발자 도구로 API 찾기

```javascript
1. Chrome에서 목표 페이지 열기
2. F12 (개발자 도구)
3. Network 탭 열기
4. Fetch/XHR 필터 선택
5. 🧹 Clear 버튼 (로그 초기화)
6. 페이지 새로고침 또는 인터랙션
   (예: 다음 페이지 클릭, 리뷰 열기)
7. API 호출 확인
   - .json 파일
   - /api/ 경로
   - reviews, data, content 등 키워드
8. 원하는 API 요청 우클릭
   → Copy → Copy as cURL (bash)
```

### 2단계: cURL을 n8n에서 실행

```yaml
n8n 워크플로우:
  1. Execute Command 노드 추가
  2. cURL 명령어 붙여넣기
  3. 실행 → HTML/JSON 응답 확인
```

### 3단계: 데이터 파싱

```yaml
HTML 응답인 경우:
  - HTML Extract 노드
  - CSS Selector로 원하는 요소 추출
  - 예: .review-article (리뷰 컨테이너)

JSON 응답인 경우:
  - Code 노드
  - JSON.parse() 후 필요한 데이터 추출
```

### 4단계: 반복 로직 (페이지네이션)

```javascript
변수화할 부분 찾기:
  - page 번호
  - offset
  - limit/size
  - product_id 등

n8n 구현:
  1. 총 페이지 수 계산 (Code 노드)
  2. 페이지 배열 생성 [1, 2, 3, ..., n]
  3. Split Out으로 순회
  4. Loop 노드로 반복 실행
```

---

## 📋 실전 사례: Onda API 문서

### 문제 상황
```
웹사이트: https://developers.onda.me
프레임워크: Docusaurus (React 기반)
문제점: 
  - curl로 가져오면 빈 껍데기만
  - 상세 파라미터, 스키마 모두 누락
  - 32개 문서 수집 필요
```

### 해결 과정

#### 시도 1: 일반 HTTP Request ❌
```python
# 실패
response = requests.get(url)
# → JavaScript 실행 전 HTML만 수집
# → 제목, 메소드만 있고 내용 없음
```

#### 시도 2: Playwright ❌
```python
# 네트워크 에러
# ERR_TUNNEL_CONNECTION_FAILED
# → 사이트 차단 또는 인증 필요
```

#### 시도 3: Jina AI Reader ✅
```bash
# 성공!
curl "https://r.jina.ai/https://developers.onda.me/docs/api/channel/get-property-list"

→ 완전한 마크다운 응답
→ 모든 파라미터, 스키마 포함
```

### 최종 워크플로우

```yaml
n8n 플로우:
  1. Get Sitemap
     → sitemap.xml에서 URL 목록 추출
  
  2. Extract URLs (Code)
     → Channel API 문서만 필터링 (32개)
  
  3. Loop Over URLs
     → 각 URL 순회
  
  4. Fetch with Jina AI
     → https://r.jina.ai/[URL]
     → 완전한 마크다운 응답
  
  5. Process Markdown (Code)
     → 메타데이터 추가
     → 파일명 생성
  
  6. Save to File
     → 로컬에 .md 파일 저장
  
  7. Rate Limit (Wait 2초)
     → 서버 부담 최소화
  
  8. Loop back
     → 다음 URL 처리

결과:
  ✅ 32개 문서 완전 수집
  ✅ 평균 3초/문서
  ✅ 총 소요시간 2분
```

---

## 🎯 의사결정 흐름도

```
동적 웹사이트 스크래핑 시작
           ↓
      
개발자 도구로 API 확인
           ↓
           
API 찾았나?
    ↙     ↘
  YES      NO
   ↓        ↓
API 가로채기  Jina AI Reader
   ↓        사용
   ↓        ↓
cURL 복사    ↓
   ↓        ↓
n8n 실행    ↓
   ↓        ↓
   └────────┘
        ↓
    
  데이터 파싱
        ↓
        
  반복 로직 추가
        ↓
        
  Rate Limiting
        ↓
        
      완료 ✅
```

---

## 🔧 n8n 노드 구성

### 기본 패턴

```yaml
1. HTTP Request (sitemap.xml)
   → 전체 URL 목록

2. Code (URL 필터링)
   → 필요한 페이지만 선택

3. Split In Batches
   → URL 순회 준비

4. HTTP Request (Jina AI)
   → https://r.jina.ai/{{ $json.url }}
   → Header: X-Return-Format: markdown

5. Code (데이터 처리)
   → 파싱, 변환, 구조화

6. Write File
   → 로컬 저장

7. Wait (Rate Limiting)
   → 1-2초 대기

8. Loop back to Step 3
```

---

## 💾 코드 스니펫

### 1. sitemap.xml에서 URL 추출

```javascript
// n8n Code 노드
const xml = $input.first().json.data;
const urlPattern = /<loc>([^<]+)<\/loc>/g;
const urls = [];

let match;
while ((match = urlPattern.exec(xml)) !== null) {
  const url = match[1];
  if (url.includes('/docs/api/')) {
    urls.push({ url: url });
  }
}

return urls.map(item => ({ json: item }));
```

### 2. 페이지 배열 생성

```javascript
// n8n Code 노드
const totalReviews = $input.first().json.total;
const pageSize = 30;
const totalPages = Math.floor(totalReviews / pageSize) + 1;

const pages = [];
for (let i = 1; i <= totalPages; i++) {
  pages.push({ page: i });
}

return pages.map(p => ({ json: p }));
```

### 3. 마크다운 메타데이터 추가

```javascript
// n8n Code 노드
const url = $input.first().json.url;
const content = $input.first().json.data;

const filename = url.split('/').pop() + '.md';
const titleMatch = content.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1] : filename;

const markdown = `---
title: ${title}
url: ${url}
date: ${new Date().toISOString()}
---

${content}

---
**출처**: [${url}](${url})
`;

return {
  json: {
    filename: filename,
    markdown: markdown
  }
};
```

---

## ⚠️ 주의사항

### 윤리 & 법적 고려사항

```yaml
반드시 확인:
  1. robots.txt 준수
     → https://example.com/robots.txt
  
  2. Rate Limiting
     → 1-2초 딜레이 필수
     → 서버 부담 최소화
  
  3. 사용 목적
     → 개인 학습: OK
     → 회사 프로젝트: 법률 검토 필요
  
  4. 데이터 재배포
     → 원본 출처 명시
     → 상업적 사용 주의

위반 시:
  - 법적 문제 발생 가능
  - IP 차단
  - 서비스 이용 제한
```

### 기술적 주의사항

```yaml
1. 403/503 에러:
   → User-Agent 변경
   → Rate Limiting 강화
   → Jina AI Reader 사용

2. 빈 응답:
   → 개발자 도구로 API 재확인
   → 인증 토큰 필요한지 확인

3. 데이터 변경:
   → API 구조가 자주 바뀔 수 있음
   → 정기적 검증 필요
```

---

## 📊 성능 비교

| 방법 | 속도 | 비용 | 완성도 | 난이도 |
|------|------|------|--------|--------|
| Puppeteer | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| API 가로채기 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Jina AI | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 🚀 빠른 시작

### 1분 만에 시작하기

```bash
# 1. 테스트
curl "https://r.jina.ai/https://example.com"

# 2. n8n에서 실행
# - HTTP Request 노드
# - URL: https://r.jina.ai/{{URL}}
# - Header: X-Return-Format: markdown

# 3. 결과 확인
# - 마크다운 응답
# - 파일로 저장
```

---

## 📚 실전 체크리스트

### 스크래핑 시작 전

- [ ] robots.txt 확인
- [ ] 사이트 유형 파악 (정적 vs 동적)
- [ ] 개발자 도구로 API 조사
- [ ] 데이터 구조 분석
- [ ] 예상 소요시간 계산

### 구현 중

- [ ] Rate Limiting 설정 (1-2초)
- [ ] 에러 핸들링 추가
- [ ] 진행 상황 로깅
- [ ] 중간 결과 확인

### 구현 후

- [ ] 데이터 품질 검증
- [ ] 출처 명시
- [ ] 문서화
- [ ] 정기 업데이트 스케줄 설정

---

## 🎓 학습 자료

### 추천 도구
- [Jina AI Reader](https://jina.ai/reader)
- [n8n](https://n8n.io)
- Chrome DevTools

### 참고 문서
- [단태랩스 MCP 크롤링 가이드](https://www.youtube.com/dantae)
- [HTTP Archive](https://httparchive.org)
- [Web Scraping Best Practices](https://www.scrapehero.com/web-scraping-best-practices/)

---

## 💡 핵심 인사이트

```
1. 동적 사이트 = API 호출
   → API를 찾으면 90% 해결

2. 브라우저 자동화는 최후의 수단
   → 비용 높고, 느리고, 복잡함

3. Jina AI Reader = 게임 체인저
   → 브라우저 없이 완전한 내용

4. n8n = 최고의 자동화 도구
   → 시각적, 공유 쉬움, 확장성

5. Rate Limiting은 필수
   → 1-2초 딜레이로 서버 부담 최소화
```

---

## 📌 Quick Reference

```bash
# Jina AI Reader
curl "https://r.jina.ai/https://example.com"

# Chrome DevTools
F12 → Network → Fetch/XHR → Refresh → Copy as cURL

# Python requests
import requests
response = requests.get(url, headers={'User-Agent': '...'})

# n8n 핵심 노드
HTTP Request → Code → Split In Batches → Loop
```

---

**작성**: 준혁 + Claude  
**업데이트**: 필요시 계속 보완  
**태그**: #스크래핑 #n8n #자동화 #API #동적웹사이트

---

## 🔄 다음 프로젝트 적용 시

이 플레이북을 보고:
1. 사이트 유형 판단 (30초)
2. API 조사 (2분)
3. Jina AI 테스트 (1분)
4. n8n 워크플로우 구축 (10분)
5. 실행 & 검증 (5분)

**총 소요시간: 20분 이내**
