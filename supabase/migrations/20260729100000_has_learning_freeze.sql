-- WO-LEARNING-LOOP: shared freeze-detection helper (applied prod 2026-07-29).
create or replace function public.has_learning_freeze()
returns boolean language sql stable as $$
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.agent_beliefs'::regclass
      and tgname like 'trg_inc_learn_contam_freeze%'
      and not tgisinternal
  );
$$;
