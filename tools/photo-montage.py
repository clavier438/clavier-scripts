#!/usr/bin/env python3
# photo-montage — 폴더 사진들을 *비율 보존* justified 그리드 시트로. claude 0·오프라인.
#
#   왜: 아트디렉션 역설계 1단계 = "엄청 축소해 한눈에" 패턴 파악(DESIGN_RECON.md).
#       photo-cluster 의 정사각 레터박스 타일은 세로/가로 *비율* 을 죽이는데, 비율 자체가
#       디렉션 신호(클로즈업 세로 vs 풍경 와이드)다. 그래서 비율을 살린 채 justified 패킹
#       (행 높이 고정 → 행을 폭에 꽉 맞춰 스케일)으로 빈틈 없이 깐다. 신문/갤러리 레이아웃.
#
#   "패턴 읽히는 최소 크기": Claude 는 이미지를 긴 변 ~1568px 로 다운샘플하므로 시트 폭을
#       그 아래(기본 1536)로 두면 다운샘플 0 = 타일 디테일 보존. 행 높이로 타일 크기 조절.
#
#   사용:
#     photo-montage.py <이미지폴더> --out <dir> [--row-h 110] [--width 1536] [--max-h 1560]
#   산출: <out>/sheet_NN.jpg  +  <out>/montage_manifest.json (타일→파일 좌표 역매핑)
import os, sys, glob, json, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경도 동작)
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif
from PIL import Image
register_heif()  # .heic/.heif 디코딩 등록

IMAGE_EXTS = PHOTO_EXTS

# ── 자동 타일 크기 (레지빌리티 바닥 불가침) ──────────────────────────────────
# 핵심 원칙(사용자): "너무 작으면 분석할 수 없다." → 타일 높이는 MIN_ROW 아래로 절대 안 감.
#   시트 폭 ≤ 1536 이라 Claude 다운샘플 0 = 타일 px == 화면에 보이는 px. 즉 MIN_ROW=실측 하한.
# packing 밀도 상수 K: tiles_per_sheet ≈ K / row_h^2 (실측 — amannewyork 247타일@104px@1536폭 →
#   247*104^2 ≈ 2.67e6). 종횡비 분포로 변동하나 row_h 1차 추정엔 충분.
MIN_ROW = 100         # 분석 가능 하한(px). 1순위 불가침.
MAX_ROW = 190         # 작은 폴더에서 타일이 과대해지는 것 방지 상한.
PACK_K = 2.3e6        # tiles_per_sheet ≈ K / row_h^2 (실측 근사: 1263장@129px→9시트≈140/시트)


def auto_row_h(n, target_sheets, min_row, width):
    """사진 n장을 target_sheets 안에 담는 가장 큰 row_h. 단 [min_row, MAX_ROW] 로 클램프.
    width 가 기준(1536)과 다르면 밀도 K 를 폭 비례로 보정."""
    k = PACK_K * (width / 1536.0)
    per = max(1, -(-n // max(1, target_sheets)))   # ceil(n/target_sheets) = 시트당 목표 타일
    r = int((k / per) ** 0.5)
    return max(min_row, min(MAX_ROW, r))


def collect(src):
    return sorted(f for f in glob.glob(os.path.join(src, "**", "*"), recursive=True)
                  if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
                  and not os.path.basename(f).startswith("."))


def build_rows(metas, row_h, width, gap, last_row_scale_cap):
    """metas=[(path,w,h)] → justified 행 리스트. 각 행 = [(path, tw, th)] 폭이 width 에 꽉 참."""
    rows, cur, cur_w = [], [], 0
    for path, w, h in metas:
        ar = (w / h) if h else 1.0
        tw = ar * row_h
        if cur and cur_w + tw + gap * len(cur) > width:
            rows.append(_justify(cur, row_h, width, gap))
            cur, cur_w = [], 0
        cur.append((path, ar)); cur_w += tw
    if cur:                                   # 마지막 행 — 과도 확대 방지(cap)
        rows.append(_justify(cur, row_h, width, gap, scale_cap=last_row_scale_cap))
    return rows


def _justify(items, row_h, width, gap, scale_cap=None):
    avail = width - gap * (len(items) - 1)
    base = sum(ar * row_h for _, ar in items)
    scale = avail / base if base else 1.0
    if scale_cap:
        scale = min(scale, scale_cap)
    th = row_h * scale
    return [(path, ar * th, th) for path, ar in items]


def main():
    ap = argparse.ArgumentParser(description="폴더 사진 → 비율 보존 justified 몽타주 시트 (claude 0)")
    ap.add_argument("src", help="이미지 폴더 (재귀)")
    ap.add_argument("--out", required=True, help="출력 폴더 (sheet_NN.jpg + manifest)")
    ap.add_argument("--row-h", type=int, default=0, help="기준 행 높이 px. 0=자동(사진 수에서 역산, MIN_ROW 보장)")
    ap.add_argument("--min-row", type=int, default=MIN_ROW, help="타일 높이 하한 px (분석 가능 바닥, 불가침)")
    ap.add_argument("--max-sheets", type=int, default=8, help="자동 모드 목표 시트 수 (토큰 예산)")
    ap.add_argument("--hard-cap-sheets", type=int, default=14, help="이 이상이면 대표 subsample (N 폭발 시)")
    ap.add_argument("--width", type=int, default=1536, help="시트 폭 px (Claude 1568 다운샘플 한도 밑)")
    ap.add_argument("--max-h", type=int, default=1560, help="시트 최대 높이 px (넘으면 다음 시트)")
    ap.add_argument("--gap", type=int, default=2, help="타일 간격 px")
    ap.add_argument("--bg", default="#101010", help="배경색")
    ap.add_argument("--last-row-cap", type=float, default=1.4, help="마지막 행 과확대 cap")
    a = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(a.src))
    out = os.path.abspath(os.path.expanduser(a.out))
    if not os.path.isdir(src):
        print(f"폴더 아님: {src}"); sys.exit(1)
    imgs = collect(src)
    if not imgs:
        print(f"이미지 없음: {src}"); sys.exit(1)
    os.makedirs(out, exist_ok=True)
    bg = tuple(int(a.bg.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

    # 1) 원본 비율만 빠르게 수집 (픽셀 디코딩 없이 헤더로 — Image.open 은 lazy)
    print(f"[photo-montage] {len(imgs)}장 비율 수집…")
    metas = []
    for p in imgs:
        try:
            with Image.open(p) as im:
                metas.append((p, im.width, im.height))
        except Exception:
            continue
    print(f"  → {len(metas)}장 ({len(imgs)-len(metas)} skip)")

    # 2) 자동 타일 크기 (지정 안 했으면 사진 수에서 역산 — MIN_ROW 바닥 보장)
    row_h = a.row_h
    if row_h <= 0:
        row_h = auto_row_h(len(metas), a.max_sheets, a.min_row, a.width)
        per = PACK_K * (a.width / 1536.0) / (row_h ** 2)
        est_sheets = max(1, -(-len(metas) // max(1, int(per))))
        # N 폭발: 바닥(min_row)으로도 시트가 hard-cap 초과면 대표 subsample (전수는 CLIP 담당)
        if row_h <= a.min_row and est_sheets > a.hard_cap_sheets:
            keep = int(per * a.hard_cap_sheets)
            stride = max(1, len(metas) // keep)
            kept = metas[::stride][:keep]
            print(f"  ⚠ {len(metas)}장 → 바닥 {a.min_row}px 로도 {est_sheets}시트(>cap {a.hard_cap_sheets}). "
                  f"대표 {len(kept)}장만 몽타주(stride {stride}). 전수 분류는 CLIP 이 담당.")
            metas = kept
        print(f"  [자동] row_h={row_h}px (하한 {a.min_row}, 목표 {a.max_sheets}시트) — 예상 ~{est_sheets}시트")

    # 3) justified 행 → 시트 분할
    rows = build_rows(metas, row_h, a.width, a.gap, a.last_row_cap)
    manifest = {"src": src, "width": a.width, "row_h": row_h, "sheets": [], "tiles": []}
    sheet_idx, y, sheet_rows = 0, a.gap, []

    def flush(sheet_rows, sheet_idx):
        if not sheet_rows:
            return
        total_h = a.gap + sum(int(r[0][2]) + a.gap for r in sheet_rows)
        canvas = Image.new("RGB", (a.width, min(total_h, a.max_h + a.row_h)), bg)
        yy = a.gap
        for row in sheet_rows:
            xx = a.gap
            th = int(row[0][2])
            for path, tw, t_h in row:
                tw_i, th_i = max(1, int(tw)), max(1, int(t_h))
                try:
                    im = Image.open(path).convert("RGB").resize((tw_i, th_i), Image.LANCZOS)
                    canvas.paste(im, (xx, yy))
                except Exception:
                    pass
                manifest["tiles"].append({"sheet": sheet_idx, "file": os.path.basename(path),
                                          "x": xx, "y": yy, "w": tw_i, "h": th_i})
                xx += tw_i + a.gap
            yy += th + a.gap
        outp = os.path.join(out, f"sheet_{sheet_idx:02d}.jpg")
        canvas.crop((0, 0, a.width, yy)).save(outp, "JPEG", quality=86)
        manifest["sheets"].append({"sheet": sheet_idx, "file": f"sheet_{sheet_idx:02d}.jpg",
                                   "rows": len(sheet_rows)})
        print(f"  sheet_{sheet_idx:02d}.jpg  ({sum(len(r) for r in sheet_rows)} tiles, {len(sheet_rows)} rows)")

    for row in rows:
        rh = int(row[0][2])
        if sheet_rows and y + rh + a.gap > a.max_h:
            flush(sheet_rows, sheet_idx)
            sheet_idx += 1; sheet_rows, y = [], a.gap
        sheet_rows.append(row); y += rh + a.gap
    flush(sheet_rows, sheet_idx)

    with open(os.path.join(out, "montage_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\n✓ {sheet_idx+1}개 시트 + montage_manifest.json → {out}")


if __name__ == "__main__":
    main()
