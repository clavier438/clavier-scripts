# Claude Code Hooks

Claude Code 의 [Hook system](https://docs.claude.com/en/docs/claude-code/hooks) 으로 *Claude 의 약속이나 능동적 polling 없이도 강제로* 행동을 보장하는 보호 장치들.

## bg-watch-spawn.sh — 백그라운드 작업 "주기적확인요망" enforce

### 문제

`Bash` 도구를 `run_in_background: true` 로 호출하면, 완료 시 Claude Code 가 task-notification 을 발화 → 다음 턴 자동 트리거. 단 *완료할 때만*. 작업이:
- 무한 hang → 자동 알림 X (Claude 가 능동적 polling 안 하면 누락)
- 사용자가 "20분마다 확인하라" 라고 약속받아도 turn-based 구조라 약속 깰 수 있음

### 해결책 — 동반 sleep task enforce

PreToolUse hook 이 모든 `Bash + run_in_background=true` 호출을 *차단*. 차단 reason 에 "동반 '주기적확인요망' sleep task 도 같이 호출하세요" 안내. Claude 는 어쩔 수 없이 두 호출 같이 등록:

1. **본 명령** — 사용자가 원래 의도한 작업
2. **주기적확인요망 sleep task** — `Bash(command='sleep 1200; echo 주기적확인요망', description='주기적확인요망', run_in_background=true)`

두 번째 sleep task 가 **정확히 1200초 후** 정상 종료되면서 Claude Code 의 task-notification 시스템이 자동 발화 → Claude 의 다음 턴 강제 트리거. 본 명령이 끝나든 hang 하든 무관.

### 회피 불가 근거

| 시나리오 | task-notification 발화? | 이유 |
|---|---|---|
| 본 명령 빨리 끝남 | ✅ 양쪽 모두 | sleep task 는 본 명령과 독립 |
| 본 명령 hang | ✅ sleep task | 같음 |
| 본 명령 에러 죽음 | ✅ sleep task | 같음 |
| Claude 약속 어김 | ✅ | hook 이 차단해서 *어쩔 수 없이* 동반 등록 |
| Claude Code 세션 끊김 | ⚠️ Claude 못 깨움 | sleep 자체는 계속 진행되지만 다음 세션 열어야 통지됨 |
| Mac 슬립 | ⚠️ sleep 일시정지 | macOS 가 깨어나면 카운터 이어감 |
| Mac 완전 꺼짐 | ❌ | OS 자체가 죽음 — 불가피 |

세션이 살아있는 한 100% 발화.

### 동작 흐름

1. Claude 가 Bash+bg 호출 (description="실제 작업")
2. **Hook 차단** + reason: "동반 task 먼저 등록하라"
3. Claude 다음 응답에 **두 호출 같이**:
   - Bash(command='sleep 1200; echo 주기적확인요망', description='주기적확인요망', run_in_background=true)
   - Bash(원래 명령, run_in_background=true)
4. Hook 이 첫 호출의 description 에 "주기적확인요망" 보고 → marker 파일 `/tmp/claude-periodic-active` 생성 + 통과
5. Hook 이 두 번째 호출 → marker 살아있음 (1200s 안) → 통과
6. 둘 다 background 로 진행
7. 1200초 후 sleep task 완료 → task-notification 발화 → Claude 새 턴 시작 → 주기적 확인

다음 Bash+bg 호출까지 1200초 이상 지났으면 marker 만료 → 다시 차단 → Claude 가 새 동반 task 등록.

### 설치

1. 이 repo 의 hook 스크립트 경로 확인:
   ```
   /path/to/clavier-scripts/tools/claude-hooks/bg-watch-spawn.sh
   ```

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
               "command": "bash '/path/to/clavier-scripts/tools/claude-hooks/bg-watch-spawn.sh'"
             }
           ]
         }
       ]
     }
   }
   ```

3. Claude Code 재시작 (또는 새 세션)

### 옵션

- `WEBEXP_BG_WATCH_SEC` env var — sleep 길이(초). 기본 `1200` (20분). 빠른 테스트는 `5` 같이.
- `WEBEXP_BG_WATCH_MARKER` env var — marker 파일 경로. 기본 `/tmp/claude-periodic-active`.

### 로그

- `~/.claude-bg-watch/marker.log` — 차단/통과 이력 (timestamp + preview)

### 자체 테스트

```bash
# 빠른 차단 시뮬
echo '{"tool_name":"Bash","tool_input":{"command":"echo test","run_in_background":true,"description":"test"}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh
# → {"decision":"block","reason":"..."}

# 동반 task 호출 시뮬 → marker 생성됨
echo '{"tool_name":"Bash","tool_input":{"command":"sleep 3; echo 주기적확인요망","description":"주기적확인요망","run_in_background":true}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh
# → exit 0, marker 생성

# 본 명령 시뮬 → marker active, 통과
echo '{"tool_name":"Bash","tool_input":{"command":"echo test","run_in_background":true,"description":"test"}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh
# → exit 0

# 3초 후 marker expired → 다시 차단
sleep 4
echo '{"tool_name":"Bash","tool_input":{"command":"echo test","run_in_background":true,"description":"test"}}' \
  | WEBEXP_BG_WATCH_SEC=3 bash tools/claude-hooks/bg-watch-spawn.sh
# → {"decision":"block","reason":"..."}
```
