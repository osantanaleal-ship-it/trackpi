create unique index salvi_contacts_unique_members_idx
on public.salvi_contacts (
  least(owner_id, contact_id),
  greatest(owner_id, contact_id)
);

revoke insert, update on public.salvi_profiles from authenticated;
grant insert (id, display_name, updated_at) on public.salvi_profiles to authenticated;
grant update (display_name, updated_at) on public.salvi_profiles to authenticated;

revoke insert on public.salvi_contacts from authenticated;
grant insert (owner_id, contact_id) on public.salvi_contacts to authenticated;

revoke insert, update on public.salvi_messages from authenticated;
grant insert (sender_id, receiver_id, kind, body, route_payload) on public.salvi_messages to authenticated;
grant update (read_at) on public.salvi_messages to authenticated;
