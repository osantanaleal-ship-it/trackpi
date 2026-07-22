import { makeSharedRoutePayload, sharedPayloadToSavedRoute } from './social-service.js'

// URL público donde está desplegada la PWA. Si se define, los enlaces
// compartidos apuntan ahí para que quien los reciba pueda abrir la ruta en el
// navegador sin instalar la app. Si no, se usa el origen actual (dentro del
// APK eso es https://localhost y el enlace solo sirve para tu propio equipo).
const PUBLIC_APP_URL = import.meta.env.VITE_PUBLIC_APP_URL

function toBase64Url(text) {
  const base64 = btoa(unescape(encodeURIComponent(text)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.length % 4 ? base64 + '='.repeat(4 - (base64.length % 4)) : base64
  return decodeURIComponent(escape(atob(padded)))
}

export function encodeSharedRoute(savedRoute) {
  const payload = makeSharedRoutePayload(savedRoute)
  return toBase64Url(JSON.stringify(payload))
}

export function decodeSharedRoute(encoded) {
  const payload = JSON.parse(fromBase64Url(String(encoded).trim()))
  return sharedPayloadToSavedRoute(payload)
}

export function buildShareUrl(savedRoute) {
  const encoded = encodeSharedRoute(savedRoute)
  let base = PUBLIC_APP_URL
  if (!base && typeof window !== 'undefined') {
    base = `${window.location.origin}${window.location.pathname}`
  }
  base = (base || '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  return `${base}/?r=${encoded}`
}

export function readSharedRouteFromUrl(urlString) {
  try {
    const url = new URL(urlString)
    let encoded = url.searchParams.get('r')
    if (!encoded && url.hash) {
      encoded = new URLSearchParams(url.hash.replace(/^#/, '')).get('r')
    }
    if (!encoded) return null
    return decodeSharedRoute(encoded)
  } catch {
    return null
  }
}

export function readIncomingSharedRoute() {
  if (typeof window === 'undefined') return null
  return readSharedRouteFromUrl(window.location.href)
}

export function clearIncomingShareParam() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  url.searchParams.delete('r')
  let hash = url.hash
  if (hash) {
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
    hashParams.delete('r')
    const rest = hashParams.toString()
    hash = rest ? `#${rest}` : ''
  }
  window.history.replaceState({}, document.title, `${url.origin}${url.pathname}${url.search}${hash}`)
}
