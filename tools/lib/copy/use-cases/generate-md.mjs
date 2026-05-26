// Use case — 자유 지시로 .md 카피 생성 (copyMd 의 코어).
// 의존: domain 전부 + claude-runner. Airtable 어댑터 의존 0.

import { writeFileSync } from "fs";
import { loadAllLayers } from "../domain/layer-loader.mjs";
import { loadInputs } from "../domain/inputs-loader.mjs";
import { layersAsXml, sectionsAsXml, wrapXml, inputsAsContextBody } from "../domain/prompt-builder.mjs";
import { runWithPaths, resolveOutputPaths, stripCodeFence } from "../adapters/claude-runner.mjs";

const SYSTEM_HEAD = `너는 호텔/브랜드 카피·IA 파트너다. 사용자의 짧은 지시를 받아, 주어진 context (inputs) 와 Layer 원칙 위에서 **마크다운 형식**으로 카피를 생성·수정한다.`;

const SYSTEM_RULES = `규칙:
- 출력은 **순수 마크다운**. 코드 펜스(\`\`\`) 절대 X. 설명·서두 절대 X.
- 사용자가 template 을 박아두었으면 그 구조·순서를 정확히 따르고, 빈 자리 (빈 줄, [?], <!-- copy --> 같은 마커) 를 채운다.
- template 없이 inputs 만 있으면, inputs 의 IA·brief 를 따라 적절한 섹션 구조 (## h2, ### h3) 로 카피를 짠다.
- Layer 1·2(·3) 의 톤·금기·도구를 정확히 따른다.
- 형용사·자기자랑·약속·권유 금지. 사실·고유명사·동사로.`;

/**
 * @param {{folder, instruction, model, commonLayersDir, outputArg?}} args
 */
export async function generateMd({ folder, instruction, model, commonLayersDir, outputArg }) {
  const layers = loadAllLayers(folder, commonLayersDir);
  const contextFiles = loadInputs(folder);

  const systemPrompt = [
    SYSTEM_HEAD,
    "",
    layersAsXml(layers),
    "",
    SYSTEM_RULES,
  ].join("\n");

  const ctxBody = inputsAsContextBody(contextFiles);
  const userSections = [];
  if (ctxBody) userSections.push({ tag: "context", content: ctxBody });
  userSections.push({ tag: "instruction", content: instruction });
  const userPrompt = sectionsAsXml(userSections) +
    "\n\n지시를 따라 마크다운 카피를 생성·수정해. 응답은 순수 마크다운만 (``` 코드 펜스·설명·서두 절대 X).";

  const paths = resolveOutputPaths({ outputArg, outputDir: folder });

  const { claudeResult, mdPath, promptPath, version } = await runWithPaths({
    ...paths,
    folder,
    systemPrompt,
    userPrompt,
    model,
    layers,
    contextFiles,
    instruction,
  });

  // ── .md 응답 추출 (펜스 벗기기)
  const mdText = stripCodeFence(claudeResult.result);
  writeFileSync(mdPath, mdText + "\n");

  return { mdPath, promptPath, version, claudeResult };
}
