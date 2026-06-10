#!/usr/bin/env python3
# image-convert — 어떤 이미지 형식이든 받아서 어떤 형식이든 변환 (any → any). 단일 변환 엔진.
#
# 정신: webp 전용이던 변환기를 타겟 가변으로 일반화. 앞으로 형식 추가가 쉽게 — WRITERS
#   테이블 한 곳에 (확장자, PIL 포맷, save 옵션) 한 줄이면 새 타겟. (기본 형식 = 이 테이블)
#   입력은 find_images(재귀·HEIF 등록 단일 소스) — 타겟과 같은 확장자는 자기변환이라 제외.
#
#   image-convert.py <folder> [--to FMT] [--quality N] [--no-recurse] [--dry]
#   image-convert.py --all [root] [--to FMT] ...        # 자식 폴더별 일괄
#     --to   webp(기본)·jpg·png·heic·avif·tiff·gif·bmp
#
#   heic 타겟 + macOS: 기존 image-convert-heic.swift(M2 ImageIO HW 가속, sips 대비 5~10x)
#     에 jpg/jpeg 를 위임하고, 그 외 입력만 PIL+pillow-heif 로 보완. 속도 보존 + 단일 front door.
#     (DECISIONS: convert 범용화 시 swift = heic 백엔드 유지)
import os, sys, json, argparse, shutil, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass

from pathlib import Path
from PIL import Image
from multiprocessing import Pool
from image_formats import PHOTO_EXTS, register_heif, find_images  # 확장자·재귀 단일 소스 + HEIF

register_heif()  # .heic/.heif 도 입력/출력 가능하게 (pillow-heif 없으면 graceful skip)

TOOLS = os.path.dirname(os.path.realpath(__file__))

# ── 타겟 형식 테이블 (단일 출처) ───────────────────────────────────────────
#   타겟 → (정식 확장자, PIL 저장 포맷, quality→save kwargs). 새 형식 = 한 줄 추가.
WRITERS = {
    "webp": (".webp", "WEBP", lambda q: {"quality": q, "method": 6}),
    "jpg":  (".jpg",  "JPEG", lambda q: {"quality": q, "optimize": True}),
    "jpeg": (".jpg",  "JPEG", lambda q: {"quality": q, "optimize": True}),
    "png":  (".png",  "PNG",  lambda q: {"optimize": True}),
    "heic": (".heic", "HEIF", lambda q: {"quality": q}),
    "avif": (".avif", "AVIF", lambda q: {"quality": q}),
    "tiff": (".tiff", "TIFF", lambda q: {}),
    "gif":  (".gif",  "GIF",  lambda q: {}),
    "bmp":  (".bmp",  "BMP",  lambda q: {}),
}
NO_ALPHA = {"JPEG", "BMP"}  # 알파 미지원 포맷 → RGB 평탄화


def convert_image(args_tuple):
    """단일 이미지를 타겟 형식으로 변환 (비파괴 — 원본 보존, 새 확장자 파일 생성)."""
    input_path, target, quality = args_tuple
    try:
        input_path = Path(input_path)
        ext, pil_fmt, save_kw = WRITERS[target]
        if input_path.suffix.lower() == ext:
            return None, None, None  # 이미 타겟
        output_path = input_path.with_suffix(ext)
        input_size = input_path.stat().st_size
        img = Image.open(input_path)
        if pil_fmt in NO_ALPHA or img.mode == "CMYK":
            img = img.convert("RGB")
        elif img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")
        img.save(output_path, pil_fmt, **save_kw(quality))
        output_size = output_path.stat().st_size
        reduction = ((1 - output_size / input_size) * 100) if input_size > 0 else 0
        return str(input_path), str(output_path), {
            "input_size": input_size, "output_size": output_size,
            "reduction_percent": reduction, "original_format": input_path.suffix.lower(),
        }
    except Exception as e:
        return str(input_path), None, str(e)


def _update_meta(folder, ext):
    """_tags.json·_cls.json 의 file 참조를 새 확장자로 갱신 (브랜드 태그가 변환 후에도 따라가게)."""
    for name in ("_tags.json", "_cls.json"):
        p = folder / name
        if not p.exists():
            continue
        try:
            data = json.load(open(p, encoding="utf-8"))
            for rec in data:
                fp = rec.get("file")
                if not fp:
                    continue
                fp = Path(fp)
                if fp.suffix.lower() in PHOTO_EXTS and fp.suffix.lower() != ext:
                    rec["file"] = str(fp.with_suffix(ext))
            json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception:
            pass


def convert_folder(folder, target="webp", quality=95, dry=False, recursive=True):
    """폴더 내 이미지를 target 형식으로 변환 (기본 재귀). heic+macOS 는 swift HW 위임."""
    folder = Path(folder)
    ext = WRITERS[target][0]
    images = [f for f in find_images(str(folder), recursive=recursive)
              if Path(f).suffix.lower() != ext]
    if not images:
        return 0, 0, []
    total = len(images)
    swift_n = 0

    # heic 타겟 + macOS → HW 가속 swift 에 jpg/jpeg 위임 (나머지는 PIL 보완)
    if not dry and target == "heic" and sys.platform == "darwin":
        swift = os.path.join(TOOLS, "image-convert-heic.swift")
        if os.path.exists(swift) and shutil.which("swift"):
            subprocess.run(["swift", swift, str(folder), f"{quality / 100:.3f}"])
            jpgs = [f for f in images if Path(f).suffix.lower() in (".jpg", ".jpeg")]
            swift_n = len(jpgs)
            images = [f for f in images if Path(f).suffix.lower() not in (".jpg", ".jpeg")]

    results = []
    if images:
        if not dry:
            with Pool(processes=None) as pool:
                results = pool.map(convert_image, [(f, target, quality) for f in images])
        else:
            results = [convert_image((f, target, quality)) for f in images]

    success, failed = [], []
    for inp, outp, info in results:
        if info is None:
            continue
        if isinstance(info, str):
            failed.append((inp, info))
        else:
            success.append((inp, outp, info))

    if not dry and (success or swift_n):
        _update_meta(folder, ext)
    return total, len(success) + swift_n, failed


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="이미지 형식 변환 (any → any)")
    ap.add_argument("path", nargs="?", help="변환할 폴더")
    ap.add_argument("--to", default="webp", type=str.lower, choices=sorted(WRITERS),
                    help="타겟 형식 (기본 webp)")
    ap.add_argument("--all", action="store_true", help="root 아래 자식 폴더별 일괄 변환")
    ap.add_argument("--quality", type=int, default=95, help="품질 1-100 (기본 95)")
    ap.add_argument("--dry", action="store_true", help="미리보기 (변환 안 함)")
    ap.add_argument("--no-recurse", action="store_true", help="하위 폴더 제외 (기본: 재귀)")
    a = ap.parse_args()
    recursive = not a.no_recurse
    target = a.to

    if a.all:
        root = Path(os.path.expanduser(a.path or "~/Library/Mobile Documents/com~apple~CloudDocs/0/works/study/books/imageRefs"))
        print(f"→ {target}  {'폴더':20}{'전':>5}{'변환':>5}{'실패':>5}  {'(dry)' if a.dry else ''}")
        tf = ts = 0
        for brand_dir in sorted(root.iterdir()):
            if not brand_dir.is_dir():
                continue
            n, s, f = convert_folder(brand_dir, target=target, quality=a.quality, dry=a.dry, recursive=recursive)
            if n:
                print(f"   {brand_dir.name:20}{n:>5}{s:>5}{len(f):>5}")
                tf += n; ts += s
        print(f"\n전체: {tf} → {ts} 변환, {tf - ts} 스킵/실패 ({'미적용' if a.dry else '적용됨'})")
    elif a.path:
        n, s, failed = convert_folder(a.path, target=target, quality=a.quality, dry=a.dry, recursive=recursive)
        print(f"→ {target}: {n}개 → {s}개 변환, {len(failed)}개 실패 ({'미적용' if a.dry else '적용됨'})")
        for f, err in failed:
            print(f"  ✗ {Path(f).name}: {err}")
    else:
        ap.print_help()
