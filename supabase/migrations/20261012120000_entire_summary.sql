-- Entire provenance per version: checkpoints (metadata only), changelog and code-map summary.
alter table public.versions add column if not exists entire jsonb;
