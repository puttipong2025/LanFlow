-- The public RPC wrapper reuses an existing signature after moving the
-- original implementation to private. Force PostgREST to resolve the new OID.
notify pgrst, 'reload schema';
