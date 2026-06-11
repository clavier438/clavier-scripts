# entryPoints.sh — "이 파일이 기능적 진입점인가" 판별의 단일 출처(SSOT, shell 공유 헬퍼)
#
# 근거를 *코드 자신*에 둔다. 진입점 여부는 파일 안에 이미 있는 사실(실행 입구 마커)이지,
# 별도로 손으로 적어 두는 주석(# door:)이 아니다. 사본을 두면 사본을 깜빡해 빠진다 —
# `# door:` 가 바로 그 의지 의존이었다. 그래서 판별을 파일 내용 스캔으로 되돌린다.
#
# 왜 모듈인가: scripts 브리핑·--gaps 감사·미래 도구가 같은 정의를 inline 재구현하면
#   불일치가 필연(repoPaths 가 inline 재구현으로 dead-path 낸 전례 — DECISIONS 2026-05-03).
#   판별 규칙을 바꿀 일이 생기면 *이 파일 한 곳만* 고치면 모든 참조 도구가 따라온다.
#
# 사용 (caller):
#   . "$(dirname "$(readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/lib/entryPoints.sh"
#   ep_classify  <file>   # stdout: entry | module | lib | skip
#   ep_is_entry  <file>   # return 0 이면 기능적 진입점
#
# 분류 정의:
#   entry  = 프로세스로 실행되는 입구를 가진 파일 (실행 마커 보유)
#   module = 같은 언어지만 import/require 전용 (실행 입구 없음 — 예: imageHarvester.py)
#   lib    = lib/ 안 = source 전용 공유 헬퍼 (freshness/repoPaths/entryPoints 자신)
#   skip   = 진입점 판별 대상 아님 (알 수 없는 확장자)
#
# 언어별 실행 마커 (추측 아님 — repo 전수 스캔으로 검증, 2026-06-11):
#   .py        __name__=="__main__" | argparse | sys.argv
#   .mjs/.js   process.argv | import.meta | require.main
#   .sh        lib/ 밖이면 실행(실행 .sh 는 import 안 되고 호출됨 — sourced lib 은 lib/ 에 산다)
#   .rb        __FILE__==$0 | ARGV | OptionParser
#   .swift     항상 entry (스크립트 실행)
#
# 주의: source 됨 (subshell X). exit 직접 호출 금지.

# ep_classify <file> -> "entry"|"module"|"lib"|"skip" (stdout)
ep_classify() {
    _ep_f="$1"
    case "$_ep_f" in */lib/*) printf 'lib'; return 0;; esac
    _ep_ext="${_ep_f##*.}"
    case "$_ep_ext" in
        py)
            if grep -qE '__name__[[:space:]]*==[[:space:]]*.__main__.|argparse|sys\.argv' "$_ep_f" 2>/dev/null
            then printf 'entry'; else printf 'module'; fi ;;
        mjs|js)
            if grep -qE 'process\.argv|import\.meta|require\.main' "$_ep_f" 2>/dev/null
            then printf 'entry'; else printf 'module'; fi ;;
        sh|bash)
            printf 'entry' ;;
        rb)
            if grep -qE '__FILE__[[:space:]]*==[[:space:]]*\$0|ARGV|OptionParser' "$_ep_f" 2>/dev/null
            then printf 'entry'; else printf 'module'; fi ;;
        swift)
            printf 'entry' ;;
        *)
            printf 'skip' ;;
    esac
}

# ep_is_entry <file> -> return 0 이면 기능적 진입점
ep_is_entry() { [ "$(ep_classify "$1")" = "entry" ]; }

# ep_scan <root> -> 진입점 파일 경로를 한 줄에 하나씩 (stdout). 정렬됨.
#   탐색 제외: .git / node_modules / .venv / datasets / docs (코드 아님·데이터).
#   lib/ 는 ep_classify 가 lib 로 걸러내므로 자동 배제.
ep_scan() {
    _ep_root="${1:-.}"
    find "$_ep_root" \
        \( -name '.git' -o -name 'node_modules' -o -name '.venv' \
           -o -name 'datasets' -o -name 'docs' \) -prune -o \
        -type f \( -name '*.py' -o -name '*.mjs' -o -name '*.js' \
                   -o -name '*.sh' -o -name '*.rb' -o -name '*.swift' \) -print 2>/dev/null \
    | sort | while IFS= read -r _ep_file; do
        [ "$(ep_classify "$_ep_file")" = "entry" ] && printf '%s\n' "$_ep_file"
    done
}
