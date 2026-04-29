# backup 브랜치

**생성일**: 2026-04-29

## 이 브랜치가 담고 있는 상태

ManagedCollection 3-레이어 파이프라인 완성 시점의 workerCtl 스냅샷.

### 이 시점의 workerCtl 상태

- `pollUntilComplete`가 `/managed-status` 포함 범용 statusPath 지원
- `push-managed` / `managed-status` / `sync-stage1` 함수 인식
- 도움말: "3-레이어 파이프라인" 기준으로 재정비
- constraint 필드 표시: 선택 목록 + 실행 직전 + 도움말 테이블

### 주요 기능 (이 브랜치 기준)

```
workerCtl sisoso push-managed      → Layer 1+2 ManagedCollection 전체 푸시 (polling)
workerCtl sisoso managed-status    → push-managed 진행 상태 확인
workerCtl sisoso sync-stage1       → Layer 1만 실행 (Airtable → D1)
workerCtl sisoso status            → 워커 상태 확인
```

### 복구 방법

```bash
cd scripts
git checkout backup
git checkout -b recovery/$(date +%Y-%m-%d)
```
