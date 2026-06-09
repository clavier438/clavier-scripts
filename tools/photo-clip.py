#!/usr/bin/env python3
# photo-clip — 로컬 CLIP 으로 사진을 (1) 피사체/씬 멀티라벨 태깅, (2) 아트디렉션 컨셉 배정.
#   고급 AI(claude) 안 씀 — 로컬 ViT-B-32, claude 토큰 0. 이미지 임베딩 1회 캐시 후 둘 다 재사용.
#
#   왜: image-tagger 는 사진마다 claude 비전(토큰)으로 피사체를 분류한다. 계정 덤프 규모엔 폭발.
#       피사체/씬 인식은 *기계적* 이라 로컬 CLIP zero-shot 으로 충분 — open-vocab 라벨, 토큰 0.
#       지능(컨셉 언어 작명·디렉션 역추적)은 사람/claude 가 몽타주를 보고, 그 컨셉을 텍스트
#       프롬프트로 받아 CLIP 이 전수 배정한다(경계는 지능, 채움은 기계).
#
#   reference (zero-shot · encode_image/encode_text · 정규화 후 img@txt.T 코사인):
#     https://github.com/mlfoundations/open_clip
#     https://pypi.org/project/open-clip-torch/
#
#   사용:
#     photo-clip.py embed    <folder> --out <dir>                         # 임베딩 캐시(clip_embed.pt)
#     photo-clip.py subjects <folder> --out <dir> --labels labels.json    # 멀티라벨 피사체/씬 태그
#     photo-clip.py concepts <folder> --out <dir> --concepts concepts.json --per 50  # 컨셉별 top-N 배정
#   (subjects/concepts 는 임베딩 캐시 없으면 자동 생성)
import os, sys, glob, json, argparse, shutil
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "lib"))
try:
    import freshness  # noqa: F401
except ImportError:
    pass
from image_formats import PHOTO_EXTS, register_heif
from PIL import Image
register_heif()

MODEL_NAME = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"     # open_clip 표준 체크포인트 (512-d)
IMAGE_EXTS = PHOTO_EXTS


def _device(torch):
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _load_model():
    import torch, open_clip
    dev = _device(torch)
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    model = model.to(dev).eval()
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    return torch, model, preprocess, tokenizer, dev


def collect(src):
    return sorted(f for f in glob.glob(os.path.join(src, "**", "*"), recursive=True)
                  if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
                  and not os.path.basename(f).startswith("."))


def embed_folder(src, out, batch=32):
    """폴더 전 이미지 → L2 정규화 512-d 임베딩. {basename: tensor} 캐시(clip_embed.pt) 저장·반환."""
    import torch
    cache = os.path.join(out, "clip_embed.pt")
    if os.path.exists(cache):
        data = torch.load(cache)
        return data["names"], data["emb"]
    torch_, model, preprocess, _, dev = _load_model()
    imgs = collect(src)
    print(f"[photo-clip] {len(imgs)}장 임베딩 ({MODEL_NAME}/{PRETRAINED}, {dev})")
    names, vecs, buf, bnames = [], [], [], []

    def flush():
        if not buf:
            return
        x = torch.stack(buf).to(dev)
        with torch.no_grad():
            f = model.encode_image(x).float()
            f /= f.norm(dim=-1, keepdim=True)
        vecs.append(f.cpu()); names.extend(bnames)
        buf.clear(); bnames.clear()

    for i, p in enumerate(imgs):
        try:
            im = Image.open(p).convert("RGB")
        except Exception:
            continue
        buf.append(preprocess(im)); bnames.append(os.path.basename(p))
        if len(buf) >= batch:
            flush()
            if (i + 1) % 200 == 0:
                print(f"  …{i+1}/{len(imgs)}")
    flush()
    emb = torch.cat(vecs) if vecs else torch.empty(0, 512)
    os.makedirs(out, exist_ok=True)
    torch.save({"names": names, "emb": emb}, cache)
    print(f"  → {len(names)}장 임베딩 → {cache}")
    return names, emb


def _text_emb(prompts):
    """프롬프트 리스트 → L2 정규화 텍스트 임베딩 (행=프롬프트)."""
    torch_, model, _, tokenizer, dev = _load_model()
    import torch
    tok = tokenizer(prompts).to(dev)
    with torch.no_grad():
        t = model.encode_text(tok).float()
        t /= t.norm(dim=-1, keepdim=True)
    return t.cpu()


def cmd_subjects(a):
    import torch
    names, emb = embed_folder(a.folder, a.out)
    labels = json.load(open(os.path.expanduser(a.labels), encoding="utf-8"))
    # labels.json = [{"key":"building","prompt":"a photograph of a building exterior"}, ...]
    prompts = [l["prompt"] for l in labels]
    keys = [l["key"] for l in labels]
    txt = _text_emb(prompts)
    sims = emb @ txt.T                       # (N, L) 코사인
    records = []
    for i, nm in enumerate(names):
        row = sims[i]
        # 멀티라벨: 최고점 대비 thresh 이내 + 절대 하한
        top = float(row.max())
        picks = [(keys[j], round(float(row[j]), 4)) for j in range(len(keys))
                 if float(row[j]) >= max(a.min_score, top - a.margin)]
        picks.sort(key=lambda x: -x[1])
        records.append({"file": nm, "subjects": [k for k, _ in picks[:a.max_labels]],
                        "scores": dict(picks[:a.max_labels])})
    os.makedirs(a.out, exist_ok=True)
    json.dump(records, open(os.path.join(a.out, "_subjects.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    # 분포 집계
    from collections import Counter
    c = Counter(s for r in records for s in r["subjects"])
    print(f"\n피사체 분포 (top): " + ", ".join(f"{k} {v}" for k, v in c.most_common(12)))
    print(f"→ _subjects.json ({len(records)}장)")


def cmd_concepts(a):
    import torch
    names, emb = embed_folder(a.folder, a.out)
    concepts = json.load(open(os.path.expanduser(a.concepts), encoding="utf-8"))
    # concepts.json = [{"id":"still_life","ko":"정물 스팟라이트","prompt":"a dark still life ..."}, ...]
    prompts = [c["prompt"] for c in concepts]
    txt = _text_emb(prompts)
    sims = emb @ txt.T                        # (N, K)
    assign = sims.argmax(dim=1).tolist()      # 각 이미지 → 최고 컨셉
    groups = {i: [] for i in range(len(concepts))}
    for idx, ci in enumerate(assign):
        groups[ci].append((idx, float(sims[idx, ci])))
    src = os.path.abspath(os.path.expanduser(a.folder))
    smp_root = os.path.join(a.out, "concept_samples")
    os.makedirs(smp_root, exist_ok=True)
    manifest = {"concepts": [], "params": {"per": a.per, "model": MODEL_NAME}}
    src_files = {os.path.basename(p): p for p in collect(src)}
    print(f"[concepts] {len(concepts)}개 컨셉, {len(names)}장 배정")
    for ci, c in enumerate(concepts):
        mem = sorted(groups[ci], key=lambda x: -x[1])           # 점수순
        reps = mem[:a.per]
        cdir = os.path.join(smp_root, f"{ci:02d}_{c['id']}")
        os.makedirs(cdir, exist_ok=True)
        rep_files = []
        for idx, sc in reps:
            nm = names[idx]; sp = src_files.get(nm)
            if sp:
                shutil.copy2(sp, os.path.join(cdir, nm)); rep_files.append(nm)
        manifest["concepts"].append({"id": c["id"], "ko": c.get("ko", c["id"]),
                                     "size": len(mem), "samples": rep_files,
                                     "dir": f"concept_samples/{ci:02d}_{c['id']}"})
        print(f"  {c.get('ko', c['id']):16} 배정 {len(mem):4}장 → 대표 {len(rep_files)}")
    json.dump(manifest, open(os.path.join(a.out, "_concepts.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"→ _concepts.json + concept_samples/")


def main():
    ap = argparse.ArgumentParser(description="로컬 CLIP 피사체 태깅 / 컨셉 배정 (claude 0)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pe = sub.add_parser("embed"); pe.add_argument("folder"); pe.add_argument("--out", required=True)
    ps = sub.add_parser("subjects")
    ps.add_argument("folder"); ps.add_argument("--out", required=True)
    ps.add_argument("--labels", required=True)
    ps.add_argument("--min-score", type=float, default=0.20)
    ps.add_argument("--margin", type=float, default=0.03, help="최고점 대비 이 이내면 같이 라벨")
    ps.add_argument("--max-labels", type=int, default=3)
    pc = sub.add_parser("concepts")
    pc.add_argument("folder"); pc.add_argument("--out", required=True)
    pc.add_argument("--concepts", required=True)
    pc.add_argument("--per", type=int, default=50)
    a = ap.parse_args()
    if a.cmd == "embed":
        embed_folder(a.folder, a.out)
    elif a.cmd == "subjects":
        cmd_subjects(a)
    elif a.cmd == "concepts":
        cmd_concepts(a)


if __name__ == "__main__":
    main()
