#!/usr/bin/env bash
# ociIn — OCI 서버(168.107.63.94) SSH 연결 (Doppler 우선, env.md@iCloud 폴백)
#
# 동작:
#   1) Doppler 시크릿 OCI_SSH_PRIVATE_KEY_B64 에서 키 추출 (1순위)
#      미설정 시 → env.md@iCloud 의 "Private Key (base64):" 블록 (Mac 폴백)
#   2) /tmp 임시 파일로 복원, 권한 600
#   3) SSH 연결
#   4) 종료 시 임시 키 파일 자동 삭제
#
# 사용법:
#   ./connectSsh.sh          → 대화형 셸
#   ./connectSsh.sh "명령어"  → 명령어 한 줄 실행 후 종료
#
# Doppler 마이그레이션 (iCloud 의존 완전 제거):
#   doppler secrets set OCI_SSH_PRIVATE_KEY_B64="$(cat <키파일> | base64 | tr -d '\n')"

set -euo pipefail

# ── 설정 ─────────────────────────────────────────────────
OCI_IP="168.107.63.94"
OCI_USER="ubuntu"
OCI_PORT="22"
KEY_TMP="/tmp/oci_key_$$"

# ── private key 추출 (Doppler 우선) ───────────────────────
KEY_B64=""

# 1순위: Doppler
if command -v doppler >/dev/null 2>&1; then
    KEY_B64=$(doppler secrets get OCI_SSH_PRIVATE_KEY_B64 --plain 2>/dev/null | tr -d '\n' || true)
fi

# 2순위 (Mac 폴백): iCloud env.md
if [[ -z "$KEY_B64" ]]; then
    ENV_MD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md"
    if [[ -f "$ENV_MD" ]]; then
        KEY_B64=$(awk '
            /Private Key \(base64\):/ { found=1; next }
            found && /^```/ && !inblock { inblock=1; next }
            found && inblock && /^```/ { exit }
            found && inblock { print }
        ' "$ENV_MD" | tr -d '\n')
    fi
fi

if [[ -z "$KEY_B64" ]]; then
    echo "❌ OCI private key 못 찾음. 다음 중 하나 필요:" >&2
    echo "   - Doppler: OCI_SSH_PRIVATE_KEY_B64 시크릿 설정" >&2
    echo "   - Mac: ~/Library/Mobile Documents/.../scripts/env.md 의 Private Key (base64) 블록" >&2
    exit 1
fi

# base64 → 바이너리 파일로 복원 후 헤더/푸터 추가
printf '%s\n%s\n%s\n' \
    "-----BEGIN OPENSSH PRIVATE KEY-----" \
    "$KEY_B64" \
    "-----END OPENSSH PRIVATE KEY-----" > "$KEY_TMP"

chmod 600 "$KEY_TMP"

# ── 종료 시 키 파일 자동 삭제 (trap: 스크립트가 어떻게 종료되든 실행됨) ──
trap "rm -f '$KEY_TMP'" EXIT

# ── 연결 ─────────────────────────────────────────────────
if [[ $# -gt 0 ]]; then
    # 인자가 있으면 명령어 실행 후 종료
    ssh -i "$KEY_TMP" \
        -o StrictHostKeyChecking=no \
        -p "$OCI_PORT" \
        "${OCI_USER}@${OCI_IP}" "$@"
else
    # 인자 없으면 대화형 셸
    echo "🔗 OCI 서버에 연결합니다 (${OCI_USER}@${OCI_IP})"
    ssh -i "$KEY_TMP" \
        -o StrictHostKeyChecking=no \
        -p "$OCI_PORT" \
        "${OCI_USER}@${OCI_IP}"
fi
