#!/usr/bin/env bash
# doppler-mirror-icloud.sh — Doppler → iCloud clavier.env 일방향 미러 (워커별 분리)
#
# 단일 진실 소스(Doppler)의 시크릿을 iCloud 백업 파일로 동기화.
# Doppler 장애·복구 대비 + 레거시 도구 호환용 (source ~/.clavier/env 사용처).
#
# 워커별 분리 미러 (2026-05-07~, multi-worker):
#   - Doppler[prd]        → clavier.env        (sisoso, 기본 폴백)
#   - Doppler[prd_mukayu] → clavier_mukayu.env (mukayu)
#
# 사용:
#   doppler-mirror-icloud           # 모든 워커 config 미러
#   doppler-mirror-icloud --check   # diff만 보고 쓰지 않음 (CI/검증용)
#
# 종료 코드:
#   0 = 변경 없음 또는 미러링 성공
#   1 = Doppler 접근 실패
#   2 = --check 모드에서 차이 발견

set -euo pipefail

ICLOUD_DIR="/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/scripts"
TIMESTAMP="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

# 미러 매핑 — "doppler-config|iCloud-파일명". workerEnvMap.mjs 의 dopplerConfig 와 동기.
MIRRORS=(
    "prd|clavier.env"
    "prd_mukayu|clavier_mukayu.env"
)

# Doppler 로그인 확인 (한 번만)
if ! doppler me >/dev/null 2>&1; then
    echo "❌ Doppler 로그인 안 됨. 'doppler login' 먼저 실행하세요." >&2
    exit 1
fi

DIFF_FOUND=0
TOTAL_VARS=0

for mirror in "${MIRRORS[@]}"; do
    IFS='|' read -r config filename <<< "$mirror"
    target="$ICLOUD_DIR/$filename"
    label="$config → $filename"

    echo "── $label"

    # 시크릿 다운로드
    SECRETS_RAW="$(doppler secrets download --project clavier --config "$config" --no-file --format env 2>/dev/null)" || {
        echo "  ⚠️  Doppler[$config] 조회 실패 (스킵)"
        continue
    }

    # DOPPLER_* 메타 변수 제거
    SECRETS_CLEAN="$(echo "$SECRETS_RAW" | grep -v '^DOPPLER_')"

    # tmp 파일 작성
    TMP_ENV="$(mktemp)"
    cat > "$TMP_ENV" <<EOF
# Clavier 로컬 환경 — Doppler 백업 미러
#
# ⚠️  이 파일은 자동 생성 — 직접 편집 금지.
# 단일 진실 소스: Doppler (project: clavier, config: $config)
# 갱신: doppler-mirror-icloud
# 마지막 동기화: $TIMESTAMP
#
# 값 변경: doppler secrets set KEY=VALUE --config $config 후 doppler-mirror-icloud 재실행.

EOF
    echo "$SECRETS_CLEAN" | sort >> "$TMP_ENV"

    # diff 비교
    if [[ -f "$target" ]]; then
        if diff <(grep -v '^# 마지막 동기화:' "$TMP_ENV") <(grep -v '^# 마지막 동기화:' "$target") >/dev/null 2>&1; then
            echo "  ✅ 변경 없음"
            rm -f "$TMP_ENV"
            continue
        fi
    fi

    if [[ "$CHECK_ONLY" == "1" ]]; then
        echo "  ⚠️  차이 발견 (timestamp 무시):"
        diff <(grep -v '^# 마지막 동기화:' "$target" 2>/dev/null) <(grep -v '^# 마지막 동기화:' "$TMP_ENV") || true
        DIFF_FOUND=1
        rm -f "$TMP_ENV"
        continue
    fi

    # 백업 후 교체
    [[ -f "$target" ]] && cp "$target" "${target}.bak"
    mv "$TMP_ENV" "$target"

    VAR_COUNT=$(echo "$SECRETS_CLEAN" | grep -c '^[A-Z]' || echo 0)
    TOTAL_VARS=$((TOTAL_VARS + VAR_COUNT))
    echo "  ✅ ${VAR_COUNT}개 변수 → $filename (백업: ${filename}.bak)"
done

echo ""
if [[ "$CHECK_ONLY" == "1" ]]; then
    [[ "$DIFF_FOUND" == "1" ]] && exit 2 || echo "✅ 모든 mirror 일치"
else
    echo "✅ 미러링 완료 (총 $TOTAL_VARS 변수)"
fi
