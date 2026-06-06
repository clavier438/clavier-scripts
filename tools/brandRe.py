#!/usr/bin/env python3
# brandRe — 브랜드 아이덴티티 리버스 엔지니어링 단일 진입점 (design-recon front door).
#
# 정신: workerCtl / framer 와 같은 "단일 front door + verb" 패턴 (CLAUDE.md framer 절).
#   내부 모듈(webExporter · recon.py · image-tagger.py · brandguide.py)은 그대로 두고,
#   사용자는 명령 하나(brandRe)에서 동사만 고른다. 모듈성은 안 깨짐 — 얇은 라우터.
#   개념·산출물 = DESIGN_RECON.md / DECISIONS 2026-06-05 brandguide ADR.
#
#   brandRe <url>              풀 파이프라인: 캡처 → 정리 → (태깅 안내) → HTML 보고서
#   brandRe capture <url>      로컬 webExporter 캡처 → books/<host>/ (PDF + images/)
#   brandRe organize <host>    recon.py 정리 (photos·icons·_layers.json + 보고서 자동)
#   brandRe tag <host>         사진 6축 비전 분류 (image-tagger) — _tags.json 채움
#   brandRe report <host>      brandguide HTML 보고서만 (재)생성
#   brandRe status [<host>]    레이어 멀티태그 상태 — 없으면 books/ 전체 목록
#   brandRe open <host>        보고서 브라우저로 열기
#   brandRe help
#
# <host> 인자는 books/<host>/ 폴더명 또는 그 경로(또는 recon 폴더 경로) 무엇이든 받는다.
# books 루트: 환경변수 BRANDRE_BOOKS > 현재 디렉토리의 ./books.
import os, sys, glob, json, subprocess, shutil
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경에서도 동작하게 선택적)
except ImportError:
    pass

TOOLS = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.dirname(TOOLS)
PY = sys.executable
VENV_PY = os.path.join(REPO, "webExporter", ".venv", "bin", "python")
EXPORTER = os.path.join(REPO, "webExporter", "webSiteExporter.py")

# ── 색/마크 (의존성 0) ────────────────────────────────────────────────────
def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() else s
def bold(s):  return _c("1", s)
def dim(s):   return _c("2", s)
def green(s): return _c("32", s)
def yellow(s):return _c("33", s)
def red(s):   return _c("31", s)
def cyan(s):  return _c("36", s)


# ── 경로 헬퍼 ──────────────────────────────────────────────────────────────
def books_root():
    return os.path.abspath(os.path.expanduser(os.environ.get("BRANDRE_BOOKS", "books")))

def host_from_url(url):
    netloc = (urlparse(url).netloc or url).lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]          # 접두사 제거 (lstrip 은 문자셋 제거라 'w' 시작 도메인 깨짐)
    return netloc

def resolve_host_dir(arg):
    """인자(host 이름 / host 경로 / recon 경로)를 host_dir 로 정규화. 못 찾으면 None."""
    cand = os.path.abspath(os.path.expanduser(arg))
    # recon 폴더를 직접 줬으면 부모가 host_dir
    if os.path.basename(cand) == "recon" and os.path.isdir(cand):
        return os.path.dirname(cand)
    if os.path.isdir(cand):
        return cand
    # 이름만 줬으면 books 루트에서 찾기
    in_books = os.path.join(books_root(), arg)
    if os.path.isdir(in_books):
        return in_books
    return None

def recon_dir_of(host_dir):
    return os.path.join(host_dir, "recon")


# ── 동사 ────────────────────────────────────────────────────────────────────
def cmd_capture(args):
    if not args:
        die("usage: brandRe capture <url> [webExporter 옵션…]")
    url = args[0]
    if not urlparse(url).scheme:
        url = "https://" + url
    host = host_from_url(url)
    out = os.path.join(books_root(), host)
    py = VENV_PY if os.path.exists(VENV_PY) else PY
    if not os.path.exists(EXPORTER):
        die(f"webExporter 없음: {EXPORTER}")
    print(bold(f"▶ capture {url}") + dim(f"  → {out}"))
    extra = args[1:] if len(args) > 1 else ["--max-pages", "3"]
    cmd = [py, EXPORTER, url, "--download-images", "-o", out] + extra
    r = subprocess.run(cmd)
    if r.returncode != 0:
        die("캡처 실패 — webExporter 로그 확인")
    print(green(f"✓ capture → {out}") + dim("  (PDF + images/. colors·fonts 는 로컬 캡처 미생성)"))
    return host_dir_or_die(host)

def cmd_organize(args):
    if not args:
        die("usage: brandRe organize <host>")
    hd = host_dir_or_die(args[0])
    print(bold(f"▶ organize {os.path.basename(hd)}"))
    r = subprocess.run([PY, os.path.join(TOOLS, "recon.py"), hd])
    if r.returncode != 0:
        die("정리 실패")
    return hd

def cmd_tag(args):
    if not args:
        die("usage: brandRe tag <host>")
    hd = host_dir_or_die(args[0])
    photos = os.path.join(recon_dir_of(hd), "photos")
    if not os.path.isdir(photos):
        die(f"photos 없음: {photos}\n   먼저 'brandRe organize {os.path.basename(hd)}'")
    print(bold(f"▶ tag {os.path.basename(hd)}") + dim(f"  ({photos})"))
    # image-tagger 는 비전 — API 크레딧 고갈 시 막힘(project_anthropic_key_no_credits).
    # 구독 빌링 우회(claude CLI/세션 --from-json)는 아직 native 화 전 → 정직히 안내.
    env = os.environ.get("ANTHROPIC_API_KEY")
    extra = args[1:]
    if not env and "--from-json" not in extra:
        print(yellow("⚠ ANTHROPIC_API_KEY 없음 — 비전 분류 API 경로 불가."))
        print(dim("   우회: doppler run -- 로 주입하거나, 세션/subagent 가 분류해 --from-json 주입."))
        print(dim("   (구독 빌링 claude CLI 비전 경로는 아직 native 미구현 — DESIGN_RECON.md 참조)"))
    py = VENV_PY if os.path.exists(VENV_PY) else PY
    r = subprocess.run([py, os.path.join(TOOLS, "image-tagger.py"), photos] + extra)
    if r.returncode == 0:
        # 태깅 후 보고서 갱신 (사진 섹션 채워짐)
        cmd_report([hd])
    return hd

def cmd_report(args):
    if not args:
        die("usage: brandRe report <host>")
    hd = host_dir_or_die(args[0])
    rd = recon_dir_of(hd)
    if not os.path.isdir(rd):
        die(f"recon/ 없음 — 먼저 'brandRe organize {os.path.basename(hd)}'")
    print(bold(f"▶ report {os.path.basename(hd)}"))
    r = subprocess.run([PY, os.path.join(TOOLS, "brandguide.py"), rd])
    if r.returncode != 0:
        die("보고서 생성 실패")
    return hd

def cmd_open(args):
    if not args:
        die("usage: brandRe open <host>")
    hd = host_dir_or_die(args[0])
    guides = sorted(glob.glob(os.path.join(recon_dir_of(hd), "brandguide_v*.html")))
    if not guides:
        die(f"보고서 없음 — 'brandRe report {os.path.basename(hd)}' 먼저")
    print(green(f"open {os.path.basename(guides[-1])}"))
    subprocess.run(["open", guides[-1]])

def _layer_line(name, layer):
    status = layer.get("status", "?")
    tags = " ".join(layer.get("tags", []))
    mark = {"ready": green("✓"), "tagged": green("✓"), "untagged": yellow("◐"),
            "pending": yellow("◐"), "missing": dim("·"), "error": red("✗")}.get(status, "?")
    extra = ""
    if "count" in layer: extra = dim(f" {layer['count']}")
    if layer.get("families"): extra = dim(f" {', '.join(layer['families'][:3])}")
    if layer.get("libs"): extra = dim(f" {', '.join(layer['libs'])}")
    if layer.get("latest"): extra = dim(f" {layer['latest']}")
    return f"   {mark} {name:9}{extra}  {dim(tags)}"

def cmd_status(args):
    if args:
        hd = resolve_host_dir(args[0])
        if not hd:
            die(f"host 폴더 못 찾음: {args[0]}")
        rd = recon_dir_of(hd)
        lp = os.path.join(rd, "_layers.json")
        print(bold(f"brandRe — {os.path.basename(hd)}"))
        print(dim(f"  {hd}"))
        if not os.path.exists(lp):
            print(yellow("  _layers.json 없음 — 'brandRe organize' 먼저"))
            return
        layers = json.load(open(lp, encoding="utf-8"))
        order = ["photos", "palette", "fonts", "icons", "report"]
        for k in order:
            if k in layers:
                print(_layer_line(k, layers[k]))
        # 다음 할 일 힌트
        nxt = _next_hint(os.path.basename(hd), layers)
        if nxt:
            print("\n   " + cyan("다음: ") + nxt)
        return
    # 인자 없음 → books 루트 전체 목록
    root = books_root()
    print(bold(f"brandRe books") + dim(f"  {root}"))
    if not os.path.isdir(root):
        print(yellow(f"  books 루트 없음 — 'brandRe capture <url>' 또는 BRANDRE_BOOKS 설정"))
        return
    hosts = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    if not hosts:
        print(dim("  (비어있음)"))
        return
    for h in hosts:
        lp = os.path.join(root, h, "recon", "_layers.json")
        if os.path.exists(lp):
            layers = json.load(open(lp, encoding="utf-8"))
            done = [k for k in ("photos","palette","fonts","icons") if layers.get(k,{}).get("status") in ("ready","tagged")]
            rep = layers.get("report",{}).get("status")
            mark = green("✓ 보고서") if rep == "ready" else yellow("◐ 보고서대기")
            print(f"   {h:24} {mark}  {dim(' '.join(done))}")
        else:
            print(f"   {h:24} {dim('미정리 (organize 필요)')}")
    print(dim(f"\n   상세: brandRe status <host>"))

def _next_hint(host, layers):
    if layers.get("photos",{}).get("status") == "missing":
        return f"brandRe capture <url>"
    if layers.get("photos",{}).get("status") == "untagged":
        return f"brandRe tag {host}   " + dim("(사진 섹션 채우려면)")
    if layers.get("report",{}).get("status") in ("pending",):
        return f"brandRe report {host}"
    if layers.get("report",{}).get("status") == "ready":
        return f"brandRe open {host}"
    return ""

def cmd_full(url):
    """brandRe <url> — 캡처부터 보고서까지 한 번에."""
    if not urlparse(url).scheme:
        url = "https://" + url
    host = host_from_url(url)
    print(bold(f"═══ brandRe {host} — 풀 파이프라인 ═══"))
    cmd_capture([url])
    hd = host_dir_or_die(host)
    cmd_organize([hd])              # recon 이 _layers.json + brandguide 까지 자동
    print()
    print(bold("─── 상태 ───"))
    cmd_status([hd])
    print()
    layers_path = os.path.join(recon_dir_of(hd), "_layers.json")
    if os.path.exists(layers_path):
        layers = json.load(open(layers_path, encoding="utf-8"))
        if layers.get("photos",{}).get("status") == "untagged":
            print(yellow(f"사진 비전 분류는 별도: ") + f"brandRe tag {host}")
    print(green(f"\n✓ 완료 → ") + f"brandRe open {host}")


# ── 유틸 ────────────────────────────────────────────────────────────────────
def host_dir_or_die(arg):
    hd = resolve_host_dir(arg)
    if not hd:
        die(f"host 폴더 못 찾음: {arg}\n   books 루트: {books_root()}\n   (brandRe status 로 목록 확인)")
    return hd

def die(msg):
    print(red("✗ ") + msg)
    sys.exit(1)

HELP = """brandRe — 브랜드 아이덴티티 리버스 엔지니어링 단일 진입점 (design-recon)

  brandRe <url>              풀 파이프라인: 캡처 → 정리 → HTML 보고서
  brandRe capture <url>      로컬 webExporter 캡처 → books/<host>/ (PDF + images/)
  brandRe organize <host>    정리 (photos·icons·_layers.json + 보고서 자동)
  brandRe tag <host>         사진 6축 비전 분류 (image-tagger) — _tags.json 채움
  brandRe report <host>      brandguide HTML 보고서만 (재)생성
  brandRe status [<host>]    레이어 멀티태그 상태 — 없으면 books/ 전체 목록
  brandRe open <host>        보고서 브라우저로 열기

  <host> = books/<host>/ 폴더명 또는 경로(또는 recon 경로). books 루트 = $BRANDRE_BOOKS > ./books.
  파이프라인 개념·레이어: DESIGN_RECON.md"""

def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)   # subprocess 출력과 순서 맞춤
    except Exception:
        pass
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(HELP.strip() if HELP else "brandRe")
        return
    verb = args[0]
    rest = args[1:]
    table = {
        "capture": cmd_capture, "organize": cmd_organize, "tag": cmd_tag,
        "report": cmd_report, "open": cmd_open, "status": cmd_status,
    }
    if verb in table:
        table[verb](rest)
    elif urlparse(verb).scheme or "." in verb and "/" not in verb:
        # 동사가 아니고 URL/도메인처럼 보이면 풀 파이프라인
        cmd_full(verb)
    else:
        die(f"알 수 없는 명령: {verb}\n   brandRe help 로 사용법 확인")

if __name__ == "__main__":
    main()
