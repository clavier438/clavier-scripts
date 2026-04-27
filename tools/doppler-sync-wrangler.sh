#!/usr/bin/env bash
# doppler-sync-wrangler.sh — Doppler → Cloudflare Wrangler secrets 단방향 sync
#
# Doppler가 단일 진실 소스. 워커별 Wrangler secret을 Doppler에서 끌어와 갱신.
#
# 매핑 규칙 (워커별):
#   - framer-sync (sisoso env)  ← AIRTABLE_API_KEY
#   - framer-sync (hotelAgencyOps env) ← AIRTABLE_API_KEY
#   - health-check-worker        ← AIRTABLE_PAT
#
# 사용:
#   doppler-sync-wrangler                # 전체 sync
#   doppler-sync-wrangler --dry-run      # 무엇이 sync될지만 출력
#   doppler-sync-wrangler <worker-name>  # 특정 워커만
#
# 신규 워커 추가 시: SYNC_MAP 배열에 한 줄 추가.

set -euo pipefail

DRY_RUN=0
TARGET_WORKER=""
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --help|-h)
            grep '^#' "$0" | head -20
            exit 0
            ;;
        *) TARGET_WORKER="$arg" ;;
    esac
done

# 매핑 정의: "워커디렉터리|env이름(없으면 -)|Doppler키|Wrangler키"
# 신규 워커 코드가 platform-workers에 추가되면 여기 행 추가.
# health-check-worker는 Cloudflare엔 배포돼있지만 로컬 코드 위치 미확인 — 추후 추가.
SYNC_MAP=(
    "framer-sync|sisoso|AIRTABLE_API_KEY|AIRTABLE_API_KEY"
    "framer-sync|hotelAgencyOps|AIRTABLE_API_KEY|AIRTABLE_API_KEY"
)

PLATFORM_WORKERS_DIR="${PLATFORM_WORKERS_DIR:-/Users/clavier/platform-workers}"

if ! doppler me >/dev/null 2>&1; then
    echo "❌ Doppler 로그인 필요." >&2
    exit 1
fi

# 매핑별 처리
synced=0
skipped=0
for entry in "${SYNC_MAP[@]}"; do
    IFS='|' read -r worker_dir env_name doppler_key wrangler_key <<< "$entry"

    # 특정 워커 필터
    if [[ -n "$TARGET_WORKER" ]] && [[ "$worker_dir" != "$TARGET_WORKER" ]]; then
        continue
    fi

    if [[ ! -d "$PLATFORM_WORKERS_DIR/$worker_dir" ]]; then
        echo "⚠️  워커 디렉터리 없음: $PLATFORM_WORKERS_DIR/$worker_dir (스킵)"
        ((skipped++))
        continue
    fi

    # Doppler에서 값 조회
    value="$(doppler secrets get "$doppler_key" --plain --project clavier --config prd 2>/dev/null)" || {
        echo "⚠️  Doppler 키 없음: $doppler_key (스킵)"
        ((skipped++))
        continue
    }

    label="$worker_dir"
    [[ "$env_name" != "-" ]] && label="$worker_dir [$env_name]"

    if [[ "$DRY_RUN" == "1" ]]; then
        echo "  [dry-run] $label ← $doppler_key (${#value}자)"
    else
        env_arg=()
        [[ "$env_name" != "-" ]] && env_arg=(--env "$env_name")
        # CLOUDFLARE_API_TOKEN 언셋 — wrangler는 OAuth 토큰 사용 (clavier.env L13 주의사항)
        if (cd "$PLATFORM_WORKERS_DIR/$worker_dir" && \
            CLOUDFLARE_API_TOKEN= echo "$value" | npx wrangler secret put "$wrangler_key" "${env_arg[@]}" >/dev/null 2>&1); then
            echo "  ✅ $label ← $wrangler_key"
            ((synced++))
        else
            echo "  ❌ $label ← $wrangler_key (실패)"
            ((skipped++))
        fi
    fi
done

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
    echo "dry-run 완료 (실제 sync는 --dry-run 빼고 재실행)"
else
    echo "완료: $synced개 sync, $skipped개 스킵"
fi
