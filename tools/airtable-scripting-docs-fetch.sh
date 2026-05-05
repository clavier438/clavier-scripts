#!/usr/bin/env bash
# airtable-scripting-docs-fetch.sh
#
# Airtable/blocks SDK 의 핵심 source 를 docs/airtable-blocks-sdk/ 에 mirror.
# 새벽루틴 queue 부하가 매일 03:00 호출 (OVERNIGHT_QUEUE.md "매일 자동 실행" 영구 항목).
# 변경 있으면 commit + push, 없으면 silent.
#
# 목적:
#   - Scripting Extension 의 SDK = Airtable/blocks 와 거의 동일 (subset)
#   - 새 메서드 사용 전 추측 단정 금지 — capabilities/airtable-scripting.md 또는 raw source 직접 확인
#   - SDK 변경 (예: 새 field type 지원) 이 다음 날 자동 인지
#
# 수동 실행: bash tools/airtable-scripting-docs-fetch.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/airtable-blocks-sdk"
mkdir -p "$DOCS_DIR"

BASE_URL="https://raw.githubusercontent.com/Airtable/blocks/master/packages/sdk"

# 핵심 source — Scripting Extension 작업 시 자주 참조
FILES=(
    "CHANGELOG.md"
    "README.md"
    "src/types/field.ts"
    "src/models/table.ts"
    "src/models/base.ts"
    "src/models/field.ts"
    "src/models/record.ts"
)

changed_files=()
fail_files=()

for f in "${FILES[@]}"; do
    # sub-directory 보존 (types/field.ts vs models/field.ts 충돌 회피)
    target="$DOCS_DIR/$f"
    mkdir -p "$(dirname "$target")"
    tmp=$(mktemp)
    if curl -sf --max-time 30 -o "$tmp" "$BASE_URL/$f"; then
        if [ ! -f "$target" ] || ! diff -q "$target" "$tmp" >/dev/null 2>&1; then
            mv "$tmp" "$target"
            changed_files+=("$(basename "$f")")
        else
            rm "$tmp"
        fi
    else
        fail_files+=("$f")
        rm -f "$tmp"
    fi
done

# 보고
echo "[airtable-scripting-docs-fetch] $(date +%Y-%m-%dT%H:%M:%S)"
if [ ${#changed_files[@]} -gt 0 ]; then
    echo "  changed: ${changed_files[*]}"
else
    echo "  no changes"
fi
if [ ${#fail_files[@]} -gt 0 ]; then
    echo "  ⚠️ fetch failed: ${fail_files[*]}"
fi

# commit + push (변경 있으면)
cd "$REPO_ROOT"
if [ ${#changed_files[@]} -gt 0 ]; then
    git add "$DOCS_DIR/"
    git commit -m "docs(airtable-blocks-sdk): mirror $(date +%Y-%m-%d) — ${changed_files[*]}" \
        -m "Airtable/blocks SDK 핵심 source 자동 동기화 (새벽루틴 queue 부하)." \
        -m "" \
        -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
    git push
    echo "  ✅ commit + push"
fi

exit 0
