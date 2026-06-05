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
#   recon/report_v<NN>.md                           ← recon/photos/_tags.json 분류돼 있으면 (photo-pattern --report)
#   recon/summary.md                                ← 어떤 레이어가 채워졌나 한 장
import os, sys, glob, json, subprocess, shutil
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
try:
    from PIL import Image
except ImportError:
    Image = None

TOOLS = os.path.dirname(os.path.realpath(__file__))
PY = sys.executable
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif")

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

    # 5) 분류돼 있으면 → photo-pattern --report
    photos_dir = os.path.join(recon, "photos")
    if os.path.exists(os.path.join(photos_dir, "_tags.json")):
        subprocess.run([PY, os.path.join(TOOLS, "photo-pattern.py"), photos_dir, "--report"], capture_output=True)
        layers.append("report")
    elif os.path.isdir(photos_dir):
        layers.append("photos:미분류(image-tagger 대기)")

    # 6) summary
    open(os.path.join(recon, "summary.md"), "w", encoding="utf-8").write(
        f"# {host} — design recon\n\n> recon.py 자동 정리\n\n**채워진 레이어**: {', '.join(layers) or '(없음)'}\n\n"
        f"- `recon/photos/` 큐레이트 사진 + 분류(_tags.json)\n- `recon/report_v<NN>.md` 사진 디렉션 보고서\n"
        f"- `recon/palette.json` 컬러 · `recon/fonts.txt` 서체 · `recon/icons.json` 아이콘 시스템\n")
    print(f"✓ {host} → recon/ : {', '.join(layers) or '(추출 레이어 없음)'}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: recon.py <books/<host> 폴더>  (webExporter 캡처 폴더)")
        sys.exit(1)
    organize(sys.argv[1])
