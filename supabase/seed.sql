-- Create preauth-uploads bucket if missing (safe via CLI)
insert into storage.buckets (id, name, public)
values ('preauth-uploads', 'preauth-uploads', false)
on conflict (id) do nothing;
