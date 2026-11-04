-- Coverage belongs to a branch. Removing an otherwise deletable branch must
-- also remove its coverage markers, rather than introduce a new deletion lock.
-- Saved bonuses still retain their existing restrictive branch reference.
alter table private.branch_bonus_source_gaps
  drop constraint branch_bonus_source_gaps_location_id_fkey,
  add constraint branch_bonus_source_gaps_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete cascade;
