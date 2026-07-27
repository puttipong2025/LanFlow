alter table public.rubber_bills
  alter column rubber_value type numeric(14,4)
  using round(rubber_value::numeric, 4);

-- This product has not entered use yet, so normalize every existing fixture
-- into the new contract even when a local report fixture currently locks it.
alter table public.rubber_bills disable trigger user;

with bill_totals as (
  select
    b.id,
    coalesce(
      sum(i.net_weight) filter (where i.item_type = 'weigh'),
      b.weight
    )::numeric as weight_total,
    coalesce(
      sum(i.net_weight * i.price) filter (where i.item_type = 'weigh'),
      b.rubber_value
    )::numeric as weigh_value_total,
    coalesce(
      sum(i.total) filter (where i.item_type <> 'weigh'),
      0
    )::numeric as money_deduction_total
  from public.rubber_bills b
  left join public.rubber_bill_items i on i.bill_id = b.id
  group by b.id, b.weight, b.rubber_value
),
normalized as (
  select
    b.id,
    round(t.weight_total, 2) as weight_total,
    greatest(
      0,
      least(
        round(b.deduct_weight, 2),
        greatest(round(t.weight_total, 2) - 0.01, 0)
      )
    ) as deduct_weight,
    round(t.weigh_value_total, 4) as weigh_value_total,
    round(t.money_deduction_total, 2) as money_deduction_total
  from public.rubber_bills b
  join bill_totals t on t.id = b.id
)
update public.rubber_bills b
set
  weight = n.weight_total,
  deduct_weight = n.deduct_weight,
  rubber_value = n.weigh_value_total,
  average_price = case
    when n.weight_total > 0
      then round(n.weigh_value_total / n.weight_total, 2)
    else 0
  end,
  deduction_total = n.money_deduction_total,
  net_total = floor(greatest(
    (
      case
        when n.weight_total > 0
          then round(
            n.weigh_value_total
            * trunc(greatest(n.weight_total - n.deduct_weight, 0), 2)
            / n.weight_total,
            2
          )
        else 0
      end
    ) - n.money_deduction_total,
    0
  ))
from normalized n
where n.id = b.id;

alter table public.rubber_bills enable trigger user;

alter table public.rubber_bills
  add column net_weight numeric(12,2)
    generated always as (
      trunc(greatest(weight - deduct_weight, 0), 2)
    ) stored,
  add column net_rubber_value numeric(14,2)
    generated always as (
      case
        when weight > 0
          then round(
            rubber_value
            * trunc(greatest(weight - deduct_weight, 0), 2)
            / weight,
            2
          )
        else 0
      end
    ) stored,
  add column payable_before_rounding numeric(14,2)
    generated always as (
      greatest(
        (
          case
            when weight > 0
              then round(
                rubber_value
                * trunc(greatest(weight - deduct_weight, 0), 2)
                / weight,
                2
              )
            else 0
          end
        ) - deduction_total,
        0
      )
    ) stored;

alter table public.rubber_bills
  add constraint rubber_bills_weight_positive_check
    check (weight > 0),
  add constraint rubber_bills_deduct_weight_range_check
    check (deduct_weight >= 0 and deduct_weight < weight),
  add constraint rubber_bills_money_values_nonnegative_check
    check (
      rubber_value >= 0
      and average_price >= 0
      and deduction_total >= 0
      and net_total >= 0
    ),
  add constraint rubber_bills_net_total_whole_baht_check
    check (net_total = trunc(net_total)),
  add constraint rubber_bills_net_total_formula_check
    check (net_total = floor(payable_before_rounding));

comment on column public.rubber_bills.weight is
  'Sum of weigh-row net weights before the single bill-level weight deduction.';
comment on column public.rubber_bills.deduct_weight is
  'Single bill-level weight deduction entered by the user.';
comment on column public.rubber_bills.net_weight is
  'Bill net weight: total weigh-row weight minus the bill-level weight deduction.';
comment on column public.rubber_bills.rubber_value is
  'Exact weigh-row value total before applying the bill-level weight proportion.';
comment on column public.rubber_bills.net_rubber_value is
  'Rubber value after applying the bill net-weight proportion, rounded half-up to 2 decimals.';
comment on column public.rubber_bills.deduction_total is
  'Money deductions only (stock and debt); excludes the bill-level weight deduction.';
comment on column public.rubber_bills.payable_before_rounding is
  'Net rubber value minus money deductions before whole-baht flooring.';
comment on column public.rubber_bills.net_total is
  'Actual customer payable amount floored to whole baht.';

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.rubber_export_candidates(uuid,timestamp with time zone)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    'round(b.weight - b.deduct_weight, 2)',
    'b.net_weight'
  );
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.get_money_transfer_receipt_source_details(uuid)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    'rb.weight - rb.deduct_weight',
    'rb.net_weight'
  );
  execute v_definition;
end;
$$;
