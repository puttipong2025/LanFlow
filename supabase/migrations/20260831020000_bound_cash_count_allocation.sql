-- Bound Cash Count denomination allocation across exact and change searches.

begin;

create or replace function private.cash_exact_take_bounded(
  p_available bigint[],
  p_target bigint,
  p_position integer,
  p_budget integer
)
returns table (
  take_counts bigint[],
  attempts_used integer,
  search_exhausted boolean
)
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_suffix_total bigint := 0;
  v_suffix_gcd bigint := 0;
  v_max_take bigint;
  v_min_take bigint;
  v_local_attempts integer := 0;
  v_remaining bigint;
  v_child_take bigint[];
  v_child_attempts integer;
  v_child_exhausted boolean;
begin
  take_counts := null;
  attempts_used := 0;
  search_exhausted := false;

  if p_budget <= 0 then
    search_exhausted := true;
    return next;
    return;
  end if;
  if p_target < 0 or p_position > 9 then
    return next;
    return;
  end if;
  if p_position = 9 then
    attempts_used := 1;
    if p_target <= p_available[9] then
      take_counts := array_fill(0::bigint, array[9]);
      take_counts[9] := p_target;
    end if;
    return next;
    return;
  end if;

  for v_i in (p_position + 1)..9 loop
    v_suffix_total := v_suffix_total + p_available[v_i] * v_denoms[v_i];
    if p_available[v_i] > 0 then
      v_suffix_gcd := case
        when v_suffix_gcd = 0 then v_denoms[v_i]
        else gcd(v_suffix_gcd, v_denoms[v_i])
      end;
    end if;
  end loop;

  v_max_take := least(p_available[p_position], p_target / v_denoms[p_position]);
  v_min_take := greatest(
    0,
    ceil(greatest(0, p_target - v_suffix_total)::numeric / v_denoms[p_position])::bigint
  );
  if v_min_take > v_max_take then
    return next;
    return;
  end if;

  for v_take in reverse v_max_take..v_min_take loop
    v_local_attempts := v_local_attempts + 1;
    if v_local_attempts > 256 then
      return next;
      return;
    end if;
    attempts_used := attempts_used + 1;
    if attempts_used > p_budget then
      take_counts := null;
      search_exhausted := true;
      return next;
      return;
    end if;

    v_remaining := p_target - v_take * v_denoms[p_position];
    if v_suffix_gcd = 0 then
      if v_remaining <> 0 then continue; end if;
      take_counts := array_fill(0::bigint, array[9]);
      take_counts[p_position] := v_take;
      return next;
      return;
    end if;
    if v_remaining % v_suffix_gcd <> 0 then continue; end if;

    select r.take_counts, r.attempts_used, r.search_exhausted
    into v_child_take, v_child_attempts, v_child_exhausted
    from private.cash_exact_take_bounded(
      p_available,
      v_remaining,
      p_position + 1,
      p_budget - attempts_used
    ) r;
    attempts_used := attempts_used + coalesce(v_child_attempts, 0);
    if v_child_exhausted then
      take_counts := null;
      search_exhausted := true;
      return next;
      return;
    end if;
    if v_child_take is not null then
      v_child_take[p_position] := v_take;
      take_counts := v_child_take;
      return next;
      return;
    end if;
  end loop;

  return next;
end;
$$;

create or replace function private.cash_take_with_change(
  p_available bigint[],
  p_target bigint,
  p_max_change bigint default 999
)
returns table (
  take_counts bigint[],
  change_amount bigint,
  search_exhausted boolean
)
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_budget constant integer := 20000;
  v_budget_left integer := v_budget;
  v_available_total bigint := 0;
  v_max_delta bigint;
  v_take bigint[];
  v_attempts integer;
  v_exhausted boolean;
begin
  take_counts := null;
  change_amount := null;
  search_exhausted := false;

  if p_target < 0 or p_max_change < 0 or coalesce(array_length(p_available, 1), 0) <> 9 then
    return next;
    return;
  end if;
  for v_i in 1..9 loop
    if p_available[v_i] < 0 then
      return next;
      return;
    end if;
    v_available_total := v_available_total + p_available[v_i] * v_denoms[v_i];
  end loop;
  if v_available_total < p_target then
    return next;
    return;
  end if;

  v_max_delta := least(p_max_change, v_available_total - p_target);
  for v_delta in 0..v_max_delta loop
    select r.take_counts, r.attempts_used, r.search_exhausted
    into v_take, v_attempts, v_exhausted
    from private.cash_exact_take_bounded(
      p_available,
      p_target + v_delta,
      1,
      v_budget_left
    ) r;
    v_budget_left := v_budget_left - coalesce(v_attempts, 0);
    if v_exhausted or v_budget_left <= 0 then
      search_exhausted := true;
      return next;
      return;
    end if;
    if v_take is not null then
      take_counts := v_take;
      change_amount := v_delta;
      return next;
      return;
    end if;
  end loop;

  return next;
end;
$$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.submit_cash_count(uuid,jsonb)'::regprocedure
  );
  v_unused_declaration text := E'  v_available_total bigint;\n';
  v_old text := $old$        v_take := private.cash_exact_take(v_expected, v_target);
        v_simulated_count := v_simulated_count + 1;
        if v_take is null then
          v_available_total := 0;
          v_selected_delta := null;
          for v_i in 1..9 loop
            v_available_total := v_available_total + v_expected[v_i] * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
          end loop;
          if v_available_total >= v_target then
            for v_try_delta in 1..least(999, v_available_total - v_target) loop
              v_take := private.cash_exact_take(v_expected, v_target + v_try_delta);
              if v_take is not null then
                v_selected_delta := v_try_delta;
                exit;
              end if;
            end loop;
          end if;
          if v_take is null then
            v_allocation_failures := v_allocation_failures + 1;
          else
            v_change := private.cash_change_counts(v_selected_delta);
            for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i] + v_change[v_i]; end loop;
            v_change_count := v_change_count + 1;
            v_change_amount := v_change_amount + v_selected_delta;
          end if;
        else
          for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i]; end loop;
        end if;$old$;
  v_new text := $new$        select allocation.take_counts, allocation.change_amount
        into v_take, v_selected_delta
        from private.cash_take_with_change(v_expected, v_target, 999) allocation;
        v_simulated_count := v_simulated_count + 1;
        if v_take is null then
          v_allocation_failures := v_allocation_failures + 1;
        elsif v_selected_delta > 0 then
          v_change := private.cash_change_counts(v_selected_delta);
          for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i] + v_change[v_i]; end loop;
          v_change_count := v_change_count + 1;
          v_change_amount := v_change_amount + v_selected_delta;
        else
          for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i]; end loop;
        end if;$new$;
begin
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'CASH_COUNT_ALLOCATION_ANCHOR_MISMATCH';
  end if;
  if (length(v_definition) - length(replace(v_definition, v_unused_declaration, ''))) / length(v_unused_declaration) <> 1 then
    raise exception 'CASH_COUNT_ALLOCATION_DECLARATION_ANCHOR_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute replace(v_definition, v_unused_declaration, '');
end
$migration$;

alter function private.cash_exact_take_bounded(bigint[],bigint,integer,integer) owner to postgres;
alter function private.cash_take_with_change(bigint[],bigint,bigint) owner to postgres;

revoke all on function private.cash_exact_take_bounded(bigint[],bigint,integer,integer)
from public, anon, authenticated;
revoke all on function private.cash_take_with_change(bigint[],bigint,bigint)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
