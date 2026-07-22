import { placeKind } from './i18n.js'

export const GIRONA_CENTER = { lat: 41.9794, lng: 2.8214 }

const SEARCH_COUNTRIES = ['ES', 'FR', 'CH', 'AD', 'PT']

const CATALONIA_HINTS = [
  {
    id: 'trackpi-espai-girones',
    name: 'Espai Gironès',
    aliases: ['spai', 'spai girones', 'espai girones', 'espai gironès', 'centre comercial espai girones'],
    lat: 41.9667398,
    lng: 2.7821238,
    countryCode: 'es',
    city: 'Salt',
    county: 'Gironès',
    state: 'Catalunya',
    street: 'Carrer del Pla de Salt',
    postcode: '17190',
    kind: 'Centro comercial',
    osmKey: 'shop',
    osmValue: 'mall',
    source: 'trackpi-catalunya',
    localPriority: 1000,
  },
]

const PLACE_KIND_LABELS = {
  aerodrome: 'Aeropuerto',
  airport: 'Aeropuerto',
  arts_centre: 'Centro cultural',
  bakery: 'Panadería',
  bar: 'Bar',
  bus_station: 'Estación de autobuses',
  bus_stop: 'Parada de autobús',
  cafe: 'Cafetería',
  car_park: 'Aparcamiento',
  cinema: 'Cine',
  fast_food: 'Comida rápida',
  fuel: 'Gasolinera',
  hospital: 'Hospital',
  hotel: 'Hotel',
  mall: 'Centro comercial',
  museum: 'Museo',
  parking: 'Aparcamiento',
  pharmacy: 'Farmacia',
  restaurant: 'Restaurante',
  station: 'Estación',
  supermarket: 'Supermercado',
  theme_park: 'Parque temático',
  train_station: 'Estación de tren',
}

const LOCAL_ADMIN_NAMES = {
  Catalonia: 'Catalunya',
  Catalogne: 'Catalunya',
  Gérone: 'Girona',
  Gironais: 'Gironès',
  'Lower Empordà': 'Baix Empordà',
  'Upper Empordà': 'Alt Empordà',
}

function localAdminName(value = '') {
  return LOCAL_ADMIN_NAMES[value] || value
}

function localPlaceName(properties) {
  const name = properties.name || ''
  if (properties.osm_value === 'aerodrome' && normalizePlaceText(name).includes('girona costa brava airport')) {
    return 'Aeroport de Girona-Costa Brava'
  }
  return name
}

export function normalizePlaceText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function buildSearchVariants(query) {
  const clean = query.trim().replace(/\s+/g, ' ')
  const normalized = normalizePlaceText(clean)
  if (!normalized) return []

  const variants = [clean]
  // In Catalan and Spanish, users commonly omit the initial E in words such as
  // "espai". Photon does not reliably correct that missing first letter.
  if (/^sp[a-z]/.test(normalized)) variants.unshift(`e${clean}`)

  return [...new Set(variants.map((value) => value.toLocaleLowerCase('es')))]
}

function getKind(properties) {
  const value = properties.osm_value || properties.type || ''
  return PLACE_KIND_LABELS[value] || ''
}

export function photonFeatureToPlace(feature) {
  const properties = feature?.properties || {}
  const [lng, lat] = feature?.geometry?.coordinates || []
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null

  const city = localAdminName(properties.city || properties.district || properties.locality || '')
  const name = localPlaceName(properties) || properties.street || city || localAdminName(properties.state) || properties.country
  if (!name) return null

  return {
    id: `photon-${properties.osm_type || 'x'}-${properties.osm_id || `${lat}-${lng}`}`,
    name,
    lat: Number(lat),
    lng: Number(lng),
    countryCode: properties.countrycode?.toLocaleLowerCase('es') || null,
    city,
    county: localAdminName(properties.county || ''),
    state: localAdminName(properties.state || ''),
    street: [properties.street, properties.housenumber].filter(Boolean).join(' '),
    postcode: properties.postcode || '',
    kind: getKind(properties),
    osmKey: properties.osm_key || '',
    osmValue: properties.osm_value || '',
    source: 'photon',
    localPriority: 0,
  }
}

function localMatches(query) {
  const normalizedQuery = normalizePlaceText(query)
  if (!normalizedQuery) return []

  return CATALONIA_HINTS.filter((place) => {
    const terms = [place.name, ...place.aliases].map(normalizePlaceText)
    return terms.some((term) => term === normalizedQuery || term.startsWith(normalizedQuery) || normalizedQuery.startsWith(term))
  })
}

function distanceKm(from, place) {
  if (!from || !Number.isFinite(Number(from.lat)) || !Number.isFinite(Number(from.lng))) return 9999
  const radians = (degrees) => (degrees * Math.PI) / 180
  const lat1 = radians(Number(from.lat))
  const lat2 = radians(Number(place.lat))
  const deltaLat = lat2 - lat1
  const deltaLng = radians(Number(place.lng) - Number(from.lng))
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function textScore(place, normalizedQuery) {
  const name = normalizePlaceText(place.name)
  const address = normalizePlaceText([place.street, place.city, place.county, place.state].filter(Boolean).join(' '))
  if (name === normalizedQuery) return 260
  if (name.startsWith(normalizedQuery)) return 220
  if (name.includes(normalizedQuery)) return 190
  if (address.includes(normalizedQuery)) return 90

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  return tokens.reduce((score, token) => score + (name.includes(token) ? 35 : address.includes(token) ? 12 : 0), 0)
}

function regionScore(place, bias, preferredCountry) {
  const countryCode = place.countryCode?.toLocaleLowerCase('es')
  const isCatalonia = normalizePlaceText(place.state).includes('catalun')
  const isGironaArea = /girones|girona/.test(normalizePlaceText(`${place.county} ${place.city}`))
  const distance = distanceKm(bias, place)
  const proximity = Math.max(0, 155 - Math.min(distance, 155))
  return proximity + (countryCode === preferredCountry ? 50 : 0) + (isCatalonia ? 90 : 0) + (isGironaArea ? 80 : 0)
}

function popularityScore(place) {
  if (place.osmValue === 'mall') return 65
  if (['airport', 'station', 'train_station', 'hospital', 'supermarket', 'museum'].includes(place.osmValue)) return 35
  if (['country', 'state', 'city'].includes(place.osmValue)) return 15
  return 0
}

function intentScore(place, normalizedQuery) {
  const value = normalizePlaceText(place.osmValue)
  const key = normalizePlaceText(place.osmKey)
  const name = normalizePlaceText(place.name)
  const hasAny = (...terms) => terms.some((term) => normalizedQuery.includes(term))

  if (hasAny('estacio', 'estacion', 'estacio', 'tren', 'ave')) {
    if (value === 'train station' || value === 'station') return 280
    if (value === 'transportation') return 220
    if (value === 'platform' || value === 'bus station') return 180
    if (key === 'railway' || key === 'public transport') return 230
    if (value === 'fuel' || name.includes('estacio de servei')) return -160
    if (value === 'pub' || value === 'bar') return -140
  }
  if (hasAny('aeroport', 'aeropuerto', 'airport')) return value === 'airport' || key === 'aeroway' ? 260 : 0
  if (hasAny('centre comercial', 'centro comercial', 'shopping', 'mall')) return value === 'mall' ? 260 : 0
  if (hasAny('gasolinera', 'benzina', 'fuel')) return value === 'fuel' ? 240 : 0
  if (hasAny('parking', 'aparcament', 'aparcamiento')) return ['parking', 'car park'].includes(value) ? 220 : 0
  if (hasAny('hospital', 'urgencies', 'urgencias')) return value === 'hospital' ? 240 : 0
  if (hasAny('farmacia', 'farmacia', 'pharmacy')) return value === 'pharmacy' ? 240 : 0
  if (hasAny('supermercat', 'supermercado')) return value === 'supermarket' ? 230 : 0
  if (hasAny('hotel')) return value === 'hotel' ? 220 : 0
  if (hasAny('restaurant', 'restaurante')) return value === 'restaurant' ? 210 : 0
  return 0
}

export function rankPlaces(places, query, { bias = GIRONA_CENTER, preferredCountry = 'es', limit = 8 } = {}) {
  const normalizedQuery = normalizePlaceText(query)
  const unique = new Map()

  for (const place of places.filter(Boolean)) {
    const key = `${normalizePlaceText(place.name)}:${Number(place.lat).toFixed(4)}:${Number(place.lng).toFixed(4)}`
    if (!unique.has(key) || (place.localPriority || 0) > (unique.get(key).localPriority || 0)) unique.set(key, place)
  }

  return [...unique.values()]
    .map((place) => ({
      ...place,
      searchScore: (place.localPriority || 0)
        + textScore(place, normalizedQuery)
        + regionScore(place, bias, preferredCountry)
        + popularityScore(place)
        + intentScore(place, normalizedQuery),
      distanceKm: distanceKm(bias, place),
    }))
    .sort((a, b) => b.searchScore - a.searchScore || a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit)
}

export function buildPhotonUrl(query, { bias = GIRONA_CENTER } = {}) {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '30')
  url.searchParams.set('lat', String(bias.lat))
  url.searchParams.set('lon', String(bias.lng))
  url.searchParams.set('zoom', '10')
  url.searchParams.set('location_bias_scale', '0.05')
  // Photon's public instance does not accept ca/es as explicit language codes.
  // English avoids French device translations; Catalan administrative names
  // and the few important translated POIs are restored locally above.
  url.searchParams.set('lang', 'en')
  SEARCH_COUNTRIES.forEach((countryCode) => url.searchParams.append('countrycode', countryCode))
  return url
}

export async function searchPlaces(query, { bias = GIRONA_CENTER, preferredCountry = 'es', signal } = {}) {
  const localPlaces = localMatches(query)
  if (localPlaces.length) return rankPlaces(localPlaces, query, { bias, preferredCountry })

  const variants = buildSearchVariants(query)
  const requests = variants.map(async (variant) => {
    const response = await fetch(buildPhotonUrl(variant, { bias }), { signal })
    if (!response.ok) throw new Error('No se pudo buscar')
    const data = await response.json()
    return (data.features || []).map(photonFeatureToPlace)
  })
  const responses = await Promise.allSettled(requests)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const remotePlaces = responses
    .filter((response) => response.status === 'fulfilled')
    .flatMap((response) => response.value)
  return rankPlaces(remotePlaces, query, { bias, preferredCountry })
}

export function formatPlaceSubtitle(place) {
  const locality = [place.postcode, place.city].filter(Boolean).join(' ')
  const kindLabel = placeKind(place.osmValue) || place.kind
  const parts = [kindLabel, place.street, locality, place.county]
  return [...new Set(parts.filter(Boolean))].join(' · ')
}
