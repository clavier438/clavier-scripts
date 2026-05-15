#!/usr/bin/env bash
# installScripts.sh — iCloud/0/scripts/ 의 스크립트를 ~/bin 에 심볼릭 링크
#
# 폴더 기반 자동 배포 (SvelteKit 방식):
#   루트 스크립트     → ~/bin/
#   tools/*           → ~/bin/        (루트와 동등 — 사용자 유틸 명령 묶음)
#   daemons/*.sh      → ~/bin/daemons/
#   clouds/{svc}/*.sh → ~/bin/clouds/{svc}/
#
# 새 폴더를 만들면 자동으로 배포 대상에 포함됨.
# 단, 아래 SKIP_DIRS에 있는 폴더는 배포하지 않음 (도구/데이터 폴더).
#
# watcherScripts LaunchAgent 가 변경 감지 시 자동 실행 / 직접 실행도 가능
# 사용법: installScripts [bin_dir]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${1:-$HOME/bin}"

# 배포하지 않을 폴더 (도구/데이터 폴더) — tools 는 아래에서 특별 처리됨
SKIP_DIRS=("webExporter" "Markdown2ID" "memory-backup" "backup" ".git" ".claude" "PDF to JPEG.app" "PDF to JPEG.workflow" "tools")

mkdir -p "$BIN_DIR"

# ── 스크립트 설치 함수 ────────────────────────────────────
install_scripts() {
    local src_dir="$1"
    local dst_dir="$2"
    local count=0

    mkdir -p "$dst_dir"

    while IFS= read -r -d '' script; do
        local filename
        filename="$(basename "$script")"
        local name="${filename%.*}"
        local target="$dst_dir/$name"

        # 모든 스크립트 = 심볼릭 링크. 소스 변경이 ~/bin 에 즉시 반영 — 버전 드리프트 방지.
        # 예전엔 .sh/.py 를 복사했는데, 복사본이 stale 돼 소스 수정이 ~/bin 에 안 먹는
        # 사고가 났다 (2026-05-15 doppler-sync-wrangler). 복사 분기 폐기 — 전부 링크.
        if [ -L "$target" ] && [ "$(readlink "$target")" = "$script" ]; then
            continue  # 이미 올바른 심링크
        fi
        rm -f "$target"
        ln -sf "$script" "$target"
        chmod +x "$script"
        echo "  [link]   $name → $filename"
        ((count++))
    done < <(find "$src_dir" -maxdepth 1 -type f \
        \( -name "*.sh" -o -name "*.py" -o -name "*.rb" -o -name "*.js" -o -name "*.mjs" \) \
        -print0)

    echo "  완료: 링크 ${count}개"
}

# ── SKIP_DIRS 판단 함수 ───────────────────────────────────
is_skipped() {
    local dir_name="$1"
    for skip in "${SKIP_DIRS[@]}"; do
        [[ "$dir_name" == "$skip" ]] && return 0
    done
    return 1
}

echo "스크립트 설치 위치: $BIN_DIR"
echo "원본 디렉터리:      $SCRIPT_DIR"
echo ""

# ── 루트 스크립트 배포 ────────────────────────────────────
echo "[ scripts → ~/bin ]"
install_scripts "$SCRIPT_DIR" "$BIN_DIR"

# ── tools/ 는 루트와 동등하게 ~/bin 으로 배포 ────────────
# 유틸 명령(imgToWeb, pdfToImg 등)을 소스에서 묶어 관리하되
# 런타임은 기존과 동일하게 ~/bin 바로 아래에 둠 (PATH 변경 불필요).
if [ -d "$SCRIPT_DIR/tools" ]; then
    echo ""
    echo "[ tools → ~/bin ]"
    install_scripts "$SCRIPT_DIR/tools" "$BIN_DIR"
fi

# ── 서브폴더 자동 감지 + 배포 ────────────────────────────
# SKIP_DIRS에 없는 모든 서브폴더를 ~/bin/{폴더명}/ 으로 배포
while IFS= read -r -d '' subdir; do
    dir_name="$(basename "$subdir")"
    is_skipped "$dir_name" && continue

    # clouds/ 는 서비스별 2단계 구조: clouds/{svc}/*.sh → ~/bin/clouds/{svc}/
    if [[ "$dir_name" == "clouds" ]]; then
        while IFS= read -r -d '' svcdir; do
            svc_name="$(basename "$svcdir")"
            dst="$BIN_DIR/clouds/$svc_name"
            echo ""
            echo "[ clouds/$svc_name → ~/bin/clouds/$svc_name ]"
            install_scripts "$svcdir" "$dst"
        done < <(find "$subdir" -mindepth 1 -maxdepth 1 -type d -print0)
        continue
    fi

    echo ""
    echo "[ $dir_name → ~/bin/$dir_name ]"
    install_scripts "$subdir" "$BIN_DIR/$dir_name"

done < <(find "$SCRIPT_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

# ── PATH 안내 ─────────────────────────────────────────────
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "⚠️  '$BIN_DIR' 가 PATH에 없습니다. ~/.zshrc 에 추가하세요:"
    echo "   export PATH=\"\$HOME/bin:\$PATH\""
fi

# LaunchAgent 등록은 setup.sh Step 5 에서 daemons/*.plist 일괄 처리.
# 이 스크립트는 Tier 1 (~/bin) 책임만 — SRP.

# ── ~/.clavier/env 심링크 — iCloud 파일을 백업 미러로 유지 ───────────────────
# 단일 진실 소스는 Doppler (2026-04-28 이전). 이 심링크는 레거시·과도기 호환용.
CLAVIER_ENV_SRC="$SCRIPT_DIR/clavier.env"
CLAVIER_ENV_LINK="$HOME/.clavier/env"
if [[ -f "$CLAVIER_ENV_SRC" ]]; then
    mkdir -p "$HOME/.clavier"
    if [[ ! -L "$CLAVIER_ENV_LINK" ]] || [[ "$(readlink "$CLAVIER_ENV_LINK")" != "$CLAVIER_ENV_SRC" ]]; then
        ln -sf "$CLAVIER_ENV_SRC" "$CLAVIER_ENV_LINK"
        echo ""
        echo "  [env] ~/.clavier/env → iCloud/scripts/clavier.env (백업 미러 심링크)"
    fi
fi

# ── Doppler CLI 자동 설치 + 로그인 안내 ───────────────────────────────────────
# 시크릿 단일 진실 소스 — 2026-04-28 iCloud → Doppler 이전
if ! command -v doppler >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
        echo ""
        echo "[ doppler CLI 설치 ]"
        brew install dopplerhq/cli/doppler
    else
        echo ""
        echo "⚠️  Homebrew 없음. Doppler CLI 수동 설치 필요: https://docs.doppler.com/docs/install-cli"
    fi
fi

if command -v doppler >/dev/null 2>&1; then
    if ! doppler me >/dev/null 2>&1; then
        echo ""
        echo "⚠️  Doppler 로그인 필요 — 다음 명령을 직접 실행하세요:"
        echo "     doppler login"
        echo "     cd \"$SCRIPT_DIR\" && doppler setup --project clavier --config prd --no-interactive"
    else
        # 이미 로그인됐으면 scripts 디렉터리 바인딩 보장 (idempotent)
        bound_project="$(doppler configure get project --scope "$SCRIPT_DIR" --plain 2>/dev/null)"
        if [[ "$bound_project" != "clavier" ]]; then
            (cd "$SCRIPT_DIR" && doppler setup --project clavier --config prd --no-interactive >/dev/null 2>&1) \
                && echo "  [doppler] $SCRIPT_DIR → clavier/prd 바인딩 완료"
        fi
    fi
fi

# ── clavier-hq git hooks 자동 활성화 (구조적 보호 Layer 2) ────────────────────
# DECISIONS.md 변경 시 doc-coverage 자동 검증. 새 맥 복구해도 바로 작동.
HQ_DIR="${CLAVIER_HQ:-$HOME/clavier-hq}"
if [[ -d "$HQ_DIR/.git" ]] && [[ -d "$HQ_DIR/hooks" ]]; then
    bound_hooks="$(cd "$HQ_DIR" && git config --local core.hooksPath 2>/dev/null || true)"
    if [[ "$bound_hooks" != "hooks" ]]; then
        (cd "$HQ_DIR" && git config --local core.hooksPath hooks) \
            && echo "  [hooks] clavier-hq core.hooksPath = hooks (post-commit 자동 검증 활성화)"
    fi
fi
