-- Greenlight persistence (3/3): private Storage bucket for verification evidence.
--
-- public = false: objects are never served by public URL. No storage.objects
-- policies are created for this bucket, so the anon and authenticated roles can
-- neither read, list nor write it; only the service role (the Greenlight server)
-- can. Object paths look like projects/<projectId>/runs/<runId>/<file> and are
-- never returned by any public API. Uploads never overwrite (x-upsert: false).
-- An existing bucket of the same name is left exactly as it is.

insert into storage.buckets (id, name, public, file_size_limit)
values ('greenlight-evidence', 'greenlight-evidence', false, 104857600) -- 100 MB per object
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'greenlight-evidence' and public) then
    raise exception 'greenlight: bucket greenlight-evidence exists and is PUBLIC; refusing to use it for private evidence';
  end if;
end $$;
