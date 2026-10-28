-- Phase 02A: independent messaging domain. No account/number/token is seeded.
create type public.conversation_status as enum ('OPEN','CLOSED');
create type public.message_direction as enum ('INBOUND','OUTBOUND');
create type public.message_status as enum ('RECEIVED','PENDING','SENT','DELIVERED','READ','FAILED');
create table public.whatsapp_accounts (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 waba_id text not null check(waba_id ~ '^[0-9]{1,64}$'),
 phone_number_id text not null unique check(phone_number_id ~ '^[0-9]{1,64}$'),
 display_phone_number text not null check(length(display_phone_number) between 1 and 40),
 active boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.contacts (
 id uuid primary key default gen_random_uuid(),
 whatsapp_account_id uuid not null references public.whatsapp_accounts(id),
 wa_id text not null check(length(wa_id) between 1 and 128),
 phone text check(length(phone) <= 25),
 display_name text check(length(display_name) <= 120),
 email text check(length(email) <= 254 and email like '%@%'),
 city text check(length(city) <= 120), state text check(state ~ '^[A-Z]{2}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(whatsapp_account_id,wa_id), unique(id,whatsapp_account_id)
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 whatsapp_account_id uuid not null references public.whatsapp_accounts(id),
 contact_id uuid not null,
 lead_id uuid references public.leads(id),
 status public.conversation_status not null default 'OPEN',
 last_message_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(contact_id,whatsapp_account_id) references public.contacts(id,whatsapp_account_id)
);
create unique index conversations_one_open_idx on public.conversations(whatsapp_account_id,contact_id) where status='OPEN';
create index conversations_lead_idx on public.conversations(lead_id);
create index conversations_contact_idx on public.conversations(contact_id);
create index conversations_last_message_idx on public.conversations(last_message_at desc nulls last,id);
create table public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id),
 external_message_id text unique check(length(external_message_id) between 1 and 256),
 direction public.message_direction not null,
 type text not null check(length(type) between 1 and 40),
 text_body text check(length(text_body) <= 10000),
 status public.message_status not null,
 sent_by_profile_id uuid references public.profiles(id),
 provider_timestamp timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((direction='INBOUND' and status='RECEIVED' and sent_by_profile_id is null and external_message_id is not null)
   or (direction='OUTBOUND' and status<>'RECEIVED')),
 check(type<>'text' or (text_body is not null and length(text_body)>0))
);
create index messages_conversation_time_idx on public.messages(conversation_id,provider_timestamp desc,created_at desc,id);
create table public.webhook_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='WHATSAPP'),
 event_key text not null check(length(event_key) between 1 and 512),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 received_at timestamptz not null default now(), processed_at timestamptz,
 processing_error text check(length(processing_error)<=500),
 unique(provider,event_key)
);
-- New entities cannot be written directly through the public API, even by ADMIN.
alter table public.whatsapp_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.webhook_events enable row level security;
revoke all on public.whatsapp_accounts,public.contacts,public.conversations,public.messages,public.webhook_events from public,anon,authenticated,service_role;
grant select on public.whatsapp_accounts,public.contacts,public.conversations,public.messages to authenticated;
create policy whatsapp_accounts_read on public.whatsapp_accounts for select to authenticated using(app_private.current_role()='ADMIN');
create policy conversations_read on public.conversations for select to authenticated using(
 app_private.current_role()='ADMIN' or exists(
 select 1 from public.leads l where l.id=lead_id and l.assigned_employee_id=app_private.current_employee_id()));
create policy contacts_read on public.contacts for select to authenticated using(
 app_private.current_role()='ADMIN' or exists(select 1 from public.conversations c where c.contact_id=contacts.id));
create policy messages_read on public.messages for select to authenticated using(
 exists(select 1 from public.conversations c where c.id=conversation_id));
-- webhook_events has no client grants or policies. Operational inspection is SQL-only.
create function app_private.touch_whatsapp_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); return new; end;
$$;
revoke all on function app_private.touch_whatsapp_updated_at() from public;
create trigger whatsapp_accounts_updated before update on public.whatsapp_accounts for each row execute function app_private.touch_whatsapp_updated_at();
create trigger contacts_updated before update on public.contacts for each row execute function app_private.touch_whatsapp_updated_at();
create trigger conversations_updated before update on public.conversations for each row execute function app_private.touch_whatsapp_updated_at();
create trigger messages_updated before update on public.messages for each row execute function app_private.touch_whatsapp_updated_at();

-- Invoker view: both table RLS and the current lead owner apply on every read.
create view public.conversation_inbox with (security_invoker=true) as
 select c.*,ct.display_name as contact_name,ct.phone as contact_phone,ct.wa_id,
  latest.text_body as last_message_text,latest.type as last_message_type
 from public.conversations c join public.contacts ct on ct.id=c.contact_id
 left join lateral (
  select m.text_body,m.type from public.messages m where m.conversation_id=c.id
  order by m.provider_timestamp desc nulls last,m.created_at desc,m.id desc limit 1
 ) latest on true;
revoke all on public.conversation_inbox from public,anon,authenticated,service_role;
grant select on public.conversation_inbox to authenticated;
