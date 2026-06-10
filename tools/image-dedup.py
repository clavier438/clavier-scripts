#!/usr/bin/env python3
# image-dedup — 폴더에서 같은 사진(정확+근접) 제거. perceptual dhash 클러스터 → 클러스터당 1장만.
# 보존 우선순위: 태그된 것 > 고해상(픽셀수). = "화질 다른 중복은 가장 큰 픽셀만 남기고 삭제".
# 모든 사진 포맷(lib/image_formats PHOTO_EXTS, HEIC 포함). _cls.json·_tags.json 레코드도 정리. 오프라인·토큰 0.
#   image-dedup.py <brand_dir>          # 한 폴더 (기본 재귀 — 하위 폴더 포함)
#   image-dedup.py <brand_dir> --no-recurse   # top-level 만
#   image-dedup.py --all <refs_root>    # 전 폴더 (자식별로 따로)
#   --dry 로 미리보기(삭제 안 함)
import os, sys, glob, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from PIL import Image
from image_formats import PHOTO_EXTS, register_heif, find_images
THRESH = 6   # dhash hamming ≤6 = 같은 사진(근접 크롭/리사이즈 포함)

def dhash(p, hs=8):
    try:
        im = Image.open(p); w, h = im.size
        g = im.convert("L").resize((hs+1, hs), Image.LANCZOS)
    except Exception:
        return None, 0
    px = g.tobytes(); b = 0; i = 0   # L 모드 1바이트/픽셀 — getdata 와 동일, deprecation 회피
    for r in range(hs):
        for c in range(hs):
            b |= (1 << i) if px[r*(hs+1)+c] > px[r*(hs+1)+c+1] else 0; i += 1
    return b, w*h
def ham(a, b): return bin(a ^ b).count("1")

def dedup(folder, dry=False, recursive=True):
    register_heif()  # HEIC/HEIF 도 Image.open 가능하게 (pillow-heif 없으면 graceful skip)
    ws = find_images(folder, recursive=recursive)
    if not ws:
        return 0, 0, []
    tagged = set()
    clsp = os.path.join(folder, "_cls.json")
    if os.path.exists(clsp):
        try: tagged = {os.path.basename(r["file"]) for r in json.load(open(clsp, encoding="utf-8"))}
        except Exception: pass
    items = []
    for w in ws:
        d, px = dhash(w)
        if d is not None: items.append((w, d, px))
    used = [False]*len(items); remove = []
    for i in range(len(items)):
        if used[i]: continue
        cluster = [i]; used[i] = True
        for j in range(i+1, len(items)):
            if not used[j] and ham(items[i][1], items[j][1]) <= THRESH:
                used[j] = True; cluster.append(j)
        if len(cluster) == 1: continue
        files = [items[k] for k in cluster]
        files.sort(key=lambda x: (os.path.basename(x[0]) in tagged, x[2]), reverse=True)  # 태그>고해상 보존
        remove += [f[0] for f in files[1:]]
    if not dry:
        rm = {os.path.basename(f) for f in remove}
        for f in remove:
            try: os.remove(f)
            except Exception: pass
        for jf in ("_cls.json", "_tags.json"):
            p = os.path.join(folder, jf)
            if os.path.exists(p):
                try:
                    d = [r for r in json.load(open(p, encoding="utf-8"))
                         if os.path.basename(r.get("file", "")) not in rm]
                    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
                except Exception: pass
    return len(ws), len(remove), remove

if __name__ == "__main__":
    args = sys.argv[1:]
    dry = "--dry" in args
    recursive = "--no-recurse" not in args
    args = [a for a in args if a not in ("--dry", "--no-recurse")]
    if args and args[0] == "--all":
        root = os.path.expanduser(args[1] if len(args) > 1 else "~/Library/Mobile Documents/com~apple~CloudDocs/0/works/study/books/imageRefs")
        tot = trm = 0
        print(f"{'브랜드':14}{'전':>5}{'제거':>5}{'남음':>5}{'  (dry)' if dry else ''}")
        for b in sorted(os.listdir(root)):
            d = os.path.join(root, b)
            if not os.path.isdir(d): continue
            n, r, _ = dedup(d, dry=dry, recursive=recursive)
            if n: print(f"{b:14}{n:>5}{r:>5}{n-r:>5}"); tot += n; trm += r
        print(f"\n전체 {tot} → 제거 {trm} → 남음 {tot-trm}  ({'미적용' if dry else '적용됨'})")
    elif args:
        n, r, rm = dedup(os.path.expanduser(args[0]), dry=dry, recursive=recursive)
        print(f"{n}장 → 제거 {r} → 남음 {n-r}")
    else:
        print("usage: image-dedup.py <dir> [--no-recurse] | --all [root] [--dry]")
