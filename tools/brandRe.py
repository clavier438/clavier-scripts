#!/usr/bin/env python3
# door: design    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
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
from image_formats import PHOTO_EXTS  # 사진 확장자 단일 소스 (heic/heif 포함)

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


# ── 대화형 입력 (workerCtl 의 prompt/selectFromList 패턴을 Python 으로) ──────
# 정신: Enter = 기본값(그전의 값) 유지. workerCtl.mjs line 435~456 의 "기본값 표시
#   + Enter 로 유지" wizard 의미론과 동일. 비-TTY(파이프·자동화)면 입력을 막지
#   않고 기본값으로 흘려보낸다 (main 이 비-TTY 면 애초에 help 로 빠지지만 이중 안전).
SIDECAR = ".brandRe.json"

def _tty():
    return sys.stdin.isatty() and sys.stdout.isatty()

def ask(label, default=None):
    """한 줄 입력. default 있으면 [default] 표시 + Enter 로 유지."""
    hint = f" {dim('[' + str(default) + ']')}" if default not in (None, "") else ""
    try:
        v = input(f"  {bold(label)}{hint}: ").strip()
    except EOFError:
        return default
    return v or default

def ask_yn(label, default=False):
    d = "Y/n" if default else "y/N"
    try:
        v = input(f"  {bold(label)} {dim('(' + d + ')')}: ").strip().lower()
    except EOFError:
        return default
    if not v:
        return default
    return v in ("y", "yes", "ㅛ")

def pick(items, label_fn, prompt_label="선택", extra=None):
    """번호 메뉴 (selectFromList 패턴). extra=[(키, 표시)] 는 목록 뒤 특수 선택지.
    반환: 고른 item / extra 키 문자열 / None(Enter·취소)."""
    extra = extra or []
    for i, it in enumerate(items, 1):
        print(f"   {bold(str(i).rjust(2))}. {label_fn(it)}")
    base = len(items)
    for j, (_, disp) in enumerate(extra, 1):
        print(f"   {bold(str(base + j).rjust(2))}. {disp}")
    total = base + len(extra)
    while True:
        try:
            raw = input(f"\n  {prompt_label} {dim('(1-' + str(total) + ', Enter=취소)')}: ").strip()
        except EOFError:
            return None
        if not raw:
            return None
        if raw.isdigit():
            n = int(raw)
            if 1 <= n <= base:
                return items[n - 1]
            if base < n <= total:
                return extra[n - base - 1][0]
        print(red(f"  ✗ 1~{total} 중에서 입력해주세요"))

def load_sidecar(host_dir):
    p = os.path.join(host_dir, SIDECAR)
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_sidecar(host_dir, data):
    try:
        cur = load_sidecar(host_dir)
        cur.update(data)
        json.dump(cur, open(os.path.join(host_dir, SIDECAR), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
    except Exception:
        pass  # 편의 기능 — 저장 실패해도 파이프라인은 계속


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
    # 비전 분류 가용성(설치/인증)은 image-tagger.py 가 자체 판단·안내한다 — brandRe 는 호출 위임만.
    py = VENV_PY if os.path.exists(VENV_PY) else PY
    extra = args[1:]
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

def cmd_folder(args):
    """brandRe folder <폴더> — 이미 가진 사진 폴더를 분석 (URL 캡처 대신).
    폴더 사진 → books/<name>/images/ → organize(photos webp 변환) → tag → report.
    디렉션 분석은 이미지 자체만 보므로 출처(URL/로컬) 무관. --as <이름> 으로 books 폴더명 지정."""
    rest = list(args)
    name = None
    if "--as" in rest:
        i = rest.index("--as")
        if i + 1 >= len(rest):
            die("--as 뒤에 이름이 필요합니다")
        name = rest[i + 1]; del rest[i:i + 2]
    if not rest:
        die("usage: brandRe folder <이미지폴더> [--as <이름>]")
    src = os.path.abspath(os.path.expanduser(rest[0]))
    if not os.path.isdir(src):
        die(f"폴더 아님: {src}")
    name = (name or os.path.basename(src.rstrip("/")) or "folder").replace(os.sep, "-").replace(" ", "-")
    imgs = [f for f in glob.glob(os.path.join(src, "**", "*"), recursive=True)
            if os.path.isfile(f) and os.path.splitext(f)[1].lower() in PHOTO_EXTS
            and not os.path.basename(f).startswith(".")]
    if not imgs:
        die(f"이미지 없음: {src}")
    dest = os.path.join(books_root(), name)
    images_dir = os.path.join(dest, "images")
    os.makedirs(images_dir, exist_ok=True)
    print(bold(f"═══ brandRe {name} — 로컬 폴더 분석 ═══"))
    print(dim(f"  출처 {src}  ({len(imgs)}장)"))
    for f in imgs:
        shutil.copy2(f, images_dir)
    print(green(f"✓ {len(imgs)}장 → {dest}"))
    # 기존 파이프라인 재사용 (reuse-first): organize(photos webp + _layers + 보고서) → tag(비전 + 보고서 갱신)
    cmd_organize([dest])
    cmd_tag([dest])

# ── 대화형 wizard (workerCtl 처럼 — 안내 따라 치거나 Enter 로 그전 값) ────────
def interactive():
    """brandRe (인자 없이) — 안내형. 기존 book 이어가기 또는 새 소스(URL/폴더).
    각 단계는 cmd_* verb 를 그대로 호출 (reuse-first — wizard 는 얇은 오케스트레이터)."""
    print(bold("═══ brandRe ═══") + dim("  design-recon 대화형 (Ctrl-C 종료)"))
    root = books_root()
    hosts = sorted(d for d in os.listdir(root)
                   if os.path.isdir(os.path.join(root, d))) if os.path.isdir(root) else []
    if hosts:
        print(dim(f"\nbooks  {root}"))
        choice = pick(hosts, lambda h: _book_label(root, h), "분석할 book",
                      extra=[("__new__", cyan("+ 새로 (URL 캡처 또는 폴더)"))])
    else:
        print(dim("\n(아직 book 없음 — 새 소스로 시작)"))
        choice = "__new__"
    if choice is None:
        print(dim("취소")); return
    if choice == "__new__":
        return _wizard_new(root)
    return _wizard_host(os.path.join(root, choice))

def _book_label(root, h):
    lp = os.path.join(root, h, "recon", "_layers.json")
    if os.path.exists(lp):
        try:
            layers = json.load(open(lp, encoding="utf-8"))
            mark = green("✓ 보고서") if layers.get("report", {}).get("status") == "ready" else yellow("◐ 대기")
        except Exception:
            mark = dim("?")
    else:
        mark = dim("미정리")
    return f"{h:24} {mark}"

def _wizard_new(root):
    src = ask("URL 또는 폴더 경로")
    if not src:
        print(dim("취소")); return
    # 실재하는 폴더면 = 이미 가진 사진 → folder 파이프라인 (캡처 생략)
    if os.path.isdir(os.path.expanduser(src)):
        base = os.path.basename(os.path.expanduser(src).rstrip("/")) or "folder"
        name = ask("books 폴더명", base)
        dest = os.path.join(root, name)
        save_sidecar_safe(dest, {"src": os.path.abspath(os.path.expanduser(src)), "name": name})
        cmd_folder([src, "--as", name])
        return
    # URL → 캡처 옵션 (그전 값 = sidecar)
    url = src if urlparse(src).scheme else "https://" + src
    host = host_from_url(url)
    prev = load_sidecar(os.path.join(root, host))
    maxp = ask("최대 페이지 수", prev.get("max_pages", 3))
    cmd_capture([url, "--max-pages", str(maxp)])
    hd = host_dir_or_die(host)
    save_sidecar(hd, {"url": url, "max_pages": maxp})
    cmd_organize([hd])
    _wizard_after(hd, host)

def _wizard_host(hd):
    host = os.path.basename(hd)
    print(bold(f"\n{host}"))
    cmd_status([hd])
    print()
    steps = [("organize", "정리 다시 (recon)"),
             ("tag",      "사진 비전 분류 (claude 호출 — 시간·비용)"),
             ("report",   "보고서 재생성"),
             ("open",     "보고서 열기")]
    label = dict(steps)
    sel = pick([k for k, _ in steps], lambda k: label[k], "무엇을 할까요")
    if not sel:
        print(dim("취소")); return
    {"organize": cmd_organize, "tag": cmd_tag, "report": cmd_report, "open": cmd_open}[sel]([hd])
    if sel != "open":
        _wizard_after(hd, host)

def _wizard_after(hd, host):
    """파이프라인 직후 — 미태깅이면 비전 분류 권유, 그리고 열기 제안."""
    lp = os.path.join(recon_dir_of(hd), "_layers.json")
    if os.path.exists(lp):
        try:
            layers = json.load(open(lp, encoding="utf-8"))
        except Exception:
            layers = {}
        if layers.get("photos", {}).get("status") == "untagged":
            if ask_yn("사진 비전 분류도 할까요? (claude 호출 — 사진 섹션 채움)", default=False):
                cmd_tag([hd])
    print(green("\n✓ 완료"))
    if ask_yn("지금 보고서 열까요?", default=True):
        cmd_open([hd])
    else:
        print(dim(f"   나중에: brandRe open {host}"))

def save_sidecar_safe(host_dir, data):
    """host_dir 가 아직 없을 수 있는 시점(folder dest 미생성) 대비 — 있을 때만 저장."""
    if os.path.isdir(host_dir):
        save_sidecar(host_dir, data)


HELP = """brandRe — 브랜드 아이덴티티 리버스 엔지니어링 단일 진입점 (design-recon)

  brandRe                    대화형 안내 (book 고르기 / 새 소스 / 단계 선택) ★

  brandRe <url>              풀 파이프라인: 캡처 → 정리 → HTML 보고서
  brandRe <폴더> | folder <폴더>   이미 가진 사진 폴더 분석 (캡처 생략) [--as <이름>]
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
    if args and args[0] in ("-h", "--help", "help"):
        print(HELP.strip() if HELP else "brandRe")
        return
    if not args:
        # workerCtl 처럼: TTY 면 대화형 안내, 비-TTY(파이프·자동화)면 help (입력 안 막음)
        if _tty():
            return interactive()
        print(HELP.strip() if HELP else "brandRe")
        return
    verb = args[0]
    rest = args[1:]
    if verb in ("wizard", "i", "go"):
        return interactive()
    table = {
        "capture": cmd_capture, "organize": cmd_organize, "tag": cmd_tag,
        "report": cmd_report, "open": cmd_open, "status": cmd_status,
        "folder": cmd_folder, "ingest": cmd_folder,
    }
    if verb in table:
        table[verb](rest)
    elif os.path.isdir(os.path.expanduser(verb)):
        # 동사가 아니고 실재하는 폴더면 = 이미 가진 사진 → 로컬 폴더 분석 (캡처 생략)
        cmd_folder([verb] + rest)
    elif urlparse(verb).scheme or "." in verb and "/" not in verb:
        # 동사가 아니고 URL/도메인처럼 보이면 풀 파이프라인
        cmd_full(verb)
    else:
        die(f"알 수 없는 명령: {verb}\n   brandRe help 로 사용법 확인")

if __name__ == "__main__":
    main()
