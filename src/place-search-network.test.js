import { afterEach, describe, expect, it, vi } from 'vitest'
import { GIRONA_CENTER, searchPlaces } from './place-search.js'

afterEach(() => vi.unstubAllGlobals())

describe('busqueda local sin red', () => {
  it('mantiene Espai Girones si el proveedor remoto no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')))

    const results = await searchPlaces('spai', { bias: GIRONA_CENTER })

    expect(results[0]).toMatchObject({
      id: 'trackpi-espai-girones',
      city: 'Salt',
    })
  })
})
