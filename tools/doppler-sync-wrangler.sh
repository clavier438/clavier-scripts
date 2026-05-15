#!/usr/bin/env bash
# doppler-sync-wrangler.sh — Doppler → Cloudflare Wrangler secrets 단방향 sync
#
# Doppler가 단일 진실 소스. 워커별 Wrangler secret을 Doppler에서 끌어와 갱신.
#
# 매핑 SSOT — 새 워커 추가 시 WORKERS 배열에 한 줄, 키 변경 시 KEYS 배열만 수정.
#   (tools/lib/workerEnvMap.mjs 와 같은 매핑을 일부러 양쪽에 박았다 — JS↔bash 인터프로세스
#    호출은 sync 한 번에 의의 없는 비용. 매핑 변경 = 양쪽 동시 수정 = 한 commit.)
#
# 사용:
#   doppler-sync-wrangler                # 모든 워커 sync
#   doppler-sync-wrangler --dry-run      # 무엇이 sync될지만 출력
#   doppler-sync-wrangler <worker-name>  # 특정 워커만 (예: mukayu, sisoso)

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

# ── 매핑 SSOT ─────────────────────────────────────────────────────────────
# 한 줄 = 한 워커. 형식: "worker-name|wrangler-env|doppler-config"
#   wrangler-env: top-level 환경 = "-"  (wrangler.toml 의 [env.<name>] 섹션 이름, 없으면 "-")
#   doppler-config: 그 워커의 secrets 가 들어있는 Doppler config 이름
WORKERS=(
    "sisoso|-|prd"
    "mukayu|mukayu|prd_mukayu"
)

# 모든 워커가 공유하는 secret 키 (Doppler key = Wrangler key 동일 이름 가정)
# 새 키 추가 시 여기에만 추가하면 모든 워커 sync.
KEYS=(
    AIRTABLE_API_KEY
    AIRTABLE_BASE_ID
    FRAMER_PROJECTS
    FRAMER_PROJECT_ID
)

# 워커 디렉터리 (모두 framer-sync repo 의 env 분리 — wrangler.toml 의 [env.<name>])
WORKER_DIR="framer-sync"

# ── 환경 셋업 ─────────────────────────────────────────────────────────────
# sibling-first 자동 탐색 (environment-peer 모델, DECISIONS 2026-05-03)
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIBLING_PW="$(cd "$SELF_DIR/../.." && pwd)/platform-workers"
ICLOUD_PW="$HOME/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers"
if [ -n "${PLATFORM_WORKERS_DIR:-}" ]; then
    : # use override
elif [ -d "$SIBLING_PW" ]; then
    PLATFORM_WORKERS_DIR="$SIBLING_PW"
elif [ -d "$ICLOUD_PW" ]; then
    PLATFORM_WORKERS_DIR="$ICLOUD_PW"
else
    echo "❌ platform-workers repo 못 찾음. PLATFORM_WORKERS_DIR env 설정 또는 sibling 클론 필요." >&2
    exit 1
fi

if ! doppler me >/dev/null 2>&1; then
    echo "❌ Doppler 로그인 필요." >&2
    exit 1
fi

# ── wrangler 인증 — Doppler[prd] CLOUDFLARE_API_TOKEN 사용 (wrangler login 불필요) ──
# 예전엔 CLOUDFLARE_API_TOKEN 을 언셋하고 OAuth 세션에 의존했는데, OAuth 로그인이 안 돼
# 있어 모든 키 sync 가 silent 실패했다 (2026-05-15 사고). Doppler 가 SSOT — 토큰도
# 거기서 끌어 export 하면 무인증·완전자동. account ID 도 함께 넘겨 env 추론 안정화.
CLOUDFLARE_API_TOKEN="$(doppler secrets get CLOUDFLARE_API_TOKEN --plain --project clavier --config prd 2>/dev/null)" || {
    echo "❌ Doppler[prd] CLOUDFLARE_API_TOKEN 없음 — wrangler 인증 불가." >&2
    exit 1
}
CLOUDFLARE_ACCOUNT_ID="$(doppler secrets get CLOUDFLARE_ACCOUNT_ID --plain --project clavier --config prd 2>/dev/null || true)"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

if [[ ! -d "$PLATFORM_WORKERS_DIR/$WORKER_DIR" ]]; then
    echo "❌ 워커 디렉터리 없음: $PLATFORM_WORKERS_DIR/$WORKER_DIR" >&2
    exit 1
fi

# ── sync 루프: 워커 × 키 ──────────────────────────────────────────────────
synced=0
skipped=0
for worker_entry in "${WORKERS[@]}"; do
    IFS='|' read -r worker_name wrangler_env doppler_config <<< "$worker_entry"

    if [[ -n "$TARGET_WORKER" ]] && [[ "$worker_name" != "$TARGET_WORKER" ]]; then
        continue
    fi

    label="$worker_name"
    [[ "$wrangler_env" != "-" ]] && label="$worker_name [$wrangler_env]"
    echo "── $label  (Doppler: $doppler_config)"

    for key in "${KEYS[@]}"; do
        # Doppler 에서 값 조회
        value="$(doppler secrets get "$key" --plain --project clavier --config "$doppler_config" 2>/dev/null)" || {
            echo "  ⚠️  Doppler[$doppler_config] $key 없음 (스킵)"
            ((skipped++))
            continue
        }

        if [[ "$DRY_RUN" == "1" ]]; then
            echo "  [dry-run] $key (${#value}자)"
        else
            env_arg=()
            [[ "$wrangler_env" != "-" ]] && env_arg=(--env "$wrangler_env")
            # wrangler 인증 = 위에서 export 한 CLOUDFLARE_API_TOKEN (Doppler SSOT). 로그인 불필요.
            # set -u 환경에서 빈 배열 expansion 보호 (${arr[@]:+...})
            if (cd "$PLATFORM_WORKERS_DIR/$WORKER_DIR" && \
                echo "$value" | npx wrangler secret put "$key" ${env_arg[@]+"${env_arg[@]}"} >/dev/null 2>&1); then
                echo "  ✅ $key"
                ((synced++))
            else
                echo "  ❌ $key (실패)"
                ((skipped++))
            fi
        fi
    done
done

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
    echo "dry-run 완료 (실제 sync는 --dry-run 빼고 재실행)"
else
    echo "완료: ${synced}개 sync, ${skipped}개 스킵"
fi
