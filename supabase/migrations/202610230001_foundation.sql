-- All application writes use authorized RPCs. Audit records share the lead transaction.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;
create type public.app_role as enum ('ADMIN','AGENT');
create type public.availability as enum ('AVAILABLE','BUSY','AWAY','OFFLINE');
create type public.lead_status as enum ('NEW','ASSIGNED','IN_PROGRESS','CLOSED_WON','CLOSED_LOST');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 role public.app_role not null default 'AGENT',
 created_at timestamptz not null default now()
);
create table public.employees (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null unique references public.profiles(id),
 name text not null check (length(trim(name)) between 2 and 120),
 email text not null unique check (length(email) <= 254 and email like '%@%'),
 phone text not null default '' check(length(phone) <= 25),
 availability public.availability not null default 'OFFLINE',
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 2 and 80),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table public.employee_products (
 employee_id uuid not null references public.employees(id) on delete cascade,
 product_id uuid not null references public.products(id), primary key(employee_id,product_id)
);
create table public.leads (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 name text not null check(length(trim(name)) between 2 and 120),
 phone text not null check(phone ~ '^\+?[0-9 ()-]{8,25}$'),
 email text check(length(email) <= 254 and email like '%@%'),
 city text check(length(city) <= 120), state text check(state ~ '^[A-Z]{2}$'),
 product_id uuid not null references public.products(id), notes text not null default '' check(length(notes) <= 5000),
 status public.lead_status not null default 'NEW',
 assigned_employee_id uuid references public.employees(id), assigned_at timestamptz,
 constraint assignment_consistency check ((status='NEW' and assigned_employee_id is null and assigned_at is null) or (status<>'NEW' and assigned_employee_id is not null and assigned_at is not null))
);
create table public.lead_events (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id),
 actor_id uuid not null references public.profiles(id), action text not null,
 data jsonb not null default '{}', created_at timestamptz not null default now()
);
create index leads_assignee_status_idx on public.leads(assigned_employee_id,status);
create index leads_created_idx on public.leads(created_at desc);
create index leads_status_idx on public.leads(status);
create index lead_events_lead_created_idx on public.lead_events(lead_id,created_at desc);
create index lead_events_created_idx on public.lead_events(created_at desc);
create index employee_products_product_idx on public.employee_products(product_id);
create function app_private.current_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p join public.employees e on e.profile_id=p.id where p.id=auth.uid() and e.active;
$$;
create function app_private.current_employee_id() returns uuid language sql stable security definer set search_path='' as $$
 select e.id from public.employees e where e.profile_id=auth.uid() and e.active;
$$;
create function app_private.require_admin() returns void language plpgsql stable security definer set search_path='' as $$
 begin if app_private.current_role() is distinct from 'ADMIN'::public.app_role then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if; end;
$$;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.products enable row level security;
alter table public.employee_products enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (app_private.current_role()='ADMIN' or (id=auth.uid() and app_private.current_role() is not null));
create policy employees_read on public.employees for select to authenticated using (app_private.current_role()='ADMIN' or id=app_private.current_employee_id());
create policy products_read on public.products for select to authenticated using (app_private.current_role() is not null);
create policy specialties_read on public.employee_products for select to authenticated using (app_private.current_role()='ADMIN' or employee_id=app_private.current_employee_id());
create policy leads_read on public.leads for select to authenticated using (app_private.current_role()='ADMIN' or assigned_employee_id=app_private.current_employee_id());
create policy events_read on public.lead_events for select to authenticated using (exists(select 1 from public.leads l where l.id=lead_id));
revoke all on public.profiles, public.employees, public.products, public.employee_products, public.leads, public.lead_events from anon, authenticated;
grant select on public.profiles, public.employees, public.products, public.employee_products, public.leads, public.lead_events to authenticated;
revoke all on all functions in schema app_private from public;
grant execute on function app_private.current_role(),app_private.current_employee_id() to authenticated;
create function app_private.audit_lead() returns trigger language plpgsql security definer set search_path='' as $$
 declare event_action text;
 begin
 if TG_OP='INSERT' then event_action:='CREATED';
 elsif new.assigned_employee_id is distinct from old.assigned_employee_id then event_action:=case when old.assigned_employee_id is null then 'ASSIGNED' else 'TRANSFERRED' end;
 elsif new.status is distinct from old.status then event_action:=case when new.status='IN_PROGRESS' then 'STARTED' when new.status in ('CLOSED_WON','CLOSED_LOST') then 'FINISHED' else 'STATUS_CHANGED' end;
 else return new; end if;
 insert into public.lead_events(lead_id,actor_id,action,data) values(new.id,auth.uid(),event_action,
 jsonb_build_object('actor_name',(select name from public.employees where profile_id=auth.uid()),'employee_name',(select name from public.employees where id=new.assigned_employee_id),'previous_employee_name',case when TG_OP='UPDATE' then (select name from public.employees where id=old.assigned_employee_id) else null end,'status',new.status,'employee_id',new.assigned_employee_id,'previous_status',case when TG_OP='UPDATE' then old.status else null end,'previous_employee_id',case when TG_OP='UPDATE' then old.assigned_employee_id else null end));
 return new;
 end;
$$;
revoke all on function app_private.audit_lead() from public;
create trigger lead_audit after insert or update on public.leads for each row execute function app_private.audit_lead();
