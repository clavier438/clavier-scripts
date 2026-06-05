#!/usr/bin/env python3
# photo-pattern — 브랜드 사진의 '체계'를 드러낸다 (개별 태그가 아니라 *유형 구조*·*의도적 일관성*).
# image-tagger 산출 _tags.json 을 읽어 아키타입 + 피사체별 고정축(룰) + 조합 문법을 계산. 오프라인·토큰 0.
#   photo-pattern.py <brand_dir>         # 한 브랜드 상세
#   photo-pattern.py --all <refs_root>   # 전 브랜드 비교표
import json, os, sys
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

if __name__ == "__main__":
    args=sys.argv[1:]
    if args and args[0]=="--all":
        root=os.path.expanduser(args[1]) if len(args)>1 else os.path.expanduser("~/Pictures/imageRefs")
        rows=[]
        for b in sorted(os.listdir(root)):
            d=os.path.join(root,b)
            if os.path.isdir(d):
                r=row(d)
                if r: rows.append(r)
        print(f"=== 브랜드 사진 문법 비교 ({len(rows)}개) ===")
        print(f"{'브랜드':14}{'n':>4}  {'지배톤':6}{'주후보정':8}{'기본비율':7}{'흑백%':6}가장강한룰")
        for nm,n,t,f,rt,bw,rule in rows:
            print(f"{nm:14}{n:>4}  {t:6}{f:8}{rt:7}{bw:6}{rule}")
    elif args:
        detail(os.path.expanduser(args[0]))
    else:
        print("usage: photo-pattern.py <brand_dir> | --all [refs_root]")
