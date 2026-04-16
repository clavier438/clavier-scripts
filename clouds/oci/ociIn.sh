#!/usr/bin/env bash
# ociIn — OCI 서버(168.107.63.94) SSH 연결 (env.md에서 키 자동 복원)
#
# 동작:
#   1) env.md에서 base64로 보관 중인 private key를 /tmp에 임시 복원
#   2) 권한을 600으로 설정 (SSH는 키 파일 권한이 너무 열려 있으면 거부함)
#   3) SSH 연결
#   4) 연결 종료 후 키 파일 자동 삭제 (보안)
#
# 사용법:
#   ./connectSsh.sh          → 대화형 셸
#   ./connectSsh.sh "명령어"  → 명령어 한 줄 실행 후 종료

set -euo pipefail

# ── 설정 ─────────────────────────────────────────────────
OCI_IP="168.107.63.94"
OCI_USER="ubuntu"
OCI_PORT="22"
KEY_TMP="/tmp/oci_key_$$"   # $$: 현재 프로세스 ID → 동시 실행해도 충돌 없음

ENV_MD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md"

# ── private key 복원 ──────────────────────────────────────
# env.md에서 base64 키 블록을 추출
# 파싱 방식: "Private Key (base64):" 줄 찾기 → 여는 ``` 건너뛰기 → 내용 수집 → 닫는 ``` 에서 종료
KEY_B64=$(awk '
    /Private Key \(base64\):/ { found=1; next }
    found && /^```/ && !inblock { inblock=1; next }
    found && inblock && /^```/ { exit }
    found && inblock { print }
' "$ENV_MD" | tr -d '\n')

if [[ -z "$KEY_B64" ]]; then
    echo "❌ env.md에서 OCI private key를 찾을 수 없습니다." >&2
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
