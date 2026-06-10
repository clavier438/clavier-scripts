#!/usr/bin/env python3
# image-filter-graphic-frame — 그래픽 요소로 프레이밍된 이미지를 감지해 격리/삭제.
#
# 정의 (사용자 명시 그대로):
#   "색상값 변화가 0인 픽셀들이 프레임 끝에서 끝까지, x값이나 y값 둘 중
#    하나만 바뀌면서 이어진다."
#   = 한 행(row) 전체(좌→우 끝까지)가 동일 색  →  수평 관통 라인
#   = 한 열(col) 전체(위→아래 끝까지)가 동일 색  →  수직 관통 라인
#   이런 관통 라인이 하나라도 있으면 그래픽 프레이밍으로 포착.
#
#   사진은 한 행/열이 끝에서 끝까지 완전히 같은 색일 수 없다. 단색 그래픽 띠
#   (레터박스·색 밴드·여백 프레임)만 이 조건을 만족한다.
#
# --threshold 는 "변화 0" 의 압축 허용오차(행/열 픽셀들의 표준편차 상한).
#   HEIC/JPEG 는 무손실이 아니라 진짜 단색도 std 가 정확히 0 이 아닐 수 있어
#   기본값을 0 보다 약간 크게 둔다. 0 으로 주면 글자 그대로 "변화 0" 만 포착.
#
# 사용법:
#   ./image-filter-graphic-frame.py <폴더>                      # 감지만 (dry-run)
#   ./image-filter-graphic-frame.py <폴더> --move-to <격리폴더>  # 격리
#   ./image-filter-graphic-frame.py <폴더> --delete             # 삭제
#   ./image-filter-graphic-frame.py <폴더> --threshold 0        # 엄격(변화 정확히 0)
#
# 의존: PIL, numpy (webExporter/.venv 에 있음)
#   webExporter/.venv/bin/python3 tools/image-filter-graphic-frame.py <폴더>

import os, sys, argparse, json, shutil
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경(OCI 등)에서도 동작하게 선택적)
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif
try:
    from PIL import Image
except ImportError:
    sys.exit("PIL 필요: pip install Pillow")


def col_ranges(arr):
    """각 열(column)의 RGB 채널별 (max−min) 중 최댓값 — shape (W,).
    0 이면 그 열 전체(위→아래 끝까지)가 *모든 채널에서 정확히* 동일 색.
    std 와 달리 채널을 뭉개지 않는다 — (255,0,0) 단색도 변동 0 으로 본다."""
    return (arr.max(axis=0) - arr.min(axis=0)).max(axis=1)


def row_ranges(arr):
    """각 행(row)의 RGB 채널별 (max−min) 중 최댓값 — shape (H,).
    0 이면 그 행 전체(좌→우 끝까지)가 모든 채널에서 정확히 동일 색."""
    return (arr.max(axis=1) - arr.min(axis=1)).max(axis=1)


def edge_band_thickness(arr, tol):
    """이미지 4 가장자리에서 안쪽으로, '끝→끝 동일색(채널변동≤tol)'인 줄이
    몇 개 연속되는지 = 단색 패딩 띠 두께. (top, bottom, left, right) px 반환.

    왜 '한 줄' 이 아니라 '연속 띠' 인가: 압축 노이즈로 진짜 단색 패딩도 변동이
    정확히 0 이 아니라 1~2 가 된다(→ tol 로 흡수). 반대로 어두운 사진은 한 줄이
    우연히 균일할 수 있으나 *가장자리부터 여러 줄 연속* 으로 균일하진 않다.
    합성 패딩만 가장자리에서 두껍게 연속된다 — 이게 사진과의 결정적 차이."""
    cr = col_ranges(arr)
    rr = row_ranges(arr)
    H, W = arr.shape[:2]
    top = 0
    while top < H and rr[top] <= tol:
        top += 1
    bot = 0
    while bot < H and rr[H - 1 - bot] <= tol:
        bot += 1
    left = 0
    while left < W and cr[left] <= tol:
        left += 1
    right = 0
    while right < W and cr[W - 1 - right] <= tol:
        right += 1
    return top, bot, left, right


def graphic_frame_reason(path, tol=2, min_band=31):
    """가장자리 단색 패딩 띠가 min_band px 이상이면 그래픽 프레이밍으로 판정.
    이유 문자열 반환, 아니면 None."""
    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        return f"열기 실패: {e}"
    arr = np.array(img, dtype=np.int16)

    top, bot, left, right = edge_band_thickness(arr, tol)
    sides = [("위", top), ("아래", bot), ("좌", left), ("우", right)]
    hits = [f"{name} {v}px" for name, v in sides if v >= min_band]
    if hits:
        return "가장자리 단색 패딩 띠: " + ", ".join(hits)
    return None


def scan_folder(folder, tol, min_band, delete, move_to, extensions):
    hits = []
    files = sorted(f for f in os.listdir(folder)
                   if os.path.splitext(f)[1].lower() in extensions and not f.startswith("."))
    if not files:
        print(f"[!] 이미지 없음: {folder}")
        return hits, 0

    if move_to:
        os.makedirs(move_to, exist_ok=True)

    for fn in files:
        path = os.path.join(folder, fn)
        reason = graphic_frame_reason(path, tol=tol, min_band=min_band)
        if reason:
            hits.append({"file": fn, "reason": reason})
            if move_to:
                shutil.move(path, os.path.join(move_to, fn))
                print(f"  📦 이동  {fn}  — {reason}")
            elif delete:
                os.remove(path)
                print(f"  🗑 삭제  {fn}  — {reason}")
            else:
                print(f"  🔍 감지  {fn}  — {reason}")
        else:
            print(f"  ✅ 보존  {fn}")

    return hits, len(files)


def main():
    ap = argparse.ArgumentParser(description="그래픽 프레이밍(끝→끝 동일색 라인) 감지·격리·삭제")
    ap.add_argument("folder", help="스캔할 이미지 폴더")
    ap.add_argument("--move-to", metavar="DIR", help="감지된 이미지를 이 폴더로 이동 (검수용)")
    ap.add_argument("--delete", action="store_true", help="감지된 이미지 실제 삭제")
    ap.add_argument("--tol", type=int, default=2,
                    help="단색 판정 채널 변동폭 허용 (기본 2 — 압축 노이즈 흡수, 0=정확히 동일색만)")
    ap.add_argument("--min-band", type=int, default=31,
                    help="그래픽으로 볼 최소 가장자리 띠 두께 px (기본 31 — 그 미만은 어두운 사진 가장자리 오검출)")
    ap.add_argument("--report", help="결과를 JSON 으로 저장할 경로")
    args = ap.parse_args()

    if not os.path.isdir(args.folder):
        sys.exit(f"폴더 없음: {args.folder}")

    register_heif()

    if args.move_to:
        mode = f"격리 → {args.move_to}"
    elif args.delete:
        mode = "삭제 모드"
    else:
        mode = "dry-run"
    print(f"\n📂 {args.folder}  [{mode}]")
    print(f"   tol={args.tol} min_band={args.min_band}px (가장자리 단색 패딩 띠가 이 두께 이상이면 그래픽)\n")

    hits, total = scan_folder(args.folder,
                              tol=args.tol,
                              min_band=args.min_band,
                              delete=args.delete,
                              move_to=args.move_to,
                              extensions=PHOTO_EXTS)

    print(f"\n결과: 감지 {len(hits)}장 / 전체 {total}장")
    if args.move_to:
        print(f"격리 폴더: {args.move_to}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(hits, f, ensure_ascii=False, indent=2)
        print(f"리포트 → {args.report}")


if __name__ == "__main__":
    main()
