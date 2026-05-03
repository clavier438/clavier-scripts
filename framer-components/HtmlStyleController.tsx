// HTML 태그 스타일 일괄 컨트롤러 — children wrap + scoped CSS injection
// 자주 쓰는 5개 (h1/h2/h3/p/li) 는 enum preset, 나머지는 JSON override.
// showReference=true 면 캔버스에서 모든 preset 비교 카드 (디자인 가이드)
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useId, useMemo, type CSSProperties, type ReactNode } from "react"

// ─── Preset 정의 ──────────────────────────────────────────────────────────────
//
// 각 태그마다 4개 + Custom. 디자인 의도 라벨로 명명 — 단순 size/weight 가 아닌
// "어떤 분위기" 가 즉시 전달되도록.

type PresetMap = Record<string, CSSProperties>

const H_PRESETS: Record<"h1" | "h2" | "h3", PresetMap> = {
    h1: {
        Editorial: {
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: 16,
            letterSpacing: "-0.02em",
        },
        Display: {
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.05,
            marginBottom: 24,
            letterSpacing: "-0.04em",
        },
        Refined: {
            fontSize: 40,
            fontWeight: 400,
            lineHeight: 1.15,
            marginBottom: 20,
            letterSpacing: "0",
            fontStyle: "italic",
        },
        Compact: {
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.2,
            marginBottom: 12,
            letterSpacing: "-0.01em",
        },
    },
    h2: {
        Editorial: {
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1.2,
            marginTop: 32,
            marginBottom: 12,
            letterSpacing: "-0.015em",
        },
        Display: {
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1.15,
            marginTop: 40,
            marginBottom: 16,
            letterSpacing: "-0.025em",
        },
        Refined: {
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.25,
            marginTop: 32,
            marginBottom: 14,
            fontStyle: "italic",
        },
        Compact: {
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.3,
            marginTop: 24,
            marginBottom: 10,
        },
    },
    h3: {
        Editorial: {
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.3,
            marginTop: 24,
            marginBottom: 10,
        },
        Display: {
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.25,
            marginTop: 28,
            marginBottom: 12,
        },
        Refined: {
            fontSize: 20,
            fontWeight: 500,
            lineHeight: 1.35,
            marginTop: 24,
            marginBottom: 10,
            fontStyle: "italic",
        },
        Compact: {
            fontSize: 17,
            fontWeight: 700,
            lineHeight: 1.4,
            marginTop: 20,
            marginBottom: 8,
        },
    },
}

const P_PRESETS: PresetMap = {
    Reading: { fontSize: 17, lineHeight: 1.7, marginBottom: 16, fontWeight: 400 },
    Editorial: { fontSize: 16, lineHeight: 1.75, marginBottom: 18, fontWeight: 400 },
    Compact: { fontSize: 15, lineHeight: 1.55, marginBottom: 12, fontWeight: 400 },
    Spacious: { fontSize: 18, lineHeight: 1.85, marginBottom: 24, fontWeight: 400 },
}

const LI_PRESETS: PresetMap = {
    Standard: { fontSize: 16, lineHeight: 1.6, marginBottom: 6, paddingLeft: 0 },
    Spacious: { fontSize: 17, lineHeight: 1.7, marginBottom: 10, paddingLeft: 4 },
    Compact: { fontSize: 15, lineHeight: 1.5, marginBottom: 4, paddingLeft: 0 },
    Editorial: {
        fontSize: 16,
        lineHeight: 1.75,
        marginBottom: 8,
        paddingLeft: 8,
    },
}

const PRESET_KEYS = {
    h1: ["Editorial", "Display", "Refined", "Compact", "Custom"],
    h2: ["Editorial", "Display", "Refined", "Compact", "Custom"],
    h3: ["Editorial", "Display", "Refined", "Compact", "Custom"],
    p: ["Reading", "Editorial", "Compact", "Spacious", "Custom"],
    li: ["Standard", "Spacious", "Compact", "Editorial", "Custom"],
} as const

// ─── 따옴표 (q tag) preset ────────────────────────────────────────────────────
//
// CSS content::before/::after 로 따옴표 글자 자체를 변경. 한국어/영문/그래픽 분리.

const QUOTE_PRESETS: Record<string, { open: string; close: string }> = {
    English: { open: '"', close: '"' },
    Korean: { open: "「", close: "」" },
    French: { open: "« ", close: " »" },
    Curly: { open: "“", close: "”" }, // “ ”
    Single: { open: "‘", close: "’" }, // ‘ ’
    Angle: { open: "‹ ", close: " ›" },
    None: { open: "", close: "" },
}

// ─── CSS 직렬화 ───────────────────────────────────────────────────────────────
//
// React style object → CSS 문자열. camelCase → kebab-case. 숫자 → px (단위 자동).

const UNITLESS = new Set([
    "fontWeight",
    "lineHeight",
    "opacity",
    "zIndex",
    "flexGrow",
    "flexShrink",
    "order",
])

function toKebab(s: string): string {
    return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())
}

function styleObjectToCss(obj: CSSProperties): string {
    return Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => {
            const val =
                typeof v === "number" && !UNITLESS.has(k) ? `${v}px` : String(v)
            return `${toKebab(k)}: ${val};`
        })
        .join(" ")
}

// ─── CSS 빌드 ─────────────────────────────────────────────────────────────────

interface BuildArgs {
    scope: string
    h1Preset: string
    h1Custom: string
    h2Preset: string
    h2Custom: string
    h3Preset: string
    h3Custom: string
    pPreset: string
    pCustom: string
    liPreset: string
    liCustom: string
    quoteStyle: string
    quoteCustomOpen: string
    quoteCustomClose: string
    overrideJson: string
    inheritColor: boolean
    bodyColor: string
    linkColor: string
    linkUnderline: "always" | "hover" | "never"
}

function safeStyleString(s: string): string {
    // 사용자가 직접 입력하는 CSS — `}` 또는 `<` 차단해서 escape
    return s.replace(/[<>]/g, "").replace(/\}/g, "")
}

function buildScopedCss(args: BuildArgs): string {
    const {
        scope,
        h1Preset,
        h1Custom,
        h2Preset,
        h2Custom,
        h3Preset,
        h3Custom,
        pPreset,
        pCustom,
        liPreset,
        liCustom,
        quoteStyle,
        quoteCustomOpen,
        quoteCustomClose,
        overrideJson,
        inheritColor,
        bodyColor,
        linkColor,
        linkUnderline,
    } = args

    const parts: string[] = []

    const pushTagBlock = (
        tag: string,
        preset: string,
        custom: string,
        presetMap: PresetMap
    ) => {
        if (preset === "Custom") {
            const safe = safeStyleString(custom).trim()
            if (safe) parts.push(`${scope} ${tag} { ${safe} }`)
            return
        }
        const styles = presetMap[preset]
        if (!styles) return
        parts.push(`${scope} ${tag} { ${styleObjectToCss(styles)} }`)
    }

    pushTagBlock("h1", h1Preset, h1Custom, H_PRESETS.h1)
    pushTagBlock("h2", h2Preset, h2Custom, H_PRESETS.h2)
    pushTagBlock("h3", h3Preset, h3Custom, H_PRESETS.h3)
    pushTagBlock("p", pPreset, pCustom, P_PRESETS)
    pushTagBlock("li", liPreset, liCustom, LI_PRESETS)

    // 색상
    if (inheritColor && bodyColor) {
        parts.push(
            `${scope}, ${scope} h1, ${scope} h2, ${scope} h3, ${scope} h4, ${scope} h5, ${scope} h6, ${scope} p, ${scope} li, ${scope} blockquote, ${scope} td, ${scope} th { color: ${bodyColor}; }`
        )
    }

    // 링크
    if (linkColor) {
        const decoration =
            linkUnderline === "always"
                ? "underline"
                : linkUnderline === "hover"
                  ? "none"
                  : "none"
        parts.push(`${scope} a { color: ${linkColor}; text-decoration: ${decoration}; }`)
        if (linkUnderline === "hover") {
            parts.push(`${scope} a:hover { text-decoration: underline; }`)
        }
    }

    // 따옴표
    const q = QUOTE_PRESETS[quoteStyle]
    let qOpen = q?.open ?? ""
    let qClose = q?.close ?? ""
    if (quoteStyle === "Custom") {
        qOpen = quoteCustomOpen
        qClose = quoteCustomClose
    }
    if (qOpen || qClose) {
        const esc = (s: string) =>
            JSON.stringify(s).replace(/^"|"$/g, "") // CSS 문자열 안 안전
        parts.push(`${scope} q::before { content: "${esc(qOpen)}"; }`)
        parts.push(`${scope} q::after { content: "${esc(qClose)}"; }`)
        // blockquote 도 옵션으로 적용
        parts.push(
            `${scope} blockquote::before { content: "${esc(qOpen)}"; opacity: 0.4; margin-right: 0.2em; font-size: 1.5em; line-height: 0; vertical-align: -0.4em; }`
        )
    }

    // JSON Override — 가장 마지막에 추가 (우선순위 최상)
    try {
        const obj = JSON.parse(overrideJson || "{}")
        if (obj && typeof obj === "object") {
            for (const [tag, decl] of Object.entries(obj)) {
                if (typeof decl !== "object" || decl === null) continue
                const css = styleObjectToCss(decl as CSSProperties)
                if (css) parts.push(`${scope} ${tag} { ${css} }`)
            }
        }
    } catch {
        // JSON parse fail → silent skip (사용자가 입력 중일 수 있음)
    }

    return parts.join("\n")
}

// ─── Reference 패널 (showReference=true 일 때 캔버스 표시) ────────────────────
//
// 한 화면에 모든 태그의 현재 적용된 preset + 다른 옵션 4개를 비교 카드.

function ReferencePanel({
    bodyColor,
    presetSelections,
}: {
    bodyColor: string
    presetSelections: { tag: string; current: string; presets: PresetMap }[]
}) {
    return (
        <div
            style={{
                fontFamily: "-apple-system, system-ui, sans-serif",
                color: bodyColor || "#222",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 32,
                background: "#fafaf9",
                borderRadius: 12,
                overflow: "auto",
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
            }}
        >
            <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    HTML Style Reference
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
                    현재 적용된 preset 은 음영 — 옆 카드는 다른 옵션 비교용
                </p>
            </div>

            {presetSelections.map(({ tag, current, presets }) => (
                <div key={tag}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 8,
                        }}
                    >
                        <code
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                background: "#222",
                                color: "#fff",
                                borderRadius: 4,
                                fontFamily: "ui-monospace, monospace",
                            }}
                        >
                            &lt;{tag}&gt;
                        </code>
                        <span style={{ fontSize: 11, color: "#888" }}>
                            현재: <b>{current}</b>
                        </span>
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: 8,
                        }}
                    >
                        {Object.entries(presets).map(([name, styles]) => {
                            const isActive = name === current
                            return (
                                <div
                                    key={name}
                                    style={{
                                        padding: 12,
                                        borderRadius: 8,
                                        background: isActive ? "#fff" : "transparent",
                                        outline: isActive
                                            ? "2px solid #c4a882"
                                            : "1px solid #e5e1d8",
                                        outlineOffset: -1,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: 9,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            letterSpacing: ".08em",
                                            color: isActive ? "#c4a882" : "#aaa",
                                            marginBottom: 6,
                                        }}
                                    >
                                        {name}
                                    </div>
                                    <div style={{ ...styles, color: bodyColor || "#222" }}>
                                        Aa 가나 The quick
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

// ─── HtmlStyleController ──────────────────────────────────────────────────────

interface HtmlStyleControllerProps {
    children?: ReactNode
    showReference: boolean
    h1Preset: string
    h1Custom: string
    h2Preset: string
    h2Custom: string
    h3Preset: string
    h3Custom: string
    pPreset: string
    pCustom: string
    liPreset: string
    liCustom: string
    quoteStyle: string
    quoteCustomOpen: string
    quoteCustomClose: string
    overrideJson: string
    inheritColor: boolean
    bodyColor: string
    linkColor: string
    linkUnderline: "always" | "hover" | "never"
    style?: CSSProperties
}

/**
 * HTML Style Controller
 *
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 400
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
export default function HtmlStyleController({
    children,
    showReference = false,
    h1Preset = "Editorial",
    h1Custom = "",
    h2Preset = "Editorial",
    h2Custom = "",
    h3Preset = "Editorial",
    h3Custom = "",
    pPreset = "Reading",
    pCustom = "",
    liPreset = "Standard",
    liCustom = "",
    quoteStyle = "Curly",
    quoteCustomOpen = "",
    quoteCustomClose = "",
    overrideJson = "{\n  \n}",
    inheritColor = true,
    bodyColor = "#222222",
    linkColor = "#1a73e8",
    linkUnderline = "hover",
    style,
}: HtmlStyleControllerProps) {
    const isStatic = useIsStaticRenderer()
    const id = useId().replace(/[^a-zA-Z0-9]/g, "")
    const dataAttr = `bs${id}`
    const scope = `[data-brand-style="${dataAttr}"]`

    const css = useMemo(
        () =>
            buildScopedCss({
                scope,
                h1Preset,
                h1Custom,
                h2Preset,
                h2Custom,
                h3Preset,
                h3Custom,
                pPreset,
                pCustom,
                liPreset,
                liCustom,
                quoteStyle,
                quoteCustomOpen,
                quoteCustomClose,
                overrideJson,
                inheritColor,
                bodyColor,
                linkColor,
                linkUnderline,
            }),
        [
            scope,
            h1Preset,
            h1Custom,
            h2Preset,
            h2Custom,
            h3Preset,
            h3Custom,
            pPreset,
            pCustom,
            liPreset,
            liCustom,
            quoteStyle,
            quoteCustomOpen,
            quoteCustomClose,
            overrideJson,
            inheritColor,
            bodyColor,
            linkColor,
            linkUnderline,
        ]
    )

    // showReference: 캔버스에서 모든 옵션 비교 카드 (디자인 가이드 모드)
    if (showReference) {
        const presetSelections = [
            { tag: "h1", current: h1Preset, presets: H_PRESETS.h1 },
            { tag: "h2", current: h2Preset, presets: H_PRESETS.h2 },
            { tag: "h3", current: h3Preset, presets: H_PRESETS.h3 },
            { tag: "p", current: pPreset, presets: P_PRESETS },
            { tag: "li", current: liPreset, presets: LI_PRESETS },
        ]
        return (
            <div style={{ ...style, width: "100%", height: "100%" }}>
                <ReferencePanel
                    bodyColor={bodyColor}
                    presetSelections={presetSelections}
                />
            </div>
        )
    }

    // 캔버스 정적 미리보기 (showReference=false 일 때): wrapper + slot 안내
    if (isStatic && !children) {
        return (
            <div
                style={{
                    ...style,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f5f3ef",
                    border: "1px dashed #c4a882",
                    borderRadius: 8,
                    color: "#888",
                    fontSize: 13,
                    fontFamily: "system-ui",
                    padding: 16,
                    textAlign: "center",
                }}
            >
                <div>
                    <div style={{ fontWeight: 700, color: "#444", marginBottom: 4 }}>
                        HTML Style Controller
                    </div>
                    <div>
                        children 자리에 콘텐츠를 끼우면 h1/h2/h3/p/li/q/a 등 일괄 스타일링
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            data-brand-style={dataAttr}
            style={{
                ...style,
                width: "100%",
                height: "100%",
            }}
        >
            <style dangerouslySetInnerHTML={{ __html: css }} />
            {children}
        </div>
    )
}

// ─── Property Controls ────────────────────────────────────────────────────────

const presetEnum = (tag: keyof typeof PRESET_KEYS) => ({
    type: ControlType.Enum as const,
    options: [...PRESET_KEYS[tag]],
    optionTitles: [...PRESET_KEYS[tag]],
    displaySegmentedControl: false,
})

const customStringHidden = (presetField: string) => ({
    type: ControlType.String as const,
    displayTextArea: true,
    placeholder: "font-size: 24px; line-height: 1.5; ...",
    hidden: (props: any) => props[presetField] !== "Custom",
})

addPropertyControls(HtmlStyleController, {
    showReference: {
        type: ControlType.Boolean,
        title: "Reference",
        defaultValue: false,
        enabledTitle: "Guide",
        disabledTitle: "Live",
        description: "ON 이면 캔버스에 preset 비교 카드 (디자인 가이드)",
    },

    // 색상
    inheritColor: {
        type: ControlType.Boolean,
        title: "Body Color",
        defaultValue: true,
        enabledTitle: "Set",
        disabledTitle: "Skip",
    },
    bodyColor: {
        type: ControlType.Color,
        title: " ↳ Color",
        defaultValue: "#222222",
        hidden: (props: any) => !props.inheritColor,
    },
    linkColor: {
        type: ControlType.Color,
        title: "Link Color",
        defaultValue: "#1a73e8",
    },
    linkUnderline: {
        type: ControlType.Enum,
        title: "Link Line",
        options: ["always", "hover", "never"],
        optionTitles: ["Always", "Hover", "Never"],
        defaultValue: "hover",
        displaySegmentedControl: true,
    },

    // h1
    h1Preset: { ...presetEnum("h1"), title: "H1", defaultValue: "Editorial" },
    h1Custom: { ...customStringHidden("h1Preset"), title: " ↳ CSS" },

    // h2
    h2Preset: { ...presetEnum("h2"), title: "H2", defaultValue: "Editorial" },
    h2Custom: { ...customStringHidden("h2Preset"), title: " ↳ CSS" },

    // h3
    h3Preset: { ...presetEnum("h3"), title: "H3", defaultValue: "Editorial" },
    h3Custom: { ...customStringHidden("h3Preset"), title: " ↳ CSS" },

    // p
    pPreset: { ...presetEnum("p"), title: "P", defaultValue: "Reading" },
    pCustom: { ...customStringHidden("pPreset"), title: " ↳ CSS" },

    // li
    liPreset: { ...presetEnum("li"), title: "LI", defaultValue: "Standard" },
    liCustom: { ...customStringHidden("liPreset"), title: " ↳ CSS" },

    // 따옴표
    quoteStyle: {
        type: ControlType.Enum,
        title: "Quote",
        options: [
            "English",
            "Korean",
            "French",
            "Curly",
            "Single",
            "Angle",
            "None",
            "Custom",
        ],
        optionTitles: [
            "English",
            "한국어",
            "French",
            "Curly",
            "Single",
            "Angle",
            "None",
            "Custom",
        ],
        defaultValue: "Curly",
    },
    quoteCustomOpen: {
        type: ControlType.String,
        title: " ↳ Open",
        defaultValue: "",
        placeholder: "「",
        hidden: (props: any) => props.quoteStyle !== "Custom",
    },
    quoteCustomClose: {
        type: ControlType.String,
        title: " ↳ Close",
        defaultValue: "",
        placeholder: "」",
        hidden: (props: any) => props.quoteStyle !== "Custom",
    },

    // JSON Override (h4/h5/h6/ul/ol/blockquote/code/em/strong/a/hr 등)
    overrideJson: {
        type: ControlType.String,
        title: "Override JSON",
        displayTextArea: true,
        defaultValue:
            '{\n  "h4": { "fontSize": 18, "fontWeight": 700, "marginBottom": 8 },\n  "blockquote": { "borderLeft": "3px solid #c4a882", "paddingLeft": 16, "fontStyle": "italic" },\n  "code": { "fontFamily": "ui-monospace, monospace", "fontSize": "0.9em", "padding": "2px 6px", "background": "#f0ede5", "borderRadius": 4 },\n  "hr": { "border": "none", "borderTop": "1px solid #ddd", "margin": "32px 0" }\n}',
        description: "기본 5 태그 외 자유 override. JSON object — 키=태그, 값=CSS object",
    },
})
