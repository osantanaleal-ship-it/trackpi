import { describe, expect, it } from 'vitest'
import { makeSharedRoutePayload, sharedPayloadToSavedRoute } from './social-service.js'

describe('rutas compartidas', () => {
  const savedRoute = {
    id: 'route-1',
    name: 'Recogidas del lunes',
    durationMode: 'individual',
    generalMinutes: 10,
    stops: [
      { id: 'a', lat: 41.9794, lng: 2.8214, name: 'Girona', countryCode: 'es', minutes: 0 },
      { id: 'b', lat: 41.9667, lng: 2.7821, name: 'Espai Gironès', countryCode: 'es', minutes: 15 },
    ],
  }

  it('envía únicamente los campos seguros y necesarios de la ruta', () => {
    const payload = makeSharedRoutePayload(savedRoute)
    expect(payload).toMatchObject({ version: 1, name: 'Recogidas del lunes', durationMode: 'individual' })
    expect(payload.stops).toHaveLength(2)
    expect(payload.stops[0]).not.toHaveProperty('id')
  })

  it('reconstruye una copia independiente que se puede guardar', () => {
    const imported = sharedPayloadToSavedRoute(makeSharedRoutePayload(savedRoute))
    expect(imported.name).toBe('Recogidas del lunes')
    expect(imported.stops).toHaveLength(2)
    expect(imported.id).not.toBe(savedRoute.id)
    expect(imported.stops[0].id).not.toBe(savedRoute.stops[0].id)
  })

  it('rechaza rutas con coordenadas manipuladas', () => {
    const payload = makeSharedRoutePayload(savedRoute)
    payload.stops[0].lat = 999
    expect(() => sharedPayloadToSavedRoute(payload)).toThrow('coordenadas')
  })
})
