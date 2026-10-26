-- Prerequisite for the following guard patch: Cloud can retain Windows CRLF
-- function bodies while local PostgreSQL has LF. Preserve the existing function,
-- grants and behavior; normalize only CRLF pairs, not literal carriage returns.
do $$
declare definition text;
begin
  select pg_get_functiondef('private.guard_cash_count_movement()'::regprocedure) into definition;
  if position(chr(13)||chr(10) in definition)>0 then
    execute replace(definition,chr(13)||chr(10),chr(10));
  end if;
end $$;
