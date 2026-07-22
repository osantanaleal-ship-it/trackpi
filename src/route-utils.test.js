import { describe, expect, it } from 'vitest'
import {
  buildGoogleMapsUrl,
  buildLegMapsUrl,
  buildFrenchDangerZones,
  buildSpeedDangerZones,
  formatMinutes,
  getRouteBounds,
  getRouteSummary,
  getStopMinutes,
  legModeOf,
  optimizeIntermediateStops,
  routeSingleMode,
} from './route-utils.js'

const stops = [
  { lat: 46.2, lng: 6.1, minutes: 0 },
  { lat: 46.3, lng: 6.2, minutes: 15 },
  { lat: 46.4, lng: 6.3, minutes: 20 },
]

describe('route calculations', () => {
  it('counts every visit but not the starting point', () => {
    expect(getStopMinutes(stops, 'individual', 10)).toBe(35)
    expect(getStopMinutes(stops, 'general', 12)).toBe(24)
  })

  it('combines driving and stop time', () => {
    const summary = getRouteSummary({ duration: 3600, distance: 24500 }, stops, 'individual', 10, new Date('2026-01-01T08:00:00Z'))
    expect(summary.totalMinutes).toBe(95)
    expect(summary.distanceKm).toBe(24.5)
    expect(summary.arrival.toISOString()).toBe('2026-01-01T09:35:00.000Z')
  })

  it('formats readable durations', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(95)).toBe('1 h 35 min')
  })
})

describe('navigation URL', () => {
  it('includes intermediate waypoints in order', () => {
    const url = new URL(buildGoogleMapsUrl(stops))
    expect(url.searchParams.get('origin')).toBe('46.200000,6.100000')
    expect(url.searchParams.get('destination')).toBe('46.400000,6.300000')
    expect(url.searchParams.get('waypoints')).toBe('46.300000,6.200000')
    expect(url.searchParams.get('dir_action')).toBe('navigate')
  })

  it('lets Google use the device position for a live start', () => {
    const url = new URL(buildGoogleMapsUrl([{ ...stops[0], isCurrentLocation: true }, stops[1]]))
    expect(url.searchParams.has('origin')).toBe(false)
  })

  it('keeps four intermediate stops in a six-point route', () => {
    const sixStops = Array.from({ length: 6 }, (_, index) => ({ lat: 41.9 + index / 100, lng: 2.7 + index / 100 }))
    const url = new URL(buildGoogleMapsUrl(sixStops))
    expect(url.searchParams.get('waypoints').split('|')).toHaveLength(4)
    expect(url.searchParams.get('destination')).toBe('41.950000,2.750000')
  })
})

describe('transporte por tramo', () => {
  it('detecta cuando toda la ruta usa el mismo transporte', () => {
    expect(routeSingleMode([{}, { mode: 'car' }, { mode: 'car' }])).toBe('car')
    expect(routeSingleMode([{}, { mode: 'bike' }])).toBe('bike')
    expect(routeSingleMode([{}])).toBe('car') // sin tramos
    expect(routeSingleMode([{}, {}])).toBe('car') // sin modo = coche
  })

  it('devuelve null cuando hay transportes mezclados', () => {
    expect(routeSingleMode([{}, { mode: 'car' }, { mode: 'bike' }])).toBe(null)
  })

  it('normaliza modos desconocidos a coche', () => {
    expect(legModeOf({ mode: 'teletransporte' })).toBe('car')
    expect(legModeOf({})).toBe('car')
    expect(legModeOf({ mode: 'walk' })).toBe('walk')
  })

  it('usa el travelmode de Google Maps del modo elegido', () => {
    expect(new URL(buildGoogleMapsUrl(stops, 'bicycling')).searchParams.get('travelmode')).toBe('bicycling')
  })

  it('genera un enlace de un solo tramo con su transporte', () => {
    const url = new URL(buildLegMapsUrl({ lat: 41.9, lng: 2.8 }, { lat: 41.4, lng: 2.1 }, 'walk'))
    expect(url.searchParams.get('origin')).toBe('41.900000,2.800000')
    expect(url.searchParams.get('destination')).toBe('41.400000,2.100000')
    expect(url.searchParams.get('travelmode')).toBe('walking')
  })

  it('omite el origen del tramo cuando es la ubicación actual', () => {
    const url = new URL(buildLegMapsUrl({ lat: 41.9, lng: 2.8, isCurrentLocation: true }, { lat: 41.4, lng: 2.1 }, 'car'))
    expect(url.searchParams.has('origin')).toBe(false)
  })

  it('estima el tiempo por tramo según su transporte', () => {
    const legStops = [{ lat: 0, lng: 0 }, { mode: 'car' }, { mode: 'walk' }]
    const route = { distance: 10000, duration: 999, legs: [{ distance: 4000, duration: 300 }, { distance: 6000, duration: 500 }] }
    const summary = getRouteSummary(route, legStops, 'general', 0, new Date('2026-01-01T08:00:00Z'))
    // coche usa la duración OSRM (300 s); a pie estima 6000 m / 1,4 m/s ≈ 4286 s → total ≈ 76 min
    expect(summary.drivingMinutes).toBe(76)
    expect(summary.transitPending).toBe(false)
  })

  it('excluye el transporte público del tiempo y lo marca como pendiente', () => {
    const transitStops = [{ lat: 0, lng: 0 }, { mode: 'transit' }]
    const route = { distance: 5000, duration: 600, legs: [{ distance: 5000, duration: 600 }] }
    const summary = getRouteSummary(route, transitStops, 'general', 0, new Date('2026-01-01T08:00:00Z'))
    expect(summary.drivingMinutes).toBe(0)
    expect(summary.transitPending).toBe(true)
  })
})

describe('stop ordering', () => {
  it('keeps the origin and destination fixed', () => {
    const input = [
      { id: 'origin', lat: 0, lng: 0 },
      { id: 'far', lat: 8, lng: 8 },
      { id: 'near', lat: 1, lng: 1 },
      { id: 'destination', lat: 10, lng: 10 },
    ]
    const result = optimizeIntermediateStops(input)
    expect(result.map((stop) => stop.id)).toEqual(['origin', 'near', 'far', 'destination'])
  })
})

describe('legal French danger zones', () => {
  const line = [[46.19, 6.1], [46.2, 6.2], [46.21, 6.3]]

  it('creates broad zones only for cameras close to the route', () => {
    const cameras = [
      { id: 1, lat: 46.2002, lon: 6.2001 },
      { id: 2, lat: 47.2, lon: 7.2 },
    ]
    const zones = buildFrenchDangerZones(cameras, line)
    expect(zones).toHaveLength(1)
    expect(zones[0].radius).toBe(2000)
  })

  it('calculates a padded query area', () => {
    expect(getRouteBounds(line, 0.01)).toEqual({ south: 46.18, west: 6.09, north: 46.22, east: 6.31 })
  })

  it('supports a smaller Spanish fixed-camera area', () => {
    const zones = buildSpeedDangerZones([{ id: 3, lat: 46.2, lon: 6.2 }], line, {
      idPrefix: 'es-fixed',
      radius: 500,
      mergeDistanceKm: 0.8,
    })
    expect(zones[0].id).toBe('es-fixed-3')
    expect(zones[0].radius).toBe(500)
  })
})
