// PDF Grid — webExporter PDF 이미지를 Figma 캔버스에 그리드로 배치
// 두 모드:
//   ① place-grid       — 파일 선택(bytes) → figma.createImage
//   ② place-grid-urls  — URL 자동로드 → figma.createImageAsync (로컬 서버 webp). 사용자 파일선택 생략.
// reference: https://www.figma.com/plugin-docs/api/properties/figma-createimage/
//            https://www.figma.com/plugin-docs/api/properties/figma-createimageasync/
//            https://developers.figma.com/docs/plugins/making-network-requests/ (networkAccess allowedDomains)

figma.showUI(__html__, { width: 360, height: 560 });

// 모드별로 Image 객체 목록을 만든다 (이후 그리드 로직은 공통)
async function buildImageRefs(msg) {
  const refs = [];
  if (msg.type === "place-grid") {
    for (const img of msg.images || []) {
      try { refs.push({ name: img.name, image: figma.createImage(img.bytes) }); }
      catch (e) { figma.notify("로드 실패: " + img.name); }
    }
  } else if (msg.type === "place-grid-urls") {
    for (const u of msg.urls || []) {
      try { refs.push({ name: u.name, image: await figma.createImageAsync(u.url) }); }
      catch (e) { figma.notify("URL 로드 실패: " + (u.name || u.url)); }
    }
  }
  return refs;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "place-grid" && msg.type !== "place-grid-urls") return;
  const cols = Math.max(1, msg.cols || 5);
  const gap = Math.max(0, msg.gap == null ? 40 : msg.gap);
  const maxWidth = msg.maxWidth || 0; // 0 = 원본 크기 유지

  const refs = await buildImageRefs(msg);
  if (!refs.length) { figma.notify("이미지가 없습니다"); return; }

  // 각 이미지 → rectangle (실제 px 를 getSizeAsync 로 얻어 비율 유지)
  const placed = [], nodes = [];
  for (const ref of refs) {
    let size;
    try { size = await ref.image.getSizeAsync(); }
    catch (e) { size = { width: 1000, height: 1414 }; }
    const scale = maxWidth > 0 && size.width > maxWidth ? maxWidth / size.width : 1;
    const w = Math.max(1, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));
    const rect = figma.createRectangle();
    rect.resize(w, h);
    rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: ref.image.hash }];
    rect.name = ref.name;
    placed.push({ rect, w, h });
    nodes.push(rect);
  }
  if (!nodes.length) { figma.notify("배치할 이미지가 없습니다"); return; }

  // N열 그리드 — 뷰포트 중앙 기준, 행 높이는 그 행에서 가장 높은 이미지에 맞춤
  const startX = Math.round(figma.viewport.center.x);
  const startY = Math.round(figma.viewport.center.y);
  let cx = startX, cy = startY, rowH = 0, c = 0;
  for (const p of placed) {
    p.rect.x = cx; p.rect.y = cy;
    cx += p.w + gap; rowH = Math.max(rowH, p.h);
    if (++c >= cols) { c = 0; cx = startX; cy += rowH + gap; rowH = 0; }
  }

  const group = figma.group(nodes, figma.currentPage);
  group.name = msg.groupName || "PDF Grid";
  figma.currentPage.selection = [group];
  figma.viewport.scrollAndZoomIntoView([group]);
  figma.notify(nodes.length + "장 그리드 배치 완료");
  figma.closePlugin();
};
