#!/usr/bin/env bash
# SessionStart hook — Claude Code on the web 전용 Doppler CLI 부트스트랩.
#
# 왜 필요한가:
#   web 세션은 매번 새 컨테이너에서 시작 — Doppler CLI 가 없어 secret 접근 불가.
#   이 hook 이 매 세션 자동으로 (1) deb 설치 (2) 기본 project/config 세팅.
#
# 인증:
#   사용자가 Claude Code on web 설정에서 DOPPLER_TOKEN 환경변수를 한 번만
#   추가해두면 Doppler CLI 가 자동으로 그 값을 사용 (토큰 → 영속).
#   토큰 발급 (현재 plan = Developer Free, Service Token 미지원):
#     dashboard.doppler.com → 우상단 프로필 → API Tokens → Generate
#     이름은 식별 가능하게 (예: claude-code-web)
#   ⚠️ Personal Token 은 계정 전체 권한 — 절대 평문 노출 금지.
#     transcript / git / 노션 등에 박히면 즉시 revoke.
#
# Mac/OCI 는 brew/apt + keychain 으로 따로 세팅돼 있으므로 web 한정 실행.

set -euo pipefail

# 1) 웹 세션이 아니면 종료 (Mac/OCI 는 자기 setup 사용)
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

DOPPLER_VERSION="3.76.0"

# 2) Doppler CLI 설치 (idempotent — 이미 있으면 skip)
if ! command -v doppler >/dev/null 2>&1; then
  echo "[session-start] installing Doppler CLI ${DOPPLER_VERSION}"
  TMPDEB="/tmp/doppler-${DOPPLER_VERSION}.deb"
  # cli.doppler.com 은 web sandbox 에서 막힘 (403). GitHub releases 우회.
  curl -sSL -H "User-Agent: claude-code" \
    -o "$TMPDEB" \
    "https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}/doppler_${DOPPLER_VERSION}_linux_amd64.deb"
  dpkg -i "$TMPDEB" >/dev/null
  rm -f "$TMPDEB"
fi

echo "[session-start] doppler $(doppler --version)"

# 3) 기본 project/config 박기 — 매 명령 --project/--config 안 붙여도 되게.
#    --scope 로 repo 디렉토리 단위 설정 (전역 오염 방지).
doppler configure set project clavier --silent --scope "$CLAUDE_PROJECT_DIR" >/dev/null
doppler configure set config prd       --silent --scope "$CLAUDE_PROJECT_DIR" >/dev/null

# 4) 인증 검증
if [ -z "${DOPPLER_TOKEN:-}" ]; then
  cat <<'WARN'
[session-start] WARN: DOPPLER_TOKEN 환경변수 미설정.
  Claude Code on web 설정에서 secret 추가:
    Name : DOPPLER_TOKEN
    Value: <Personal Token — dashboard.doppler.com → 프로필 → API Tokens → Generate>
           이름 예: claude-code-web
  추가 후 새 세션부터 자동 적용.
  ⚠️ Personal Token 은 계정 전체 권한 — 평문 노출 시 즉시 revoke.
WARN
  exit 0
fi

# DOPPLER_TOKEN 있으면 doppler CLI 가 자동 사용 — whoami 로 확인만.
if doppler me >/dev/null 2>&1; then
  echo "[session-start] doppler authed: $(doppler me --json 2>/dev/null | grep -oE '"slug":"[^"]+"' | head -1 || echo 'ok')"
else
  echo "[session-start] WARN: DOPPLER_TOKEN set but auth failed — token expired or wrong scope"
fi
