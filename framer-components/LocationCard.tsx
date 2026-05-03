// 텍스트/카드를 클릭하면 HotelMap 해당 핀으로 포커스 이동 — HotelMap과 이벤트 버스 연동
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import {
    useEffect,
    useState,
    startTransition,
    type CSSProperties,
} from "react"

// ─── 카테고리 색상 (HotelMap 과 동일) ────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
    hotel: "#1a1209",
    restaurant: "#b05a2a",
    spa: "#4d7a62",
    shopping: "#7a4f8a",
    culture: "#3a6a9e",
    bar: "#7a3520",
    cafe: "#8a5c34",
    transport: "#555555",
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LocationCardProps {
    locationId: string
    locationName: string
    locationCategory: string
    locationDescription: string
    locationDistance: string
    accentColor: string
    activeBackground: string
    activeBorderColor: string
    borderRadius: number
    padding: number
    style?: CSSProperties
}

// ─── LocationCard ─────────────────────────────────────────────────────────────

/**
 * Location Card
 *
 * @framerIntrinsicWidth 280
 * @framerIntrinsicHeight 100
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function LocationCard({
    locationId = "",
    locationName = "롯데백화점 노원점",
    locationCategory = "shopping",
    locationDescription = "프리미엄 쇼핑",
    locationDistance = "도보 5분",
    accentColor = "#c4a882",
    activeBackground = "rgba(196,168,130,.10)",
    activeBorderColor = "#c4a882",
    borderRadius = 12,
    padding = 16,
    style,
}: LocationCardProps) {
    const isStatic = useIsStaticRenderer()
    const [isActive, setIsActive] = useState(false)

    // HotelMap → 활성 상태 수신
    useEffect(() => {
        if (typeof window === "undefined") return
        const handler = (e: Event) => {
            startTransition(() =>
                setIsActive((e as CustomEvent).detail.id === locationId)
            )
        }
        window.addEventListener("hotelmap:active", handler)
        return () => window.removeEventListener("hotelmap:active", handler)
    }, [locationId])

    const handleClick = () => {
        if (!locationId || typeof window === "undefined") return
        window.dispatchEvent(
            new CustomEvent("hotelmap:focus", { detail: { id: locationId } })
        )
    }

    const badgeColor = CAT_COLOR[locationCategory.toLowerCase()] ?? accentColor

    return (
        <div
            onClick={isStatic ? undefined : handleClick}
            role="button"
            aria-pressed={isActive}
            tabIndex={locationId ? 0 : undefined}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClick()
            }}
            style={{
                ...style,
                position: "relative",
                cursor: locationId && !isStatic ? "pointer" : "default",
                borderRadius,
                padding,
                transition: "all .2s ease",
                background: isActive ? activeBackground : "transparent",
                outline: isActive
                    ? `2px solid ${activeBorderColor}`
                    : "2px solid transparent",
                outlineOffset: "1px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontFamily: "-apple-system, system-ui, sans-serif",
            }}
        >
            {/* 카테고리 배지 + 거리 */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <span
                    style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 99,
                        background: badgeColor,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                    }}
                >
                    {locationCategory}
                </span>
                {locationDistance ? (
                    <span
                        style={{
                            fontSize: 11,
                            color: accentColor,
                            fontWeight: 500,
                        }}
                    >
                        {locationDistance}
                    </span>
                ) : null}
            </div>

            {/* 이름 */}
            <div
                style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#2c1810",
                    lineHeight: 1.3,
                }}
            >
                {locationName}
            </div>

            {/* 설명 */}
            {locationDescription ? (
                <div
                    style={{
                        fontSize: 12,
                        color: "#6e5e4e",
                        lineHeight: 1.5,
                    }}
                >
                    {locationDescription}
                </div>
            ) : null}

            {/* 활성 인디케이터 */}
            {isActive && (
                <div
                    style={{
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                    }}
                >
                    <span
                        style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: accentColor,
                            display: "inline-block",
                        }}
                    />
                    <span
                        style={{
                            fontSize: 10,
                            color: accentColor,
                            fontWeight: 700,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                        }}
                    >
                        지도에서 보기
                    </span>
                </div>
            )}
        </div>
    )
}

addPropertyControls(LocationCard, {
    locationId: {
        type: ControlType.String,
        title: "Location ID",
        placeholder: "lotte_nowon",
        defaultValue: "lotte_nowon",
    },
    locationName: {
        type: ControlType.String,
        title: "Name",
        defaultValue: "롯데백화점 노원점",
    },
    locationCategory: {
        type: ControlType.Enum,
        title: "Category",
        defaultValue: "shopping",
        options: [
            "hotel",
            "restaurant",
            "spa",
            "shopping",
            "culture",
            "bar",
            "cafe",
            "transport",
        ],
        optionTitles: [
            "호텔",
            "레스토랑",
            "스파",
            "쇼핑",
            "문화",
            "바",
            "카페",
            "교통",
        ],
    },
    locationDescription: {
        type: ControlType.String,
        title: "Description",
        defaultValue: "프리미엄 쇼핑",
    },
    locationDistance: {
        type: ControlType.String,
        title: "Distance",
        defaultValue: "도보 5분",
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#c4a882",
    },
    activeBackground: {
        type: ControlType.Color,
        title: "Active BG",
        defaultValue: "rgba(196,168,130,.10)",
    },
    activeBorderColor: {
        type: ControlType.Color,
        title: "Active Border",
        defaultValue: "#c4a882",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 12,
        min: 0,
        max: 32,
    },
    padding: {
        type: ControlType.Number,
        title: "Padding",
        defaultValue: 16,
        min: 0,
        max: 48,
    },
})
