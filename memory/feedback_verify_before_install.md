---
name: feedback-verify-before-install
description: 도구/패키지 설치 전 사용자 타겟(앱/플랫폼/버전) 지원 여부를 반드시 검증할 것
metadata:
  type: feedback
---

설치형 도구/헬퍼/CLI 를 깔기 전에, 그 도구가 **사용자가 명시한 타겟(앱/플랫폼/버전)** 을 실제로 지원하는지 docs·README·이슈로 1회 검증한다.

**Why:** 2026-05-24 사용자가 "Warp를 기본 터미널로" 요청 → 검증 없이 OpenInTerminal-Lite 설치 → 해당 앱이 Warp 미지원 → 사용자 분노 + 시간 낭비 + 신뢰 손상. "씨팔그건왜깔은거야?" 발언.

**How to apply:**
- brew install / npm install / pip install / mas install 등 *설치 명령 직전*에 한 번 멈춘다
- 그 도구의 지원 목록(예: 지원 터미널, 지원 OS, 지원 DB)에서 타겟이 명시되는지 WebFetch/README 로 확인
- 확인 안 되면 설치 안 함 → 사용자에게 "이 도구는 X 지원 확인 안 됨, 다른 길 찾을게요" 보고
- "Lite" / "minimal" 변형은 full 버전보다 지원 범위가 좁다는 점 의심
- [[feedback-single-solution]] 원칙: 어림짐작 설치로 "막았다는 기분" 만들지 말 것
