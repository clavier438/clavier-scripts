// 브랜드 커스텀 Google Maps — 호텔 + 파트너 업장 핀, LocationCard 클릭 연동
import {
    addPropertyControls,
    ControlType,
    useIsStaticRenderer,
} from "framer"
import {
    useEffect,
    useRef,
    useState,
    useCallback,
    startTransition,
    type CSSProperties,
} from "react"

// ─── 타입 ────────────────────────────────────────────────────────────────────

type Category =
    | "hotel"
    | "restaurant"
    | "spa"
    | "shopping"
    | "culture"
    | "bar"
    | "cafe"
    | "transport"

interface LocationData {
    id: string
    name: string
    category: Category
    lat: number
    lng: number
    description?: string
    distance?: string
}

interface HotelMapProps {
    apiKey: string
    primaryColor: string
    accentColor: string
    hotelLat: number
    hotelLng: number
    defaultZoom: number
    locationsJson: string
    showInfoWindows: boolean
    borderRadius: number
    style?: CSSProperties
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const CAT_COLOR: Record<Category, string> = {
    hotel: "#1a1209",
    restaurant: "#b05a2a",
    spa: "#4d7a62",
    shopping: "#7a4f8a",
    culture: "#3a6a9e",
    bar: "#7a3520",
    cafe: "#8a5c34",
    transport: "#555555",
}

const CAT_ICON: Record<Category, string> = {
    hotel: "✦",
    restaurant: "🍽",
    spa: "◈",
    shopping: "◇",
    culture: "⬡",
    bar: "◉",
    cafe: "☕",
    transport: "◎",
}

const DEFAULT_LOCATIONS: LocationData[] = [
    {
        id: "hotel",
        name: "그랜드 호텔",
        category: "hotel",
        lat: 37.655,
        lng: 127.061,
        description: "메인 호텔",
    },
    {
        id: "lotte_nowon",
        name: "롯데백화점 노원점",
        category: "shopping",
        lat: 37.6557,
        lng: 127.0636,
        description: "프리미엄 쇼핑",
        distance: "도보 5분",
    },
    {
        id: "rest1",
        name: "레스토랑 루체",
        category: "restaurant",
        lat: 37.6565,
        lng: 127.0625,
        description: "이탈리안 파인다이닝",
        distance: "도보 3분",
    },
    {
        id: "spa1",
        name: "아쿠아 스파",
        category: "spa",
        lat: 37.6545,
        lng: 127.062,
        description: "럭셔리 웰니스",
        distance: "도보 4분",
    },
    {
        id: "cafe1",
        name: "카페 아르카나",
        category: "cafe",
        lat: 37.6558,
        lng: 127.0645,
        description: "시그니처 카페",
        distance: "도보 2분",
    },
]

const DEFAULT_JSON = JSON.stringify(DEFAULT_LOCATIONS, null, 2)

// ─── 맵 스타일 (브랜드 팔레트) ────────────────────────────────────────────────

function getBrandStyles() {
    return [
        { elementType: "geometry", stylers: [{ color: "#f7f3ee" }] },
        { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        {
            elementType: "labels.text.fill",
            stylers: [{ color: "#4a3d30" }],
        },
        {
            elementType: "labels.text.stroke",
            stylers: [{ color: "#f7f3ee" }],
        },
        {
            featureType: "administrative",
            elementType: "geometry",
            stylers: [{ visibility: "off" }],
        },
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        {
            featureType: "poi.park",
            elementType: "geometry",
            stylers: [{ color: "#deeacb" }],
        },
        {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#ffffff" }],
        },
        {
            featureType: "road",
            elementType: "geometry.stroke",
            stylers: [{ color: "#ede7de" }],
        },
        {
            featureType: "road",
            elementType: "labels.text.fill",
            stylers: [{ color: "#9e8e7e" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry",
            stylers: [{ color: "#ede8df" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry.stroke",
            stylers: [{ color: "#ddd5c8" }],
        },
        {
            featureType: "transit.line",
            elementType: "geometry",
            stylers: [{ color: "#e5ddd3" }],
        },
        {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#c8dce8" }],
        },
        {
            featureType: "water",
            elementType: "labels.text.fill",
            stylers: [{ color: "#8aafc2" }],
        },
    ]
}

// ─── SVG 핀 마커 ──────────────────────────────────────────────────────────────

function buildPin(
    color: string,
    icon: string,
    isHotel: boolean,
    isActive: boolean
): string {
    const r = isHotel ? 22 : isActive ? 19 : 16
    const cx = r + 4
    const w = cx * 2
    const tipH = 10
    const h = cx + r + tipH
    const stroke = isActive ? "#ffffff" : "rgba(255,255,255,0.85)"
    const sw = isActive ? 3 : 2
    const fs = isHotel ? 20 : isActive ? 16 : 13
    const shadowY = isActive ? 3 : 2
    const shadowBlur = isActive ? 6 : 4
    const shadowOp = isActive ? 0.45 : 0.3

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<filter id="d"><feDropShadow dx="0" dy="${shadowY}" stdDeviation="${shadowBlur}" flood-opacity="${shadowOp}"/></filter>
<g filter="url(#d)">
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
  <polygon points="${cx - 5},${cx + r - 2} ${cx + 5},${cx + r - 2} ${cx},${h - 1}" fill="${color}"/>
</g>
<text x="${cx}" y="${cx + fs * 0.4}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-family="-apple-system,sans-serif">${icon}</text>
</svg>`
}

// ─── Google Maps 로더 (싱글턴) ────────────────────────────────────────────────

let _promise: Promise<void> | null = null

function loadMaps(apiKey: string): Promise<void> {
    if (typeof window === "undefined") return Promise.reject("no window")
    if ((window as any).google?.maps) return Promise.resolve()
    if (_promise) return _promise
    _promise = new Promise((resolve, reject) => {
        const s = document.createElement("script")
        s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
        s.async = true
        s.defer = true
        s.onload = () => resolve()
        s.onerror = () => {
            _promise = null
            reject(new Error("Maps 로드 실패"))
        }
        document.head.appendChild(s)
    })
    return _promise
}

// ─── HotelMap 컴포넌트 ────────────────────────────────────────────────────────

/**
 * Hotel Map
 *
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 500
 *
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function HotelMap({
    apiKey = "",
    primaryColor = "#2c1810",
    accentColor = "#c4a882",
    hotelLat = 37.655,
    hotelLng = 127.061,
    defaultZoom = 16,
    locationsJson = DEFAULT_JSON,
    showInfoWindows = true,
    borderRadius = 16,
    style,
}: HotelMapProps) {
    const isStatic = useIsStaticRenderer()
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<any>(null)
    const markersRef = useRef<Map<string, any>>(new Map())
    const infoRef = useRef<any>(null)
    const [phase, setPhase] = useState<"loading" | "ready" | "error">(
        "loading"
    )
    const [errMsg, setErrMsg] = useState("")

    const locations: LocationData[] = (() => {
        try {
            return JSON.parse(locationsJson)
        } catch {
            return DEFAULT_LOCATIONS
        }
    })()

    // 마커 아이콘 갱신
    const refreshIcons = useCallback(
        (activeId: string | null) => {
            if (typeof window === "undefined") return
            const g = (window as any).google
            if (!g) return
            markersRef.current.forEach((marker, id) => {
                const loc = locations.find((l) => l.id === id)
                if (!loc) return
                const isHotel = loc.category === "hotel"
                const isActive = id === activeId
                const color = CAT_COLOR[loc.category] ?? "#333"
                const icon = CAT_ICON[loc.category] ?? "📍"
                const svg = buildPin(color, icon, isHotel, isActive)
                const w = isHotel ? 52 : isActive ? 46 : 40
                const h = w + 10
                marker.setIcon({
                    url:
                        "data:image/svg+xml;charset=UTF-8," +
                        encodeURIComponent(svg),
                    scaledSize: new g.maps.Size(w, h),
                    anchor: new g.maps.Point(w / 2, h),
                })
                marker.setZIndex(isActive ? 30 : isHotel ? 10 : 1)
            })
        },
        [locations]
    )

    // 위치 포커스
    const focusLocation = useCallback(
        (id: string) => {
            const loc = locations.find((l) => l.id === id)
            if (!loc || !mapRef.current) return

            refreshIcons(id)
            mapRef.current.panTo({ lat: loc.lat, lng: loc.lng })
            mapRef.current.setZoom(17)

            if (showInfoWindows && infoRef.current) {
                const marker = markersRef.current.get(id)
                if (marker) {
                    infoRef.current.setContent(`
            <div style="font-family:-apple-system,sans-serif;padding:12px 14px;min-width:160px;max-width:220px">
              <p style="margin:0 0 3px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${accentColor}">
                ${loc.category}${loc.distance ? ` · ${loc.distance}` : ""}
              </p>
              <p style="margin:0 0 ${loc.description ? "4px" : "0"};font-size:15px;font-weight:700;color:${primaryColor}">${loc.name}</p>
              ${loc.description ? `<p style="margin:0;font-size:12px;color:#666">${loc.description}</p>` : ""}
            </div>
          `)
                    infoRef.current.open(mapRef.current, marker)
                }
            }

            if (typeof window !== "undefined") {
                window.dispatchEvent(
                    new CustomEvent("hotelmap:active", { detail: { id } })
                )
            }
        },
        [locations, primaryColor, accentColor, showInfoWindows, refreshIcons]
    )

    // 지도 초기화
    useEffect(() => {
        if (isStatic) return
        if (!apiKey) {
            startTransition(() => {
                setPhase("error")
                setErrMsg("API Key를 프로퍼티 패널에 입력해주세요.")
            })
            return
        }
        if (!containerRef.current) return

        loadMaps(apiKey)
            .then(() => {
                if (!containerRef.current) return
                const g = (window as any).google

                const map = new g.maps.Map(containerRef.current, {
                    center: { lat: hotelLat, lng: hotelLng },
                    zoom: defaultZoom,
                    styles: getBrandStyles(),
                    disableDefaultUI: true,
                    zoomControl: true,
                    zoomControlOptions: {
                        position: g.maps.ControlPosition.RIGHT_BOTTOM,
                    },
                    gestureHandling: "cooperative",
                    clickableIcons: false,
                })

                mapRef.current = map
                infoRef.current = new g.maps.InfoWindow({
                    pixelOffset: new g.maps.Size(0, -4),
                })

                locations.forEach((loc) => {
                    const isHotel = loc.category === "hotel"
                    const color = CAT_COLOR[loc.category] ?? "#333"
                    const icon = CAT_ICON[loc.category] ?? "📍"
                    const svg = buildPin(color, icon, isHotel, false)
                    const w = isHotel ? 52 : 40
                    const h = w + 10

                    const marker = new g.maps.Marker({
                        position: { lat: loc.lat, lng: loc.lng },
                        map,
                        title: loc.name,
                        icon: {
                            url:
                                "data:image/svg+xml;charset=UTF-8," +
                                encodeURIComponent(svg),
                            scaledSize: new g.maps.Size(w, h),
                            anchor: new g.maps.Point(w / 2, h),
                        },
                        zIndex: isHotel ? 10 : 1,
                    })

                    marker.addListener("click", () => focusLocation(loc.id))
                    markersRef.current.set(loc.id, marker)
                })

                startTransition(() => setPhase("ready"))
            })
            .catch((err) => {
                startTransition(() => {
                    setPhase("error")
                    setErrMsg(String(err?.message ?? err))
                })
            })

        return () => {
            markersRef.current.clear()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey, isStatic])

    // LocationCard → 이벤트 수신
    useEffect(() => {
        if (typeof window === "undefined") return
        const handler = (e: Event) => {
            focusLocation((e as CustomEvent).detail.id)
        }
        window.addEventListener("hotelmap:focus", handler)
        return () => window.removeEventListener("hotelmap:focus", handler)
    }, [focusLocation])

    // 캔버스 정적 프리뷰
    if (isStatic) {
        return (
            <div
                style={{
                    ...style,
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    borderRadius,
                    background: "#f0ebe2",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    fontFamily: "-apple-system, sans-serif",
                }}
            >
                <span style={{ fontSize: 48 }}>🗺️</span>
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: primaryColor,
                    }}
                >
                    Hotel Map
                </span>
                <span style={{ fontSize: 12, color: "#9e8e7e" }}>
                    {locations.length}개 위치
                </span>
            </div>
        )
    }

    return (
        <div
            style={{
                ...style,
                position: "relative",
                width: "100%",
                height: "100%",
                borderRadius,
                overflow: "hidden",
                background: "#f7f3ee",
            }}
        >
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

            {/* 로딩 */}
            {phase === "loading" && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 14,
                        background: "#f7f3ee",
                    }}
                >
                    <style>{`@keyframes hmspin{to{transform:rotate(360deg)}}`}</style>
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: `3px solid ${accentColor}`,
                            borderTopColor: "transparent",
                            animation: "hmspin .9s linear infinite",
                        }}
                    />
                    <span
                        style={{
                            fontSize: 12,
                            color: "#9a8a78",
                            fontFamily: "system-ui",
                        }}
                    >
                        지도를 불러오는 중…
                    </span>
                </div>
            )}

            {/* 에러 */}
            {phase === "error" && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        background: "#f7f3ee",
                        padding: 24,
                        fontFamily: "system-ui",
                    }}
                >
                    <span style={{ fontSize: 32 }}>🗺️</span>
                    <span
                        style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: primaryColor,
                        }}
                    >
                        지도 로드 실패
                    </span>
                    <span
                        style={{
                            fontSize: 12,
                            color: "#999",
                            textAlign: "center",
                        }}
                    >
                        {errMsg}
                    </span>
                </div>
            )}
        </div>
    )
}

addPropertyControls(HotelMap, {
    apiKey: {
        type: ControlType.String,
        title: "API Key",
        placeholder: "Google Maps API Key",
    },
    primaryColor: {
        type: ControlType.Color,
        title: "Primary",
        defaultValue: "#2c1810",
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#c4a882",
    },
    hotelLat: {
        type: ControlType.Number,
        title: "Hotel Lat",
        defaultValue: 37.655,
        step: 0.0001,
        displayStepper: true,
    },
    hotelLng: {
        type: ControlType.Number,
        title: "Hotel Lng",
        defaultValue: 127.061,
        step: 0.0001,
        displayStepper: true,
    },
    defaultZoom: {
        type: ControlType.Number,
        title: "Zoom",
        defaultValue: 16,
        min: 10,
        max: 20,
        step: 1,
        displayStepper: true,
    },
    locationsJson: {
        type: ControlType.String,
        title: "Locations (JSON)",
        displayTextArea: true,
        defaultValue: DEFAULT_JSON,
    },
    showInfoWindows: {
        type: ControlType.Boolean,
        title: "Info Popups",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 16,
        min: 0,
        max: 48,
    },
})
