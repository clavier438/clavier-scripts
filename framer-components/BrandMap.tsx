// 브랜드 커스터마이즈 가능한 Google Maps — 카테고리·색·아이콘·맵 base 모두 prop
// HotelMap.tsx 의 일반화 버전. featured(메인 위치) 1+ 개 + 일반 핀 N 개.
// LocationCard 호환 이벤트 버스: brandmap:focus(in) / brandmap:active(out)
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
    useMemo,
    startTransition,
    type CSSProperties,
} from "react"

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface CategoryDef {
    color: string
    icon: string // 1~2자 텍스트/이모지 (SVG 안에 렌더)
    label?: string // info-window 노출용
}

interface LocationData {
    id: string
    name: string
    lat: number
    lng: number
    category?: string // categories JSON 키 (없으면 default)
    description?: string
    distance?: string // "도보 5분" 등 보조 텍스트
    featured?: boolean // 메인 위치 (호텔/매장 본점) — 핀 크게
    url?: string // 클릭 시 외부 링크 (info-window 안 버튼)
}

interface BrandMapProps {
    apiKey: string
    centerLat: number
    centerLng: number
    defaultZoom: number
    locationsJson: string
    categoriesJson: string
    // 맵 base palette
    geometryColor: string
    waterColor: string
    parkColor: string
    roadColor: string
    roadStrokeColor: string
    textFillColor: string
    textStrokeColor: string
    // info-window
    accentColor: string
    primaryColor: string
    showInfoWindows: boolean
    showLabels: boolean // POI 라벨 표시 여부 (off 면 빌트인 POI 숨김)
    // 외형
    borderRadius: number
    eventChannel: string // brandmap:focus / brandmap:active 의 prefix (다중 인스턴스용)
    style?: CSSProperties
}

// ─── 기본값 ───────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Record<string, CategoryDef> = {
    main: { color: "#1a1209", icon: "✦", label: "Main" },
    food: { color: "#b05a2a", icon: "🍽", label: "Food" },
    drink: { color: "#7a3520", icon: "◉", label: "Drink" },
    retail: { color: "#7a4f8a", icon: "◇", label: "Retail" },
    culture: { color: "#3a6a9e", icon: "⬡", label: "Culture" },
    wellness: { color: "#4d7a62", icon: "◈", label: "Wellness" },
    transit: { color: "#555555", icon: "◎", label: "Transit" },
}

const DEFAULT_CATEGORIES_JSON = JSON.stringify(DEFAULT_CATEGORIES, null, 2)

const DEFAULT_LOCATIONS: LocationData[] = [
    {
        id: "main",
        name: "Main Location",
        lat: 37.5665,
        lng: 126.978,
        category: "main",
        description: "Brand flagship",
        featured: true,
    },
    {
        id: "spot1",
        name: "Partner Cafe",
        lat: 37.567,
        lng: 126.979,
        category: "drink",
        description: "Signature blend",
        distance: "도보 3분",
    },
    {
        id: "spot2",
        name: "Local Boutique",
        lat: 37.566,
        lng: 126.977,
        category: "retail",
        description: "Curated goods",
        distance: "도보 4분",
    },
]

const DEFAULT_LOCATIONS_JSON = JSON.stringify(DEFAULT_LOCATIONS, null, 2)

// ─── 맵 스타일 (base palette 7색) ──────────────────────────────────────────────

function buildMapStyles(p: {
    geometry: string
    water: string
    park: string
    road: string
    roadStroke: string
    textFill: string
    textStroke: string
    showLabels: boolean
}) {
    const styles: any[] = [
        { elementType: "geometry", stylers: [{ color: p.geometry }] },
        { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        { elementType: "labels.text.fill", stylers: [{ color: p.textFill }] },
        { elementType: "labels.text.stroke", stylers: [{ color: p.textStroke }] },
        {
            featureType: "administrative",
            elementType: "geometry",
            stylers: [{ visibility: "off" }],
        },
        { featureType: "poi.park", elementType: "geometry", stylers: [{ color: p.park }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: p.road }] },
        {
            featureType: "road",
            elementType: "geometry.stroke",
            stylers: [{ color: p.roadStroke }],
        },
        {
            featureType: "road",
            elementType: "labels.text.fill",
            stylers: [{ color: p.textFill }],
        },
        { featureType: "transit.line", elementType: "geometry", stylers: [{ color: p.roadStroke }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: p.water }] },
        {
            featureType: "water",
            elementType: "labels.text.fill",
            stylers: [{ color: p.textFill }],
        },
    ]
    // POI 라벨 on/off 토글: 빌트인 가게/명소 라벨 (사용자 핀과 충돌 방지)
    if (!p.showLabels) {
        styles.push({ featureType: "poi", stylers: [{ visibility: "off" }] })
    }
    return styles
}

// ─── SVG 핀 (featured = 큰 핀, 일반 = 작은 핀) ────────────────────────────────

function buildPin(color: string, icon: string, featured: boolean, active: boolean): string {
    const r = featured ? 22 : active ? 19 : 16
    const cx = r + 4
    const w = cx * 2
    const tipH = 10
    const h = cx + r + tipH
    const stroke = active ? "#ffffff" : "rgba(255,255,255,0.85)"
    const sw = active ? 3 : 2
    const fs = featured ? 20 : active ? 16 : 13
    const shadowY = active ? 3 : 2
    const shadowBlur = active ? 6 : 4
    const shadowOp = active ? 0.45 : 0.3

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<filter id="d"><feDropShadow dx="0" dy="${shadowY}" stdDeviation="${shadowBlur}" flood-opacity="${shadowOp}"/></filter>
<g filter="url(#d)">
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
  <polygon points="${cx - 5},${cx + r - 2} ${cx + 5},${cx + r - 2} ${cx},${h - 1}" fill="${color}"/>
</g>
<text x="${cx}" y="${cx + fs * 0.4}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-family="-apple-system,sans-serif" fill="#ffffff">${icon}</text>
</svg>`
}

// ─── Google Maps loader (싱글턴, 다중 인스턴스 안전) ──────────────────────────

let _mapsPromise: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
    if (typeof window === "undefined") return Promise.reject(new Error("no window"))
    if ((window as any).google?.maps) return Promise.resolve()
    if (_mapsPromise) return _mapsPromise
    _mapsPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script")
        s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
        s.async = true
        s.defer = true
        s.onload = () => resolve()
        s.onerror = () => {
            _mapsPromise = null
            reject(new Error("Maps 로드 실패"))
        }
        document.head.appendChild(s)
    })
    return _mapsPromise
}

// ─── BrandMap ─────────────────────────────────────────────────────────────────

/**
 * Brand Map
 *
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 500
 *
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function BrandMap({
    apiKey = "",
    centerLat = 37.5665,
    centerLng = 126.978,
    defaultZoom = 16,
    locationsJson = DEFAULT_LOCATIONS_JSON,
    categoriesJson = DEFAULT_CATEGORIES_JSON,
    geometryColor = "#f7f3ee",
    waterColor = "#c8dce8",
    parkColor = "#deeacb",
    roadColor = "#ffffff",
    roadStrokeColor = "#ede7de",
    textFillColor = "#4a3d30",
    textStrokeColor = "#f7f3ee",
    accentColor = "#c4a882",
    primaryColor = "#2c1810",
    showInfoWindows = true,
    showLabels = false,
    borderRadius = 16,
    eventChannel = "brandmap",
    style,
}: BrandMapProps) {
    const isStatic = useIsStaticRenderer()
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<any>(null)
    const markersRef = useRef<Map<string, any>>(new Map())
    const infoRef = useRef<any>(null)
    const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
    const [errMsg, setErrMsg] = useState("")

    // JSON 파싱은 useMemo — props 변할 때만 재계산
    const locations = useMemo<LocationData[]>(() => {
        try {
            const arr = JSON.parse(locationsJson)
            return Array.isArray(arr) ? arr : DEFAULT_LOCATIONS
        } catch {
            return DEFAULT_LOCATIONS
        }
    }, [locationsJson])

    const categories = useMemo<Record<string, CategoryDef>>(() => {
        try {
            const obj = JSON.parse(categoriesJson)
            return obj && typeof obj === "object" ? obj : DEFAULT_CATEGORIES
        } catch {
            return DEFAULT_CATEGORIES
        }
    }, [categoriesJson])

    const focusEvent = `${eventChannel}:focus`
    const activeEvent = `${eventChannel}:active`

    // 카테고리 → 색·아이콘 lookup (default fallback)
    const lookupCat = useCallback(
        (key?: string): CategoryDef => {
            if (key && categories[key]) return categories[key]
            return { color: "#555", icon: "•", label: key || "" }
        },
        [categories]
    )

    // 마커 아이콘 갱신 (active 표시)
    const refreshIcons = useCallback(
        (activeId: string | null) => {
            if (typeof window === "undefined") return
            const g = (window as any).google
            if (!g) return
            markersRef.current.forEach((marker, id) => {
                const loc = locations.find((l) => l.id === id)
                if (!loc) return
                const cat = lookupCat(loc.category)
                const featured = !!loc.featured
                const active = id === activeId
                const svg = buildPin(cat.color, cat.icon, featured, active)
                const w = featured ? 52 : active ? 46 : 40
                const h = w + 10
                marker.setIcon({
                    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
                    scaledSize: new g.maps.Size(w, h),
                    anchor: new g.maps.Point(w / 2, h),
                })
                marker.setZIndex(active ? 30 : featured ? 10 : 1)
            })
        },
        [locations, lookupCat]
    )

    // 위치 포커스 (외부 dispatch + 내부 click 공통)
    const focusLocation = useCallback(
        (id: string) => {
            const loc = locations.find((l) => l.id === id)
            if (!loc || !mapRef.current) return

            refreshIcons(id)
            mapRef.current.panTo({ lat: loc.lat, lng: loc.lng })
            mapRef.current.setZoom(Math.max(defaultZoom + 1, 17))

            if (showInfoWindows && infoRef.current) {
                const marker = markersRef.current.get(id)
                if (marker) {
                    const cat = lookupCat(loc.category)
                    const catLabel = cat.label || loc.category || ""
                    const meta = [catLabel, loc.distance].filter(Boolean).join(" · ")
                    const urlBtn = loc.url
                        ? `<a href="${loc.url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;padding:4px 10px;border-radius:99px;background:${accentColor};color:#fff;font-size:11px;font-weight:600;text-decoration:none;letter-spacing:.04em">자세히 →</a>`
                        : ""
                    infoRef.current.setContent(`
                        <div style="font-family:-apple-system,sans-serif;padding:12px 14px;min-width:160px;max-width:240px">
                          ${meta ? `<p style="margin:0 0 3px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${accentColor}">${meta}</p>` : ""}
                          <p style="margin:0 0 ${loc.description ? "4px" : "0"};font-size:15px;font-weight:700;color:${primaryColor}">${loc.name}</p>
                          ${loc.description ? `<p style="margin:0;font-size:12px;color:#666;line-height:1.4">${loc.description}</p>` : ""}
                          ${urlBtn}
                        </div>
                    `)
                    infoRef.current.open(mapRef.current, marker)
                }
            }

            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent(activeEvent, { detail: { id } }))
            }
        },
        [
            locations,
            primaryColor,
            accentColor,
            showInfoWindows,
            refreshIcons,
            lookupCat,
            activeEvent,
            defaultZoom,
        ]
    )

    // 지도 초기화 (apiKey/static 변경 시만 재생성 — 색·카테고리는 별도 effect)
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

        loadGoogleMaps(apiKey)
            .then(() => {
                if (!containerRef.current) return
                const g = (window as any).google

                const map = new g.maps.Map(containerRef.current, {
                    center: { lat: centerLat, lng: centerLng },
                    zoom: defaultZoom,
                    styles: buildMapStyles({
                        geometry: geometryColor,
                        water: waterColor,
                        park: parkColor,
                        road: roadColor,
                        roadStroke: roadStrokeColor,
                        textFill: textFillColor,
                        textStroke: textStrokeColor,
                        showLabels,
                    }),
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
                    const cat = lookupCat(loc.category)
                    const featured = !!loc.featured
                    const svg = buildPin(cat.color, cat.icon, featured, false)
                    const w = featured ? 52 : 40
                    const h = w + 10

                    const marker = new g.maps.Marker({
                        position: { lat: loc.lat, lng: loc.lng },
                        map,
                        title: loc.name,
                        icon: {
                            url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
                            scaledSize: new g.maps.Size(w, h),
                            anchor: new g.maps.Point(w / 2, h),
                        },
                        zIndex: featured ? 10 : 1,
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
    }, [apiKey, isStatic, locationsJson, categoriesJson])

    // 외부에서 핀 포커스 요청 (LocationCard 등)
    useEffect(() => {
        if (typeof window === "undefined") return
        const handler = (e: Event) => {
            focusLocation((e as CustomEvent).detail.id)
        }
        window.addEventListener(focusEvent, handler)
        return () => window.removeEventListener(focusEvent, handler)
    }, [focusLocation, focusEvent])

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
                    background: geometryColor,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    fontFamily: "-apple-system, sans-serif",
                }}
            >
                <span style={{ fontSize: 48 }}>🗺️</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: primaryColor }}>
                    Brand Map
                </span>
                <span style={{ fontSize: 12, color: textFillColor, opacity: 0.6 }}>
                    {locations.length}개 위치 · {Object.keys(categories).length}개 카테고리
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
                background: geometryColor,
            }}
        >
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

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
                        background: geometryColor,
                    }}
                >
                    <style>{`@keyframes bmspin{to{transform:rotate(360deg)}}`}</style>
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: `3px solid ${accentColor}`,
                            borderTopColor: "transparent",
                            animation: "bmspin .9s linear infinite",
                        }}
                    />
                    <span
                        style={{
                            fontSize: 12,
                            color: textFillColor,
                            opacity: 0.7,
                            fontFamily: "system-ui",
                        }}
                    >
                        지도를 불러오는 중…
                    </span>
                </div>
            )}

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
                        background: geometryColor,
                        padding: 24,
                        fontFamily: "system-ui",
                    }}
                >
                    <span style={{ fontSize: 32 }}>🗺️</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>
                        지도 로드 실패
                    </span>
                    <span
                        style={{
                            fontSize: 12,
                            color: textFillColor,
                            opacity: 0.6,
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

addPropertyControls(BrandMap, {
    apiKey: {
        type: ControlType.String,
        title: "API Key",
        placeholder: "Google Maps API Key",
    },
    centerLat: {
        type: ControlType.Number,
        title: "Center Lat",
        defaultValue: 37.5665,
        step: 0.0001,
        displayStepper: true,
    },
    centerLng: {
        type: ControlType.Number,
        title: "Center Lng",
        defaultValue: 126.978,
        step: 0.0001,
        displayStepper: true,
    },
    defaultZoom: {
        type: ControlType.Number,
        title: "Zoom",
        defaultValue: 16,
        min: 8,
        max: 20,
        step: 1,
        displayStepper: true,
    },
    locationsJson: {
        type: ControlType.String,
        title: "Locations (JSON)",
        displayTextArea: true,
        defaultValue: DEFAULT_LOCATIONS_JSON,
    },
    categoriesJson: {
        type: ControlType.String,
        title: "Categories (JSON)",
        displayTextArea: true,
        defaultValue: DEFAULT_CATEGORIES_JSON,
    },
    geometryColor: {
        type: ControlType.Color,
        title: "Map Base",
        defaultValue: "#f7f3ee",
    },
    waterColor: {
        type: ControlType.Color,
        title: "Water",
        defaultValue: "#c8dce8",
    },
    parkColor: {
        type: ControlType.Color,
        title: "Park",
        defaultValue: "#deeacb",
    },
    roadColor: {
        type: ControlType.Color,
        title: "Road",
        defaultValue: "#ffffff",
    },
    roadStrokeColor: {
        type: ControlType.Color,
        title: "Road Stroke",
        defaultValue: "#ede7de",
    },
    textFillColor: {
        type: ControlType.Color,
        title: "Text",
        defaultValue: "#4a3d30",
    },
    textStrokeColor: {
        type: ControlType.Color,
        title: "Text BG",
        defaultValue: "#f7f3ee",
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#c4a882",
    },
    primaryColor: {
        type: ControlType.Color,
        title: "Primary",
        defaultValue: "#2c1810",
    },
    showInfoWindows: {
        type: ControlType.Boolean,
        title: "Info Popups",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    showLabels: {
        type: ControlType.Boolean,
        title: "POI Labels",
        defaultValue: false,
        enabledTitle: "Show",
        disabledTitle: "Hide",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 16,
        min: 0,
        max: 48,
    },
    eventChannel: {
        type: ControlType.String,
        title: "Event Ch",
        defaultValue: "brandmap",
        description: "다중 인스턴스: brandmap-a, brandmap-b 등",
    },
})
