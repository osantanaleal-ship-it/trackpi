import { describe, expect, it } from 'vitest'
import { decodeSharedRoute, encodeSharedRoute } from './share-link.js'

describe('enlaces de ruta', () => {
  const savedRoute = {
    id: 'route-1',
    name: 'Recogidas del lunes',
    durationMode: 'individual',
    generalMinutes: 10,
    stops: [
      { id: 'a', lat: 41.9794, lng: 2.8214, name: 'Girona Centre', countryCode: 'es', minutes: 0 },
      { id: 'b', lat: 41.9667, lng: 2.7821, name: 'Espai Gironès', countryCode: 'es', minutes: 15 },
    ],
  }

  it('codifica y decodifica una ruta conservando los datos', () => {
    const encoded = encodeSharedRoute(savedRoute)
    expect(typeof encoded).toBe('string')
    expect(encoded).not.toMatch(/[+/=]/) // base64url, sin caracteres inseguros para URL

    const decoded = decodeSharedRoute(encoded)
    expect(decoded.name).toBe('Recogidas del lunes')
    expect(decoded.durationMode).toBe('individual')
    expect(decoded.stops).toHaveLength(2)
    expect(decoded.stops[1].name).toBe('Espai Gironès')
    expect(decoded.stops[1].minutes).toBe(15)
  })

  it('conserva acentos y caracteres no ASCII', () => {
    const decoded = decodeSharedRoute(encodeSharedRoute(savedRoute))
    expect(decoded.stops[0].name).toBe('Girona Centre')
    expect(decoded.stops[1].name).toContain('è')
  })

  it('genera una copia independiente del original', () => {
    const decoded = decodeSharedRoute(encodeSharedRoute(savedRoute))
    expect(decoded.id).not.toBe(savedRoute.id)
    expect(decoded.stops[0].id).not.toBe(savedRoute.stops[0].id)
  })

  it('rechaza una cadena corrupta', () => {
    expect(() => decodeSharedRoute('no-es-base64-valido!!!')).toThrow()
  })
})
