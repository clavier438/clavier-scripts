---
name: scheduled-tasks-sleep-silent-fail
description: macOS sleep 중 Claude Code scheduled-tasks cron 이 발화 못해 산출물 0 — 진단 방법 + 해결 안
metadata:
  type: reference
---

Claude Code `scheduled-tasks` (closer/ray-dalio/sentinel/architect 같은 routine) 가 **macOS sleep 중 cron 시간 도래 시 발화 못 함**. lastRunAt 은 갱신될 수 있어도 실제 SKILL.md 처리 0, briefings/* 산출물 0, git commit 0.

## 진단 방법

1. `mcp scheduled-tasks list` — lastRunAt 시각 확인
2. `git log --since="<expected> 02:00 KST" --until="<expected> 06:00 KST"` — 새벽 시간대 commit 확인 (0건이면 silent fail)
3. `ls briefings/ | grep <date>` — 그날 briefing 산출물 (0건이면 silent fail)
4. `pmset -g sched` — 새벽 wake schedule 등록 여부 (없으면 sleep 중 발화 X)
5. `pmset -g log | grep -E "Sleep|Wake" | grep "<date> 0[0-5]"` — 새벽 시간대 wake 흔적

## 해결 안

- **즉시 (사용자 sudo 필요)**: `sudo pmset repeat wakeorpoweron MTWRFSU 02:55:00` — 매일 02:55 자동 wake → 03:00 cron 정상 발화 → 작업 후 sleep 복귀.
- **구조적 (큰 변경)**: routines 를 OCI VM (항상 켜진 환경) 으로 이전. 별도 ADR.

## 자주 헷갈리는 것

- ❌ "LaunchAgent plist 가 진짜 cron" → **거짓**. 2026-05-26 이후 routine 의 진짜 cron = Claude Code `scheduled-tasks`. LaunchAgent plist 는 옛 잔재 (clavier-scripts PR #50 으로 삭제).
- ❌ "lastRunAt 갱신 = 정상 실행" → **거짓**. lastRunAt 은 trigger 시도 흔적일 수 있음. *실제 실행 검증* = briefings/* 산출물 + git commit.
- ❌ "silent fail = scheduled-tasks 의 버그" → 보통 **시스템 sleep**. cron 의 표준 한계.

진단 결과의 메모: 2026-05-26 clavier 시스템 정비 시 모든 4 routines (closer/ray-dalio/sentinel/architect) 가 같은 패턴 silent fail 발견. 사용자 의심 ("루틴이 작동한다 느낀 적 없다") 의 *근본 원인* 발견.

관련: [[feedback_routine_distrust]]
