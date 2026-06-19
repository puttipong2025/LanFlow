alter table public.offline_sync_events
  drop constraint if exists offline_sync_events_client_temp_id_key;
