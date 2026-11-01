-- Once this release is deployed, old branch registrations leave the active list.
-- Keep their rows: existing bills and offline commands still reference these UUIDs.
update private.rubber_bill_issuers
set retired_at=clock_timestamp()
where device_id is null and retired_at is null;
