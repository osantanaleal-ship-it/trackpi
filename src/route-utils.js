const toPoint = (stop) => `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`

export function getStopMinutes(stops, mode, generalMinutes) {
  if (stops.length < 2) return 0
  return stops.slice(1).reduce((total, stop) => {
    const minutes = mode === 'general' ? generalMinutes : stop.minutes
    return total + Math.max(0, Number(minutes) || 0)
  }, 0)
}

export function getRouteSummary(route, stops, mode, generalMinutes, now = new Date()) {
  const legs = route?.legs || []
  let travelSeconds = 0
  let transitPending = false
  if (legs.length) {
    legs.forEach((leg, index) => {
      const legMode = legModeOf(stops[index + 1])
      if (legMode === 'transit') {
        transitPending = true // sin estimación gratuita para transporte público
        return
      }
      const speed = MODE_SPEED_MPS[legMode]
      travelSeconds += speed ? (leg.distance || 0) / speed : (leg.duration || 0)
    })
  } else {
    travelSeconds = route?.duration || 0
  }

  const drivingMinutes = Math.max(0, Math.round(travelSeconds / 60))
  const stopMinutes = getStopMinutes(stops, mode, generalMinutes)
  const totalMinutes = drivingMinutes + stopMinutes
  const arrival = new Date(now.getTime() + totalMinutes * 60_000)

  return {
    drivingMinutes,
    stopMinutes,
    totalMinutes,
    distanceKm: route ? route.distance / 1000 : 0,
    arrival,
    transitPending,
  }
}

export function formatMinutes(totalMinutes) {
  const value = Math.max(0, Math.round(totalMinutes || 0))
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (!hours) return `${minutes} min`
  if (!minutes) return `${hours} h`
  return `${hours} h ${minutes} min`
}

export const TRANSPORT_MODES = ['car', 'walk', 'bike', 'transit']
const GMAPS_TRAVELMODE = { car: 'driving', walk: 'walking', bike: 'bicycling', transit: 'transit' }
// Velocidades para estimar el tiempo de tramos a pie o en bici (m/s).
const MODE_SPEED_MPS = { walk: 1.4, bike: 4.2 }

export function legModeOf(stop) {
  return TRANSPORT_MODES.includes(stop?.mode) ? stop.mode : 'car'
}

export function getLegModes(stops) {
  return stops.slice(1).map(legModeOf)
}

// Devuelve el modo único si toda la ruta usa el mismo transporte (o solo hay un
// tramo). Devuelve null cuando los tramos mezclan varios transportes.
export function routeSingleMode(stops) {
  const modes = getLegModes(stops)
  if (!modes.length) return 'car'
  return modes.every((mode) => mode === modes[0]) ? modes[0] : null
}

export function gmapsTravelmode(mode) {
  return GMAPS_TRAVELMODE[mode] || 'driving'
}

export function buildGoogleMapsUrl(stops, travelmode = 'driving') {
  if (stops.length < 2) return null

  const origin = stops[0]
  const destination = stops.at(-1)
  const params = new URLSearchParams({
    api: '1',
    destination: toPoint(destination),
    travelmode,
    dir_action: 'navigate',
    utm_source: 'trackpi',
    utm_campaign: 'directions_request',
  })

  if (!origin.isCurrentLocation) params.set('origin', toPoint(origin))
  if (stops.length > 2) {
    params.set('waypoints', stops.slice(1, -1).map(toPoint).join('|'))
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`
}

// Enlace de Google Maps para un único tramo (origen -> destino) con su modo.
export function buildLegMapsUrl(fromStop, toStop, mode = 'car') {
  if (!fromStop || !toStop) return null
  const params = new URLSearchParams({
    api: '1',
    destination: toPoint(toStop),
    travelmode: gmapsTravelmode(mode),
    dir_action: 'navigate',
    utm_source: 'trackpi',
    utm_campaign: 'directions_request',
  })
  if (!fromStop.isCurrentLocation) params.set('origin', toPoint(fromStop))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function distanceSquared(a, b) {
  const latitudeScale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  const x = (a.lng - b.lng) * latitudeScale
  const y = a.lat - b.lat
  return x * x + y * y
}

export function optimizeIntermediateStops(stops) {
  if (stops.length < 4) return stops
  const origin = stops[0]
  const destination = stops.at(-1)
  const remaining = stops.slice(1, -1)
  const ordered = []
  let current = origin

  while (remaining.length) {
    let bestIndex = 0
    let bestDistance = Infinity
    remaining.forEach((candidate, index) => {
      const distance = distanceSquared(current, candidate)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    current = remaining.splice(bestIndex, 1)[0]
    ordered.push(current)
  }

  return [origin, ...ordered, destination]
}

export function distanceKm(a, b) {
  const earthRadiusKm = 6371
  const toRadians = (value) => value * Math.PI / 180
  const deltaLatitude = toRadians(b.lat - a.lat)
  const deltaLongitude = toRadians(b.lng - a.lng)
  const latitudeA = toRadians(a.lat)
  const latitudeB = toRadians(b.lat)
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine))
}

export function getRouteBounds(routeLine, padding = 0.03) {
  if (!routeLine.length) return null
  const latitudes = routeLine.map(([lat]) => lat)
  const longitudes = routeLine.map(([, lng]) => lng)
  return {
    south: Math.min(...latitudes) - padding,
    west: Math.min(...longitudes) - padding,
    north: Math.max(...latitudes) + padding,
    east: Math.max(...longitudes) + padding,
  }
}

export function buildSpeedDangerZones(cameras, routeLine, options = {}) {
  if (!routeLine.length) return []

  const {
    idPrefix = 'speed-zone',
    radius = 2000,
    mergeDistanceKm = 2.5,
    maxRouteDistanceKm = 0.55,
    label = 'Zona de vigilancia de velocidad',
  } = options

  const candidates = cameras.flatMap((camera) => {
    let nearest = null
    routeLine.forEach(([lat, lng], routeIndex) => {
      const separation = distanceKm({ lat: camera.lat, lng: camera.lon }, { lat, lng })
      if (!nearest || separation < nearest.separation) nearest = { lat, lng, routeIndex, separation }
    })
    if (!nearest || nearest.separation > maxRouteDistanceKm) return []
    return [{
      id: `${idPrefix}-${camera.id}`,
      lat: nearest.lat,
      lng: nearest.lng,
      routeIndex: nearest.routeIndex,
      radius,
      label,
    }]
  }).sort((a, b) => a.routeIndex - b.routeIndex)

  return candidates.filter((zone, index, zones) => {
    const previous = zones[index - 1]
    return !previous || distanceKm(zone, previous) > mergeDistanceKm
  })
}

export function buildFrenchDangerZones(cameras, routeLine) {
  return buildSpeedDangerZones(cameras, routeLine, {
    idPrefix: 'fr-zone',
    label: 'Zona de vigilancia de velocidad · Francia',
  })
}
