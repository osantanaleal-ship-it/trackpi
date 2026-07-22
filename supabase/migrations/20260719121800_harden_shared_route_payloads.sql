alter table public.salvi_messages
  add constraint salvi_messages_route_payload_size
  check (route_payload is null or pg_column_size(route_payload) <= 65536),
  add constraint salvi_messages_route_payload_shape
  check (
    kind <> 'route'
    or (
      route_payload->>'version' = '1'
      and jsonb_typeof(route_payload->'stops') = 'array'
      and jsonb_array_length(route_payload->'stops') between 2 and 20
      and char_length(trim(coalesce(route_payload->>'name', ''))) between 1 and 60
      and char_length(trim(coalesce(body, ''))) between 1 and 60
    )
  );
