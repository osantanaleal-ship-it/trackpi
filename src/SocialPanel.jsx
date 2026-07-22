import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  LoaderCircle,
  MessageCircle,
  Plus,
  Route,
  Save,
  Send,
  Share2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  addContact,
  ensureSocialSession,
  findMemberByCode,
  loadContacts,
  loadMessages,
  loadOwnProfile,
  markMessagesRead,
  saveOwnProfile,
  sendRouteMessage,
  sendTextMessage,
  sharedPayloadToSavedRoute,
  subscribeToMessages,
} from './social-service.js'
import { useI18n } from './i18n.js'

function shortTime(value, locale) {
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function ProfileCreator({ busy, error, onCreate }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  return (
    <div className="social-onboarding">
      <span className="social-onboarding-icon"><Users size={32} /></span>
      <p className="eyebrow">{t('onboardingEyebrow')}</p>
      <h2>{t('createProfile')}</h2>
      <p>{t('onboardingBody')}</p>
      <form onSubmit={(event) => {
        event.preventDefault()
        onCreate(name)
      }}>
        <label htmlFor="social-name">{t('howToAppear')}</label>
        <input
          id="social-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('namePlaceholder')}
          minLength="2"
          maxLength="40"
          autoFocus
        />
        <button disabled={busy || name.trim().length < 2}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}
          {t('createMyProfile')}
        </button>
      </form>
      {error && <p className="social-error">{error}</p>}
      <small>{t('profileSecure')}</small>
    </div>
  )
}

function ContactCard({ contact, active, unread, pendingRoute, onSelect, onShare }) {
  const { t } = useI18n()
  return (
    <button className={`social-contact ${active ? 'active' : ''}`} onClick={pendingRoute ? onShare : onSelect}>
      <span className="social-avatar">{contact.display_name.slice(0, 1).toUpperCase()}</span>
      <span>
        <strong>{contact.display_name}</strong>
        <small>{pendingRoute ? t('sendThisRoute') : contact.member_code}</small>
      </span>
      {pendingRoute ? <Share2 size={17} /> : unread > 0 ? <b>{unread}</b> : <MessageCircle size={16} />}
    </button>
  )
}

function RouteMessage({ message, mine, onOpen, onSave }) {
  const { t, locale } = useI18n()
  const payload = message.route_payload
  const stopsCount = payload?.stops?.length || 0
  return (
    <div className={`chat-bubble route-message ${mine ? 'mine' : ''}`}>
      <div className="route-message-title"><Route size={18} /><span><small>{t('sharedRoute')}</small><strong>{payload?.name || t('routeWord')}</strong></span></div>
      <p>{stopsCount} {t(stopsCount === 1 ? 'pointOne' : 'pointMany')} · {payload?.durationMode === 'individual' ? t('individualTimes') : t('minPerStop', { n: payload?.generalMinutes || 0 })}</p>
      <div>
        <button onClick={() => onOpen(payload)}><Route size={15} /> {t('open')}</button>
        <button onClick={() => onSave(payload)}><Save size={15} /> {t('save')}</button>
      </div>
      <time>{shortTime(message.created_at, locale)}</time>
    </div>
  )
}

export default function SocialPanel({
  open,
  onClose,
  savedRoutes,
  initialRouteToShare,
  onRouteShared,
  onOpenSharedRoute,
  onSaveSharedRoute,
}) {
  const { t, locale } = useI18n()
  const [booting, setBooting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [userId, setUserId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [contacts, setContacts] = useState([])
  const [messages, setMessages] = useState([])
  const [selectedContactId, setSelectedContactId] = useState(null)
  const [showAddContact, setShowAddContact] = useState(false)
  const [memberCode, setMemberCode] = useState('SAL-')
  const [draft, setDraft] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const chatEndRef = useRef(null)

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null
  const conversation = useMemo(
    () => selectedContact ? messages.filter((message) =>
      (message.sender_id === userId && message.receiver_id === selectedContact.id)
      || (message.sender_id === selectedContact.id && message.receiver_id === userId)) : [],
    [messages, selectedContact, userId],
  )
  const unreadByContact = useMemo(() => messages.reduce((counts, message) => {
    if (message.receiver_id === userId && !message.read_at) counts[message.sender_id] = (counts[message.sender_id] || 0) + 1
    return counts
  }, {}), [messages, userId])

  const refresh = async (currentUserId) => {
    const [nextContacts, nextMessages] = await Promise.all([loadContacts(currentUserId), loadMessages(currentUserId)])
    setContacts(nextContacts)
    setMessages(nextMessages)
    setSelectedContactId((current) => current && nextContacts.some((contact) => contact.id === current) ? current : nextContacts[0]?.id || null)
  }

  useEffect(() => {
    if (!open) return
    let active = true
    setBooting(true)
    setError('')
    ensureSocialSession()
      .then(async (session) => {
        if (!active || !session?.user) return
        const ownProfile = await loadOwnProfile(session.user.id)
        if (!active) return
        setUserId(session.user.id)
        setProfile(ownProfile)
        if (ownProfile) await refresh(session.user.id)
      })
      .catch((nextError) => active && setError(nextError.message || t('errOpenCommunity')))
      .finally(() => active && setBooting(false))
    return () => { active = false }
  }, [open])

  useEffect(() => {
    if (!open || !profile || !userId) return undefined
    return subscribeToMessages((message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      loadContacts(userId).then(setContacts).catch(() => {})
    })
  }, [open, profile?.id, userId])

  useEffect(() => {
    if (!selectedContact || !userId) return
    markMessagesRead(userId, selectedContact.id)
      .then(() => setMessages((current) => current.map((message) => (
        message.receiver_id === userId && message.sender_id === selectedContact.id && !message.read_at
          ? { ...message, read_at: new Date().toISOString() }
          : message
      ))))
      .catch(() => {})
  }, [selectedContact, userId, conversation.length])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation.length, selectedContactId])

  if (!open) return null

  const createProfile = async (displayName) => {
    setBusy(true)
    setError('')
    try {
      const nextProfile = await saveOwnProfile(userId, displayName)
      setProfile(nextProfile)
      await refresh(userId)
    } catch (nextError) {
      setError(nextError.message || t('errCreateProfile'))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(profile.member_code)
    setNotice(t('codeCopied'))
    setTimeout(() => setNotice(''), 1800)
  }

  const submitContact = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const member = await findMemberByCode(memberCode)
      if (!member) throw new Error(t('errMemberNotFound'))
      const nextContacts = await addContact(userId, member.id)
      setContacts(nextContacts)
      setSelectedContactId(member.id)
      setShowAddContact(false)
      setMemberCode('SAL-')
      setNotice(t('contactAdded', { name: member.display_name }))
    } catch (nextError) {
      setError(nextError.message || t('errAddContact'))
    } finally {
      setBusy(false)
    }
  }

  const appendMessage = (message) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])

  const submitMessage = async (event) => {
    event.preventDefault()
    if (!selectedContact || !draft.trim()) return
    setBusy(true)
    try {
      const message = await sendTextMessage(userId, selectedContact.id, draft)
      if (message) appendMessage(message)
      setDraft('')
    } catch (nextError) {
      setError(nextError.message || t('errSendMessage'))
    } finally {
      setBusy(false)
    }
  }

  const shareRoute = async (contact, route) => {
    if (!route) return
    setBusy(true)
    setError('')
    try {
      const message = await sendRouteMessage(userId, contact.id, route)
      appendMessage(message)
      setSelectedContactId(contact.id)
      setSelectedRouteId('')
      setNotice(t('routeSentTo', { name: contact.display_name }))
      onRouteShared?.()
    } catch (nextError) {
      setError(nextError.message || t('errSendRoute'))
    } finally {
      setBusy(false)
    }
  }

  const useSharedRoute = (payload, mode) => {
    try {
      const route = sharedPayloadToSavedRoute(payload)
      if (mode === 'save') onSaveSharedRoute(route)
      else onOpenSharedRoute(route)
      setNotice(mode === 'save' ? t('routeSavedToMine') : t('routeOpened'))
    } catch (nextError) {
      setError(nextError.message)
    }
  }

  return (
    <div className="social-overlay" role="dialog" aria-modal="true" aria-label="Mensajes y rutas compartidas">
      <div className="social-modal">
        <header className="social-header">
          <div><span className="social-logo"><MessageCircle size={21} /></span><div><strong>{t('socialBrand')}</strong><small>{t('socialSubtitle')}</small></div></div>
          <button onClick={onClose} aria-label={t('close')}><X size={22} /></button>
        </header>

        {booting ? (
          <div className="social-loading"><LoaderCircle className="spin" size={28} /><strong>{t('preparingProfile')}</strong></div>
        ) : !profile ? (
          <ProfileCreator busy={busy} error={error} onCreate={createProfile} />
        ) : (
          <div className="social-body">
            <aside className={`social-sidebar ${selectedContact ? 'has-chat' : ''}`}>
              <div className="social-profile-card">
                <span className="social-avatar large">{profile.display_name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{profile.display_name}</strong><small>{t('yourCode', { code: profile.member_code })}</small></span>
                <button onClick={copyCode} aria-label={t('copyMyCode')}><Copy size={17} /></button>
              </div>

              {initialRouteToShare && (
                <div className="share-intent"><Share2 size={18} /><span><small>{t('sendRouteEyebrow')}</small><strong>{initialRouteToShare.name}</strong></span></div>
              )}

              <div className="social-sidebar-title">
                <strong>{initialRouteToShare ? t('chooseRecipient') : t('contacts')}</strong>
                <button onClick={() => setShowAddContact((show) => !show)}><UserPlus size={17} /> {t('add')}</button>
              </div>
              {showAddContact && (
                <form className="add-contact-form" onSubmit={submitContact}>
                  <label htmlFor="member-code">{t('memberCode')}</label>
                  <div><input id="member-code" value={memberCode} onChange={(event) => setMemberCode(event.target.value.toUpperCase())} maxLength="10" /><button disabled={busy}><Plus size={17} /></button></div>
                </form>
              )}
              <div className="social-contacts">
                {contacts.length ? contacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    active={contact.id === selectedContactId}
                    unread={unreadByContact[contact.id] || 0}
                    pendingRoute={initialRouteToShare}
                    onSelect={() => setSelectedContactId(contact.id)}
                    onShare={() => shareRoute(contact, initialRouteToShare)}
                  />
                )) : (
                  <div className="contacts-empty"><Users size={24} /><strong>{t('noContactsTitle')}</strong><span>{t('noContactsBody')}</span></div>
                )}
              </div>
            </aside>

            <section className={`social-chat ${selectedContact ? 'open' : ''}`}>
              {selectedContact ? (
                <>
                  <div className="chat-header"><button onClick={() => setSelectedContactId(null)} aria-label={t('back')}><ArrowLeft size={19} /></button><span className="social-avatar">{selectedContact.display_name.slice(0, 1).toUpperCase()}</span><span><strong>{selectedContact.display_name}</strong><small>{selectedContact.member_code}</small></span></div>
                  <div className="chat-messages">
                    {!conversation.length && <div className="chat-empty"><MessageCircle size={27} /><strong>{t('startConversation')}</strong><span>{t('startConversationBody')}</span></div>}
                    {conversation.map((message) => message.kind === 'route' ? (
                      <RouteMessage
                        key={message.id}
                        message={message}
                        mine={message.sender_id === userId}
                        onOpen={(payload) => useSharedRoute(payload, 'open')}
                        onSave={(payload) => useSharedRoute(payload, 'save')}
                      />
                    ) : (
                      <div key={message.id} className={`chat-bubble ${message.sender_id === userId ? 'mine' : ''}`}><p>{message.body}</p><time>{shortTime(message.created_at, locale)}</time></div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="route-share-bar">
                    <select value={selectedRouteId} onChange={(event) => setSelectedRouteId(event.target.value)} aria-label={t('sendSavedRoute')}>
                      <option value="">{t('sendSavedRoute')}</option>
                      {savedRoutes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
                    </select>
                    <button disabled={!selectedRouteId || busy} onClick={() => shareRoute(selectedContact, savedRoutes.find((route) => route.id === selectedRouteId))}><Share2 size={17} /> {t('sendRoute')}</button>
                  </div>
                  <form className="chat-composer" onSubmit={submitMessage}>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('messagePlaceholder')} maxLength="2000" />
                    <button disabled={!draft.trim() || busy} aria-label={t('sendMessage')}><Send size={19} /></button>
                  </form>
                </>
              ) : (
                <div className="select-chat"><MessageCircle size={34} /><strong>{t('selectContact')}</strong><span>{t('selectContactBody')}</span></div>
              )}
            </section>
          </div>
        )}
        {error && profile && <div className="social-toast error">{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
        {notice && <div className="social-toast">{notice}</div>}
      </div>
    </div>
  )
}
