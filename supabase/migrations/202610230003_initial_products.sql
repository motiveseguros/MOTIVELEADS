insert into public.products(name) values ('Seguro Auto'),('Consórcio') on conflict(name) do nothing;
