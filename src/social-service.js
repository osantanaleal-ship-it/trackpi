import { isSocialConfigured, supabase } from './supabase-client.js'
import { translate } from './i18n.js'
import { legModeOf } from './route-utils.js'

function requireClient() {
  if (!isSocialConfigured || !supabase) throw new Error(translate('svcNotConfigured'))
  return supabase
}

export async function ensureSocialSession() {
  const client = requireClient()
  const { data: sessionData } = await client.auth.getSession()
  if (sessionData.session) return sessionData.session

  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw new Error(error.message || translate('svcSessionFailed'))
  return data.session
}

export async function loadOwnProfile(userId) {
  const client = requireClient()
  const { data, error } = await client
    .from('salvi_profiles')
    .select('id, display_name, member_code, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveOwnProfile(userId, displayName) {
  const client = requireClient()
  const cleanName = displayName.trim().replace(/\s+/g, ' ')
  if (cleanName.length < 2 || cleanName.length > 40) throw new Error(translate('svcNameLength'))

  const { data, error } = await client
    .from('salvi_profiles')
    .insert({ id: userId, display_name: cleanName })
    .select('id, display_name, member_code, created_at')
    .single()
  if (error) throw error
  return data
}

export async function findMemberByCode(code) {
  const client = requireClient()
  const normalizedCode = code.trim().toUpperCase()
  const { data, error } = await client.functions.invoke('salvi-find-member', { body: { code: normalizedCode } })
  if (error) throw new Error(error.message || translate('svcFindMember'))
  if (data?.error) throw new Error(data.error)
  return data?.member || null
}

export async function loadContacts(userId) {
  const client = requireClient()
  const { data, error } = await client
    .from('salvi_contacts')
    .select(`
      id, owner_id, contact_id, created_at,
      owner:salvi_profiles!salvi_contacts_owner_id_fkey(id, display_name, member_code),
      contact:salvi_profiles!salvi_contacts_contact_id_fkey(id, display_name, member_code)
    `)
    .or(`owner_id.eq.${userId},contact_id.eq.${userId}`)
    .order('created_at', { ascending: true })
  if (error) throw error

  return (data || []).map((row) => {
    const member = row.owner_id === userId ? row.contact : row.owner
    return { ...member, relationshipId: row.id, relationshipOwnerId: row.owner_id }
  }).filter((member) => member?.id)
}

export async function addContact(userId, memberId) {
  const client = requireClient()
  const { error } = await client
    .from('salvi_contacts')
    .insert({ owner_id: userId, contact_id: memberId })
  if (error && error.code !== '23505') throw error
  return loadContacts(userId)
}

export async function deleteContact(relationshipId) {
  const client = requireClient()
  const { error } = await client.from('salvi_contacts').delete().eq('id', relationshipId)
  if (error) throw error
}

export async function loadMessages(userId) {
  const client = requireClient()
  const { data, error } = await client
    .from('salvi_messages')
    .select('id, sender_id, receiver_id, kind, body, route_payload, created_at, read_at')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: true })
    .limit(400)
  if (error) throw error
  return data || []
}

export async function sendTextMessage(userId, receiverId, body) {
  const client = requireClient()
  const cleanBody = body.trim()
  if (!cleanBody) return null
  if (cleanBody.length > 2000) throw new Error(translate('svcMessageTooLong'))
  const { data, error } = await client
    .from('salvi_messages')
    .insert({ sender_id: userId, receiver_id: receiverId, kind: 'text', body: cleanBody })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function sendRouteMessage(userId, receiverId, savedRoute) {
  const client = requireClient()
  const routePayload = makeSharedRoutePayload(savedRoute)
  const { data, error } = await client
    .from('salvi_messages')
    .insert({
      sender_id: userId,
      receiver_id: receiverId,
      kind: 'route',
      body: routePayload.name,
      route_payload: routePayload,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markMessagesRead(userId, senderId) {
  const client = requireClient()
  const { error } = await client
    .from('salvi_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('receiver_id', userId)
    .eq('sender_id', senderId)
    .is('read_at', null)
  if (error) throw error
}

export function subscribeToMessages(onMessage) {
  const client = requireClient()
  const channel = client
    .channel(`salvi-messages-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'salvi_messages' }, (payload) => onMessage(payload.new))
    .subscribe()
  return () => client.removeChannel(channel)
}

export async function signOutSocialProfile() {
  const client = requireClient()
  const { error } = await client.auth.signOut()
  if (error) throw error
}

export function makeSharedRoutePayload(savedRoute) {
  if (!savedRoute || !Array.isArray(savedRoute.stops) || savedRoute.stops.length < 2) {
    throw new Error(translate('svcInvalidSavedRoute'))
  }
  return {
    version: 1,
    name: String(savedRoute.name || 'Ruta compartida').slice(0, 60),
    durationMode: savedRoute.durationMode === 'individual' ? 'individual' : 'general',
    generalMinutes: Math.max(0, Math.min(240, Number(savedRoute.generalMinutes) || 0)),
    stops: savedRoute.stops.slice(0, 20).map((stop) => ({
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      name: String(stop.name || 'Punto').slice(0, 160),
      countryCode: stop.countryCode || null,
      minutes: Math.max(0, Math.min(240, Number(stop.minutes) || 0)),
      mode: legModeOf(stop),
    })),
  }
}

export function sharedPayloadToSavedRoute(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.stops) || payload.stops.length < 2 || payload.stops.length > 20) {
    throw new Error(translate('svcInvalidSharedRoute'))
  }
  const stops = payload.stops.map((stop) => {
    const lat = Number(stop.lat)
    const lng = Number(stop.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(translate('svcInvalidCoords'))
    }
    return {
      id: crypto.randomUUID(),
      lat,
      lng,
      name: String(stop.name || 'Punto').slice(0, 160),
      countryCode: typeof stop.countryCode === 'string' ? stop.countryCode.slice(0, 2).toLowerCase() : null,
      minutes: Math.max(0, Math.min(240, Number(stop.minutes) || 0)),
      mode: legModeOf(stop),
      isCurrentLocation: false,
    }
  })
  return {
    id: crypto.randomUUID(),
    name: String(payload.name || 'Ruta compartida').slice(0, 60),
    createdAt: new Date().toISOString(),
    stops,
    durationMode: payload.durationMode === 'individual' ? 'individual' : 'general',
    generalMinutes: Math.max(0, Math.min(240, Number(payload.generalMinutes) || 0)),
  }
}
