create extension if not exists pgcrypto;

create table public.salvi_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 40),
  member_code text not null default ('SAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))) unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.salvi_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.salvi_profiles(id) on delete cascade,
  contact_id uuid not null references public.salvi_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint salvi_contacts_different_members check (owner_id <> contact_id),
  constraint salvi_contacts_unique_pair unique (owner_id, contact_id)
);

create table public.salvi_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.salvi_profiles(id) on delete cascade,
  receiver_id uuid not null references public.salvi_profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'route')),
  body text,
  route_payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint salvi_messages_different_members check (sender_id <> receiver_id),
  constraint salvi_messages_valid_content check (
    (kind = 'text' and char_length(trim(coalesce(body, ''))) between 1 and 2000 and route_payload is null)
    or
    (kind = 'route' and jsonb_typeof(route_payload) = 'object')
  )
);

create index salvi_contacts_owner_idx on public.salvi_contacts(owner_id);
create index salvi_contacts_contact_idx on public.salvi_contacts(contact_id);
create index salvi_messages_sender_created_idx on public.salvi_messages(sender_id, created_at desc);
create index salvi_messages_receiver_created_idx on public.salvi_messages(receiver_id, created_at desc);

alter table public.salvi_profiles enable row level security;
alter table public.salvi_contacts enable row level security;
alter table public.salvi_messages enable row level security;

create policy "salvi_profiles_insert_own"
on public.salvi_profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "salvi_profiles_select_related"
on public.salvi_profiles for select
to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1
    from public.salvi_contacts contact
    where
      (contact.owner_id = (select auth.uid()) and contact.contact_id = salvi_profiles.id)
      or
      (contact.contact_id = (select auth.uid()) and contact.owner_id = salvi_profiles.id)
  )
);

create policy "salvi_profiles_update_own"
on public.salvi_profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "salvi_contacts_select_participant"
on public.salvi_contacts for select
to authenticated
using ((select auth.uid()) in (owner_id, contact_id));

create policy "salvi_contacts_insert_own"
on public.salvi_contacts for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "salvi_contacts_delete_own"
on public.salvi_contacts for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "salvi_messages_select_participant"
on public.salvi_messages for select
to authenticated
using ((select auth.uid()) in (sender_id, receiver_id));

create policy "salvi_messages_insert_sender"
on public.salvi_messages for insert
to authenticated
with check (
  (select auth.uid()) = sender_id
  and exists (
    select 1
    from public.salvi_contacts contact
    where
      (contact.owner_id = sender_id and contact.contact_id = receiver_id)
      or
      (contact.owner_id = receiver_id and contact.contact_id = sender_id)
  )
);

create policy "salvi_messages_mark_received_read"
on public.salvi_messages for update
to authenticated
using ((select auth.uid()) = receiver_id)
with check ((select auth.uid()) = receiver_id);

create or replace function public.salvi_find_member(p_member_code text)
returns table (id uuid, display_name text, member_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.display_name, profile.member_code
  from public.salvi_profiles profile
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and profile.member_code = upper(trim(p_member_code))
  limit 1;
$$;

revoke all on function public.salvi_find_member(text) from public;
revoke all on function public.salvi_find_member(text) from anon;
grant execute on function public.salvi_find_member(text) to authenticated;

grant select, insert, update on public.salvi_profiles to authenticated;
grant select, insert, delete on public.salvi_contacts to authenticated;
grant select, insert, update on public.salvi_messages to authenticated;

revoke all on public.salvi_profiles from anon;
revoke all on public.salvi_contacts from anon;
revoke all on public.salvi_messages from anon;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'salvi_messages'
  ) then
    alter publication supabase_realtime add table public.salvi_messages;
  end if;
end
$$;
