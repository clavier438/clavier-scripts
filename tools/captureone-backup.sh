#!/usr/bin/env bash
# captureone-backup.sh — Capture One 카탈로그/세션을 *안전할 때만* iCloud 로 백업
#
# 사용법:
#   captureone-backup.sh            상태만 표시 (안전한가 / 무엇이 백업될까) — 부작용 없음
#   captureone-backup.sh check      동일 (명시적)
#   captureone-backup.sh backup     안전검사 통과 시에만 백업 실행
#   captureone-backup.sh --full backup   재생성 가능한 Cache 까지 통째로 포함
#
# 환경변수로 경로 덮어쓰기:
#   CO_SRC   백업 대상 루트 (기본: ~/Pictures/CaptureOne)
#   CO_DEST  백업 저장 위치 (기본: ~/Library/Mobile Documents/com~apple~CloudDocs/CaptureOneBackup)
#   CO_KEEP  보관 세대 수 (기본: 5)
#
# === 핵심 불변식 ============================================================
# 이 스크립트에는 안전검사를 *끄는 플래그가 없다*. backup() 은 첫 동작으로 게이트를
# 부르고, 통과(return 0)가 아니면 복사 코드에 도달하지 못하고 종료한다. 복사 후에도
# 다시 게이트(프로세스 재실행 감지) + 무결성 검증을 통과해야만 백업을 "승격"한다.
# 어느 단계든 실패하면 staging 을 버리고 *직전 백업은 그대로 둔다* — 나쁜 백업이
# 좋은 백업을 덮어쓸 path 자체가 없다. (메타원칙: 나쁜 상태로 가는 경로를 없앤다.)

# freshness — 모든 .sh tool 의 첫 source (stale 로컬 코드 실행 차단).
# set -u 이전에 둔다: freshness.sh 가 미설정 환경변수를 참조하므로(imgToWeb.sh 동일 순서).
. "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/freshness.sh"

set -euo pipefail

# lib (안전검사 SSOT) source — symlink 경유 호출도 견디게 해석
_DIR="$(cd "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
. "$_DIR/lib/co-safety.sh"

# ── 설정 ────────────────────────────────────────────────────
CO_SRC="${CO_SRC:-$HOME/Pictures/CaptureOne}"
CO_DEST="${CO_DEST:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/CaptureOneBackup}"
CO_KEEP="${CO_KEEP:-5}"
FULL=0

# 색 (터미널일 때만)
if [ -t 1 ]; then R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; X=$'\033[0m'
else R=; G=; Y=; B=; X=; fi

# 재생성 가능 → 기본 제외 (복사시간↓ = race 창↓, 용량↓). --full 이면 포함.
rsync_excludes() {
  if [ "$FULL" -eq 1 ]; then return; fi
  printf '%s\n' \
    "--exclude=Cache/" \
    "--exclude=*.profraw" \
    "--exclude=.DS_Store" \
    "--exclude=writelock"
}

die()  { echo "${R}✗ $*${X}" >&2; exit 1; }
info() { echo "$*" >&2; }

# ── 상태 표시 (status-upfront: 묻기 전에 먼저 보여준다) ──────────────────
cmd_check() {
  echo "${B}Capture One 안전 백업 — 상태${X}"
  echo "  대상(SRC) : $CO_SRC"
  echo "  저장(DEST): $CO_DEST"
  echo "  보관 세대 : $CO_KEEP"
  echo ""

  if [ ! -d "$CO_SRC" ]; then
    echo "  ${Y}⚠ SRC 폴더 없음 — 아직 백업할 게 없습니다.${X}"
    return 0
  fi

  local dbs; dbs="$(co_find_dbs "$CO_SRC")"
  if [ -z "$dbs" ]; then
    echo "  ${Y}⚠ SRC 안에 Capture One 문서(.cocatalog/.cosessiondb) 없음.${X}"
  else
    echo "  발견된 C1 문서:"
    echo "$dbs" | sed 's/^/      /'
  fi
  echo ""

  echo "  ${B}안전검사:${X}"
  if co_safe_to_copy "$CO_SRC"; then
    echo "  ${G}✓ 안전 — 지금 'backup' 하면 복사됩니다.${X}"
  else
    echo "  ${R}→ 위험 — 'backup' 해도 게이트에서 차단됩니다. (Capture One 종료 후 재시도)${X}"
  fi

  # 기존 백업 목록
  if [ -d "$CO_DEST" ]; then
    local n; n=$(find "$CO_DEST" -maxdepth 1 -type d -name 'CaptureOne-*' 2>/dev/null | wc -l | tr -d ' ')
    echo ""
    echo "  기존 백업: ${n}개"
    find "$CO_DEST" -maxdepth 1 -type d -name 'CaptureOne-*' 2>/dev/null | sort | tail -3 | sed 's/^/      /'
  fi
}

# ── 백업 실행 ───────────────────────────────────────────────
cmd_backup() {
  [ -d "$CO_SRC" ] || die "SRC 폴더가 없습니다: $CO_SRC"
  local dbs; dbs="$(co_find_dbs "$CO_SRC")"
  [ -n "$dbs" ] || { info "${Y}백업할 C1 문서 없음 — 종료.${X}"; exit 0; }

  # 동시 실행 방지 락 (mkdir 은 원자적). LOCK 은 *전역* — EXIT trap 이 함수 스코프
  # 밖에서 실행되므로 local 이면 set -u 에 unbound 가 된다(테스트로 발견).
  LOCK="$CO_DEST/.backup.lock"
  mkdir -p "$CO_DEST"
  if ! mkdir "$LOCK" 2>/dev/null; then
    die "다른 백업이 진행 중인 것 같습니다 (lock: $LOCK). 아니면 수동 삭제 후 재시도."
  fi
  trap 'rm -rf "${LOCK:-}"' EXIT

  # ── GATE (불변식): 통과 못 하면 여기서 끝. 복사 코드에 도달 불가 ──
  info "${B}[1/4] 안전검사…${X}"
  co_safe_to_copy "$CO_SRC" || die "안전검사 차단 — Capture One 을 완전히 종료한 뒤 다시 실행하세요."
  info "${G}  ✓ 통과${X}"

  # ── 복사: staging 으로 (승격 전까지 기존 백업 불변) ──
  local ts staging
  ts="$(date +%Y%m%d-%H%M%S)"
  staging="$CO_DEST/.staging-$ts"
  info "${B}[2/4] 복사(rsync) → staging…${X}"
  local exc; exc="$(rsync_excludes)"
  # shellcheck disable=SC2086
  rsync -a --delete $exc "$CO_SRC/" "$staging/" \
    || { rm -rf "$staging"; die "rsync 실패 — staging 삭제, 백업 미생성."; }

  # ── RE-GATE: 복사 도중 C1 이 켜졌으면 사본이 찢어졌을 수 있음 → 폐기 ──
  info "${B}[3/4] 복사 후 재검사…${X}"
  if co_running; then
    rm -rf "$staging"
    die "복사 중 Capture One 이 실행됨 — 사본 신뢰 불가, staging 폐기. 종료 후 재시도."
  fi
  # 모든 복사된 DB 무결성 검증 — 하나라도 깨지면 승격 안 함
  local d bad=0
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    co_integrity_ok "$d" || bad=1
  done < <(co_find_dbs "$staging")
  if [ "$bad" -ne 0 ]; then
    rm -rf "$staging"
    die "복사본 무결성 검증 실패 — staging 폐기, 직전 백업 보존."
  fi
  info "${G}  ✓ 재검사·무결성 통과${X}"

  # ── 승격(원자적 rename) + 세대 정리 ──
  info "${B}[4/4] 승격 & 정리…${X}"
  local final="$CO_DEST/CaptureOne-$ts"
  mv "$staging" "$final"
  # 오래된 세대 삭제 (최신 CO_KEEP 개만 유지). macOS head 는 `-n -N` 미지원이므로
  # newest-first 정렬 후 앞 CO_KEEP 개를 건너뛴 나머지(=오래된 것)를 삭제(테스트로 발견).
  local olddirs
  olddirs="$(find "$CO_DEST" -maxdepth 1 -type d -name 'CaptureOne-*' | sort -r | tail -n +"$((CO_KEEP+1))")"
  if [ -n "$olddirs" ]; then
    echo "$olddirs" | while IFS= read -r od; do [ -n "$od" ] && rm -rf "$od"; done
    info "  오래된 백업 $(echo "$olddirs" | grep -c .)개 정리"
  fi

  local sz; sz="$(du -sh "$final" 2>/dev/null | cut -f1)"
  info "${G}✓ 백업 완료: $final ($sz)${X}"
}

# ── 인자 파싱 ───────────────────────────────────────────────
SUB="check"
for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;;
    check|backup) SUB="$a" ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "알 수 없는 인자: $a (--help 참고)" ;;
  esac
done

case "$SUB" in
  check)  cmd_check ;;
  backup) cmd_backup ;;
esac
