alter table public.rubber_bills
  add column formula_version smallint not null default 1;

alter table public.rubber_bills
  add constraint rubber_bills_formula_version_check
  check (formula_version in (1, 2));

comment on column public.rubber_bills.formula_version is
  '1 preserves the historical two-decimal formula; 2 floors calculated line values and rubber value to whole baht.';

alter table public.rubber_bills
  alter column net_rubber_value set expression as (
    case
      when weight > 0 then
        case
          when formula_version >= 2 then floor(
            rubber_value * trunc(greatest(weight - deduct_weight, 0), 2) / weight
          )
          else round(
            rubber_value * trunc(greatest(weight - deduct_weight, 0), 2) / weight,
            2
          )
        end
      else 0
    end
  ),
  alter column payable_before_rounding set expression as (
    greatest(
      case
        when weight > 0 then
          case
            when formula_version >= 2 then floor(
              rubber_value * trunc(greatest(weight - deduct_weight, 0), 2) / weight
            )
            else round(
              rubber_value * trunc(greatest(weight - deduct_weight, 0), 2) / weight,
              2
            )
          end
        else 0
      end - deduction_total,
      0
    )
  );

comment on column public.rubber_bills.net_rubber_value is
  'Rubber value after the bill net-weight proportion: v1 rounds half-up to 2 decimals; v2 floors to whole baht.';

comment on column public.rubber_bills.payable_before_rounding is
  'Versioned rubber value minus money deductions before final whole-baht flooring.';

create or replace function private.assign_rubber_bill_formula_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_rubber_export_id is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.formula_version := 2;
  elsif row(
    new.weight,
    new.deduct_weight,
    new.rubber_value,
    new.deduction_total,
    new.net_total
  ) is distinct from row(
    old.weight,
    old.deduct_weight,
    old.rubber_value,
    old.deduction_total,
    old.net_total
  ) then
    new.formula_version := 2;
  end if;

  return new;
end;
$$;

revoke all on function private.assign_rubber_bill_formula_version()
  from public, anon, authenticated;

create trigger assign_rubber_bill_formula_version
before insert or update on public.rubber_bills
for each row execute function private.assign_rubber_bill_formula_version();

create or replace function private.normalize_rubber_bill_calculation_payload(payload jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_operation text := payload->>'operation';
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_type text;
  v_in_weight numeric;
  v_out_weight numeric;
  v_row_weight numeric;
  v_price numeric;
  v_quantity numeric;
  v_line_value numeric;
  v_total_weight numeric := 0;
  v_total_weigh_value numeric := 0;
  v_money_deduction_raw numeric := 0;
  v_deduct_weight numeric;
  v_net_weight numeric;
  v_average_price numeric;
  v_net_rubber_value numeric;
  v_deduction_total numeric;
  v_payable_before_rounding numeric;
  v_weigh_count integer := 0;
begin
  if v_operation not in ('create', 'update') then
    return payload;
  end if;

  if jsonb_typeof(payload->'items') <> 'array' then
    raise exception 'items must be an array';
  end if;

  v_deduct_weight := coalesce(nullif(payload->>'deductWeight', '')::numeric, 0);
  if v_deduct_weight < 0 or v_deduct_weight <> round(v_deduct_weight, 2) then
    raise exception 'deductWeight must be non-negative with at most 2 decimal places';
  end if;

  for v_item in
    select value from jsonb_array_elements(payload->'items')
  loop
    v_item_type := v_item->>'itemType';

    if v_item_type = 'weigh' then
      v_in_weight := nullif(v_item->>'inWeight', '')::numeric;
      v_out_weight := nullif(v_item->>'outWeight', '')::numeric;

      if v_in_weight is not null and v_out_weight is not null then
        if v_in_weight < 0 or v_out_weight < 0 then
          raise exception 'weigh-row weights must be non-negative';
        end if;
        if v_in_weight <> round(v_in_weight, 2)
           or v_out_weight <> round(v_out_weight, 2) then
          raise exception 'weigh-row weights must have at most 2 decimal places';
        end if;
        v_row_weight := v_in_weight - v_out_weight;
      else
        v_row_weight := nullif(v_item->>'netWeight', '')::numeric;
        if v_row_weight is null or v_row_weight <> round(v_row_weight, 2) then
          raise exception 'weigh-row net weight must have at most 2 decimal places';
        end if;
      end if;

      v_price := nullif(v_item->>'unitPrice', '')::numeric;
      if v_row_weight <= 0 then
        raise exception 'weigh-row net weight must be positive';
      end if;
      if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
        raise exception 'weigh-row price must be non-negative with at most 2 decimal places';
      end if;

      v_row_weight := round(v_row_weight, 2);
      v_line_value := floor(v_row_weight * v_price);
      v_total_weight := v_total_weight + v_row_weight;
      v_total_weigh_value := v_total_weigh_value + v_line_value;
      v_weigh_count := v_weigh_count + 1;
      v_item := v_item || jsonb_build_object(
        'netWeight', v_row_weight,
        'totalAmount', v_line_value
      );

    elsif v_item_type in ('acid', 'stock_deduction') then
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_price := nullif(v_item->>'unitPrice', '')::numeric;
      if v_quantity is null
         or v_quantity <= 0
         or v_quantity <> round(v_quantity, 2)
         or v_price is null
         or v_price < 0
         or v_price <> round(v_price, 2) then
        raise exception 'stock deductions must use non-negative values with at most 2 decimal places';
      end if;

      v_line_value := floor(v_quantity * v_price);
      v_money_deduction_raw := v_money_deduction_raw + v_line_value;
      v_item := v_item || jsonb_build_object(
        'totalAmount', v_line_value
      );

    elsif v_item_type = 'debt' then
      v_line_value := nullif(v_item->>'totalAmount', '')::numeric;
      if v_line_value is null
         or v_line_value < 0
         or v_line_value <> round(v_line_value, 2) then
        raise exception 'debt deductions must be non-negative with at most 2 decimal places';
      end if;
      v_money_deduction_raw := v_money_deduction_raw + v_line_value;
      v_item := v_item || jsonb_build_object(
        'totalAmount', round(v_line_value, 2)
      );
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  if v_weigh_count = 0 or v_total_weight <= 0 then
    raise exception 'at least one positive weigh row is required';
  end if;
  if v_deduct_weight >= v_total_weight then
    raise exception 'deductWeight must be less than total weight';
  end if;

  v_total_weight := round(v_total_weight, 2);
  v_net_weight := trunc(v_total_weight - v_deduct_weight, 2);
  v_average_price := round(v_total_weigh_value / v_total_weight, 2);
  v_net_rubber_value := floor(
    v_total_weigh_value * v_net_weight / v_total_weight
  );
  v_deduction_total := round(v_money_deduction_raw, 2);
  v_payable_before_rounding := greatest(
    v_net_rubber_value - v_deduction_total,
    0
  );

  return payload || jsonb_build_object(
    'formulaVersion', 2,
    'items', v_items,
    'weight', v_total_weight,
    'netWeight', v_net_weight,
    'rubberValue', v_total_weigh_value,
    'netRubberValue', v_net_rubber_value,
    'averagePrice', v_average_price,
    'deductionTotal', v_deduction_total,
    'payableBeforeRounding', v_payable_before_rounding,
    'netTotal', floor(v_payable_before_rounding)
  );
end;
$$;

revoke all on function private.normalize_rubber_bill_calculation_payload(jsonb)
  from public, anon, authenticated;

comment on function private.normalize_rubber_bill_calculation_payload(jsonb) is
  'Recalculates Rubber Bill v2 values: floor calculated line values and rubber value to whole baht while preserving two-decimal input precision.';

notify pgrst, 'reload schema';
