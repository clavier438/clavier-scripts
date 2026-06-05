#!/usr/bin/env python3
# image-tagger — 추출한 이미지를 비전 모델로 분류해 macOS Finder 태그로 박는다
#
# 목적: webExporter --download-images 로 모은 호텔/브랜드 사진을, 사진마다
#   ① 피사체 ② 톤(색감) ③ 후보정 ④ 구도 네 축으로 태깅 → 파인더에서 바로 거름.
#   "사진을 어떻게 후보정·연출해 조합하는가" 를 디자인 레퍼런스로 학습하기 위한 도구.
#
# 분류 엔진: Claude 비전 API (강제 tool 호출로 고정 vocab JSON 보장).
#   - 이미지당 1회 호출. 768px 로 줄여 JPEG 재인코딩(토큰 절감 + AVIF/WebP/PNG 통일).
#   - 모델 기본 claude-haiku-4-5 (비전·tool 지원 최저가). 이미지 토큰 ≈ w*h/750.
#   reference: https://platform.claude.com/docs/en/docs/build-with-claude/vision
#             https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/overview
#
# 출력(비파괴):
#   - 원본 이미지 파일에 Finder 태그 부착 (xattr, 원본 픽셀 안 건드림)
#   - <dir>/_tags.json   사진별 전체 분류 레코드 (재실행·쿼리·집계용)
#   - <dir>/_tags.csv    표 형태
#   - <dir>/_tag-summary.json + 콘솔  사이트 단위 조합 패턴 (피사체/톤/후보정 분포 %)
#
# 사용법 (ANTHROPIC_API_KEY 는 Doppler 에 있음 → doppler run 으로 주입):
#   doppler run -- webExporter/.venv/bin/python tools/image-tagger.py "<images 폴더>"
#   ... --limit 8 --dry-run     # 샘플 N장만, 태그는 안 박고 결과만 출력 (비용·품질 확인)
#
# 의존성: Pillow (webExporter/.venv 에 있음). 그 외는 stdlib 만.

import os, sys, re, json, csv, base64, argparse, subprocess, plistlib, io, unicodedata
import urllib.request, urllib.error
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경(OCI 등)에서도 동작하게 선택적)
except ImportError:
    pass

try:
    from PIL import Image
except ImportError:
    print("❌ Pillow 필요. webExporter venv 로 실행:")
    print("   doppler run -- webExporter/.venv/bin/python tools/image-tagger.py <dir>")
    sys.exit(1)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-4-5"
MAX_EDGE = 768            # 비전 입력 long-edge px (토큰 절감, 태깅엔 충분)
MAX_TOKENS = 400
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tiff"}

# ── 분류 vocab (영문 enum = 모델 출력 안정용 / 한글 = Finder 태그 표시용) ──────────
# 네 축은 서로 의미가 겹치지 않게 설계: 피사체=무엇, 톤=색감, 후보정=비색상 기법, 구도=배치.
AXES = {
    "subject": {
        "prefix": "피사체",
        "multi": True,          # 한 사진에 1~2개
        "ko": {
            "person": "인물", "interior": "실내", "exterior": "실외",
            "landscape": "풍경", "architecture": "건축", "product": "제품",
            "food": "음식", "detail": "디테일", "still_life": "정물",
        },
    },
    "tone": {
        "prefix": "톤",
        "multi": False,
        "ko": {
            "warm": "웜", "cool": "쿨", "neutral": "뉴트럴", "muted": "뮤트",
            "vivid": "비비드", "monochrome": "모노", "earthy": "어시", "pastel": "파스텔",
        },
        # macOS Finder 태그 색 인덱스 (0=none,1=gray,2=green,3=purple,4=blue,5=yellow,6=red,7=orange)
        # 톤만 색을 입혀 파인더 사이드바/색점에서 한눈에 구분. neutral·monochrome 은 무채라 둘 다 gray.
        "colors": {
            "warm": 7, "cool": 4, "neutral": 1, "muted": 5,
            "vivid": 6, "monochrome": 1, "earthy": 2, "pastel": 3,
        },
    },
    "finish": {                 # 색상이 아닌 후처리 기법 (톤과 직교)
        "prefix": "후보정",
        "multi": True,          # 0~3개
        "ko": {
            "grain": "그레인", "high_contrast": "고대비", "faded": "페이드",
            "bw": "흑백", "high_key": "하이키", "low_key": "로우키",
            "sepia_film": "세피아필름", "natural": "내추럴",
        },
    },
    "composition": {
        "prefix": "구도",
        "multi": False,
        "ko": {
            "minimal": "여백", "centered": "중앙", "full_frame": "풀프레임",
            "layered": "레이어드", "symmetrical": "대칭",
        },
    },
    # ── 계산 축 (비전 아님 — 이미지/캡처 메타에서 도출, build_tool 스키마에서 제외) ──
    "ratio": {                  # 비율 — 표시(렌더) 비율 우선, 없으면 원본 픽셀 비율
        "prefix": "비율",
        "multi": False,
        "computed": True,
        "ko": {
            "square": "정사각", "portrait": "세로", "tall": "긴세로",
            "landscape": "가로", "wide": "와이드", "pano": "파노라마",
        },
    },
    "webfx": {                  # 웹단(CSS)에서 가한 보정 — 다운로드 파일엔 없음. 캡처 시 webExporter 가 기록.
        "prefix": "웹보정",
        "multi": True,
        "computed": True,
        "ko": {
            "grayscale": "흑백", "contrast": "고대비", "low_contrast": "저대비",
            "bright": "밝기", "blur": "블러", "sepia": "세피아",
            "saturate": "채도강조", "desaturate": "채도감소",
            "blend": "블렌드", "translucent": "반투명", "overlay": "오버레이",
        },
    },
}


def build_tool():
    """강제 호출할 tool 정의 — input_schema enum 으로 출력 vocab 고정."""
    props = {}
    for axis, conf in AXES.items():
        if conf.get("computed"):     # 비율·웹보정은 비전이 아니라 계산 → 스키마 제외
            continue
        vals = list(conf["ko"].keys())
        if conf["multi"]:
            props[axis] = {
                "type": "array",
                "items": {"type": "string", "enum": vals},
                "description": f"{conf['prefix']} — 해당하는 값들 (1~3개, 가장 두드러진 것 위주)",
            }
        else:
            props[axis] = {
                "type": "string", "enum": vals,
                "description": f"{conf['prefix']} — 가장 지배적인 값 하나",
            }
    return {
        "name": "classify_photo",
        "description": "한 장의 브랜드/호텔 사진을 네 축(피사체·톤·후보정·구도)으로 분류한다.",
        "input_schema": {
            "type": "object",
            "properties": props,
            "required": [a for a, c in AXES.items() if not c.get("computed")],
        },
    }


SYSTEM_PROMPT = (
    "너는 부티크 호텔·스테이·브랜드의 마케팅 사진을 디자인 레퍼런스로 분석하는 아트 디렉터다. "
    "각 사진이 '무엇을(피사체) / 어떤 색감(톤) / 어떤 후처리 기법(후보정) / 어떤 배치(구도)' 로 "
    "연출됐는지 판단해 classify_photo 도구로만 답하라. "
    "주어진 enum 값만 쓰고, 추측이 어려워도 가장 가까운 값을 반드시 고른다. "
    "톤은 색온도/채도의 지배적 인상(웜·쿨·뮤트 등), 후보정은 색이 아닌 기법(그레인·고대비·흑백 등)이다. "
    "특별한 후처리가 없으면 finish 에 natural 을 넣는다. 순수 흑백이면 tone=monochrome 이고 finish 에 bw."
)


def set_finder_tags(filepath, tags):
    """macOS Finder 사용자 태그 부착 (xattr 바이너리 plist). webSiteExporter 패턴 재사용.
    한글 태그는 NFC 로 정규화 — 입력 출처(내 JSON·API·외부 NFD)에 무관하게 단일 정규형 보장."""
    tags = [unicodedata.normalize("NFC", t) for t in tags]
    plist = plistlib.dumps(tags, fmt=plistlib.FMT_BINARY)
    subprocess.run(
        ["xattr", "-wx", "com.apple.metadata:_kMDItemUserTags", plist.hex(), filepath],
        capture_output=True,
    )


def get_finder_tags(filepath):
    """기존 Finder 태그 읽기 (없으면 빈 리스트)."""
    r = subprocess.run(
        ["xattr", "-px", "com.apple.metadata:_kMDItemUserTags", filepath],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return []
    try:
        raw = bytes.fromhex(re.sub(r"\s", "", r.stdout))
        return [unicodedata.normalize("NFC", t) for t in plistlib.loads(raw)]
    except Exception:
        return []


def prep_image(path, max_edge=MAX_EDGE):
    """이미지를 RGB·≤max_edge 로 줄여 JPEG bytes + 지배색 hex(최대3) 반환.
    Pillow 가 못 여는 포맷(예: 플러그인 없는 AVIF)은 (None, []) 로 스킵 신호."""
    try:
        img = Image.open(path)
        img = img.convert("RGB")
    except Exception:
        return None, [], None
    orig = img.size            # 원본 (w,h) — 비율 계산용 (thumbnail 전)
    img.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82, optimize=True)
    # 지배색 — quantize 후 팔레트 빈도순 (색감 클러스터용 정밀 수치, 토큰 0)
    dom = []
    try:
        q = img.quantize(colors=5)
        pal = q.getpalette()
        counts = sorted(q.getcolors(), reverse=True)  # [(count, idx), ...]
        for _, idx in counts[:3]:
            r, g, b = pal[idx * 3: idx * 3 + 3]
            dom.append(f"#{r:02x}{g:02x}{b:02x}")
    except Exception:
        pass
    return buf.getvalue(), dom, orig


def ratio_bucket(size):
    """(w,h) → 비율 en 값. 표시 비율이 있으면 그걸로(레이아웃 크롭), 없으면 원본."""
    if not size or not size[0] or not size[1]:
        return None
    r = size[0] / size[1]
    if r < 0.66: return "tall"
    if r < 0.9:  return "portrait"
    if r <= 1.1: return "square"
    if r <= 1.5: return "landscape"
    if r <= 2.1: return "wide"
    return "pano"


def load_webfx(root):
    """webExporter 가 캡처 시 기록한 _webfx.json (filename→{dw,dh,filter,blend,opacity,overlay}) 로드."""
    p = os.path.join(root, "_webfx.json")
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            pass
    return {}


def webfx_values(fx):
    """CSS fx 메타 → 웹보정 en 값. 보정이 *파일이 아니라 웹(컴포넌트)* 에 있을 때 잡는다."""
    if not fx:
        return []
    out, flt = [], (fx.get("filter") or "").lower()
    def num(fn):
        m = re.search(fn + r"\(([\d.]+)", flt)
        return float(m.group(1)) if m else None
    if "grayscale(" in flt and (num("grayscale") or 0) > 0.5: out.append("grayscale")
    c = num("contrast")
    if c is not None and c > 1.15: out.append("contrast")
    if c is not None and c < 0.85: out.append("low_contrast")
    b = num("brightness")
    if b is not None and abs(b - 1) > 0.15: out.append("bright")
    if "blur(" in flt: out.append("blur")
    if "sepia(" in flt and (num("sepia") or 0) > 0.3: out.append("sepia")
    s = num("saturate")
    if s is not None and s > 1.2: out.append("saturate")
    if s is not None and s < 0.8: out.append("desaturate")
    if (fx.get("blend") or "normal").lower() not in ("normal", ""): out.append("blend")
    try:
        if fx.get("opacity") is not None and float(fx["opacity"]) < 0.92: out.append("translucent")
    except Exception:
        pass
    if fx.get("overlay"): out.append("overlay")
    return out


def call_vision(jpeg_bytes, model, api_key, tool, retries=4):
    """비전 API 1회 호출 → classify_photo.input(dict) + usage 반환. 429/5xx 백오프."""
    b64 = base64.standard_b64encode(jpeg_bytes).decode()
    body = json.dumps({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "tools": [tool],
        "tool_choice": {"type": "tool", "name": "classify_photo"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg", "data": b64}},
                {"type": "text", "text": "이 사진을 분류해줘."},
            ],
        }],
    }).encode()
    headers = {
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
    }
    backoff = 2
    for attempt in range(retries):
        req = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
            for block in data.get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == "classify_photo":
                    return block["input"], data.get("usage", {})
            raise RuntimeError("tool_use 블록 없음: " + json.dumps(data)[:200])
        except urllib.error.HTTPError as e:
            code = e.code
            msg = e.read().decode(errors="replace")[:200]
            if code in (429, 500, 502, 503, 504, 529) and attempt < retries - 1:
                import time; time.sleep(backoff); backoff *= 2
                continue
            raise RuntimeError(f"HTTP {code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                import time; time.sleep(backoff); backoff *= 2
                continue
            raise RuntimeError(f"네트워크: {e}")
    raise RuntimeError("재시도 소진")


def result_to_tags(result):
    """classify_photo.input → '피사체:공간' 형태 한글 Finder 태그 리스트.
    색이 정의된 축(톤)은 '톤:웜\\n7' 처럼 색 인덱스를 붙여 파인더에서 색점으로 표시."""
    tags = []
    for axis, conf in AXES.items():
        val = result.get(axis)
        vals = val if isinstance(val, list) else ([val] if val else [])
        for v in vals:
            ko = conf["ko"].get(v)
            if ko:
                tag = f"{conf['prefix']}:{ko}"
                color = conf.get("colors", {}).get(v)
                if color:
                    tag += f"\n{color}"
                tags.append(tag)
    return tags


def merge_tags(existing, new_axis_tags):
    """우리 축 prefix 태그만 갈아끼우고 사용자가 단 다른 태그는 보존 (재실행 멱등)."""
    prefixes = tuple(f"{c['prefix']}:" for c in AXES.values())
    kept = [t for t in existing if not t.split("\n")[0].startswith(prefixes)]
    return kept + new_axis_tags


def _have_exiftool():
    import shutil
    return shutil.which("exiftool") is not None


def write_xmp_keywords(path, tags):
    """태그를 XMP-dc:Subject 키워드로 파일에 임베드 → Apple Photos·Photomator·Lightroom 등
    '온갖 곳'에서 키워드로 인식. exiftool 사용(webp 무손실, 재인코딩 X). 없으면 조용히 스킵.
    Finder 태그(xattr)는 그 앱들이 못 읽어서 — 파일 안 메타데이터로도 박아야 인식됨."""
    kws = []
    for t in tags:
        base = t.split("\n")[0]                       # 색 인덱스 제거
        kws.append(base)
        if ":" in base:
            kws.append(base.split(":", 1)[1])         # 값만(실내·웜) 도 검색 편하게
    kws = list(dict.fromkeys(kws))
    if not kws:
        return
    args = ["exiftool", "-overwrite_original", "-q", "-XMP-dc:Subject="]
    for k in kws:
        args.append(f"-XMP-dc:Subject+={k}")
    args.append(path)
    try:
        subprocess.run(args, capture_output=True, timeout=20)
    except (FileNotFoundError, Exception):
        pass


def find_images(root, exts):
    out = []
    for dirpath, _, files in os.walk(root):
        for fn in sorted(files):
            if os.path.splitext(fn)[1].lower() in exts and not fn.startswith("."):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser(description="추출 이미지를 비전 분류 → Finder 태그")
    ap.add_argument("dir", help="이미지 폴더 (재귀 탐색)")
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N장만 (0=전체, 샘플링용)")
    ap.add_argument("--dry-run", action="store_true", help="태그 안 박고 분류 결과만 출력")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-edge", type=int, default=MAX_EDGE)
    ap.add_argument("--from-json", default=None,
                    help="비전 API 대신 미리 분류한 JSON 을 받아 태그만 부착 "
                         "(이 세션의 Claude 가 직접 분류한 결과 등). "
                         "형식: [{\"file\":\"<파일명>\",\"subject\":[..],\"tone\":\"..\","
                         "\"finish\":[..],\"composition\":\"..\"}, ...]")
    ap.add_argument("--no-xmp", action="store_true",
                    help="XMP 키워드 임베드 끄기 (기본: 태그를 XMP-dc:Subject 로도 박아 "
                         "Apple Photos·Photomator 등에서 키워드 인식. exiftool 필요)")
    args = ap.parse_args()
    if not args.no_xmp and not args.dry_run and not _have_exiftool():
        print("⚠ exiftool 없음 — XMP 키워드 스킵(Finder 태그는 정상). 켜려면: brew install exiftool\n")
    max_edge = args.max_edge

    # 분류 출처: --from-json(=사전 분류) 이면 API 불필요, 아니면 비전 API 키 필요
    precomputed = None
    if args.from_json:
        with open(os.path.expanduser(args.from_json), encoding="utf-8") as f:
            precomputed = {os.path.basename(r["file"]): r for r in json.load(f)}
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not args.from_json and not api_key:
        print("❌ ANTHROPIC_API_KEY 없음. Doppler 로 주입하거나(--from-json 쓰면 불필요):")
        print("   doppler run -- webExporter/.venv/bin/python tools/image-tagger.py", args.dir)
        sys.exit(1)

    root = os.path.abspath(os.path.expanduser(args.dir))
    if not os.path.isdir(root):
        print(f"❌ 폴더 아님: {root}"); sys.exit(1)

    images = find_images(root, IMAGE_EXTS)
    if args.limit:
        images = images[:args.limit]
    if not images:
        print(f"이미지 없음: {root}"); sys.exit(0)

    tool = build_tool()
    engine = "from-json" if precomputed is not None else args.model
    print(f"[{engine}] {len(images)}장 처리 시작 (max-edge {max_edge}px"
          f"{', dry-run' if args.dry_run else ''})\n")

    records, in_tok, out_tok, skipped, failed = [], 0, 0, 0, 0
    webfx_map = load_webfx(root)             # 웹단 보정 메타 (webExporter 캡처 시 기록, 없으면 {})
    for i, path in enumerate(images, 1):
        rel = os.path.relpath(path, root)
        jpeg, dom, size = prep_image(path, max_edge)   # dom=지배색, size=원본(w,h)
        if jpeg is None:
            print(f"  {i:>3}/{len(images)} ⊘ 열기 실패(스킵) {rel}"); skipped += 1; continue
        if precomputed is not None:
            result = precomputed.get(os.path.basename(path))
            if result is None:
                print(f"  {i:>3}/{len(images)} ⊘ 분류 JSON 에 없음(스킵) {rel}"); skipped += 1; continue
            usage = {}
        else:
            try:
                result, usage = call_vision(jpeg, args.model, api_key, tool)
            except Exception as e:
                print(f"  {i:>3}/{len(images)} ✗ {rel} — {e}"); failed += 1; continue
        in_tok += usage.get("input_tokens", 0)
        out_tok += usage.get("output_tokens", 0)
        # 계산 축 머지: 비율(표시 비율 우선, 없으면 원본) + 웹보정(CSS fx 메타)
        fx = webfx_map.get(os.path.basename(path)) or {}
        dsize = (fx["dw"], fx["dh"]) if fx.get("dw") and fx.get("dh") else size
        result["ratio"] = ratio_bucket(dsize)
        result["webfx"] = webfx_values(fx)
        tags = result_to_tags(result)
        if not args.dry_run:
            merged = merge_tags(get_finder_tags(path), tags)
            set_finder_tags(path, merged)
            if not args.no_xmp:
                write_xmp_keywords(path, tags)   # 파일 안 XMP 키워드 (Apple Photos·Photomator 인식)
        records.append({"file": rel, "path": path, **result,
                        "dominant_hex": dom, "tags": tags})
        print(f"  {i:>3}/{len(images)} {'·' if args.dry_run else '✓'} {rel}\n"
              f"        {'  '.join(tags)}")

    # ── 사이트 단위 조합 패턴 집계 (④ 축) ──
    n = len(records)
    summary = {"dir": root, "count": n, "axes": {}}
    if n:
        for axis, conf in AXES.items():
            c = Counter()
            for r in records:
                v = r.get(axis)
                for x in (v if isinstance(v, list) else [v] if v else []):
                    c[conf["ko"].get(x, x)] += 1
            summary["axes"][conf["prefix"]] = {
                k: f"{v} ({round(100 * v / n)}%)" for k, v in c.most_common()}

    # ── 산출물 저장 ──
    if records and not args.dry_run:
        with open(os.path.join(root, "_tags.json"), "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        with open(os.path.join(root, "_tags.csv"), "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["file", "subject", "tone", "finish", "composition", "ratio", "webfx", "dominant_hex"])
            for r in records:
                w.writerow([
                    r["file"],
                    "|".join(r.get("subject", []) if isinstance(r.get("subject"), list) else [r.get("subject", "")]),
                    r.get("tone", ""),
                    "|".join(r.get("finish", []) if isinstance(r.get("finish"), list) else [r.get("finish", "")]),
                    r.get("composition", ""),
                    r.get("ratio", ""),
                    "|".join(r.get("webfx", []) if isinstance(r.get("webfx"), list) else [r.get("webfx", "")]),
                    "|".join(r.get("dominant_hex", [])),
                ])
        with open(os.path.join(root, "_tag-summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)

    # ── 콘솔 리포트 ──
    cost = in_tok / 1e6 * 1.0 + out_tok / 1e6 * 5.0   # Haiku 4.5 대략 단가(추정), 실값은 콘솔서 확인
    print(f"\n── 완료: {n}장 분류"
          f"{f', {skipped}장 스킵' if skipped else ''}"
          f"{f', {failed}장 실패' if failed else ''} ──")
    if n:
        print("조합 패턴(사이트 단위):")
        for prefix, dist in summary["axes"].items():
            print(f"  {prefix}: " + ", ".join(f"{k} {v}" for k, v in dist.items()))
    print(f"토큰: in {in_tok:,} / out {out_tok:,}  (≈ ${cost:.4f}, 추정단가)")
    if not args.dry_run and n:
        print(f"→ Finder 태그 부착 완료 + _tags.json / _tags.csv / _tag-summary.json 저장")


if __name__ == "__main__":
    main()
