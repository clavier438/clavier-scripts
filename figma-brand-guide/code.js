// Brand Guide 생성 — 분석 폴더(_tags.json·_palette·webp)를 Figma 캔버스에 브랜드 스탠다드로 빌드.
// 섹션형 에디토리얼(Straightforward/Redo 템플릿 결): Cover · Color · Photography · Typography · Assets.
// reference: https://developers.figma.com/docs/plugins/api/properties/figma-createtext/ (createText/loadFontAsync,
//            createRectangle fills SOLID/GRADIENT_LINEAR, createFrame autolayout)
//            in-repo figma-pdf-grid/code.js (figma.createImage(bytes)→rect IMAGE fill)
// 이미지는 UI에서 webp→png 변환해 bytes 로 전달(Figma createImage 는 png/jpg/gif 만 지원).

figma.showUI(__html__, { width: 380, height: 520 });

const FONT = "Inter";
const W = (s) => ({ family: FONT, style: s });
const KO_T = { warm:"웜", cool:"쿨", neutral:"뉴트럴", muted:"뮤트", vivid:"비비드", monochrome:"모노", earthy:"어시", pastel:"파스텔" };
const KO_S = { person:"인물", interior:"실내", exterior:"실외", landscape:"풍경", architecture:"건축", product:"제품", food:"음식", detail:"디테일", still_life:"정물" };
const KO_F = { grain:"그레인", high_contrast:"고대비", faded:"페이드", bw:"흑백", high_key:"하이키", low_key:"로우키", sepia_film:"세피아필름", natural:"내추럴" };
const TONE_RGB = { warm:"#d9803f", cool:"#3f72d9", neutral:"#9a9a9a", muted:"#c9a94a", vivid:"#d94a4a", monochrome:"#6b6b6b", earthy:"#7e8f43", pastel:"#9a5fbf" };
const INK = "#141414", SUB = "#8a8a8a", LINE = "#ececec", ACCENT = "#cc3366";

function hx(h) {
  h = (h || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
}
const solid = (h) => [{ type: "SOLID", color: hx(h) }];

function text(chars, { size=14, style="Regular", color=INK, w=0, lh=0 } = {}) {
  const t = figma.createText();
  t.fontName = W(style);
  t.characters = String(chars == null ? "" : chars);
  t.fontSize = size;
  t.fills = solid(color);
  if (lh) t.lineHeight = { value: lh, unit: "PERCENT" };
  if (w) { t.resize(w, t.height); t.textAutoResize = "HEIGHT"; }
  return t;
}
function frame({ dir="VERTICAL", gap=0, padd=[0,0,0,0], w=0, fill=null, align="MIN", grow=false } = {}) {
  const f = figma.createFrame();
  f.layoutMode = dir;
  f.itemSpacing = gap;
  f.paddingTop = padd[0]; f.paddingRight = padd[1]; f.paddingBottom = padd[2]; f.paddingLeft = padd[3];
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = w ? "FIXED" : "AUTO";
  f.counterAxisAlignItems = align;
  if (w) f.resize(w, f.height);
  f.fills = fill ? solid(fill) : [];
  if (grow) f.layoutGrow = 1;
  return f;
}
function rect(w, h, fills) { const r = figma.createRectangle(); r.resize(w, h); r.fills = fills; r.cornerRadius = 6; return r; }

function imgTile(hash, w, h) {
  const r = figma.createRectangle(); r.resize(w, h); r.cornerRadius = 5;
  r.fills = hash ? [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }] : solid("#eee");
  return r;
}
function grid(hashes, cols, cw, ch, gap) {
  const g = frame({ dir: "VERTICAL", gap });
  for (let i = 0; i < hashes.length; i += cols) {
    const row = frame({ dir: "HORIZONTAL", gap });
    hashes.slice(i, i + cols).forEach(h => row.appendChild(imgTile(h, cw, ch)));
    g.appendChild(row);
  }
  return g;
}
function dist(tags, axis) {
  const c = {};
  tags.forEach(t => { const v = t[axis]; (Array.isArray(v) ? v : v ? [v] : []).forEach(x => c[x] = (c[x]||0)+1); });
  const n = tags.length || 1;
  return Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v]) => [k, Math.round(100*v/n)]);
}
function sectionHead(num, title) {
  const h = frame({ dir: "HORIZONTAL", gap: 18 });
  h.appendChild(text(num, { size: 12, style: "Semi Bold", color: ACCENT }));
  h.appendChild(text(title.toUpperCase(), { size: 13, style: "Semi Bold", color: INK }));
  return h;
}
function label(s) { return text(s, { size: 11, style: "Semi Bold", color: SUB }); }

async function build(msg) {
  await Promise.all(["Regular","Medium","Semi Bold","Bold"].map(s => figma.loadFontAsync(W(s))));
  const tags = msg.tags || [], palette = msg.palette || [], fonts = msg.fonts || [];
  const brand = msg.brand || "Brand", url = msg.url || "";
  const imgHash = {};
  for (const im of (msg.images || [])) {
    try { imgHash[im.name] = figma.createImage(new Uint8Array(im.bytes)).hash; } catch (e) {}
  }
  const fileTone = {}; tags.forEach(t => fileTone[t.file] = t);
  const pick = (pred, n) => tags.filter(pred).map(t => imgHash[t.file]).filter(Boolean).slice(0, n);

  const PAGE_W = 1280, PAD = 80, CONTENT_W = PAGE_W - PAD*2;
  const page = frame({ dir: "VERTICAL", gap: 0, w: PAGE_W, fill: "#ffffff" });

  // ── COVER (gradient hero + nav) ──
  const cover = frame({ dir: "HORIZONTAL", gap: 0, w: PAGE_W });
  const sidebar = frame({ dir: "VERTICAL", gap: 14, padd: [64,0,64,PAD], w: 300, align: "MIN" });
  sidebar.appendChild(text(brand, { size: 18, style: "Bold" }));
  sidebar.appendChild(text(url, { size: 11, color: SUB }));
  const nav = frame({ dir: "VERTICAL", gap: 9, padd: [28,0,0,0] });
  ["01 Color","02 Photography","03 Typography","04 Assets"].forEach(s => nav.appendChild(text(s, { size: 12, color: "#555" })));
  sidebar.appendChild(nav);
  cover.appendChild(sidebar);
  const hero = frame({ dir: "VERTICAL", gap: 0, grow: true, align: "MIN" });
  const grad = rect(CONTENT_W, 360, [{ type:"GRADIENT_LINEAR",
    gradientTransform: [[1,0,0],[0,1,0]],
    gradientStops: [{position:0,color:{...hx(ACCENT),a:1}},{position:1,color:{...hx(palette[3]?palette[3].hex:"#d7d4cb"),a:1}}] }]);
  grad.layoutGrow = 0;
  const heroWrap = frame({ dir:"VERTICAL", gap:0, w: CONTENT_W, padd:[64,0,0,0] });
  heroWrap.appendChild(grad);
  const title = frame({ dir:"VERTICAL", gap:14, padd:[40,0,72,0], w: CONTENT_W });
  title.appendChild(text("Visual Standards", { size: 13, style:"Semi Bold", color: ACCENT }));
  title.appendChild(text(brand, { size: 60, style: "Bold", lh: 100 }));
  title.appendChild(text(msg.essence || "관찰 기반 비주얼 스탠다드.", { size: 18, color: "#444", w: 620, lh: 150 }));
  heroWrap.appendChild(title);
  hero.appendChild(heroWrap);
  cover.appendChild(hero);
  page.appendChild(cover);

  // ── helper: 한 섹션 프레임 ──
  function section(num, ttl, buildContent) {
    const s = frame({ dir:"VERTICAL", gap:24, padd:[56,PAD,56,PAD], w: PAGE_W });
    s.appendChild(sectionHead(num, ttl));
    buildContent(s);
    const div = rect(PAGE_W, 1, solid(LINE)); // 구분선
    page.appendChild(s); page.appendChild(div);
  }

  // 01 COLOR
  section("01", "Color", (s) => {
    s.appendChild(text("UI는 무채로 빠지고 온기는 사진에. 유일 채색은 악센트.", { size: 19, color:"#333", w: 660, lh: 150 }));
    const chips = (arr) => {
      const row = frame({ dir:"HORIZONTAL", gap: 14 });
      arr.forEach(c => {
        const col = frame({ dir:"VERTICAL", gap: 8, w: 120 });
        col.appendChild(rect(120, 92, solid(c.hex)));
        col.appendChild(text(c.hex, { size: 11, color:"#333" }));
        if (c.label) col.appendChild(text(c.label, { size: 11, color: SUB }));
        row.appendChild(col);
      });
      return row;
    };
    s.appendChild(label("BRAND · 렌더 컬러"));
    s.appendChild(chips((palette || []).slice(0, 6)));
    const doms = {}; tags.forEach(t => (t.dominant_hex||[]).slice(0,1).forEach(h => doms[h]=(doms[h]||0)+1));
    const photoPal = Object.entries(doms).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([hex])=>({hex}));
    s.appendChild(label("PHOTOGRAPHY · 사진 지배색"));
    s.appendChild(chips(photoPal));
  });

  // 02 PHOTOGRAPHY
  section("02", "Photography · Art Direction", (s) => {
    s.appendChild(text(msg.photoLead || "공간은 따뜻한 자연소재, 이벤트는 거친 흑백 다큐.", { size: 19, color:"#333", w: 700, lh: 150 }));
    s.appendChild(label("톤 분포"));
    const bars = frame({ dir:"VERTICAL", gap: 7 });
    dist(tags, "tone").forEach(([k,p]) => {
      const r = frame({ dir:"HORIZONTAL", gap: 12, align:"CENTER" });
      r.appendChild(text(KO_T[k]||k, { size: 13, color:"#444", w: 60 }));
      r.appendChild(rect(Math.max(4, p*2.4), 12, solid(TONE_RGB[k]||"#bbb")));
      r.appendChild(text(p+"%", { size: 11, color: SUB }));
      bars.appendChild(r);
    });
    s.appendChild(bars);
    s.appendChild(label("후보정 · 피사체"));
    s.appendChild(text(dist(tags,"finish").map(([k,p])=>`${KO_F[k]||k} ${p}%`).join("   "), { size: 14, color:"#555", w: CONTENT_W }));
    s.appendChild(text(dist(tags,"subject").map(([k,p])=>`${KO_S[k]||k} ${p}%`).join("   "), { size: 14, color:"#555", w: CONTENT_W }));
    const warm = pick(t => ["warm","earthy"].includes(t.tone) && (t.subject||[]).some(x=>["interior","exterior","architecture"].includes(x)), 6);
    const mono = pick(t => t.tone==="monochrome" || (t.finish||[]).includes("bw"), 6);
    const cw = (CONTENT_W - 20) / 3;
    if (warm.length) { s.appendChild(label("— 웜 · 자연소재 공간")); s.appendChild(grid(warm, 3, cw, 190, 10)); }
    if (mono.length) { s.appendChild(label("— 흑백 · 이벤트 / 아트")); s.appendChild(grid(mono, 3, cw, 190, 10)); }
  });

  // 03 TYPOGRAPHY
  section("03", "Typography", (s) => {
    const fam = fonts.length ? fonts.join(" · ") : "—";
    s.appendChild(text("로드된 서체로 본 타이포 인상.", { size: 19, color:"#333", w: 660, lh: 150 }));
    s.appendChild(text("Aa Bb Cc 0123456789", { size: 40, style:"Medium" }));
    s.appendChild(text(fam + "  |  로드된 패밀리", { size: 12, color: SUB }));
  });

  // 04 ASSETS
  section("04", "Assets · Iconography", (s) => {
    const svgN = (msg.svgCount || 0);
    s.appendChild(text(svgN ? `SVG 에셋 ${svgN}개 수집됨.` : "독립 SVG 없음 — 아이콘은 웹폰트로 처리.", { size: 16, color:"#555", w: 660, lh: 150 }));
  });

  figma.currentPage.appendChild(page);
  page.x = figma.viewport.center.x - PAGE_W/2; page.y = figma.viewport.center.y - 400;
  figma.currentPage.selection = [page];
  figma.viewport.scrollAndZoomIntoView([page]);
  figma.notify(`${brand} 브랜드 가이드 생성 완료 (${tags.length} photos)`);
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "build") return;
  try { await build(msg); }
  catch (e) { figma.notify("오류: " + e.message); console.error(e); }
};
