#!/usr/bin/env python3
# recon — webExporter 가 만든 per-host 캡처 폴더(books/<host>/)를 받아,
# *추출된 레이어만*(옵션 게이팅) recon/ 에 체계적으로 정리한다.
# "한 브랜드 = 한 폴더 = 모든 레이어" (DESIGN_RECON.md).
#
#   recon.py <books/<host> 폴더>
#
# 입력(webExporter 산출): <host>.pdf · images/ · fonts/ · colors/
# 출력:
#   recon/photos/<host>_NNN.webp (+ _webfx.json)   ← images/ 있을 때 (webp 변환 + 중복제거)
#   recon/palette.json                              ← colors/ 있을 때
#   recon/fonts.txt                                 ← fonts/ 있을 때 (로드 패밀리)
#   recon/icons.json                                ← site-icons 정적 스캔 (host)
#   recon/_layers.json                              ← 레이어 멀티태그 매니페스트 (brandguide 가 읽음)
#   recon/brandguide_v<NN>.html                     ← 보고서(단일 산출물). 채워진 레이어 있으면 자동 생성
#   recon/summary.md                                ← 어떤 레이어가 채워졌나 한 장
import os, sys, glob, json, subprocess, shutil
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif  # 사진 확장자 단일 소스 + HEIF 디코딩 등록
try:
    from PIL import Image
    register_heif()  # .heic/.heif 도 Image.open 가능하게 (pillow-heif 없으면 graceful)
except ImportError:
    Image = None

TOOLS = os.path.dirname(os.path.realpath(__file__))
PY = sys.executable
IMG_EXT = PHOTO_EXTS

def _build_layer_tags(recon, photos_dir):
    """각 레이어의 상태를 멀티태그 dict 로 반환 — brandguide 등이 읽어 섹션 렌더 결정."""
    tags = {}

    # photos
    if os.path.isdir(photos_dir):
        webps = glob.glob(os.path.join(photos_dir, "*.webp"))
        tagged = os.path.exists(os.path.join(photos_dir, "_tags.json"))
        tags["photos"] = {
            "status": "tagged" if tagged else "untagged",
            "count": len(webps),
            "tags": ["has:photos"] + (["has:tags"] if tagged else ["needs:image-tagger"]),
        }
    else:
        tags["photos"] = {"status": "missing", "count": 0, "tags": ["needs:webExporter"]}

    # palette
    if os.path.exists(os.path.join(recon, "palette.json")):
        try:
            colors = json.load(open(os.path.join(recon, "palette.json"), encoding="utf-8"))
            count = len(colors) if isinstance(colors, list) else len(colors.get("colors", []))
        except Exception:
            count = 0
        tags["palette"] = {"status": "ready", "count": count, "tags": ["has:palette"]}
    else:
        tags["palette"] = {"status": "missing", "tags": ["needs:webExporter --extract-colors"]}

    # fonts
    if os.path.exists(os.path.join(recon, "fonts.txt")):
        fams = [l.strip() for l in open(os.path.join(recon, "fonts.txt"), encoding="utf-8") if l.strip()]
        tags["fonts"] = {"status": "ready", "families": fams, "tags": ["has:fonts"]}
    else:
        tags["fonts"] = {"status": "missing", "tags": ["needs:webExporter --download-fonts"]}

    # icons
    icons_path = os.path.join(recon, "icons.json")
    if os.path.exists(icons_path):
        try:
            icons_data = json.load(open(icons_path, encoding="utf-8"))
            entry = icons_data[0] if isinstance(icons_data, list) and icons_data else {}
            libs = [l.get("name") for l in entry.get("libs", []) if l.get("name")]
            has_svg = bool(entry.get("svg", 0))
            icon_tags = ["has:icons"] + (["has:svg"] if has_svg else ["no:svg"])
            if libs:
                icon_tags += [f"lib:{l}" for l in libs]
            tags["icons"] = {"status": "ready", "libs": libs, "svg": has_svg, "tags": icon_tags}
        except Exception:
            tags["icons"] = {"status": "error", "tags": ["has:icons", "needs:recheck"]}
    else:
        tags["icons"] = {"status": "missing", "tags": ["needs:site-icons"]}

    # luts — 컬러그레이딩 .cube (photo-lut, organize 자동 생성). 정책별 N개.
    cubes = glob.glob(os.path.join(recon, "luts", "*.cube"))
    if cubes:
        tags["luts"] = {"status": "ready", "count": len(cubes),
                        "files": sorted(os.path.basename(c) for c in cubes),
                        "tags": ["has:luts"] + ([f"split:{len(cubes)}"] if len(cubes) > 1 else [])}
    else:
        tags["luts"] = {"status": "missing", "tags": ["needs:photo-lut"]}

    # report — 단일 산출물 = brandguide HTML (md 보고서 폐기, HTML 단일화. DECISIONS 2026-06-05)
    guides = sorted(glob.glob(os.path.join(recon, "brandguide_v*.html")))
    ready_layers = [k for k in ("photos", "palette", "fonts", "icons")
                    if tags[k]["status"] in ("ready", "tagged")]
    if guides:
        tags["report"] = {"status": "ready", "latest": os.path.basename(guides[-1]),
                          "tags": ["has:brandguide"]}
    elif ready_layers:
        tags["report"] = {"status": "pending", "tags": ["needs:brandguide"]}
    else:
        tags["report"] = {"status": "missing", "tags": ["needs:webExporter"]}

    return tags


def organize(host_dir):
    host_dir = os.path.abspath(os.path.expanduser(host_dir))
    host = os.path.basename(host_dir.rstrip("/"))
    if not os.path.isdir(host_dir):
        print(f"❌ 폴더 아님: {host_dir}"); return
    recon = os.path.join(host_dir, "recon"); os.makedirs(recon, exist_ok=True)
    layers = []

    # 1) images/ → recon/photos/ (webp 변환 + 중복제거 + webfx carry)
    srcs = [s for s in glob.glob(os.path.join(host_dir, "images", "**", "*"), recursive=True)
            if os.path.splitext(s)[1].lower() in IMG_EXT and not os.path.basename(s).startswith("_")]
    if srcs and Image:
        photos = os.path.join(recon, "photos"); os.makedirs(photos, exist_ok=True)
        fx_by_src = {}
        for fxf in glob.glob(os.path.join(host_dir, "images", "**", "_webfx.json"), recursive=True):
            try:
                base = os.path.dirname(fxf)
                for fn, fx in json.load(open(fxf, encoding="utf-8")).items():
                    fx_by_src[os.path.join(base, fn)] = fx
            except Exception:
                pass
        kept, webfx = 0, {}
        for src in sorted(set(srcs)):
            try:
                im = Image.open(src)
                if min(im.size) < 200:
                    continue
                nn = f"{host}_{kept:03d}.webp"
                im.convert("RGB").save(os.path.join(photos, nn), "WEBP", quality=88, method=4)
                if src in fx_by_src:
                    webfx[nn] = fx_by_src[src]
                kept += 1
            except Exception:
                continue
        if webfx:
            json.dump(webfx, open(os.path.join(photos, "_webfx.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        subprocess.run([PY, os.path.join(TOOLS, "image-dedup.py"), photos], capture_output=True)
        n = len(glob.glob(os.path.join(photos, "*.webp")))
        layers.append(f"photos({n})")
        # 1b) photos → recon/luts/ : 컬러그레이딩 LUT (정책별 .cube). 색만 보므로 tag 불필요.
        if n:
            luts = os.path.join(recon, "luts"); os.makedirs(luts, exist_ok=True)
            subprocess.run([PY, os.path.join(TOOLS, "photo-lut.py"), photos,
                            "--outdir", luts, "--title", host], capture_output=True, text=True)
            nl = len(glob.glob(os.path.join(luts, "*.cube")))
            if nl: layers.append(f"luts({nl})")

    # 2) colors/ → recon/palette.json
    cj = sorted(glob.glob(os.path.join(host_dir, "colors", "*.json")))
    if cj:
        shutil.copy(cj[0], os.path.join(recon, "palette.json"))
        for png in glob.glob(os.path.join(host_dir, "colors", "*.png"))[:1]:
            shutil.copy(png, os.path.join(recon, "palette.png"))
        layers.append("palette")

    # 3) fonts/ → recon/fonts.txt (로드 패밀리)
    fams = set()
    for lf in glob.glob(os.path.join(host_dir, "fonts", "**", "_loaded.txt"), recursive=True):
        try:
            for line in open(lf, encoding="utf-8"):
                if line.strip():
                    fams.add(line.split("|")[0].strip())
        except Exception:
            pass
    if fams:
        open(os.path.join(recon, "fonts.txt"), "w", encoding="utf-8").write("\n".join(sorted(fams)))
        layers.append(f"fonts({len(fams)})")

    # 4) site-icons 정적 스캔 → recon/icons.json
    si = os.path.join(TOOLS, "site-icons.py")
    if os.path.exists(si):
        try:
            r = subprocess.run([PY, si, f"https://{host}/", "--json"], capture_output=True, text=True, timeout=60)
            if r.returncode == 0 and r.stdout.strip():
                json.dump(json.loads(r.stdout), open(os.path.join(recon, "icons.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
                layers.append("icons")
        except Exception:
            pass

    photos_dir = os.path.join(recon, "photos")
    if os.path.isdir(photos_dir) and not os.path.exists(os.path.join(photos_dir, "_tags.json")):
        layers.append("photos:미분류(image-tagger 대기)")

    # 5) _layers.json — 멀티태그 레이어 매니페스트 (brandguide 등이 읽음. DECISIONS 2026-06-05)
    layer_tags = _build_layer_tags(recon, photos_dir)
    json.dump(layer_tags, open(os.path.join(recon, "_layers.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    # 6) 보고서 = HTML brandguide 자동 생성 (단일 산출물). 채워진 레이어가 있으면 무조건 생성.
    if any(layer_tags[k]["status"] in ("ready", "tagged") for k in ("photos", "palette", "fonts", "icons")):
        r = subprocess.run([PY, os.path.join(TOOLS, "brandguide.py"), recon], capture_output=True, text=True)
        if r.returncode == 0:
            layers.append("brandguide(html)")
            # brandguide 가 html 을 만든 뒤 _layers.json 재기록 — report 레이어를
            # has:brandguide 로 갱신 (step5 시점엔 html 이 없어 pending 으로 stale).
            layer_tags = _build_layer_tags(recon, photos_dir)
            json.dump(layer_tags, open(os.path.join(recon, "_layers.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
        else:
            print(f"  ⚠ brandguide 생성 실패: {r.stderr.strip()[:200]}")

    # 7) summary
    open(os.path.join(recon, "summary.md"), "w", encoding="utf-8").write(
        f"# {host} — design recon\n\n> recon.py 자동 정리\n\n**채워진 레이어**: {', '.join(layers) or '(없음)'}\n\n"
        f"- `recon/photos/` 큐레이트 사진 + 분류(_tags.json)\n- `recon/brandguide_v<NN>.html` 브랜드 가이드 (보고서)\n"
        f"- `recon/palette.json` 컬러 · `recon/fonts.txt` 서체 · `recon/icons.json` 아이콘 시스템\n"
        f"- `recon/_layers.json` 레이어 멀티태그 매니페스트\n")
    print(f"✓ {host} → recon/ : {', '.join(layers) or '(추출 레이어 없음)'}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: recon.py <books/<host> 폴더>  (webExporter 캡처 폴더)")
        sys.exit(1)
    organize(sys.argv[1])
