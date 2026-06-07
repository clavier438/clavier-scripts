#!/usr/bin/env python3
# photo-pattern — 브랜드 사진의 '체계'를 드러낸다 (개별 태그가 아니라 *유형 구조*·*의도적 일관성*).
# image-tagger 산출 _tags.json 을 읽어 아키타입 + 피사체별 고정축(룰) + 조합 문법을 계산. 오프라인·토큰 0.
#   photo-pattern.py <brand_dir>         # 한 브랜드 상세
#   photo-pattern.py --all <refs_root>   # 전 브랜드 비교표
import json, os, sys, re, shutil, subprocess
from collections import Counter, defaultdict
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401  (repo freshness 체크 — 없는 환경(OCI 등)에서도 동작하게 선택적)
except ImportError:
    pass
try:
    from PIL import Image
except ImportError:
    Image = None

KO_T={"warm":"웜","cool":"쿨","neutral":"뉴트럴","muted":"뮤트","vivid":"비비드","monochrome":"모노","earthy":"어시","pastel":"파스텔"}
KO_S={"person":"인물","interior":"실내","exterior":"실외","landscape":"풍경","architecture":"건축","product":"제품","food":"음식","detail":"디테일","still_life":"정물","nonphoto":"비사진"}
KO_F={"grain":"그레인","high_contrast":"고대비","faded":"페이드","bw":"흑백","high_key":"하이키","low_key":"로우키","sepia_film":"세피아필름","natural":"내추럴"}
KO_C={"minimal":"여백","centered":"중앙","full_frame":"풀프레임","layered":"레이어드","symmetrical":"대칭"}
KO_R={"square":"정사각","portrait":"세로","tall":"긴세로","landscape":"가로","wide":"와이드","pano":"파노라마"}

def ratio_bucket(wh):
    if not wh or not wh[0] or not wh[1]: return None
    r = wh[0]/wh[1]
    return "tall" if r<0.66 else "portrait" if r<0.9 else "square" if r<=1.1 else "landscape" if r<=1.5 else "wide" if r<=2.1 else "pano"

def load(brand_dir):
    p = os.path.join(brand_dir, "_tags.json")
    if not os.path.exists(p): return []
    recs = [r for r in json.load(open(p, encoding="utf-8")) if (r.get("subject") or [None])[0] != "nonphoto"]
    for r in recs:                       # ratio 없으면 이미지에서 즉석 계산 (오프라인)
        if not r.get("ratio") and Image and r.get("path") and os.path.exists(r["path"]):
            try: r["ratio"] = ratio_bucket(Image.open(r["path"]).size)
            except Exception: pass
    return recs

def ps(r): s = r.get("subject") or []; return s[0] if s else "?"
def keyfin(r): f=[x for x in (r.get("finish") or []) if x!="natural"]; return f[0] if f else "natural"

def rules(recs):
    """피사체별 다른 축의 최대 집중도 → (피사체, 축, 값, share) 중 강한 것."""
    out=[]
    for s,_ in Counter(ps(r) for r in recs).most_common():
        sub=[r for r in recs if s in (r.get("subject") or [])]
        if len(sub)<3: continue
        best=None
        for axis,ko in (("composition",KO_C),("ratio",KO_R),("finish",KO_F),("tone",KO_T)):
            c = Counter(keyfin(r) for r in sub) if axis=="finish" else Counter(r.get(axis) for r in sub if r.get(axis))
            if not c: continue
            v,cnt=c.most_common(1)[0]; sh=round(100*cnt/len(sub))
            if not best or sh>best[3]: best=(s,axis,v,sh,ko)
        if best: out.append(best)
    return sorted(out, key=lambda x:-x[3])

def detail(brand_dir):
    recs=load(brand_dir); n=len(recs)
    if not n: print(f"(_tags.json 없음/빈: {brand_dir})"); return
    print(f"=== {os.path.basename(brand_dir)} 사진 체계 ({n}장) ===")
    sig=Counter((ps(r),r.get("tone"),r.get("ratio")) for r in recs)
    print("① 아키타입:")
    for (s,t,rt),c in sig.most_common():
        if c<3: continue
        print(f"   {c:>2}  {KO_S.get(s,s)}·{KO_T.get(t,t)}·{KO_R.get(rt,rt)}")
    print("② 의도적 룰 (강한 순):")
    for s,axis,v,sh,ko in rules(recs)[:6]:
        mark="★" if sh>=60 else ""
        print(f"   {KO_S.get(s,s)} → {axis}={ko.get(v,v)} {sh}%{mark}")

def row(brand_dir):
    recs=load(brand_dir); n=len(recs)
    if n<4: return None
    tone=Counter(r.get("tone") for r in recs).most_common(1)[0][0]
    fin=Counter(keyfin(r) for r in recs).most_common(1)[0][0]
    rat=Counter(r.get("ratio") for r in recs if r.get("ratio")).most_common(1)
    rat=rat[0][0] if rat else "?"
    rl=rules(recs)
    top=rl[0] if rl else None
    rule=f"{KO_S.get(top[0],top[0])}→{top[4].get(top[2],top[2])}{top[3]}%" if top else "—"
    bw=round(100*sum(1 for r in recs if 'bw' in (r.get('finish') or []))/n)
    return (os.path.basename(brand_dir), n, KO_T.get(tone,tone), KO_F.get(fin,fin), KO_R.get(rat,rat), f"{bw}%", rule)


# ── 보고서 파일 생성 (copy.mjs 구조: 버전 무덮어쓰기 + 감사 사이드카 + claude CLI 서술) ──
def next_version(brand_dir, prefix="_report_v"):
    """기존 _report_v<NN>.md 스캔 → 다음 빈 번호 (덮어쓰기 없음)."""
    mx = 0
    if os.path.isdir(brand_dir):
        for f in os.listdir(brand_dir):
            m = re.match(rf"^{re.escape(prefix)}(\d+)\.md$", f)
            if m: mx = max(mx, int(m.group(1)))
    v = f"{mx+1:02d}"
    return f"v{v}", os.path.join(brand_dir, f"{prefix}{v}.md"), os.path.join(brand_dir, f"{prefix}{v}.prompt.md")

from claude_cli import run_claude   # 구독 빌링 claude CLI — image-tagger·brandguide 와 공유 (복붙 제거)

def findings_md(recs):
    """계산된 findings (아키타입·룰·문법) 를 마크다운으로."""
    out = ["### 아키타입 (반복 시그니처 = 사진 유형)"]
    sig = Counter((ps(r), r.get("tone"), r.get("ratio")) for r in recs)
    for (s, t, rt), c in sig.most_common():
        if c < 3: continue
        out.append(f"- {c}장 · {KO_S.get(s,s)}·{KO_T.get(t,t)}·{KO_R.get(rt,rt)}")
    out.append("\n### 의도적 룰 (피사체별 고정축 — ★≥60%)")
    for s, axis, v, sh, ko in rules(recs):
        out.append(f"- {KO_S.get(s,s)} → {axis}={ko.get(v,v)} {sh}%{'★' if sh>=60 else ''}")
    tf = Counter((r.get("tone"), keyfin(r)) for r in recs)
    out.append("\n### 조합 문법")
    out.append("- 톤×후보정: " + ", ".join(f"{KO_T.get(t,t)}+{KO_F.get(f,f)}×{c}" for (t, f), c in tf.most_common(5)))
    return "\n".join(out)

def generate_report(brand_dir, model="sonnet"):
    """브랜드 사진 디렉션 분석 보고서 파일 생성 (_report_v<NN>.md + .prompt.md 감사)."""
    recs = load(brand_dir); n = len(recs)
    brand = os.path.basename(brand_dir.rstrip("/"))
    if not n:
        print(f"  ⊘ {brand}: _tags.json 없음/빈"); return
    findings = findings_md(recs)
    prompt = (
        f"너는 브랜드 사진 디렉션을 분석하는 아트 디렉터다. 아래는 '{brand}' 웹사이트 사진 {n}장을 "
        f"6축(피사체·톤·후보정·구도·비율·웹보정)으로 분류해 *계산*한 결과다.\n\n{findings}\n\n"
        "이걸 근거로 한국어 보고서를 써라 (마크다운, 서론 없이 바로):\n"
        "## 사진 디렉션 체계\n2~3문장 — 어떤 사진 유형을 어떻게 연출·보정·배치하나.\n"
        "## 의도적으로 맞춘 것\n위 룰 중 의미 있는 것을 *해석*. 예: 'X는 항상 흑백 = 사람·이벤트 전용 스위치'. 수치 인용.\n"
        "## 본받을 점\n1~2개, 구체적으로.\n"
        "추측 금지 — 위 수치에 근거한 것만. 군더더기 없이."
    )
    narrative = run_claude(prompt, model)
    ver, md_path, prompt_path = next_version(brand_dir)
    head = f"# {brand} — 사진 디렉션 분석 ({ver})\n\n> photo-pattern 자동 생성 · {n}장 · 6축 분류 기반\n\n"
    if narrative:
        body = head + narrative + "\n\n---\n\n## 계산된 근거 (findings)\n\n" + findings + "\n"
        tag = "LLM 서술"
    else:
        body = head + "> (claude CLI 없음/실패 — 계산 findings 만)\n\n" + findings + "\n"
        tag = "findings만"
    open(md_path, "w", encoding="utf-8").write(body)
    open(prompt_path, "w", encoding="utf-8").write(f"<!-- photo-pattern report prompt · {brand} {ver} -->\n\n{prompt}\n")
    print(f"  ✓ {brand}: {os.path.basename(md_path)} ({tag})")


if __name__ == "__main__":
    args = sys.argv[1:]
    report = "--report" in args
    args = [a for a in args if a != "--report"]
    if args and args[0] == "--all":
        root = os.path.expanduser(args[1]) if len(args) > 1 else os.path.expanduser("~/Pictures/imageRefs")
        if report:
            print("보고서 생성 (브랜드별 _report_v<NN>.md) — claude CLI, 구독 빌링")
            for b in sorted(os.listdir(root)):
                d = os.path.join(root, b)
                if os.path.isdir(d) and os.path.exists(os.path.join(d, "_tags.json")):
                    generate_report(d)
        else:
            rows = []
            for b in sorted(os.listdir(root)):
                d = os.path.join(root, b)
                if os.path.isdir(d):
                    r = row(d)
                    if r: rows.append(r)
            print(f"=== 브랜드 사진 문법 비교 ({len(rows)}개) ===")
            print(f"{'브랜드':14}{'n':>4}  {'지배톤':6}{'주후보정':8}{'기본비율':7}{'흑백%':6}가장강한룰")
            for nm, n, t, f, rt, bw, rule in rows:
                print(f"{nm:14}{n:>4}  {t:6}{f:8}{rt:7}{bw:6}{rule}")
    elif args:
        d = os.path.expanduser(args[0])
        generate_report(d) if report else detail(d)
    else:
        print("usage: photo-pattern.py <brand_dir> [--report] | --all [refs_root] [--report]")
