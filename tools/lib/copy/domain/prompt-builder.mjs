// Domain — system / user 프롬프트 조립.
// XML 태그 wrapping + layer/inputs 직렬화. 외부 무의존.

export function wrapXml(tag, content) {
  return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Layer 1·2·3 을 XML 블록으로 직렬화 (system 슬롯용).
 * 누락된 레이어는 생략.
 */
export function layersAsXml(layers) {
  const parts = [];
  if (layers?.layer1) parts.push(wrapXml("layer1_core", layers.layer1.content));
  if (layers?.layer2) parts.push(wrapXml("layer2_brand", layers.layer2.content));
  if (layers?.layer3) parts.push(wrapXml("layer3_section", layers.layer3.content));
  return parts.join("\n\n");
}

/**
 * 임의의 라벨된 섹션들을 직렬화 (user 슬롯용).
 * @param {Array<{tag, content}>} sections
 */
export function sectionsAsXml(sections) {
  return sections
    .filter(s => s && s.content != null && s.content !== "")
    .map(s => wrapXml(s.tag, s.content))
    .join("\n\n");
}

/**
 * inputs 파일 묶음을 context 블록 본문으로.
 * 각 파일 = "## filename\n\n{content}", 파일 간 "---" 구분.
 * @returns {string|null}  inputs 가 비면 null
 */
export function inputsAsContextBody(inputs) {
  if (!inputs || inputs.length === 0) return null;
  return inputs.map(f => `## ${f.name}\n\n${f.content}`).join("\n\n---\n\n");
}
