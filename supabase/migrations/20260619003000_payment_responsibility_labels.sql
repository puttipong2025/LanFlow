alter table public.customers
  drop constraint if exists customers_class_check;

update public.customers
set class = case class
  when 'ชาวสวน' then 'สาขานี้จ่าย'
  when 'ผู้ค้าขาย' then 'สาขาใหญ่จ่าย'
  else class
end;

alter table public.customers
  add constraint customers_class_check
  check (class in ('สาขานี้จ่าย', 'สาขาใหญ่จ่าย'));

alter table public.rubber_bills
  drop constraint if exists rubber_bills_customer_type_check;

update public.rubber_bills
set customer_type = case customer_type
  when 'ชาวสวน' then 'สาขานี้จ่าย'
  when 'ผู้ค้าขาย' then 'สาขาใหญ่จ่าย'
  else customer_type
end;

alter table public.rubber_bills
  add constraint rubber_bills_customer_type_check
  check (customer_type in ('สาขานี้จ่าย', 'สาขาใหญ่จ่าย'));
