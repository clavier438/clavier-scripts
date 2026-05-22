# Claude Code Hooks

Claude Code 의 [Hook system](https://code.claude.com/docs/en/hooks.md) 으로 *Claude 의 약속이나 능동적 polling 없이도 강제로* 행동을 보장하는 보호 장치.

## bg-watch-spawn.sh — 백그라운드 Bash 호출 시 "주기적확인요망" 동반 task enforce

### 문제

`Bash(run_in_background=true)` 로 백그라운드 작업을 시작하면 Claude Code 가 완료 시점에 task-notification 을 발화 → 다음 turn 자동 트리거 (경험적 관찰. 공식 문서 미명시). 단 *완료할 때만*:

- 작업이 hang → 알림 없음 (Claude 능동적 polling 안 하면 누락)
- Claude 가 "20분마다 확인" 약속해도 turn-based 구조라 *능동적 polling 불가*

### 해결책

PreToolUse hook 이 모든 `Bash + run_in_background=true` 호출 시 *동반 sleep task* 활성 여부 검사:

- `/tmp/claude-periodic-active` marker 파일 살아있음 (mtime < `${DELAY_SEC}`s) → **통과**
- marker 없거나 expired → **차단** + Claude 한테 "동반 sleep task 먼저 등록" 안내
- 호출 description 에 "주기적확인요망" 있으면 → marker 갱신 + 통과 (이게 동반 task 본체)

차단으로 Claude 는 *어쩔 수 없이* 두 호출 같이 등록:
1. `Bash(command='sleep 1200 && echo 주기적확인요망 완료', description='주기적확인요망', run_in_background=true)` ← 동반
2. `Bash(<원래 명령>, run_in_background=true)` ← 본 명령

동반 task 가 1200초 후 자연 종료 → task-notification 발화 → Claude 다음 turn 강제 트리거.

### 공식 schema 준수

[Claude Code Hooks 문서](https://code.claude.com/docs/en/hooks.md) 의 PreToolUse output schema:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}
```

`permissionDecision` 값: `allow` / `deny` / `ask` / `defer`. 본 hook 은 `deny` 사용.

이전 시도 (`{"decision":"block",...}`) 는 PreToolUse 가 아닌 다른 event 의 schema 라 무시됨 — 이번 버전에서 교정.

### 회피 경로 분석

| 시나리오 | sleep task task-notification 발화? | 이유 |
|---|---|---|
| 본 명령 빨리 끝남 | ✅ | sleep task 는 본 명령과 독립 |
| 본 명령 hang | ✅ | 같음 |
| 본 명령 에러 죽음 | ✅ | 같음 |
| Claude 가 sleep 동반 안 함 | ✅ (강제됨) | hook 매번 차단 → 우회 불가 |
| macOS Sleep | ✅ (지연됨) | 깨어나면 카운터 이어감 |
| 세션 끊김 | ⚠️ | sleep 자체는 계속, 다음 세션에서 알림은 lost |
| Mac 완전 종료 | ❌ | OS 자체가 죽음 — 불가피 |

세션 + Mac 살아있는 한 100%.

### 설치

1. hook 경로 확인:
   ```
   /Users/<user>/Developer/clavier-scripts/tools/claude-hooks/bg-watch-spawn.sh
   ```
   (또는 iCloud 클론: `/Users/<user>/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/tools/claude-hooks/bg-watch-spawn.sh`)

2. `~/.claude/settings.json` 의 `hooks` 섹션에 추가:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {
               "type": "command",
               "command": "bash '/path/to/bg-watch-spawn.sh'"
             }
           ]
         }
       ]
     }
   }
   ```

3. Claude Code 재시작 또는 새 세션

### 옵션

- `WEBEXP_BG_WATCH_SEC` — sleep / marker 유효시간 (초). 기본 `1200`.
- `WEBEXP_BG_WATCH_MARKER` — marker 파일 경로. 기본 `/tmp/claude-periodic-active`.

### 의존성

- `jq` (없으면 silent allow + 로그)
- `python3` (JSON escape 안전화 — macOS 기본 포함)

### 로그

`~/.claude-bg-watch/marker.log` 에 `MARK` / `PASS` / `DENY` / `WARN` 이벤트 누적.

### 자체 테스트

```bash
rm -f /tmp/claude-periodic-active

# T1: foreground bash → exit 0 (no-op)
echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' \
  | bash tools/claude-hooks/bg-watch-spawn.sh; echo "RC=$?"

# T2: non-Bash tool → exit 0
echo '{"tool_name":"Read","tool_input":{"file_path":"/x"}}' \
  | bash tools/claude-hooks/bg-watch-spawn.sh

# T3: Bash+bg no marker → deny JSON
echo '{"tool_name":"Bash","tool_input":{"command":"x","run_in_background":true,"description":"y"}}' \
  | bash tools/claude-hooks/bg-watch-spawn.sh \
  | jq '.hookSpecificOutput.permissionDecision'
# → "deny"

# T4: companion task → marker
echo '{"tool_name":"Bash","tool_input":{"command":"sleep 3","description":"주기적확인요망","run_in_background":true}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh
ls /tmp/claude-periodic-active

# T5: Bash+bg with marker → pass
echo '{"tool_name":"Bash","tool_input":{"command":"x","run_in_background":true,"description":"y"}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh

# T6: wait 4s → marker expired → deny again
sleep 4
echo '{"tool_name":"Bash","tool_input":{"command":"x","run_in_background":true,"description":"y"}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh \
  | jq '.hookSpecificOutput.permissionDecision'
# → "deny"
```

### 한계 (정직하게)

- task-notification 메커니즘은 *경험적 관찰* (공식 문서 미명시) → Claude Code 가 향후 동작 변경하면 자동 트리거 못할 수 있음
- 세션 끊기면 sleep task 알림 lost
- Hook 미등록 / `jq` 부재 등 외부 조건 깨지면 작동 안 함 (사용자 환경 책임)
- 100% 보장 아님 — *주된 회피 경로 (Claude 약속 어김) 만 차단*
