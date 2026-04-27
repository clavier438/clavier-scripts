#!/usr/bin/env bash
# doppler-mirror-icloud.sh — Doppler → iCloud clavier.env 일방향 미러
#
# 단일 진실 소스(Doppler)의 시크릿을 iCloud 백업 파일로 동기화.
# Doppler 장애·복구 대비 + 레거시 도구 호환용 (source ~/.clavier/env 사용처).
#
# 사용:
#   doppler-mirror-icloud           # 미러링 실행
#   doppler-mirror-icloud --check   # diff만 보고 쓰지 않음 (CI/검증용)
#
# 종료 코드:
#   0 = 변경 없음 또는 미러링 성공
#   1 = Doppler 접근 실패
#   2 = --check 모드에서 차이 발견

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICLOUD_ENV="/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/clavier.env"
TIMESTAMP="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

# Doppler 로그인 + 바인딩 확인
if ! doppler me >/dev/null 2>&1; then
    echo "❌ Doppler 로그인 안 됨. 'doppler login' 먼저 실행하세요." >&2
    exit 1
fi

# 시크릿 다운로드 (env 형식, DOPPLER_* 메타 제외)
SECRETS_RAW="$(doppler secrets download --project clavier --config prd --no-file --format env 2>/dev/null)" || {
    echo "❌ Doppler 시크릿 조회 실패." >&2
    exit 1
}

# DOPPLER_* 메타 변수 제거
SECRETS_CLEAN="$(echo "$SECRETS_RAW" | grep -v '^DOPPLER_')"

# clavier.env 생성 (섹션 헤더 + 값)
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

cat > "$TMP_ENV" <<EOF
# Clavier 로컬 환경 — Doppler 백업 미러
#
# ⚠️  이 파일은 자동 생성 — 직접 편집 금지.
# 단일 진실 소스: Doppler (project: clavier, config: prd)
# 갱신: doppler-mirror-icloud
# 마지막 동기화: $TIMESTAMP
#
# 값 변경: doppler secrets set KEY=VALUE 후 doppler-mirror-icloud 재실행.

EOF

# 알파벳 순으로 정렬 (안정적 diff)
echo "$SECRETS_CLEAN" | sort >> "$TMP_ENV"

# diff 비교 — timestamp 줄은 비교 대상에서 제외 (실질적 시크릿 변경만 감지)
if [[ -f "$ICLOUD_ENV" ]]; then
    if diff <(grep -v '^# 마지막 동기화:' "$TMP_ENV") <(grep -v '^# 마지막 동기화:' "$ICLOUD_ENV") >/dev/null 2>&1; then
        echo "✅ 변경 없음 — Doppler ↔ iCloud 일치"
        exit 0
    fi
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
    echo "⚠️  차이 발견 (timestamp 무시):"
    diff <(grep -v '^# 마지막 동기화:' "$ICLOUD_ENV") <(grep -v '^# 마지막 동기화:' "$TMP_ENV") || true
    exit 2
fi

# 백업 후 교체
[[ -f "$ICLOUD_ENV" ]] && cp "$ICLOUD_ENV" "${ICLOUD_ENV}.bak"
mv "$TMP_ENV" "$ICLOUD_ENV"
trap - EXIT

VAR_COUNT=$(echo "$SECRETS_CLEAN" | grep -c '^[A-Z]' || echo 0)
echo "✅ 미러링 완료: $VAR_COUNT개 변수 → $ICLOUD_ENV"
echo "   백업: ${ICLOUD_ENV}.bak"
