import { describe, expect, it } from 'vitest'
import {
  buildPhotonUrl,
  buildSearchVariants,
  GIRONA_CENTER,
  normalizePlaceText,
  photonFeatureToPlace,
  rankPlaces,
} from './place-search.js'

describe('búsqueda de lugares enfocada a Catalunya', () => {
  it('normaliza acentos y corrige la E omitida de "spai"', () => {
    expect(normalizePlaceText('  GIRÓNÈS  ')).toBe('girones')
    expect(buildSearchVariants('spai')).toEqual(['espai', 'spai'])
  })

  it('limita Photon a España y países vecinos con sesgo Girona', () => {
    const url = buildPhotonUrl('Espai', { bias: GIRONA_CENTER })
    expect(url.origin).toBe('https://photon.komoot.io')
    expect(url.searchParams.get('lat')).toBe(String(GIRONA_CENTER.lat))
    expect(url.searchParams.get('lon')).toBe(String(GIRONA_CENTER.lng))
    expect(url.searchParams.get('lang')).toBe('en')
    expect(url.searchParams.getAll('countrycode')).toEqual(['ES', 'FR', 'CH', 'AD', 'PT'])
  })

  it('mantiene nombres catalanes aunque el proveedor traduzca datos administrativos', () => {
    const result = photonFeatureToPlace({
      properties: {
        osm_type: 'R', osm_id: 6740225, osm_key: 'aeroway', osm_value: 'aerodrome',
        name: 'Girona-Costa Brava Airport', city: "Vilobí d'Onyar", county: 'Upper Empordà',
        state: 'Catalonia', countrycode: 'ES',
      },
      geometry: { coordinates: [2.762426, 41.9044947] },
    })

    expect(result).toMatchObject({
      name: 'Aeroport de Girona-Costa Brava',
      county: 'Alt Empordà',
      state: 'Catalunya',
      kind: 'Aeropuerto',
    })
  })

  it('convierte resultados GeoJSON de Photon al formato de Trackpi', () => {
    const result = photonFeatureToPlace({
      properties: {
        osm_type: 'R',
        osm_id: 11682576,
        osm_key: 'shop',
        osm_value: 'mall',
        name: 'Espai Gironès',
        street: 'Carrer del Pla de Salt',
        city: 'Salt',
        county: 'Gironès',
        state: 'Catalunya',
        countrycode: 'ES',
      },
      geometry: { coordinates: [2.7821238, 41.9667398] },
    })

    expect(result).toMatchObject({
      name: 'Espai Gironès',
      countryCode: 'es',
      city: 'Salt',
      kind: 'Centro comercial',
      lat: 41.9667398,
      lng: 2.7821238,
    })
  })

  it('prioriza Catalunya, Girona y los lugares locales conocidos', () => {
    const places = [
      {
        id: 'barcelona-spain', name: 'Spain', lat: 41.3819, lng: 2.1762,
        countryCode: 'es', city: 'Barcelona', state: 'Catalunya', osmValue: 'house',
      },
      {
        id: 'espai-girones', name: 'Espai Gironès', lat: 41.9667, lng: 2.7821,
        countryCode: 'es', city: 'Salt', county: 'Gironès', state: 'Catalunya',
        osmValue: 'mall', localPriority: 1000,
      },
      {
        id: 'spai-prat', name: 'SPAI', lat: 41.32, lng: 2.09,
        countryCode: 'es', city: 'el Prat de Llobregat', state: 'Catalunya', osmValue: 'clinic',
      },
    ]

    expect(rankPlaces(places, 'spai', { bias: GIRONA_CENTER })[0].name).toBe('Espai Gironès')
  })

  it('entiende la intención y pone la estación antes que gasolineras o bares', () => {
    const places = [
      {
        id: 'fuel', name: 'Estació de Servei Girona', lat: 41.97, lng: 2.80,
        countryCode: 'es', city: 'Girona', county: 'Gironès', state: 'Catalunya',
        osmKey: 'amenity', osmValue: 'fuel',
      },
      {
        id: 'pub', name: "Girona l'Estació", lat: 41.98, lng: 2.82,
        countryCode: 'es', city: 'Girona', county: 'Gironès', state: 'Catalunya',
        osmKey: 'amenity', osmValue: 'pub',
      },
      {
        id: 'train', name: 'Estació de Girona', lat: 41.979, lng: 2.817,
        countryCode: 'es', city: 'Girona', county: 'Gironès', state: 'Catalunya',
        osmKey: 'building', osmValue: 'train_station',
      },
    ]

    expect(rankPlaces(places, 'estacio girona', { bias: GIRONA_CENTER })[0].name).toBe('Estació de Girona')
  })
})
