import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AppLauncher } from '@capacitor/app-launcher'
import { Capacitor } from '@capacitor/core'
import L from 'leaflet'
import {
  MapContainer,
  Circle,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookmarkPlus,
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Crosshair,
  Download,
  FolderHeart,
  Languages,
  Link2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Plus,
  Radar,
  RotateCcw,
  Route,
  Search,
  Save,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  buildGoogleMapsUrl,
  buildSpeedDangerZones,
  formatMinutes,
  getRouteBounds,
  getRouteSummary,
  optimizeIntermediateStops,
} from './route-utils.js'
import {
  formatPlaceSubtitle,
  GIRONA_CENTER,
  searchPlaces,
} from './place-search.js'
import { LANGUAGES, translate, useI18n } from './i18n.js'
import { buildShareUrl, clearIncomingShareParam, readIncomingSharedRoute, readSharedRouteFromUrl } from './share-link.js'

const SocialPanel = lazy(() => import('./SocialPanel.jsx'))

const STORAGE_KEY = 'salvi-route-v1'
const SAVED_ROUTES_KEY = 'salvi-saved-routes-v1'
const SAVED_POINTS_KEY = 'salvi-saved-points-v1'
const DEFAULT_CENTER = [GIRONA_CENTER.lat, GIRONA_CENTER.lng]
const geocodeCache = new Map()
const speedZoneCache = new Map()
let lastSpeedRequestAt = 0

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (Array.isArray(saved?.stops)) return saved
  } catch {
    // A damaged local draft should never prevent the app from opening.
  }
  return { stops: [], durationMode: 'general', generalMinutes: 10 }
}

function loadSavedRoutes() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_ROUTES_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function loadSavedPoints() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_POINTS_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function makeStop({ lat, lng, name, countryCode = null, isCurrentLocation = false }, minutes = 10) {
  return {
    id: crypto.randomUUID(),
    lat: Number(lat),
    lng: Number(lng),
    name,
    countryCode: countryCode?.toLowerCase() || null,
    minutes,
    isCurrentLocation,
  }
}

function markerIcon(index, isFirst, isLast) {
  const className = isFirst ? 'origin' : isLast ? 'destination' : 'waypoint'
  return L.divIcon({
    className: 'trackpi-marker-shell',
    html: `<div class="trackpi-marker ${className}">${isFirst ? '<span></span>' : index}</div>`,
    iconSize: [38, 46],
    iconAnchor: [19, 42],
    tooltipAnchor: [0, -40],
  })
}

function FitRoute({ stops, line }) {
  const map = useMap()
  const lastFitKey = useRef('')

  useEffect(() => {
    const points = line?.length ? line : stops.map((stop) => [stop.lat, stop.lng])
    if (!points.length) return
    const key = points.map((point) => point.join(',')).join(';')
    if (key === lastFitKey.current) return
    lastFitKey.current = key
    if (points.length === 1) map.flyTo(points[0], 14, { duration: 0.7 })
    else map.fitBounds(points, { padding: [46, 46], maxZoom: 15 })
  }, [map, stops, line])

  return null
}

function MapClickHandler({ onPick }) {
  const { t } = useI18n()
  useMapEvents({
    click(event) {
      onPick({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
        name: t('pointAt', { coords: `${event.latlng.lat.toFixed(4)}, ${event.latlng.lng.toFixed(4)}` }),
      })
    },
  })
  return null
}

function RouteMap({ stops, routeLine, speedZones, onMapPick }) {
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={12} zoomControl={false} className="map-canvas">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {routeLine?.length > 1 && (
        <>
          <Polyline positions={routeLine} pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.95 }} />
          <Polyline positions={routeLine} pathOptions={{ color: '#ff6542', weight: 6, opacity: 1 }} />
        </>
      )}
      {speedZones.map((zone) => (
        <Circle
          key={zone.id}
          center={[zone.lat, zone.lng]}
          radius={zone.radius}
          pathOptions={{ color: '#e05a38', fillColor: '#ff9a6f', fillOpacity: 0.13, weight: 2, dashArray: '7 7' }}
        >
          <Tooltip direction="top">{zone.label}</Tooltip>
        </Circle>
      ))}
      {stops.map((stop, index) => (
        <Marker
          key={stop.id}
          position={[stop.lat, stop.lng]}
          icon={markerIcon(index, index === 0, index === stops.length - 1 && stops.length > 1)}
        >
          <Tooltip direction="top" offset={[0, -6]}>{stop.name}</Tooltip>
        </Marker>
      ))}
      <MapClickHandler onPick={onMapPick} />
      <FitRoute stops={stops} line={routeLine} />
      <ZoomControl position="bottomright" />
    </MapContainer>
  )
}

function PlaceSearch({ onSelect, hasStops, biasPoint, preferredCountry }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es')
    if (normalizedQuery.length < 3) {
      setResults([])
      setLoading(false)
      return
    }

    const cacheKey = `${preferredCountry}:${Number(biasPoint.lat).toFixed(2)}:${Number(biasPoint.lng).toFixed(2)}:${normalizedQuery}`
    if (geocodeCache.has(cacheKey)) {
      setResults(geocodeCache.get(cacheKey))
      setOpen(true)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await searchPlaces(query, {
          bias: biasPoint,
          preferredCountry,
          signal: controller.signal,
        })
        geocodeCache.set(cacheKey, data)
        setResults(data)
        setOpen(true)
      } catch (error) {
        if (error.name !== 'AbortError') setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 420)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [biasPoint, preferredCountry, query])

  const choose = (result) => {
    const locality = [result.city, result.county].filter(Boolean).join(', ')
    const compactName = locality && !result.name.toLocaleLowerCase('es').includes(result.city?.toLocaleLowerCase('es') || '__')
      ? `${result.name}, ${locality}`
      : result.name
    onSelect({ lat: result.lat, lng: result.lng, name: compactName, countryCode: result.countryCode })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="search-wrap">
      <Search size={20} aria-hidden="true" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={hasStops ? t('searchAddStop') : t('searchOrigin')}
        aria-label={hasStops ? t('ariaAddStop') : t('ariaSearchOrigin')}
        autoComplete="off"
      />
      {loading && <span className="search-loader" aria-label={t('searching')} />}
      {query && !loading && (
        <button className="icon-button clear-search" onClick={() => setQuery('')} aria-label={t('clearSearch')}>
          <X size={18} />
        </button>
      )}
      {open && query.length >= 3 && (
        <div className="search-results">
          {results.length ? results.map((result) => (
            <button key={result.id} onClick={() => choose(result)}>
              <MapPin size={18} />
              <span className="search-result-copy">
                <strong>{result.name}</strong>
                <small>{formatPlaceSubtitle(result)}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )) : !loading && <p>{t('noResults')}</p>}
        </div>
      )}
    </div>
  )
}

function MinuteStepper({ value, onChange, compact = false }) {
  const { t } = useI18n()
  const update = (next) => onChange(Math.max(0, Math.min(240, Number(next) || 0)))
  return (
    <div className={`minute-stepper ${compact ? 'compact' : ''}`}>
      <button onClick={() => update(value - 5)} aria-label={t('minusFive')}><Minus size={16} /></button>
      <label>
        <input type="number" min="0" max="240" step="5" value={value} onChange={(event) => update(event.target.value)} />
        <span>{t('minUnit')}</span>
      </label>
      <button onClick={() => update(value + 5)} aria-label={t('plusFive')}><Plus size={16} /></button>
    </div>
  )
}

function StopRow({ stop, index, total, durationMode, onMinutes, onMove, onRemove, onSavePoint }) {
  const { t } = useI18n()
  const isOrigin = index === 0
  const isDestination = index === total - 1 && total > 1
  const label = isOrigin ? t('stopOrigin') : isDestination ? t('stopDestination') : t('stopN', { n: index })

  return (
    <div className="stop-row">
      <div className={`stop-dot ${isOrigin ? 'origin' : isDestination ? 'destination' : ''}`}>
        {isOrigin ? <span /> : index}
      </div>
      <div className="stop-copy">
        <span>{label}</span>
        <strong title={stop.name}>{stop.name}</strong>
        {!isOrigin && durationMode === 'individual' && (
          <MinuteStepper compact value={stop.minutes} onChange={onMinutes} />
        )}
      </div>
      <div className="stop-actions">
        <button onClick={onSavePoint} aria-label={t('savePointAs', { label })} title={t('savePointTitle')}>
          <BookmarkPlus size={17} />
        </button>
        {!isOrigin && !isDestination && (
          <>
            <button onClick={() => onMove(-1)} disabled={index === 1} aria-label={t('moveUp')}><ArrowUp size={16} /></button>
            <button onClick={() => onMove(1)} disabled={index === total - 2} aria-label={t('moveDown')}><ArrowDown size={16} /></button>
          </>
        )}
        <button className="remove" onClick={onRemove} aria-label={t('removeLabel', { label })}><Trash2 size={17} /></button>
      </div>
    </div>
  )
}

function Stat({ icon, label, value, accent = false }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SpeedAlertsCard({ state, zones, countries }) {
  const { t } = useI18n()
  const isSpain = countries.includes('es')
  const isFrance = countries.includes('fr')
  const includesSwitzerland = countries.includes('ch')
  const fixedCopy = state === 'loading'
    ? t('fixedQuerying')
    : state === 'error'
      ? t('fixedUnavailable')
      : state === 'restricted'
        ? t('fixedSwiss')
        : state === 'unsupported'
          ? t('fixedNoSource')
          : state === 'unknown'
            ? t('fixedUnknown')
            : t(zones.length === 1 ? 'zonesOne' : 'zonesMany', { n: zones.length })

  let mobileCopy = t('mobileTemporary')
  if (isSpain) mobileCopy = t('mobileSpainPending')
  if (state === 'restricted') mobileCopy = t('fixedSwiss')

  let legalCopy = t('legalDefault')
  if (isSpain) legalCopy = t('legalSpain')
  if (isFrance) legalCopy = t('legalFrance')
  if (includesSwitzerland) legalCopy += t('legalSwiss')

  return (
    <div className="speed-card">
      <div className="speed-title"><Radar size={20} /><strong>{t('speedTitle')}</strong></div>
      <div className="speed-row">
        <span className="speed-symbol fixed"><Radar size={17} /></span>
        <div><strong>{t('fixedControls')}</strong><span>{fixedCopy}</span></div>
        <span className={`status-dot ${state}`} />
      </div>
      <div className="speed-row">
        <span className="speed-symbol mobile"><CarFront size={17} /></span>
        <div><strong>{t('mobileControls')}</strong><span>{mobileCopy}</span></div>
        <span className="phase-badge">{t('phase2')}</span>
      </div>
      <p className="legal-note">{legalCopy}</p>
    </div>
  )
}

function SavedRoutes({ routes, onLoad, onShare, onShareLink, onDelete }) {
  const { t, locale } = useI18n()
  if (!routes.length) {
    return (
      <div className="saved-empty">
        <FolderHeart size={24} />
        <div><strong>{t('savedRoutesEmptyTitle')}</strong><span>{t('savedRoutesEmptyBody')}</span></div>
      </div>
    )
  }

  return (
    <div className="saved-list">
      {routes.map((savedRoute) => (
        <div className="saved-route shareable" key={savedRoute.id}>
          <button className="saved-route-main" onClick={() => onLoad(savedRoute)}>
            <span className="saved-route-icon"><Route size={18} /></span>
            <span>
              <strong>{savedRoute.name}</strong>
              <small>{savedRoute.stops.length} {t(savedRoute.stops.length === 1 ? 'pointOne' : 'pointMany')} · {new Date(savedRoute.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <button className="saved-share" onClick={() => onShareLink(savedRoute)} aria-label={t('shareLink')} title={t('shareLink')}><Link2 size={16} /></button>
          <button className="saved-share" onClick={() => onShare(savedRoute)} aria-label={t('sendRoute')} title={t('sendRoute')}><Share2 size={16} /></button>
          <button className="saved-delete" onClick={() => onDelete(savedRoute.id)} aria-label={t('clearRoute')}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  )
}

function SavedPoints({ points, onAdd, onDelete }) {
  const { t } = useI18n()
  if (!points.length) {
    return (
      <div className="saved-empty">
        <MapPin size={24} />
        <div><strong>{t('savedPointsEmptyTitle')}</strong><span>{t('savedPointsEmptyBody')}</span></div>
      </div>
    )
  }

  return (
    <div className="saved-list">
      {points.map((savedPoint) => (
        <div className="saved-route saved-point" key={savedPoint.id}>
          <button className="saved-route-main" onClick={() => onAdd(savedPoint)} aria-label={t('addToRoute')}>
            <span className="saved-route-icon saved-point-icon"><MapPin size={18} /></span>
            <span>
              <strong>{savedPoint.name}</strong>
              <small>{savedPoint.point.name}</small>
            </span>
            <Plus size={17} />
          </button>
          <button className="saved-delete" onClick={() => onDelete(savedPoint.id)} aria-label={t('clearRoute')}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  )
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  useEffect(() => {
    const handler = (event) => {
      event.preventDefault()
      setPrompt(event)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    setPrompt(null)
  }
  return { canInstall: Boolean(prompt), install }
}

export default function App() {
  const { t, lang, setLang, locale } = useI18n()
  const initial = useMemo(loadSavedState, [])
  const [stops, setStops] = useState(initial.stops)
  const [durationMode, setDurationMode] = useState(initial.durationMode || 'general')
  const [generalMinutes, setGeneralMinutes] = useState(initial.generalMinutes ?? 10)
  const [route, setRoute] = useState(null)
  const [routeState, setRouteState] = useState('idle')
  const [speedZones, setSpeedZones] = useState([])
  const [speedState, setSpeedState] = useState('idle')
  const [savedRoutes, setSavedRoutes] = useState(loadSavedRoutes)
  const [savedPoints, setSavedPoints] = useState(loadSavedPoints)
  const [showSavedRoutes, setShowSavedRoutes] = useState(false)
  const [showSavedPoints, setShowSavedPoints] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [showSocial, setShowSocial] = useState(false)
  const [routeToShare, setRouteToShare] = useState(null)
  const [incomingShared, setIncomingShared] = useState(null)
  const [routeName, setRouteName] = useState('')
  const [pointToSaveId, setPointToSaveId] = useState(null)
  const [pickupPointName, setPickupPointName] = useState('')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(new Date())
  const { canInstall, install } = useInstallPrompt()
  const origin = stops[0]
  const searchBias = useMemo(
    () => origin ? { lat: origin.lat, lng: origin.lng } : GIRONA_CENTER,
    [origin?.lat, origin?.lng],
  )
  const preferredSearchCountry = origin?.countryCode || 'es'

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stops, durationMode, generalMinutes }))
  }, [stops, durationMode, generalMinutes])

  useEffect(() => {
    localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(savedRoutes))
  }, [savedRoutes])

  useEffect(() => {
    localStorage.setItem(SAVED_POINTS_KEY, JSON.stringify(savedPoints))
  }, [savedPoints])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const applyIncomingRoute = (incoming) => {
    if (!incoming) return
    setStops(incoming.stops.map((stop) => ({ ...stop })))
    setDurationMode(incoming.durationMode || 'general')
    setGeneralMinutes(incoming.generalMinutes ?? 10)
    setIncomingShared(incoming)
    setMessage(t('toastSharedRouteOpened', { name: incoming.name }))
  }

  // Web: ruta compartida en la URL al abrir (?r=...)
  useEffect(() => {
    const incoming = readIncomingSharedRoute()
    if (!incoming) return
    applyIncomingRoute(incoming)
    clearIncomingShareParam()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nativo (Android): enlace abierto dentro de la app instalada (App Link)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    let removeListener = () => {}
    ;(async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app')
        const launch = await CapApp.getLaunchUrl()
        if (launch?.url && !cancelled) applyIncomingRoute(readSharedRouteFromUrl(launch.url))
        const handle = await CapApp.addListener('appUrlOpen', (event) => {
          applyIncomingRoute(readSharedRouteFromUrl(event.url))
        })
        removeListener = () => handle.remove()
      } catch {
        // @capacitor/app no disponible: sin deep-link nativo, la app sigue funcionando.
      }
    })()
    return () => {
      cancelled = true
      removeListener()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (stops.length < 2) {
      setRoute(null)
      setRouteState('idle')
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setRouteState('loading')
      try {
        const coordinates = stops.map((stop) => `${stop.lng},${stop.lat}`).join(';')
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(translate('routeServiceError'))
        const data = await response.json()
        if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(translate('noCarRoute'))
        setRoute(data.routes[0])
        setRouteState('ready')
      } catch (error) {
        if (error.name !== 'AbortError') {
          setRoute(null)
          setRouteState('error')
          setMessage(error.message || translate('toastRouteCalcFailed'))
        }
      }
    }, 450)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [stops])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), 4200)
    return () => clearTimeout(timer)
  }, [message])

  const routeLine = useMemo(
    () => route?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || [],
    [route],
  )
  const routeCountries = useMemo(
    () => [...new Set(stops.map((stop) => stop.countryCode).filter(Boolean))],
    [stops],
  )

  useEffect(() => {
    const bounds = getRouteBounds(routeLine)
    if (!bounds || routeState !== 'ready') {
      setSpeedZones([])
      setSpeedState('idle')
      return
    }

    if (!routeCountries.length) {
      setSpeedZones([])
      setSpeedState('unknown')
      return
    }

    const supportedCountries = routeCountries.filter((country) => country === 'fr' || country === 'es')
    if (!supportedCountries.length) {
      setSpeedZones([])
      setSpeedState(routeCountries.includes('ch') ? 'restricted' : 'unsupported')
      return
    }

    const controller = new AbortController()
    let requestTimeout
    const roundedBounds = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => value.toFixed(2)).join(',')
    const countryKey = [...supportedCountries].sort().join('-')
    const cacheKey = `${countryKey}:${roundedBounds}`
    const cached = speedZoneCache.get(cacheKey)
    if (cached) {
      setSpeedZones(cached)
      setSpeedState('ready')
      return
    }

    const loadSpeedZones = async () => {
      setSpeedState('loading')
      try {
        const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
        const areaStatements = supportedCountries.map((country) => `area["ISO3166-1"="${country.toUpperCase()}"][admin_level="2"]->.${country};`).join('')
        const nodeStatements = supportedCountries.map((country) => `node(area.${country})["highway"="speed_camera"](${bbox});`).join('')
        const query = `[out:json][timeout:18];${areaStatements}(${nodeStatements});out tags;`
        lastSpeedRequestAt = Date.now()
        requestTimeout = setTimeout(() => controller.abort(), 20_000)
        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Servicio de zonas no disponible')
        const data = await response.json()
        const isFrenchCoverage = supportedCountries.includes('fr')
        const zones = buildSpeedDangerZones(data.elements || [], routeLine, isFrenchCoverage ? {
          idPrefix: countryKey,
          label: translate('zoneLabelFrance'),
        } : {
          idPrefix: 'es-fixed',
          radius: 500,
          mergeDistanceKm: 0.8,
          label: translate('zoneLabelSpain'),
        })
        speedZoneCache.set(cacheKey, zones)
        setSpeedZones(zones)
        setSpeedState('ready')
      } catch {
        if (!controller.signal.aborted) setSpeedState('error')
      } finally {
        clearTimeout(requestTimeout)
      }
    }

    const cooldown = Math.max(1800, 12_000 - (Date.now() - lastSpeedRequestAt))
    const delay = setTimeout(loadSpeedZones, cooldown)
    return () => {
      clearTimeout(delay)
      clearTimeout(requestTimeout)
      controller.abort()
    }
  }, [routeCountries, routeLine, routeState])
  const summary = useMemo(
    () => getRouteSummary(route, stops, durationMode, generalMinutes, now),
    [route, stops, durationMode, generalMinutes, now],
  )

  const addStop = (place) => {
    setStops((current) => [...current, makeStop(place, current.length ? generalMinutes : 0)])
  }

  const openSavePoint = (stop) => {
    setPointToSaveId(stop.id)
    setPickupPointName('')
  }

  const savePickupPoint = () => {
    const sourcePoint = stops.find((stop) => stop.id === pointToSaveId)
    const customName = pickupPointName.trim()
    if (!sourcePoint || !customName) {
      setMessage(t('toastPointNameNeeded'))
      return
    }

    const savedPoint = {
      id: crypto.randomUUID(),
      name: customName,
      createdAt: new Date().toISOString(),
      point: {
        lat: sourcePoint.lat,
        lng: sourcePoint.lng,
        name: sourcePoint.name,
        countryCode: sourcePoint.countryCode,
      },
    }
    setSavedPoints((current) => [savedPoint, ...current])
    setPointToSaveId(null)
    setPickupPointName('')
    setShowSavedPoints(true)
    setMessage(t('toastPointSaved', { name: savedPoint.name }))
  }

  const addSavedPoint = (savedPoint) => {
    addStop({ ...savedPoint.point, name: savedPoint.name })
    setShowSavedPoints(false)
    setMessage(t('toastPointAdded', { name: savedPoint.name }))
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage(t('toastNoGeoloc'))
      return
    }
    setMessage(t('toastSearchingLocation'))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const currentStop = makeStop({
          lat: coords.latitude,
          lng: coords.longitude,
          name: t('myLocationName'),
          isCurrentLocation: true,
        }, 0)
        setStops((current) => current.length ? [currentStop, ...current.slice(1)] : [currentStop])
        setMessage(t('toastLocationSet'))
      },
      () => setMessage(t('toastLocationDenied')),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    )
  }

  const updateStop = (index, patch) => {
    setStops((current) => current.map((stop, stopIndex) => stopIndex === index ? { ...stop, ...patch } : stop))
  }

  const moveStop = (index, direction) => {
    setStops((current) => {
      const next = [...current]
      const target = index + direction
      if (target <= 0 || target >= current.length - 1) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const clearRoute = () => {
    setStops([])
    setRoute(null)
    setPointToSaveId(null)
    setPickupPointName('')
    setMessage(t('toastRouteCleared'))
  }

  const optimize = () => {
    if (stops.length < 4) {
      setMessage(t('toastNeedTwoStops'))
      return
    }
    setStops((current) => optimizeIntermediateStops([...current]))
    setMessage(t('toastStopsSorted'))
  }

  const navigate = async () => {
    const url = buildGoogleMapsUrl(stops)
    if (!url) return
    if (Capacitor.isNativePlatform()) {
      try {
        const { completed } = await AppLauncher.openUrl({ url })
        if (completed) return
      } catch {
        // Fall back to the browser when no compatible navigation app is installed.
      }
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    window.location.href = url
  }

  const saveCurrentRoute = () => {
    if (stops.length < 2) return
    const createdAt = new Date().toISOString()
    const fallbackName = t('fallbackRouteName', { date: new Date(createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })
    const savedRoute = {
      id: crypto.randomUUID(),
      name: routeName.trim() || fallbackName,
      createdAt,
      stops: stops.map((stop) => ({ ...stop })),
      durationMode,
      generalMinutes,
    }
    setSavedRoutes((current) => [savedRoute, ...current])
    setRouteName('')
    setShowSaveForm(false)
    setShowSavedRoutes(true)
    setMessage(t('toastRouteSaved', { name: savedRoute.name }))
  }

  const loadRoute = (savedRoute) => {
    setStops(savedRoute.stops.map((stop) => ({ ...stop })))
    setDurationMode(savedRoute.durationMode || 'general')
    setGeneralMinutes(savedRoute.generalMinutes ?? 10)
    setShowSavedRoutes(false)
    setMessage(t('toastRouteLoaded', { name: savedRoute.name }))
  }

  const shareRouteLink = async (savedRoute) => {
    try {
      const url = buildShareUrl(savedRoute)
      if (navigator.share) {
        await navigator.share({ title: savedRoute.name, text: t('shareLinkText', { name: savedRoute.name }), url })
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setMessage(t('toastLinkCopied'))
        return
      }
      window.prompt(t('shareLinkPrompt'), url)
    } catch (error) {
      if (error?.name === 'AbortError') return
      setMessage(t('toastLinkFailed'))
    }
  }

  const saveIncomingSharedRoute = () => {
    if (!incomingShared) return
    setSavedRoutes((current) => [incomingShared, ...current])
    setShowSavedRoutes(true)
    setMessage(t('toastRouteSavedToMine', { name: incomingShared.name }))
    setIncomingShared(null)
  }

  return (
    <main className="app-shell">
      <section className="map-panel">
        <RouteMap stops={stops} routeLine={routeLine} speedZones={speedZones} onMapPick={addStop} />
        <header className="brand-bar">
          <div className="brand-mark">T</div>
          <div><strong>TRACKPI</strong></div>
          {canInstall && (
            <button onClick={install} className="install-button"><Download size={17} /> {t('install')}</button>
          )}
        </header>
        <div className="map-hint"><Crosshair size={15} /> {t('mapHint')}</div>
      </section>

      <section className="planner-panel">
        <div className="panel-scroll">
          <div className="planner-head">
            <div>
              <p className="eyebrow">{t('eyebrowPlan')}</p>
              <h1>{t('title')}</h1>
            </div>
            <div className="head-tools">
              <label className="lang-select" title={t('languageLabel')}>
                <Languages size={16} aria-hidden="true" />
                <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label={t('languageLabel')}>
                  {LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>{language.name}</option>
                  ))}
                </select>
              </label>
              {stops.length > 0 && (
                <button className="icon-button reset" onClick={clearRoute} aria-label={t('clearRoute')}><RotateCcw size={19} /></button>
              )}
            </div>
          </div>

          <div className="location-tools">
            <PlaceSearch
              onSelect={addStop}
              hasStops={stops.length > 0}
              biasPoint={searchBias}
              preferredCountry={preferredSearchCountry}
            />
            <button className="locate-button" onClick={useCurrentLocation} title={t('useLocationTitle')}>
              <LocateFixed size={21} />
            </button>
          </div>

          <button className="saved-routes-toggle" onClick={() => setShowSavedRoutes((open) => !open)}>
            <span><FolderHeart size={18} /> {t('myRoutes')} {savedRoutes.length > 0 && <b>{savedRoutes.length}</b>}</span>
            {showSavedRoutes ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showSavedRoutes && (
            <SavedRoutes
              routes={savedRoutes}
              onLoad={loadRoute}
              onShare={(savedRoute) => {
                setRouteToShare(savedRoute)
                setShowSocial(true)
              }}
              onShareLink={shareRouteLink}
              onDelete={(id) => {
                setSavedRoutes((current) => current.filter((savedRoute) => savedRoute.id !== id))
                setMessage(t('toastSavedRouteDeleted'))
              }}
            />
          )}

          <button className="social-entry-button" onClick={() => {
            setRouteToShare(null)
            setShowSocial(true)
          }}>
            <span><MessageCircle size={18} /> {t('messagesAndRoutes')}</span>
            <ArrowRight size={18} />
          </button>

          <button className="saved-routes-toggle saved-points-toggle" onClick={() => setShowSavedPoints((open) => !open)}>
            <span><MapPin size={18} /> {t('myPoints')} {savedPoints.length > 0 && <b>{savedPoints.length}</b>}</span>
            {showSavedPoints ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showSavedPoints && (
            <SavedPoints
              points={savedPoints}
              onAdd={addSavedPoint}
              onDelete={(id) => {
                setSavedPoints((current) => current.filter((savedPoint) => savedPoint.id !== id))
                setMessage(t('toastSavedPointDeleted'))
              }}
            />
          )}

          {!stops.length ? (
            <div className="empty-state">
              <div className="empty-illustration">
                <div className="road-line" />
                <MapPin size={38} />
              </div>
              <h2>{t('emptyTitle')}</h2>
              <p>{t('emptyBody')}</p>
              <button onClick={useCurrentLocation}><LocateFixed size={19} /> {t('useMyLocation')}</button>
            </div>
          ) : (
            <>
              <div className="route-section-title">
                <span>{stops.length} {t(stops.length === 1 ? 'pointOne' : 'pointMany')}</span>
                <div>
                  {stops.length >= 2 && <button onClick={() => setShowSaveForm((open) => !open)}><BookmarkPlus size={15} /> {t('save')}</button>}
                  {stops.length >= 4 && <button onClick={optimize}><Sparkles size={15} /> {t('sort')}</button>}
                </div>
              </div>
              {showSaveForm && (
                <div className="save-route-form">
                  <label htmlFor="route-name">{t('routeNameLabel')} <span>{t('optional')}</span></label>
                  <div>
                    <input
                      id="route-name"
                      value={routeName}
                      onChange={(event) => setRouteName(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && saveCurrentRoute()}
                      placeholder={t('routeNamePlaceholder')}
                      maxLength="60"
                      autoFocus
                    />
                    <button onClick={saveCurrentRoute}><Save size={17} /> {t('save')}</button>
                  </div>
                </div>
              )}
              {pointToSaveId && (
                <div className="save-route-form save-point-form">
                  <label htmlFor="pickup-point-name">
                    {t('pickupNameLabel')}
                    <span> · {stops.find((stop) => stop.id === pointToSaveId)?.name}</span>
                  </label>
                  <div>
                    <input
                      id="pickup-point-name"
                      value={pickupPointName}
                      onChange={(event) => setPickupPointName(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && savePickupPoint()}
                      placeholder={t('pickupNamePlaceholder')}
                      maxLength="60"
                      autoFocus
                    />
                    <button className="form-cancel" onClick={() => {
                      setPointToSaveId(null)
                      setPickupPointName('')
                    }} aria-label={t('cancel')}><X size={16} /></button>
                    <button onClick={savePickupPoint} disabled={!pickupPointName.trim()}><Save size={17} /> {t('save')}</button>
                  </div>
                </div>
              )}
              <div className="stops-list">
                {stops.map((stop, index) => (
                  <StopRow
                    key={stop.id}
                    stop={stop}
                    index={index}
                    total={stops.length}
                    durationMode={durationMode}
                    onMinutes={(minutes) => updateStop(index, { minutes })}
                    onMove={(direction) => moveStop(index, direction)}
                    onRemove={() => setStops((current) => current.filter((_, stopIndex) => stopIndex !== index))}
                    onSavePoint={() => openSavePoint(stop)}
                  />
                ))}
              </div>

              <div className="duration-card">
                <div className="card-heading">
                  <div><Clock3 size={20} /><strong>{t('timePerStop')}</strong></div>
                  <div className="mode-switch" role="group" aria-label={t('timePerStop')}>
                    <button className={durationMode === 'general' ? 'active' : ''} onClick={() => setDurationMode('general')}>{t('modeEqual')}</button>
                    <button className={durationMode === 'individual' ? 'active' : ''} onClick={() => setDurationMode('individual')}>{t('modeIndividual')}</button>
                  </div>
                </div>
                {durationMode === 'general' ? (
                  <div className="general-duration">
                    <p>{t('applyAll')}</p>
                    <MinuteStepper value={generalMinutes} onChange={setGeneralMinutes} />
                  </div>
                ) : (
                  <p className="individual-help"><Check size={16} /> {t('adjustBelow')}</p>
                )}
              </div>

              {stops.length >= 2 && <SpeedAlertsCard state={speedState} zones={speedZones} countries={routeCountries} />}
            </>
          )}

          {stops.length >= 2 && (
            <div className="summary-card">
              <div className="summary-top">
                <div>
                  <span>{t('totalTime')}</span>
                  <strong>{routeState === 'loading' ? t('calculating') : formatMinutes(summary.totalMinutes)}</strong>
                </div>
                <div className="arrival-time">
                  <span>{t('arrivalApprox')}</span>
                  <strong>{summary.arrival.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</strong>
                </div>
              </div>
              <div className="stats-grid">
                <Stat icon={<CarFront size={18} />} label={t('driving')} value={formatMinutes(summary.drivingMinutes)} />
                <Stat icon={<Clock3 size={18} />} label={t('stopsLabel')} value={formatMinutes(summary.stopMinutes)} />
                <Stat icon={<Route size={18} />} label={t('distance')} value={`${summary.distanceKm.toFixed(1)} km`} />
              </div>
              {routeState === 'error' && <p className="route-error">{t('routeErrorSummary')}</p>}
              {stops.length > 5 && (
                <p className="waypoint-warning">{t('waypointWarning')}</p>
              )}
            </div>
          )}
        </div>

        <div className="bottom-action">
          <button className="navigate-button" disabled={stops.length < 2 || routeState !== 'ready'} onClick={navigate}>
            <span className="nav-icon"><Navigation size={22} fill="currentColor" /></span>
            <span><small>{t('openGoogleMaps')}</small><strong>{t('startNavigation')}</strong></span>
            <ArrowRight size={22} />
          </button>
          <p>{t('autoSaved')}</p>
        </div>
      </section>

      {incomingShared && (
        <div className="shared-banner">
          <div className="shared-banner-text">
            <strong>{t('sharedBannerTitle')}</strong>
            <span>{incomingShared.name}</span>
          </div>
          <div className="shared-banner-actions">
            <button className="shared-banner-save" onClick={saveIncomingSharedRoute}>{t('sharedBannerSave')}</button>
            <button className="shared-banner-dismiss" onClick={() => setIncomingShared(null)} aria-label={t('cancel')}><X size={18} /></button>
          </div>
        </div>
      )}
      {message && <div className="toast">{message}</div>}
      <Suspense fallback={null}>
        <SocialPanel
          open={showSocial}
          onClose={() => {
            setShowSocial(false)
            setRouteToShare(null)
          }}
          savedRoutes={savedRoutes}
          initialRouteToShare={routeToShare}
          onRouteShared={() => setRouteToShare(null)}
          onOpenSharedRoute={(sharedRoute) => {
            loadRoute(sharedRoute)
            setShowSocial(false)
            setRouteToShare(null)
          }}
          onSaveSharedRoute={(sharedRoute) => {
            setSavedRoutes((current) => [sharedRoute, ...current])
            setShowSavedRoutes(true)
            setMessage(t('toastRouteSavedToMine', { name: sharedRoute.name }))
          }}
        />
      </Suspense>
    </main>
  )
}
