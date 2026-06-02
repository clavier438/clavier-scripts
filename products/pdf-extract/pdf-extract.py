#!/usr/bin/env python3
# pdf-extract — PDF 디렉토리에서 한글/영문 텍스트 일괄 추출
# 사용법: pdf-extract <디렉토리> [옵션]
#
# 옵션:
#   -o <디렉토리>   출력 디렉토리 (기본: <입력>/_extracted)
#   -r              하위 폴더까지 재귀 탐색
#   -f              이미 추출된 파일도 덮어쓰기 (기본: skip)
#   -q              조용히 실행 (오류만 출력)
#   -t <초>         iCloud 다운로드 대기 타임아웃 (기본: 120초)
#   --open          완료 후 출력 폴더 Finder에서 열기
#   -h / --help     도움말
#
# 출력:
#   <이름>.txt      페이지별 텍스트 (--- p.N --- 구분자 포함)
#
# iCloud: evict된 파일은 자동으로 brctl download 트리거 후 대기

import sys, os, argparse, subprocess, time
from pathlib import Path


try:
    import pdfplumber
except ImportError:
    print("❌ 의존성 누락. 설치: pip3 install pdfplumber --break-system-packages")
    sys.exit(1)


# ── iCloud 다운로드 대기 ────────────────────────────────────
def ensure_local(pdf_path: Path, timeout: int = 120, quiet: bool = False) -> bool:
    """iCloud에서 evict된 파일을 다운로드 후 대기.
    반환값: True = 로컬에 사용 가능, False = 타임아웃/실패"""

    # placeholder 파일: .<name>.icloud (evicted 상태)
    placeholder = pdf_path.parent / f".{pdf_path.name}.icloud"

    # 이미 로컬에 있으면 바로 반환
    if not placeholder.exists() and pdf_path.exists() and pdf_path.stat().st_size > 1024:
        return True

    if not quiet:
        print(f"  ☁️  {pdf_path.name} — iCloud 다운로드 트리거...", end="", flush=True)

    # brctl download 로 다운로드 요청
    subprocess.run(["brctl", "download", str(pdf_path)],
                   capture_output=True)

    # 폴링: placeholder가 사라지고 파일 크기가 생길 때까지
    deadline = time.time() + timeout
    dots = 0
    while time.time() < deadline:
        time.sleep(2)
        dots += 1
        if not quiet and dots % 5 == 0:
            print(".", end="", flush=True)

        if placeholder.exists():
            continue  # 아직 다운로드 중

        if pdf_path.exists() and pdf_path.stat().st_size > 1024:
            if not quiet:
                print(" ✓", flush=True)
            return True

    if not quiet:
        print(f" ⏱ 타임아웃 ({timeout}s) — 건너뜀", flush=True)
    return False


# ── 단일 PDF 추출 ───────────────────────────────────────────
def extract_pdf(pdf_path: Path, out_dir: Path, timeout: int, quiet: bool) -> str:
    """반환값: 'ok' | 'empty' | 'error' | 'timeout'"""
    out_path = out_dir / (pdf_path.stem + ".txt")

    # iCloud 다운로드 보장
    if not ensure_local(pdf_path, timeout=timeout, quiet=quiet):
        return "timeout"

    try:
        pages_text = []
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ""
                if text.strip():
                    pages_text.append(f"--- p.{i} ---\n{text}")

        if pages_text:
            out_path.write_text("\n\n".join(pages_text), encoding="utf-8")
            if not quiet:
                chars = sum(len(t) for t in pages_text)
                print(f"  ✅ {pdf_path.name:50s} {len(pages_text)}p  {chars:,}자")
            return "ok"
        else:
            if not quiet:
                print(f"  ⚠️  {pdf_path.name:50s} (스캔 이미지 — 텍스트 레이어 없음)")
            return "empty"

    except Exception as e:
        if not quiet:
            print(f"  ❌ {pdf_path.name}: {e}")
        return "error"


# ── CLI ─────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        prog="pdf-extract",
        description="PDF 디렉토리에서 한글/영문 텍스트 일괄 추출 (iCloud 자동 대기 포함)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  pdf-extract ~/books/brand/B
  pdf-extract ~/books/brand/B -r -o ~/output/extracted
  pdf-extract ~/books/brand/B -f --open
  pdf-extract ~/books/brand/B -t 300       # iCloud 대기 5분까지
        """
    )
    p.add_argument("directory",          help="PDF가 있는 디렉토리")
    p.add_argument("-o", "--output",     help="출력 디렉토리 (기본: <입력>/_extracted)")
    p.add_argument("-r", "--recursive",  action="store_true", help="하위 폴더 재귀 탐색")
    p.add_argument("-f", "--force",      action="store_true", help="이미 추출된 파일도 덮어쓰기")
    p.add_argument("-q", "--quiet",      action="store_true", help="조용히 실행")
    p.add_argument("-t", "--timeout",    type=int, default=120,
                                         help="iCloud 다운로드 타임아웃 초 (기본: 120)")
    p.add_argument("--open",             action="store_true", help="완료 후 출력 폴더 열기")

    if len(sys.argv) == 1:
        p.print_help(); sys.exit(0)

    args = p.parse_args()

    src = Path(args.directory).expanduser().resolve()
    if not src.is_dir():
        print(f"❌ 디렉토리가 없습니다: {src}"); sys.exit(1)

    out_dir = Path(args.output).expanduser().resolve() if args.output else src / "_extracted"
    out_dir.mkdir(parents=True, exist_ok=True)

    pattern = "**/*.pdf" if args.recursive else "*.pdf"
    pdfs = sorted(src.glob(pattern))

    if not pdfs:
        print(f"❌ PDF 파일이 없습니다: {src}"); sys.exit(1)

    if not args.force:
        done = {f.stem for f in out_dir.glob("*.txt")}
        skipped = [p for p in pdfs if p.stem in done]
        pdfs    = [p for p in pdfs if p.stem not in done]
    else:
        skipped = []

    if not args.quiet:
        total = len(pdfs) + len(skipped)
        print(f"\n📄 pdf-extract  →  {out_dir}")
        print(f"   총 {total}개  |  처리 {len(pdfs)}개  |  건너뜀 {len(skipped)}개")
        print(f"   iCloud 대기 타임아웃: {args.timeout}초/파일\n")

    counts = {"ok": 0, "empty": 0, "error": 0, "timeout": 0}
    for pdf_path in pdfs:
        result = extract_pdf(pdf_path, out_dir, args.timeout, args.quiet)
        counts[result] += 1

    if not args.quiet:
        print(f"\n✨ 완료")
        print(f"   ✅ {counts['ok']}개 추출  "
              f"⚠️  {counts['empty']}개 이미지PDF  "
              f"⏱ {counts['timeout']}개 타임아웃  "
              f"❌ {counts['error']}개 오류")
        print(f"   출력: {out_dir}")

    if args.open:
        subprocess.run(["open", str(out_dir)])


if __name__ == "__main__":
    main()
