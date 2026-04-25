# Claude 세션 시작 지침

## 반드시 먼저 할 것

새 세션을 시작하면 **무조건** 아래 순서로 읽어라:

```
1. clavier-hq/README.md    → 전체 시스템 지도
2. clavier-hq/STATUS.md    → 현재 모든 시스템 상태
3. clavier-hq/QUEUE.md     → 지금 해야 할 것 (우선순위순)
4. clavier-hq/MISSION.md   → 방향과 기준
```

GitHub: https://github.com/clavier0/clavier-hq

그 다음 이 repo에서:
1. `CONVENTIONS.md` — 작업 원칙 (Clean Architecture, Git, 메모리, 단계적 수정 등)
2. `ARCHITECTURE.md` — Mac 자동화 모듈 구조
3. `env.md` — 시크릿/계정 정보 (필요할 때만)

## 핵심 원칙 (요약)

- 모든 파일 변경 → git commit (목적 + 수단 명시)
- 문제 하나씩 고치기 (여러 개 동시 수정 금지)
- 완료한 작업 → clavier-hq/QUEUE.md에 ✅ 표시 후 커밋
- 클린아키텍처 위반 발견 시 적극 시정 제안
- 자세한 가이드는 CONVENTIONS.md 참조
