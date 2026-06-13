#!/usr/bin/env python3
# clip_embed.py — 공유 CLIP(open_clip) 임베딩·zero-shot·클러스터 바퀴 (로컬·무료·API 0).
#
#   왜: open_clip 이 venv 에 깔려만 있고 어느 도구에도 안 물려 있었다. 시각 feature 가
#       도구마다 제각각(photo-cluster=색상그리드, image-tagger=비전 API). 이 lib 하나로
#       cluster·tag(zero-shot)·dedup·montage 가 같은 임베딩을 재사용한다 (reuse-first).
#
#   ref: https://github.com/mlfoundations/open_clip  (ViT-B-32 / pretrained=laion2b_s34b_b79k)
#   API: create_model_and_transforms / get_tokenizer / encode_image|text / L2 normalize / softmax
#   디바이스: Apple Silicon 이면 MPS 자동. 첫 호출 시 weights 다운로드(~600MB, 캐시됨).
#
#   numpy/torch/open_clip 은 webExporter/.venv 에 설치돼 있음 — img.py 가 그 파이썬을 자동 선택.

_M = _PRE = _TOK = _DEV = None
DEFAULT_MODEL = "ViT-B-32"
DEFAULT_PRETRAINED = "laion2b_s34b_b79k"


def available():
    """open_clip+torch import 가능한 환경인지 (아니면 호출부가 기존 경로로 폴백)."""
    try:
        import open_clip, torch  # noqa: F401
        return True
    except Exception:
        return False


def _load(model_name=DEFAULT_MODEL, pretrained=DEFAULT_PRETRAINED):
    global _M, _PRE, _TOK, _DEV
    if _M is None:
        import torch, open_clip
        _DEV = "mps" if torch.backends.mps.is_available() else "cpu"
        _M, _, _PRE = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
        _M.eval().to(_DEV)
        _TOK = open_clip.get_tokenizer(model_name)
    return _M, _PRE, _TOK, _DEV


def embed_images(paths, batch=32, progress=None):
    """paths → (valid_paths, Tensor[N,D] L2 정규화). 못 읽는 파일은 조용히 제외.
    progress(done, total) 콜백 선택."""
    import torch
    from PIL import Image
    m, pre, _, dev = _load()
    chunks, valid, buf, bp = [], [], [], []

    def _flush():
        if not buf:
            return
        with torch.no_grad():
            x = torch.stack(buf).to(dev)
            f = m.encode_image(x)
            f /= f.norm(dim=-1, keepdim=True)
        chunks.append(f.cpu())
        valid.extend(bp)
        buf.clear(); bp.clear()

    for i, p in enumerate(paths):
        try:
            buf.append(pre(Image.open(p).convert("RGB"))); bp.append(p)
        except Exception:
            continue
        if len(buf) >= batch:
            _flush()
        if progress and (i + 1) % 30 == 0:
            progress(i + 1, len(paths))
    _flush()
    return valid, (torch.cat(chunks) if chunks else torch.empty(0))


def embed_texts(texts):
    """텍스트 리스트 → Tensor[len,D] L2 정규화."""
    import torch
    m, _, tok, dev = _load()
    with torch.no_grad():
        f = m.encode_text(tok(texts).to(dev))
        f /= f.norm(dim=-1, keepdim=True)
    return f.cpu()


def zeroshot(img_feats, promptmap, thr=None):
    """이미지 임베딩[N,D] × {label: prompt} → 각 이미지의 best label.
    thr 주면 2위 확률>thr 일 때 [1위,2위] 리스트(멀티), 아니면 1위 문자열."""
    keys = list(promptmap)
    tf = embed_texts([promptmap[k] for k in keys])
    probs = (100.0 * img_feats @ tf.T).softmax(dim=-1)
    out = []
    for row in probs:
        order = row.argsort(descending=True)
        if thr is not None:
            sel = [keys[order[0]]]
            if len(keys) > 1 and row[order[1]].item() > thr:
                sel.append(keys[order[1]])
            out.append(sel)
        else:
            out.append(keys[order[0]])
    return out


def kmeans(feats, k, iters=30, seed=0):
    """정규화 임베딩[N,D] k-means (결정론 seed). → 각 이미지의 군집 인덱스 리스트.
    정규화 벡터라 유클리드 거리 ≈ 코사인."""
    import torch
    X = feats
    k = min(k, X.shape[0])
    g = torch.Generator().manual_seed(seed)
    c = X[torch.randperm(X.shape[0], generator=g)[:k]].clone()
    a = None
    for _ in range(iters):
        a = torch.cdist(X, c).argmin(dim=1)
        for j in range(k):
            mask = a == j
            if mask.any():
                c[j] = X[mask].mean(0)
    return a.tolist()
