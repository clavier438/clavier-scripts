#!/usr/bin/env bash
# precheck.sh — 외부 도구 사전 헬스체크
# 사용: precheck <tool>  또는  precheck all
# 모드: airtable / github / cloudflare / doppler / framer-sync / all
#
# 출력: 항목별 ✅ / ❌ + exit code (전부 통과 0, 1개 이상 실패 1)
# 목적: 작업 시작 전 / 매일 03:00 morning shield 가 실행
# 발견 시 처리: stdout 에 빨간점 + 자동 수정 가능한 건 자동, 사용자 결정 필요는 alarm
#
# 등록되지 않은 모드 = 사용법 안내

set -uo pipefail

MODE="${1:-help}"
FAIL=0

print() { echo "$@"; }
ok()   { print "  ✅ $1"; }
fail() { print "  ❌ $1"; FAIL=1; }
warn() { print "  ⚠️  $1"; }

# ─────────────────────────── airtable ───────────────────────────
check_airtable() {
    print "[airtable]"
    if [ -z "${AIRTABLE_PAT:-}" ]; then
        # Doppler fallback
        if command -v doppler >/dev/null && doppler whoami >/dev/null 2>&1; then
            AIRTABLE_PAT=$(doppler secrets get AIRTABLE_PAT --plain 2>/dev/null || echo "")
        fi
    fi
    [ -z "${AIRTABLE_PAT:-}" ] && { fail "AIRTABLE_PAT 미설정 (Doppler 또는 env)"; return; }

    local resp
    resp=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AIRTABLE_PAT" \
        "https://api.airtable.com/v0/meta/whoami")
    if [ "$resp" = "200" ]; then ok "PAT 토큰 살아있음 (whoami 200)"
    else fail "PAT 토큰 응답 $resp — Doppler 갱신 필요"
    fi

    resp=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AIRTABLE_PAT" \
        "https://api.airtable.com/v0/meta/bases")
    if [ "$resp" = "200" ]; then ok "schema.bases:read scope OK"
    else warn "schema.bases scope 부재 — metadata API 작업 막힘 (PAT scope 갱신)"
    fi
}

# ─────────────────────────── github ───────────────────────────
check_github() {
    print "[github]"
    command -v gh >/dev/null || { fail "gh CLI 미설치 (brew install gh)"; return; }

    if gh auth status >/dev/null 2>&1; then
        ok "gh auth 살아있음"
    else
        fail "gh auth 만료 — 'gh auth login' 필요"; return
    fi

    # Common scopes 확인
    local scopes
    scopes=$(gh auth status 2>&1 | grep -oE "Token scopes: .*" || echo "")
    if echo "$scopes" | grep -q "workflow"; then ok "scope: workflow"
    else warn "scope: workflow 부재 — 'gh auth refresh -s workflow'"
    fi
    if echo "$scopes" | grep -q "repo"; then ok "scope: repo"
    else fail "scope: repo 부재"
    fi
}

# ─────────────────────────── cloudflare ───────────────────────────
check_cloudflare() {
    print "[cloudflare]"
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
        if command -v doppler >/dev/null && doppler whoami >/dev/null 2>&1; then
            CLOUDFLARE_API_TOKEN=$(doppler secrets get CLOUDFLARE_API_TOKEN --plain 2>/dev/null || echo "")
        fi
    fi
    [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && { fail "CLOUDFLARE_API_TOKEN 미설정"; return; }

    # 토큰 + IP whitelist 동시 검증
    local resp body status
    resp=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/user/tokens/verify")
    status=$(echo "$resp" | tail -n1)
    body=$(echo "$resp" | sed '$d')

    if [ "$status" = "200" ]; then
        if echo "$body" | grep -q '"status":"active"'; then
            ok "토큰 active"
        else
            fail "토큰 status != active: $body"
        fi
    elif [ "$status" = "403" ]; then
        local my_ip
        my_ip=$(curl -s https://api.ipify.org || echo "?")
        fail "토큰 403 (IP whitelist 추정) — 현재 outbound IP=$my_ip 를 토큰 'Client IP Address Filtering' 에 추가하거나 제거"
    else
        fail "토큰 응답 $status: $body"
    fi

    # ACCOUNT_ID
    if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
        if command -v doppler >/dev/null; then
            CLOUDFLARE_ACCOUNT_ID=$(doppler secrets get CLOUDFLARE_ACCOUNT_ID --plain 2>/dev/null || echo "")
        fi
    fi
    if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
        fail "CLOUDFLARE_ACCOUNT_ID 미설정 (Account-level token 인 경우 필수)"
    else
        ok "CLOUDFLARE_ACCOUNT_ID set ($(echo "$CLOUDFLARE_ACCOUNT_ID" | head -c 8)...)"
    fi

    # Node 22+
    if command -v node >/dev/null; then
        local nv
        nv=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$nv" -ge 22 ] 2>/dev/null; then ok "Node $(node -v) (wrangler 4.x 호환)"
        else fail "Node $(node -v) < 22 (wrangler 4.x = Node 22+ 강제)"
        fi
    else
        warn "node 미설치"
    fi

    # GH Actions secrets 검증 (framer-sync repo 가 main SoT)
    if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
        local repo="clavier0/framer-sync"
        local secrets
        secrets=$(gh secret list --repo "$repo" 2>/dev/null | awk '{print $1}' || echo "")
        echo "$secrets" | grep -q "^CLOUDFLARE_API_TOKEN$" && ok "GH secret: CLOUDFLARE_API_TOKEN" || warn "GH secret: CLOUDFLARE_API_TOKEN 미등록 ($repo)"
        echo "$secrets" | grep -q "^CLOUDFLARE_ACCOUNT_ID$" && ok "GH secret: CLOUDFLARE_ACCOUNT_ID" || warn "GH secret: CLOUDFLARE_ACCOUNT_ID 미등록 ($repo)"
    fi
}

# ─────────────────────────── doppler ───────────────────────────
check_doppler() {
    print "[doppler]"
    command -v doppler >/dev/null || { fail "doppler CLI 미설치 (brew install dopplerhq/cli/doppler)"; return; }

    if doppler whoami >/dev/null 2>&1; then
        ok "doppler 로그인 살아있음 ($(doppler whoami 2>/dev/null | grep -oE '[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+' | head -1))"
    else
        fail "doppler 로그인 만료 — 'doppler login'"; return
    fi

    local cfg
    cfg=$(doppler configure get config --plain 2>/dev/null || echo "")
    if [ -n "$cfg" ]; then ok "활성 config: $cfg"
    else warn "활성 config 미설정 — 'doppler setup'"
    fi

    # 핵심 secret 존재 확인
    for key in AIRTABLE_PAT CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
        if doppler secrets get "$key" --plain >/dev/null 2>&1; then
            ok "secret: $key"
        else
            warn "secret: $key 미등록"
        fi
    done
}

# ─────────────────────────── framer-sync idempotency ───────────────────────────
check_framer_sync() {
    print "[framer-sync idempotency]"
    local mc_init
    mc_init=$(grep -rn "mc_init" "/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync/src/" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$mc_init" -gt 0 ]; then
        ok "mc_init flag 코드 살아있음 ($mc_init refs)"
    else
        fail "mc_init flag 코드 사라짐 — duplicate slug 회귀 위험 (framer-sync/src/usecases/stage2.ts 검사)"
    fi

    # API 시그니처 회귀 — getItems (잘못된 메서드) 호출 검사
    local bad_calls
    bad_calls=$(grep -rn "mc\.getItems\b\|managedCollection\.getItems\b" "/Users/clavier/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers/framer-sync/src/" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$bad_calls" = "0" ]; then
        ok "잘못된 메서드 mc.getItems() 호출 없음"
    else
        fail "mc.getItems() 호출 $bad_calls 곳 — 존재하지 않는 메서드 (getItemIds 사용)"
    fi
}

# ─────────────────────────── dispatch ───────────────────────────
case "$MODE" in
    airtable)     check_airtable ;;
    github)       check_github ;;
    cloudflare)   check_cloudflare ;;
    doppler)      check_doppler ;;
    framer-sync)  check_framer_sync ;;
    all)
        check_doppler && echo
        check_airtable && echo
        check_github && echo
        check_cloudflare && echo
        check_framer_sync
        ;;
    help|--help|-h|*)
        cat <<EOF
사용: precheck <mode>

모드:
  airtable      Airtable PAT + scope
  github        gh CLI auth + scope
  cloudflare    CF token + ACCOUNT_ID + IP whitelist + Node 버전 + GH secrets
  doppler       Doppler 로그인 + 핵심 secret 존재
  framer-sync   mc_init flag + API 시그니처 회귀
  all           위 전부

exit: 전부 통과 0 / 실패 1 (CI·morning shield 에서 fail-fast)
EOF
        exit 0
        ;;
esac

echo
[ "$FAIL" = "0" ] && { echo "✅ precheck $MODE 통과"; exit 0; } || { echo "❌ precheck $MODE 실패 — 위 빨간점 해결 필요"; exit 1; }
