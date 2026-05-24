# 유형자산→무형자산 전환 사례 팔로우업 시스템

## 🎯 목표
"Asset-Light" 비즈니스 모델과 "공간을 브랜드로" 전환한 사례들을 지속적으로 발견하고 분석

---

## 📊 시스템 구조: 3단계 하이브리드

### ⚙️ Phase 1: 자동 큐레이션 (AI 기반)

#### 도구: Perplexity Pro + Claude

**Perplexity 활용법:**
```
매주 월요일 아침 검색:
1. "asset light business model case studies 2024"
2. "experiential retail transformation examples"
3. "brand-led hospitality new openings"
4. "franchise asset light expansion"
5. "space as marketing case studies"
```

**왜 Perplexity인가?**
- 실시간 웹 검색 + AI 요약
- 소스 링크 자동 제공
- RSS보다 훨씬 똑똑한 필터링
- 한국어 쿼리도 가능

**저장 워크플로우:**
1. Perplexity 결과를 Claude에게 던지기
2. Claude가 관련성 판단 (1-10점)
3. 7점 이상만 Obsidian에 저장

---

### 🔍 Phase 2: 타겟 미디어 모니터링

#### 2-1. Fast Company (핵심 소스)

**방법:** Google Alerts + IFTTT 자동화

**설정:**
```
Google Alert 키워드:
- site:fastcompany.com "brand transformation"
- site:fastcompany.com "experiential retail"
- site:fastcompany.com "asset light"
- site:fastcompany.com "franchise model"

빈도: 일간
언어: 영어
```

**IFTTT 레시피:**
```
IF: Google Alert 트리거
THEN: 
1. Slack 알림
2. Notion/Obsidian 자동 저장
3. 이메일 다이제스트
```

#### 2-2. 업계 특화 뉴스레터

**구독 추천:**
1. **Skift** (호스피탈리티)
   - 주간 뉴스레터
   - 브랜드 런칭/확장 소식
   
2. **Hospitality Net**
   - 무료
   - 호텔 산업 글로벌 뉴스
   
3. **The Business of Fashion**
   - 리테일 브랜드 전략
   - 공간 브랜딩 사례
   
4. **Retail Dive**
   - 경험형 리테일 사례

#### 2-3. LinkedIn 전략적 팔로우

**팔로우 대상:**
```
개인:
- Ian Schrager (EDITION Hotels)
- Chip Conley (Airbnb, 호스피탈리티 전략가)
- Brian Chesky (Airbnb CEO)

기업:
- Ennismore
- Marriott International
- Accor
- 21c Museum Hotels
- Ace Hotel Group

해시태그:
#AssetLight
#HospitalityInnovation
#ExperientialRetail
#BrandTransformation
```

**LinkedIn 자동화:**
- Phantombuster (LinkedIn 포스트 스크래핑)
- 주간 다이제스트 생성
- Obsidian 자동 입력

---

### 📝 Phase 3: 수동 큐레이션 (주간 30분)

#### 매주 금요일 루틴

**10분: 스캔**
- Perplexity 주간 검색 결과
- Google Alerts 누적분
- LinkedIn 피드

**15분: 분석**
- Claude에게 던지기:
  ```
  "이 5개 사례 중 제주 호텔 프로젝트에 적용 가능한 인사이트는?"
  ```
- 핵심만 추출

**5분: 정리**
- Obsidian에 케이스 추가
- 태그: #asset-light #space-branding #franchise 등
- 인사이트 메모 추가

---

## 🛠️ 구체적 도구 스택

### 필수 (무료/저렴)

1. **Perplexity Pro** ($20/월)
   - 실시간 AI 검색
   - 소스 링크 제공
   - 한국어 지원

2. **Google Alerts** (무료)
   - 타겟 키워드 모니터링
   - 이메일 자동 전송

3. **IFTTT** (무료/Pro $3.33/월)
   - 자동화 워크플로우
   - Google Alerts → Slack/Email

4. **Obsidian** (이미 사용중)
   - 로컬 노트 저장
   - 태그 시스템

### 선택 (추가 효율)

5. **Feedly Pro** ($6/월)
   - RSS 피드 집중 관리
   - AI 필터링 (Leo)
   - 아티클 우선순위

6. **Pocket Premium** ($4.99/월)
   - 읽기 나중에
   - 자동 태그
   - 하이라이트

7. **Phantombuster** ($30/월)
   - LinkedIn 자동 스크래핑
   - 경쟁사 모니터링

---

## 📋 실전 워크플로우 예시

### 월요일 (5분)
```
1. Perplexity 5개 검색 실행
2. 결과 스캔
3. 관련있어 보이는 것만 "Save for Later"
```

### 매일 (자동)
```
1. Google Alerts 이메일 수신
2. IFTTT가 Slack에 알림
3. 흥미로운 건 Pocket에 저장
```

### 금요일 (30분)
```
1. 주간 누적분 스캔 (10분)
2. Claude로 분석 (15분)
3. Obsidian 정리 (5분)
```

### 월말 (1시간)
```
1. 이번 달 케이스 리뷰
2. 패턴 발견
3. "적용 아이디어" 노트 작성
```

---

## 🎯 검색 키워드 리스트

### 영어 (글로벌 사례)

**비즈니스 모델:**
- "asset light business model hospitality"
- "franchise without real estate"
- "brand licensing hotel"
- "management contract expansion"

**공간 브랜딩:**
- "experiential retail transformation"
- "instagrammable hotel design"
- "space as marketing"
- "flagship store brand building"

**호스피탈리티:**
- "boutique hotel brand expansion"
- "lifestyle hotel case study"
- "hotel franchise growth"
- "new hotel brand launch"

**리테일:**
- "DTC brand physical store"
- "popup to permanent transformation"
- "retail brand experience"

### 한국어 (로컬 사례)

- "브랜드 공간 마케팅"
- "경험형 매장 사례"
- "프랜차이즈 확장 전략"
- "자산 경량화 모델"
- "플래그십 스토어 브랜딩"

---

## 📊 케이스 템플릿 (Obsidian)

### 새 케이스 발견 시 이 템플릿 사용:

```markdown
# [브랜드명] - [날짜]

## 📌 한줄 요약
[브랜드가 무엇을 어떻게 전환했는지]

## 🏢 기본 정보
- **브랜드:** 
- **산업:** 
- **국가:** 
- **시기:** 

## 💡 핵심 전략
1. 
2. 
3. 

## 📊 결과
- 
- 

## 🎯 제주 호텔 적용 아이디어
- 

## 🔗 소스
- [링크]

## 🏷️ 태그
#asset-light #브랜딩 #호스피탈리티
```

---

## 🚀 시작하기: 첫 주 액션 플랜

### Day 1 (30분)
```
1. Perplexity Pro 가입
2. Google Alerts 5개 설정
3. IFTTT 계정 생성
```

### Day 2 (20분)
```
1. Fast Company 뉴스레터 구독
2. Skift 무료 계정 가입
3. LinkedIn 15명 팔로우
```

### Day 3 (15분)
```
1. Obsidian 템플릿 생성
2. 태그 시스템 정의
3. 폴더 구조 설정
```

### Day 4-7 (매일 5분)
```
1. Perplexity 검색 1개씩 실행
2. 결과 스캔
3. 좋은 거 있으면 저장
```

### 첫 금요일 (30분)
```
1. 주간 누적분 리뷰
2. 첫 케이스 3개 정리
3. 워크플로우 조정
```

---

## 💎 왜 이 시스템이 RSS보다 나은가?

### RSS의 한계:
```
❌ 노이즈 많음 (관련없는 기사 과다)
❌ 필터링 약함 (키워드 매칭만)
❌ 맥락 이해 없음
❌ 수동 분류 필요
❌ 분석 불가
```

### 이 시스템의 장점:
```
✅ AI가 관련성 판단 (Perplexity)
✅ 실시간 웹 검색 (최신성)
✅ 맥락 이해 (Claude 분석)
✅ 자동 분류 (IFTTT + 태그)
✅ 인사이트 추출 가능
✅ 한국어 지원
```

---

## 📈 확장 옵션 (나중에)

### 고급 자동화:
1. **Zapier** ($20/월)
   - 더 복잡한 워크플로우
   - 여러 도구 연결

2. **Make (Integromat)** ($9/월)
   - 시각적 자동화 빌더
   - 복잡한 로직 가능

3. **Custom Bot** (개발)
   - Python + Beautiful Soup
   - 특정 사이트 크롤링
   - 완전 자동화

### 팀 협업:
1. **Notion** (공유 데이터베이스)
2. **Airtable** (구조화된 케이스 DB)
3. **Slack** (팀 알림)

---

## 🎯 성공 지표

### 3개월 후:
```
✅ 케이스 50개+ 수집
✅ 주간 루틴 정착
✅ 적용 아이디어 10개+
```

### 6개월 후:
```
✅ 케이스 100개+ 수집
✅ 패턴 발견 3-5개
✅ 제주 호텔 전략에 반영
```

### 1년 후:
```
✅ 케이스 200개+
✅ 업계 트렌드 예측 가능
✅ 경쟁 우위 확보
```

---

## 💬 마지막 조언

### RSS vs AI 도구:

"RSS는 2005년 솔루션입니다.
2025년에는 AI 큐레이션이 답입니다."

**이유:**
1. 정보 과부하 시대
2. 맥락 이해 필요
3. 시간 = 돈
4. AI가 필터링 훨씬 잘함

### 당신에게 딱 맞는 이유:

```
✅ 이미 Claude 사용 중
✅ Obsidian 생태계 구축
✅ 호텔 산업 특화 필요
✅ 한국어 + 영어 동시 필요
✅ 실행 가능한 인사이트 필요
```

---

## 🚀 지금 바로 시작하세요

**Step 1:** Perplexity Pro 가입 ($20/월)
**Step 2:** 아래 5개 검색 실행
**Step 3:** 결과를 Claude에게 분석 요청
**Step 4:** 좋은 케이스 3개를 Obsidian에 저장

**축하합니다! 시스템 가동 시작! 🎉**

---

_"The best time to start was yesterday. The second best time is now."_
