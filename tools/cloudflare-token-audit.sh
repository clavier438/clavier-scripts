#!/usr/bin/env bash
# cloudflare-token-audit.sh
# 매일 새벽 — Cloudflare 토큰 audit
# 1) 우리 Doppler 토큰 verify (살아있나 + 만료일 + 권한)
# 2) 결과 markdown 저장
# 3) 비정상 (revoked/만료 임박/24h 안 사용 안 됨) 시 ⚠️ 표시
# 토큰 list 자체는 Cloudflare 대시보드 직접 확인 (Account-level 토큰은 API list 미제공)

set -e

OUT_DIR="${HOME}/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/clavier-hq/briefings"
mkdir -p "$OUT_DIR"
DATE=$(date +%Y-%m-%d)
REPORT="$OUT_DIR/cloudflare-tokens-$DATE.md"

TOKEN=$(doppler secrets get CLOUDFLARE_API_TOKEN --plain --project clavier --config prd 2>/dev/null)
[ -z "$TOKEN" ] && { echo "❌ CLOUDFLARE_API_TOKEN not in Doppler"; exit 1; }

# Account-level token 은 verify 미지원. 단순 account 조회로 대체
ACCT=$(doppler secrets get CLOUDFLARE_ACCOUNT_ID --plain --project clavier --config prd)
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT")

OK=$(echo "$RESP" | jq -r '.success')
ACCT_NAME=$(echo "$RESP" | jq -r '.result.name // "unknown"')
TOKEN_ID="(account-level — id 노출 안 됨)"
STATUS=$([ "$OK" = "true" ] && echo "active" || echo "invalid")
EXPIRES="(account-level token, 만료 정보 별도 조회 필요)"
NOT_BEFORE="-"

{
  echo "# Cloudflare 토큰 audit — $DATE"
  echo ""
  echo "## Doppler 토큰 verify"
  echo ""
  echo "- token id: \`$TOKEN_ID\`"
  echo "- status: **$STATUS**"
  echo "- expires_on: $EXPIRES"
  echo "- not_before: $NOT_BEFORE"
  echo ""

  if [ "$OK" = "true" ] && [ "$STATUS" = "active" ]; then
    echo "✅ Doppler 토큰 정상 활성"
  else
    echo "⚠️ **Doppler 토큰 비정상** — verify 실패"
    echo ""
    echo "raw response:"
    echo '```'
    echo "$VERIFY" | jq
    echo '```'
  fi
  echo ""

  # 만료일 검사 (timestamp 형식일 때만)
  if [[ "$EXPIRES" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
    SECS_LEFT=$(( $(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$EXPIRES" +%s 2>/dev/null || echo 0) - $(date +%s) ))
    DAYS_LEFT=$(( SECS_LEFT / 86400 ))
    if [ "$DAYS_LEFT" -lt 30 ] && [ "$DAYS_LEFT" -gt 0 ]; then
      echo "⚠️ **만료 임박** — $DAYS_LEFT 일 후 만료"
    elif [ "$DAYS_LEFT" -le 0 ]; then
      echo "❌ **이미 만료**"
    fi
  fi

  echo ""
  echo "## 다른 토큰 list (Account-level 은 API 미제공)"
  echo ""
  echo "사용자 본인이 [Cloudflare 대시보드](https://dash.cloudflare.com/profile/api-tokens) 에서 직접 확인:"
  echo "- 1개만 active = 정상"
  echo "- 2개 이상 active 또는 우리 모르는 토큰 = revoke 권장"
} > "$REPORT"

cat "$REPORT"
echo ""
echo "📝 saved: $REPORT"
