#!/usr/bin/env python3
"""
image-ref-fetch.py — 브랜드/사이트 진입 페이지 이미지 레퍼런스 수집 → webp → books/imageRefs/<brand>/

study/books 이미지 레퍼런스 파이프라인의 *수집(acquisition)* 단계.
다운스트림: tools/image-tagger.py 가 imageRefs/<brand>/ 를 읽어 _tags.json/_cls.json 으로 태깅.

엔진은 tools/site-scraper.py (requests 기반, playwright 없이 빠름).
JS-렌더/봇월/접속불가 사이트는 0장이 나온다 — 그 경우 스크레이퍼의 stdout/stderr 를
*그대로 흘려보낸다*. (과거 /tmp/batch_capture.py 는 subprocess capture_output=True 로
원인을 삼켜서 aesop/muji/mukayu 가 "왜 0장인지" 알 수 없는 silent gap 을 남겼다. 그 자리를 막는다.)

브랜드 목록은 하드코딩하지 않는다 → tools/image-ref-brands.csv (name,url,note).
note 컬럼에 봇월/접속불가 진단을 보존(재발견 비용 제거).

provenance: /tmp/batch_capture.py (2026-06-04, 14-brand 1회 배치, 11/14 성공) 를
            영구 위치로 이전 + 출력 은폐 결함 제거 + 브랜드 목록 data 화 한 것.

사용:
  webExporter/.venv/bin/python tools/image-ref-fetch.py            # CSV 전체
  webExporter/.venv/bin/python tools/image-ref-fetch.py aesop muji # 특정 브랜드만
반드시 Pillow 가 있는 인터프리터(webExporter/.venv)로 실행.
"""
import os, sys, glob, csv, subprocess, shutil

# repo freshness 체크 (모든 .py tool 의 첫 import) — site-scraper.py 와 동일 패턴.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (없는 환경(OCI 등)에서도 동작하게 선택적)
except Exception:
    pass

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # clavier-scripts/
PY = sys.executable                                                 # 이 스크립트를 띄운 인터프리터 그대로
SCRAPER = os.path.join(ROOT, "tools", "site-scraper.py")
BRANDS_CSV = os.path.join(ROOT, "tools", "image-ref-brands.csv")
BOOKS = os.path.expanduser("~/Library/Mobile Documents/com~apple~CloudDocs/0/works/study/books")
DEST_ROOT = os.path.join(BOOKS, "imageRefs")
TMP = "/tmp/imgbatch"   # 중간 스크랩 덤프 = 휘발 데이터(코드 아님) — /tmp 적절
MIN_DIM = 200           # 로고/아이콘/UI 스프라이트 제외 (실제 사진만 keep)


def load_brands(only=None):
    rows = []
    with open(BRANDS_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name, url = (r.get("name") or "").strip(), (r.get("url") or "").strip()
            if not name or not url:
                continue
            if only and name not in only:
                continue
            rows.append((name, url, (r.get("note") or "").strip()))
    return rows


def fetch_one(name, url, note):
    tmpdir = os.path.join(TMP, name)
    shutil.rmtree(tmpdir, ignore_errors=True)
    os.makedirs(tmpdir, exist_ok=True)
    print(f"\n=== {name}  {url} ===", flush=True)
    if note:
        print(f"  (note: {note})", flush=True)
    # capture_output 금지 — 0장일 때 403/봇월/타임아웃 원인이 콘솔에 보여야 한다.
    rc = subprocess.run([PY, SCRAPER, "--urls", url, "-i", "-o", tmpdir]).returncode
    if rc != 0:
        print(f"  [scraper exit {rc}] — 위 출력에서 원인 확인", flush=True)

    dest = os.path.join(DEST_ROOT, name)
    os.makedirs(dest, exist_ok=True)
    srcs = []
    for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.avif", "*.gif"):
        srcs += glob.glob(os.path.join(tmpdir, "**", ext), recursive=True)
    kept = 0
    for src in sorted(set(srcs)):
        try:
            im = Image.open(src)
            if min(im.size) < MIN_DIM:
                continue
            im.convert("RGB").save(
                os.path.join(dest, f"{name}_{kept:03d}.webp"), "WEBP", quality=88, method=4
            )
            kept += 1
        except Exception:
            continue
    return kept


def main():
    only = set(a for a in sys.argv[1:] if not a.startswith("-")) or None
    brands = load_brands(only)
    if not brands:
        print(f"브랜드 없음 (CSV: {BRANDS_CSV}, 필터: {only})", flush=True)
        return 1
    os.makedirs(DEST_ROOT, exist_ok=True)
    summary = []
    for name, url, note in brands:
        kept = fetch_one(name, url, note)
        print(f"  → {kept}장 webp 적재  ({os.path.join(DEST_ROOT, name)})", flush=True)
        summary.append((name, kept))

    print("\n\n===== 배치 완료 =====", flush=True)
    for name, kept in summary:
        flag = "" if kept >= 8 else "  ⚠ 적음/0 — 봇월·JS·접속불가 가능 (위 스크레이퍼 출력 확인 → 실브라우저 캡처)"
        print(f"  {name:16} {kept:3d}장{flag}", flush=True)
    print(f"\n적재 위치: {DEST_ROOT}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
