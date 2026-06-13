# co-safety.sh — Capture One 카탈로그/세션을 "복사해도 안전한가" 판별의 단일 출처
#                (SSOT, shell source 전용 공유 헬퍼 — lib/ 에 산다)
#
# === 왜 존재하는가 (근본) ===================================================
# Capture One 의 .cocatalog/.cosessiondb 는 *살아있는 SQLite DB* 다. 앱이 그 DB 에
# 쓰기 트랜잭션을 진행하는 도중에 파일을 복사하면 — 일부는 새 페이지, 일부는 옛
# 페이지가 섞인 "찢어진" 사본이 나오고, 그 백업은 열리지 않는다(corruption).
# (출처: sqlite.org/howtocorrupt.html — "백그라운드 백업이 트랜잭션 중간에 복사하면
#  옛 내용과 새 내용이 섞여 corrupt 백업이 된다.")
#
# 실측(2026-06-13, 이 repo): 이 카탈로그의 journal_mode = `delete` (WAL 아님).
#   → 위험 파일은 transient `*-journal` (트랜잭션 중 수 ms 존재). `*-wal`/`*-shm` 은
#     아예 안 생긴다. 따라서 "WAL 검사"는 헛수고고, 진짜 보증은 *프로세스가 꺼져 있어
#     열린 트랜잭션이 없음*이다 (sqlite.org: "어떤 프로세스도 트랜잭션을 진행 중이지
#     않으면 파일 복사는 안전하다").
#
# === 설계: 권유가 아닌 장치 =================================================
# 호출자(백업 스크립트)는 co_safe_to_copy 를 *우회할 수 없다*. 통과(return 0)가 아니면
# 복사 자체로 갈 경로가 없도록 호출자를 짠다. 안전검사를 "끄는" 플래그는 제공하지 않는다
# — 그것이 곧 나쁜 상태로 가는 path 이기 때문 (메타원칙: 나쁜 path 자체를 없앤다).
#
# === 사용 (caller) ==========================================================
#   . "$(dirname …)/lib/co-safety.sh"
#   if co_safe_to_copy "/path/to/root"; then ... ; fi   # root 아래 모든 C1 문서 검사
#   co_integrity_ok "/path/to/copied.cocatalogdb"        # 복사 후 사후검증
#
# 모든 함수: 사람이 읽는 진단은 stderr, 판정은 return code (0=안전/ok, 1=위험/실패).

# ── C1 프로세스가 실행 중인가 (전역 보증의 핵심) ──────────────────────────
co_running() {
  pgrep -x "Capture One" >/dev/null 2>&1
}

# ── 주어진 DB 파일을 *어떤* 프로세스든 열고 있는가 (좀비/타앱/race 포착) ──
co_db_open() {
  local db="$1"
  [ -e "$db" ] || return 1          # 없으면 "열려있지 않음"
  lsof -- "$db" >/dev/null 2>&1
}

# ── root 아래 모든 C1 문서 DB 경로를 출력 (.cocatalogdb / .cosessiondb) ──
#    글롭 대신 find — zsh 의 "no matches" 폭발과 빈 디렉토리를 안전 처리.
co_find_dbs() {
  local root="$1"
  [ -d "$root" ] || return 0
  find "$root" -type f \( -name "*.cocatalogdb" -o -name "*.cosessiondb" \) 2>/dev/null
}

# ── root 아래 transient journal/wal 잔재가 있는가 (쓰기 진행 중 / 직전 크래시) ─
co_journal_present() {
  local root="$1"
  [ -d "$root" ] || return 1
  find "$root" -type f \( -name "*-journal" -o -name "*-wal" -o -name "*-shm" \) \
    2>/dev/null | grep -q .
}

# ── 종합 게이트: root 아래 C1 문서를 복사해도 안전한가 ─────────────────────
#    ALL 통과해야만 return 0. 하나라도 실패하면 stderr 에 이유 찍고 return 1.
co_safe_to_copy() {
  local root="$1"
  local safe=0   # 0=safe, 1=unsafe (bash 관례 반대로 쓰지 않게 명시적으로 추적)

  # GATE 1 — 프로세스 (sqlite "no transaction in progress" 보증의 토대)
  if co_running; then
    echo "  ✗ GATE1 프로세스: Capture One 실행 중 (pid $(pgrep -x 'Capture One' | tr '\n' ' '))" >&2
    safe=1
  fi

  # GATE 2 — 열린 핸들 (좀비/크래시/타앱 — 프로세스명만으론 못 잡는 경우)
  local db opened=""
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    if co_db_open "$db"; then opened="$opened\n      $db"; fi
  done < <(co_find_dbs "$root")
  if [ -n "$opened" ]; then
    echo -e "  ✗ GATE2 열린 핸들: 아래 DB 를 누군가 열고 있음$opened" >&2
    safe=1
  fi

  # GATE 3 — transient journal/wal (쓰기 중이거나 직전 크래시 잔재)
  if co_journal_present "$root"; then
    echo "  ✗ GATE3 저널 잔재: -journal/-wal 발견 (쓰기 진행 중이거나 크래시 흔적)" >&2
    safe=1
  fi

  return $safe
}

# ── 사후검증: 복사된 DB 가 무결한가 (PRAGMA integrity_check) ───────────────
#    복사 후 이걸로 검증해 ok 아니면 그 백업은 승격하지 않는다 — 사본은 절대 신뢰 X.
#    sqlite3 가 없으면 검증 불가 → 보수적으로 실패 처리(승격 막음).
co_integrity_ok() {
  local db="$1"
  [ -e "$db" ] || { echo "  ✗ 검증: 파일 없음 $db" >&2; return 1; }
  command -v sqlite3 >/dev/null 2>&1 || { echo "  ✗ 검증: sqlite3 미설치 — 검증 불가" >&2; return 1; }
  local out
  out=$(sqlite3 "file:$db?mode=ro" "PRAGMA integrity_check;" 2>&1 | head -1)
  [ "$out" = "ok" ] || { echo "  ✗ 검증 실패 ($db): $out" >&2; return 1; }
  return 0
}
