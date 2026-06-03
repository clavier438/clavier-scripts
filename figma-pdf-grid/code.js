// PDF Grid — webExporter PDF 페이지 PNG 들을 Figma 캔버스에 그리드로 배치
// UI(ui.html)에서 받은 이미지 bytes → figma.createImage → rectangle.fills(IMAGE) → N열 그리드
// reference: https://www.figma.com/plugin-docs/api/properties/figma-createimage/
//            https://www.figma.com/plugin-docs/api/Image/ (getSizeAsync)

figma.showUI(__html__, { width: 340, height: 460 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "place-grid") return;

  const images = msg.images || [];
  const cols = Math.max(1, msg.cols || 5);
  const gap = Math.max(0, msg.gap == null ? 40 : msg.gap);
  const maxWidth = msg.maxWidth || 0; // 0 = 원본 크기 유지

  if (!images.length) {
    figma.notify("선택된 이미지가 없습니다");
    return;
  }

  // 1) 각 이미지 → createImage → rectangle. 실제 px 크기를 getSizeAsync 로 얻어 비율 유지.
  const placed = [];
  const nodes = [];
  for (const img of images) {
    let image;
    try {
      image = figma.createImage(img.bytes);
    } catch (e) {
      figma.notify("이미지 로드 실패: " + img.name);
      continue;
    }
    let size;
    try {
      size = await image.getSizeAsync();
    } catch (e) {
      size = { width: 1000, height: 1414 }; // fallback A4 비율
    }
    const scale = maxWidth > 0 && size.width > maxWidth ? maxWidth / size.width : 1;
    const w = Math.max(1, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));

    const rect = figma.createRectangle();
    rect.resize(w, h);
    rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
    rect.name = img.name;
    placed.push({ rect, w, h });
    nodes.push(rect);
  }

  if (!nodes.length) {
    figma.notify("배치할 이미지가 없습니다");
    return;
  }

  // 2) 그리드 좌표 — 뷰포트 중앙 기준, N열. 행 높이는 그 행에서 가장 높은 이미지에 맞춤.
  const startX = Math.round(figma.viewport.center.x);
  const startY = Math.round(figma.viewport.center.y);
  let cx = startX, cy = startY, rowH = 0, c = 0;
  for (const p of placed) {
    p.rect.x = cx;
    p.rect.y = cy;
    cx += p.w + gap;
    rowH = Math.max(rowH, p.h);
    if (++c >= cols) {
      c = 0;
      cx = startX;
      cy += rowH + gap;
      rowH = 0;
    }
  }

  // 3) 그룹화 + 뷰 이동
  const group = figma.group(nodes, figma.currentPage);
  group.name = msg.groupName || "PDF Grid";
  figma.currentPage.selection = [group];
  figma.viewport.scrollAndZoomIntoView([group]);
  figma.notify(nodes.length + "장 그리드 배치 완료");
  figma.closePlugin();
};
