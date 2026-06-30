-- ============================================================
-- Supabase setup for the Motion Edit user study
-- Run this once in:  Supabase dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- One row per (rater session, scenario).
create table if not exists public.responses (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null,          -- one study run
  device_id      uuid,                   -- stable per browser (links repeat attempts)
  attempt        int  default 1,         -- 1 = first run, 2+ = "take again"
  scenario_id    text not null,          -- e.g. "dog_jumping"
  scenario_order int,                    -- position in this rater's shuffled sequence
  rank1          text,                   -- condition ranked #1 (gold)
  rank2          text,                   -- condition ranked #2 (silver)
  rank3          text,                   -- condition ranked #3 (bronze)
  worst          text,                   -- condition marked worst (red ✗)
  ratings        jsonb,                  -- { condition: { motion: int, visual: int } } for top-3
  positions      jsonb,                  -- { condition: displaySlotIndex } for position-bias audit
  dwell_ms       int,                    -- time spent on the scenario
  user_agent     text,
  screen_size    text,
  created_at     timestamptz default now()
);

-- Helpful indexes for aggregation later.
create index if not exists responses_scenario_idx on public.responses (scenario_id);
create index if not exists responses_session_idx  on public.responses (session_id);

-- Row Level Security: the public anon key may ONLY insert.
-- It cannot read, update, or delete. You read results from the
-- dashboard / SQL editor (service role), so participant data stays private.
alter table public.responses enable row level security;

drop policy if exists "anon can insert responses" on public.responses;
create policy "anon can insert responses"
  on public.responses
  for insert
  to anon
  with check (true);
