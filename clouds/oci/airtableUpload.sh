#!/bin/bash
# GDrive airtable/jobs/{job}/ → Airtable 업로드 트리거
# 사용법: airtableUpload <job-name> [--wait]
# 예시:  airtableUpload sisoso_1.0.1
#        airtableUpload sisoso_1.0.1 --wait

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SELF_DIR/server.conf" 2>/dev/null || true

HOST="${HOST:-168.107.63.94}"
PORT="${PORT:-8081}"
JOB="$1"
WAIT="${2:-}"

if [[ -z "$JOB" ]]; then
    echo "사용법: airtableUpload <job-name> [--wait]"
    exit 1
fi

# Airtable PAT — env.md에서 읽기
ENV_MD="$SELF_DIR/../../env.md"
AT_PAT=$(grep -A1 'Airtable' "$ENV_MD" | grep 'API_KEY' | awk -F': *' '{print $2}' | tr -d '`' | xargs)

if [[ -z "$AT_PAT" ]]; then
    echo "오류: Airtable PAT을 env.md에서 찾을 수 없습니다"
    exit 1
fi

echo "▸ 업로드 시작: $JOB"

# SSH를 통해 OCI localhost 호출 (포트 공개 불필요)
RESPONSE=$(ssh -o ConnectTimeout=10 ubuntu@"$HOST" \
    "curl -s -X POST http://localhost:$PORT/airtable-upload \
     -H 'Authorization: Bearer $AT_PAT' \
     -H 'Content-Type: application/json' \
     -d '{\"job\": \"$JOB\"}'")

echo "$RESPONSE"

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)

if [[ "$STATUS" != "started" ]]; then
    echo "오류: 업로드 시작 실패"
    exit 1
fi

if [[ "$WAIT" == "--wait" ]]; then
    echo "▸ 완료 대기 중..."
    for i in $(seq 1 24); do
        sleep 5
        RESULT=$(ssh -o ConnectTimeout=10 ubuntu@"$HOST" \
            "curl -s http://localhost:$PORT/airtable-upload/$JOB")
        JOB_STATUS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
        if [[ "$JOB_STATUS" == "done" ]]; then
            echo "✅ 완료:"
            echo "$RESULT" | python3 -m json.tool
            exit 0
        elif [[ "$JOB_STATUS" == "error" ]]; then
            echo "❌ 오류:"
            echo "$RESULT"
            exit 1
        fi
        echo "  ... ($((i*5))s)"
    done
    echo "⚠️  타임아웃 (2분). 상태 확인: airtableUpload $JOB --status"
else
    echo "▸ 백그라운드 실행 중. 상태 확인:"
    echo "  ssh ubuntu@$HOST \"curl -s http://localhost:$PORT/airtable-upload/$JOB\""
fi
