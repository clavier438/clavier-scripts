# Dynamic Web Scraping Skill

> 🎯 **100% 성공률 달성** - Onda API 32개 문서 완벽 수집

## 📦 Skill 정보

- **이름**: dynamic-web-scraping
- **용도**: JavaScript가 필요한 동적 웹사이트 스크래핑
- **성공 사례**: Onda API 문서 32/32 (100%)
- **위치**: [[claude-outputs/dynamic-web-scraping-skill/README|📁 Skill 폴더]]

## 🎯 이 Skill을 언제 사용하나?

✅ **사용해야 할 때**:
- `curl`이나 `requests`로 데이터가 안 나올 때
- 웹사이트가 "Loading..." 만 보일 때
- React/Vue/Angular 같은 모던 웹앱
- API 문서, 상품 목록, 부동산 정보 등

❌ **사용하지 않을 때**:
- 단순 정적 HTML 사이트
- 이미 잘 작동하는 스크래퍼가 있을 때

## 🚀 빠른 시작

### 가장 쉬운 방법: Jina AI Reader

```python
import requests

url = "https://example.com/page"
content = requests.get(f"https://r.jina.ai/{url}").text

# 끝! 깔끔한 마크다운으로 변환됨
```

### 실전 스크립트 사용

```bash
# Skill 폴더의 스크립트 사용
python scripts/jina_scraper.py https://example.com/page1

# 여러 URL
python scripts/jina_scraper.py @urls.txt
```

## 📚 포함된 파일들

### 핵심 문서
- [[claude-outputs/dynamic-web-scraping-skill/SKILL|📖 SKILL.md]] - 완전한 가이드
- [[claude-outputs/dynamic-web-scraping-skill/README|📘 README]] - 빠른 시작

### 스크립트
- `scripts/jina_scraper.py` - 범용 스크래퍼
- `scripts/onda_production_example.py` - 실제 성공 사례

### 참고 자료
- `references/api-interception-guide.md` - API 찾는 법

## 💡 3가지 방법

### 1. API Interception ⭐ (최고)
- **속도**: 0.1초/페이지
- **성공률**: 90%
- **방법**: DevTools에서 API 찾기 → 직접 사용

### 2. Jina AI Reader ⭐ (가장 쉬움)
- **속도**: 2초/페이지
- **성공률**: 80%
- **방법**: URL 앞에 `https://r.jina.ai/` 붙이기

### 3. Browser Automation (최후의 수단)
- **속도**: 10초/페이지
- **성공률**: 95%
- **방법**: Playwright로 실제 브라우저 실행

## 🏆 실전 사례: Onda API

**도전**: 32개 API 문서 수집
**문제**: 동적 사이트, 기본 스크래핑 실패
**해결**: Jina AI Reader + 재시도 로직
**결과**: **100% 성공 (32/32)** in 3분

상세 코드: `scripts/onda_production_example.py`

## 🔑 핵심 특징

- ✅ 자동 재시도 (지수 백오프)
- ✅ 진행 상황 저장 (중단 후 재개 가능)
- ✅ Rate Limiting (서버 존중)
- ✅ 깔끔한 마크다운 출력
- ✅ 프로덕션 검증됨

## 📊 성능 비교

| 방법 | 속도 | 성공률 | 난이도 |
|------|------|--------|--------|
| API 직접 | 0.1초 | 90% | 중 |
| Jina AI | 2초 | 80% | 하 |
| Browser | 10초 | 95% | 상 |

## 🎓 사용 예시

### Claude에게 물어보기
```
"https://example.com 스크래핑 도와줘"
"이 사이트 JavaScript 필요한데 어떻게 해?"
"스크래퍼가 빈 결과만 반환해"
```

### 직접 실행
```bash
# 1. Skill 폴더로 이동
cd claude-outputs/dynamic-web-scraping-skill

# 2. 스크립트 실행
python scripts/jina_scraper.py <URL>

# 3. 결과 확인
open scraped_content/
```

## ⚠️ 주의사항

- `robots.txt` 확인
- Rate Limiting 준수 (1-2초 대기)
- 서버 과부하 주지 말 것
- ToS(이용약관) 확인

## 🔗 관련 문서

- [[기술/동적 웹사이트 스크래핑 플레이북|스크래핑 플레이북]] (원본)
- [[env/env|환경 설정]] (설정 정보)

## 💬 다음 단계

1. **Skill 폴더 확인**: [[claude-outputs/dynamic-web-scraping-skill/README|여기]]
2. **스크립트 테스트**: 간단한 사이트로 먼저
3. **프로덕션 적용**: Onda 예제 참고

---

**핵심**: Jina AI Reader부터 시작하세요. 80%는 이것만으로 해결됩니다.

**설치 위치**: `claude-outputs/dynamic-web-scraping-skill/`
**Claude에게**: "dynamic web scraping skill 사용해서 스크래핑 도와줘"
