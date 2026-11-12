-- Phase 03B1. Only desired responses: no provider calls or fabricated SENT messages.
create type public.whatsapp_intake_status as enum ('ACTIVE','COMPLETE','CANCELLED');
create type public.whatsapp_intake_step as enum ('NAME','PRODUCT','LOCATION','EMAIL','SUPPLEMENTAL','COMPLETE');
create table public.whatsapp_intake_sessions (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null unique references public.conversations(id) on delete cascade,
 status public.whatsapp_intake_status not null default 'ACTIVE',
 current_step public.whatsapp_intake_step not null default 'NAME',
 name text check(length(name) between 2 and 120),
 product_id uuid references public.products(id),
 city text check(length(city) between 2 and 120),
 state text check(state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 email text check(length(email) between 3 and 254),
 supplemental_notes text check(length(supplemental_notes) between 1 and 5000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 check ((status='COMPLETE' and current_step='COMPLETE' and completed_at is not null
   and name is not null and product_id is not null and city is not null and state is not null and email is not null)
   or (status<>'COMPLETE' and current_step<>'COMPLETE' and completed_at is null))
);
-- One turn per persisted inbound message. Also the idempotency boundary for drafts.
create table public.whatsapp_intake_turns (
 message_id uuid primary key references public.messages(id) on delete cascade,
 session_id uuid not null references public.whatsapp_intake_sessions(id) on delete cascade,
 step_before public.whatsapp_intake_step not null,
 step_after public.whatsapp_intake_step not null,
 outcome text not null check(outcome in ('STARTED','ACCEPTED','INVALID','BLOCKED','COMPLETE')),
 created_at timestamptz not null default now()
);
create index whatsapp_intake_turns_session_idx on public.whatsapp_intake_turns(session_id);
create table public.whatsapp_outbound_drafts (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 session_id uuid not null references public.whatsapp_intake_sessions(id) on delete cascade,
 in_reply_to_message_id uuid not null unique references public.whatsapp_intake_turns(message_id) on delete cascade,
 text_body text not null check(length(text_body) between 1 and 4096),
 status text not null default 'DRAFT' check(status='DRAFT'),
 created_at timestamptz not null default now()
);
create index whatsapp_outbound_drafts_session_idx on public.whatsapp_outbound_drafts(session_id);
create trigger whatsapp_intake_updated before update on public.whatsapp_intake_sessions
 for each row execute function app_private.touch_whatsapp_updated_at();
alter table public.whatsapp_intake_sessions enable row level security;
alter table public.whatsapp_intake_turns enable row level security;
alter table public.whatsapp_outbound_drafts enable row level security;
revoke all on public.whatsapp_intake_sessions,public.whatsapp_intake_turns,public.whatsapp_outbound_drafts from public,anon,authenticated,service_role;
revoke all on sequence public.whatsapp_outbound_drafts_sequence_seq from public,anon,authenticated,service_role;
grant select on public.whatsapp_intake_sessions,public.whatsapp_outbound_drafts to authenticated;
-- AGENT continues reading only the commercial lead/conversation through existing RLS.
create policy intake_admin_read on public.whatsapp_intake_sessions for select to authenticated
 using(app_private.current_role()='ADMIN');
create policy intake_drafts_admin_read on public.whatsapp_outbound_drafts for select to authenticated
 using(app_private.current_role()='ADMIN');

-- Explicit system provenance, never an invented ADMIN or an actor from external input.
alter table public.leads add column creation_source text not null default 'MANUAL'
 check(creation_source in ('MANUAL','WHATSAPP_INTAKE'));
alter table public.lead_events alter column actor_id drop not null;
alter table public.lead_events add constraint lead_events_actor_required check (
 actor_id is not null or (coalesce(data->>'source','')='WHATSAPP_INTAKE'
 and action in ('CREATED','CONVERTED_FROM_WHATSAPP_INTAKE'))
);
create or replace function app_private.audit_lead() returns trigger language plpgsql security definer set search_path='' as $$
declare event_action text;
begin
 if TG_OP='INSERT' and new.creation_source='WHATSAPP_INTAKE' then
  insert into public.lead_events(lead_id,actor_id,action,data) values(new.id,null,'CREATED',
   jsonb_build_object('source','WHATSAPP_INTAKE','actor_name','Coleta automática WhatsApp','status',new.status));
  return new;
 end if;
 if TG_OP='INSERT' then event_action:='CREATED';
 elsif new.assigned_employee_id is distinct from old.assigned_employee_id then event_action:=case when old.assigned_employee_id is null then 'ASSIGNED' else 'TRANSFERRED' end;
 elsif new.status is distinct from old.status then event_action:=case when new.status='IN_PROGRESS' then 'STARTED' when new.status in ('CLOSED_WON','CLOSED_LOST') then 'FINISHED' else 'STATUS_CHANGED' end;
 else return new; end if;
 insert into public.lead_events(lead_id,actor_id,action,data) values(new.id,auth.uid(),event_action,
 jsonb_build_object('actor_name',(select name from public.employees where profile_id=auth.uid()),'employee_name',(select name from public.employees where id=new.assigned_employee_id),'previous_employee_name',case when TG_OP='UPDATE' then (select name from public.employees where id=old.assigned_employee_id) else null end,'status',new.status,'employee_id',new.assigned_employee_id,'previous_status',case when TG_OP='UPDATE' then old.status else null end,'previous_employee_id',case when TG_OP='UPDATE' then old.assigned_employee_id else null end));
 return new;
end;
$$;

create function app_private.intake_trim(value text) returns text language sql immutable set search_path='' as $$
 select nullif(btrim(value,U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'),'');
$$;
create function app_private.intake_key(value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(translate(lower(app_private.intake_trim(value)),
 'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[[:space:]]+',' ','g');
$$;
create function app_private.intake_product(value text) returns uuid language sql stable set search_path='' as $$
 select case when count(*)=1 then (array_agg(p.id))[1] else null end
 from public.products p where p.active and app_private.intake_key(p.name)=
 case app_private.intake_key(value)
 when 'seguro' then 'seguro auto' when 'seguro auto' then 'seguro auto'
 when 'seguro de carro' then 'seguro auto' when 'automovel' then 'seguro auto'
 when 'consorcio' then 'consorcio' when 'consorcio auto' then 'consorcio' end;
$$;
create function app_private.intake_prompt(step public.whatsapp_intake_step,contact_name text) returns text
language sql immutable set search_path='' as $$
 select case step
 when 'NAME' then 'Olá! Sou o atendimento da Motive. Para começarmos, qual é o seu nome?'
 when 'PRODUCT' then 'Obrigado, ' || contact_name || '. Qual produto você procura: Seguro Auto ou Consórcio?'
 when 'LOCATION' then 'Qual é sua cidade e estado? Ex.: Vitória/ES.'
 when 'EMAIL' then 'Qual é o melhor e-mail para continuarmos seu atendimento?'
 when 'SUPPLEMENTAL' then 'Perfeito. Existe alguma informação adicional que você gostaria de nos contar? Se não houver, responda ''não''.'
 when 'COMPLETE' then 'Obrigado! Recebemos suas informações e seu atendimento será encaminhado para um especialista da Motive.' end;
$$;

-- Internal technical operation. No EXECUTE for browser roles or service_role:
-- only the authenticated ingest RPC reaches these internal operations.
create function app_private.complete_whatsapp_intake(p_conversation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.conversations; s public.whatsapp_intake_sessions; ct public.contacts; phone_value text; result uuid;
begin
 select * into strict c from public.conversations where id=p_conversation_id for update;
 if c.lead_id is not null then return c.lead_id; end if;
 select * into strict s from public.whatsapp_intake_sessions where conversation_id=c.id for update;
 if c.status<>'OPEN' or s.status<>'ACTIVE' or s.current_step<>'SUPPLEMENTAL'
  or s.name is null or s.product_id is null or s.city is null or s.state is null or s.email is null then
  raise exception 'Coleta incompleta.' using errcode='22023';
 end if;
 perform 1 from public.products where id=s.product_id and active for share;
 if not found then raise exception 'Produto indisponível.' using errcode='22023'; end if;
 select * into strict ct from public.contacts where id=c.contact_id;
 phone_value:=case when ct.phone ~ '^\+?[0-9 ()-]{8,25}$' then ct.phone
  when ct.wa_id ~ '^[0-9]{8,15}$' then '+' || ct.wa_id end;
 if phone_value is null then raise exception 'Telefone WhatsApp indisponível.' using errcode='22023'; end if;
 insert into public.leads(name,phone,email,city,state,product_id,notes,creation_source)
 values(s.name,phone_value,s.email,s.city,s.state,s.product_id,coalesce(s.supplemental_notes,''),'WHATSAPP_INTAKE') returning id into result;
 update public.conversations set lead_id=result where id=c.id;
 insert into public.lead_events(lead_id,actor_id,action,data) values(result,null,'CONVERTED_FROM_WHATSAPP_INTAKE',
  jsonb_build_object('source','WHATSAPP_INTAKE','actor_name','Coleta automática WhatsApp',
  'conversation_id',c.id,'intake_session_id',s.id,'status','NEW'));
 update public.whatsapp_intake_sessions set status='COMPLETE',current_step='COMPLETE',completed_at=now() where id=s.id;
 return result;
end;
$$;

create function app_private.process_whatsapp_intake(p_message_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 new public.messages; c public.conversations; s public.whatsapp_intake_sessions; ct public.contacts;
 value text; parts text[]; product_value uuid; reply text; outcome_value text:='ACCEPTED';
 before_step public.whatsapp_intake_step; started boolean:=false;
begin
 select * into strict new from public.messages where id=p_message_id;
 if new.direction<>'INBOUND' or new.type<>'text' then return; end if;
 -- Same first lock as manual conversion. First conversion to commit wins.
 select * into strict c from public.conversations where id=new.conversation_id for update;
 if c.status<>'OPEN' or c.lead_id is not null then return; end if;
 select * into s from public.whatsapp_intake_sessions where conversation_id=c.id for update;
 if not found then
  insert into public.whatsapp_intake_sessions(conversation_id) values(c.id) returning * into s;
  started:=true;
 end if;
 if s.status<>'ACTIVE' then return; end if;
 before_step:=s.current_step;
 -- Persisted message UUID is derived by ingestion; never supplied by external payload.
 insert into public.whatsapp_intake_turns(message_id,session_id,step_before,step_after,outcome)
 values(new.id,s.id,before_step,before_step,'STARTED') on conflict(message_id) do nothing;
 if not found then return; end if;
 value:=app_private.intake_trim(new.text_body);
 if started then
  outcome_value:='STARTED'; -- Greeting opens the flow; do not mistake it for a name.
 elsif s.current_step='NAME' then
  if value is null or length(value) not between 2 and 120 or value ~ '[[:cntrl:]]' then
   outcome_value:='INVALID'; reply:='Informe um nome com 2 a 120 caracteres.';
  else update public.whatsapp_intake_sessions set name=value,current_step='PRODUCT' where id=s.id; end if;
 elsif s.current_step='PRODUCT' then
  product_value:=app_private.intake_product(value);
  if product_value is null then
   outcome_value:='INVALID'; reply:='Produto não reconhecido ou indisponível. Informe Seguro Auto ou Consórcio.';
  else update public.whatsapp_intake_sessions set product_id=product_value,current_step='LOCATION' where id=s.id; end if;
 elsif s.current_step='LOCATION' then
  parts:=regexp_match(value,'^(.+)[/,-][[:space:]]*([a-zA-Z]{2})$');
  if parts is null or app_private.intake_trim(parts[1]) is null
   or length(app_private.intake_trim(parts[1])) not between 2 and 120
   or parts[1] ~ '[[:cntrl:]]'
   or upper(parts[2])<>all(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then
   outcome_value:='INVALID'; reply:='Informe cidade e UF brasileira válida. Ex.: Vitória/ES.';
  else update public.whatsapp_intake_sessions set city=app_private.intake_trim(parts[1]),state=upper(parts[2]),current_step='EMAIL' where id=s.id; end if;
 elsif s.current_step='EMAIL' then
  if value is null or length(value)>254 or length(split_part(value,'@',1))>64
   or value !~ '^[A-Za-z0-9_%+.-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$'
   or value like '%..%' or value like '.%' or value like '%.@%' then
   outcome_value:='INVALID'; reply:='Informe um e-mail válido. Ex.: nome@exemplo.com.';
  else update public.whatsapp_intake_sessions set email=value,current_step='SUPPLEMENTAL' where id=s.id; end if;
 elsif s.current_step='SUPPLEMENTAL' then
  if value is null or length(value)>5000 then
   outcome_value:='INVALID'; reply:='Use até 5000 caracteres ou responda ''não'' se não houver informações adicionais.';
  else
   update public.whatsapp_intake_sessions set supplemental_notes=case when app_private.intake_key(value) in ('nao','nenhuma','nada') then null else value end where id=s.id;
   -- Expected catalog/phone problems retain the inbound message and a correction draft.
   perform 1 from public.products where id=s.product_id and active for share;
   if not found then
    update public.whatsapp_intake_sessions set product_id=null,current_step='PRODUCT' where id=s.id;
    outcome_value:='BLOCKED'; reply:='O produto selecionado ficou indisponível. Informe outro produto ativo.';
   else
    select * into strict ct from public.contacts where id=c.contact_id;
    if coalesce(ct.phone ~ '^\+?[0-9 ()-]{8,25}$',false) or ct.wa_id ~ '^[0-9]{8,15}$' then
     perform app_private.complete_whatsapp_intake(c.id); outcome_value:='COMPLETE';
    else
     outcome_value:='BLOCKED'; reply:='Precisamos de revisão da equipe para concluir seu cadastro. Aguarde o atendimento da Motive.';
    end if;
   end if;
  end if;
 end if;
 select * into strict s from public.whatsapp_intake_sessions where id=s.id;
 update public.whatsapp_intake_turns set step_after=s.current_step,outcome=outcome_value where message_id=new.id;
 insert into public.whatsapp_outbound_drafts(session_id,in_reply_to_message_id,text_body)
 values(s.id,new.id,coalesce(reply,app_private.intake_prompt(s.current_step,s.name)));
 return;
end;
$$;
revoke all on function app_private.intake_trim(text),app_private.intake_key(text),app_private.intake_product(text),
 app_private.intake_prompt(public.whatsapp_intake_step,text),app_private.complete_whatsapp_intake(uuid),
 app_private.process_whatsapp_intake(uuid),app_private.audit_lead() from public,anon,authenticated,service_role;


-- Preserve 009 identity/metadata rules. The new-message intake pass runs after original ingestion, in the same transaction.
create or replace function public.ingest_whatsapp_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 e jsonb; k text; account public.whatsapp_accounts; contact_id_value uuid;
 conversation_id_value uuid; event_id_value uuid; message_row public.messages;
 intake_message_id uuid; intake_message_ids uuid[]:=array[]::uuid[];
 event_key_value text; event_time timestamptz; target_status public.message_status;
 normalized_display_name text;
 name_whitespace constant text := U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000';
 inserted_count integer:=0; duplicate_count integer:=0; status_count integer:=0;
begin
 if jsonb_typeof(p_events) is distinct from 'array' then
  raise exception 'Lote de webhook inválido.' using errcode='22023';
 end if;
 if jsonb_array_length(p_events) not between 1 and 100 then
  raise exception 'Tamanho do lote inválido.' using errcode='22023';
 end if;
 -- Lock all accounts in fixed order before processing any conversation.
 perform a.id from public.whatsapp_accounts a
  where a.phone_number_id in (select value->>'phone_number_id' from jsonb_array_elements(p_events))
  order by a.phone_number_id for update;
 -- Preserve the established A01/A02 first-processed contact metadata policy.
 for e in select value from jsonb_array_elements(p_events) order by value->>'phone_number_id',value->>'external_message_id',value->>'kind' loop
  if jsonb_typeof(e) is distinct from 'object' or not (e ?& array['kind','waba_id','phone_number_id','external_message_id','provider_timestamp']) then
   raise exception 'Evento inválido.' using errcode='22023';
  end if;
  foreach k in array array['kind','waba_id','phone_number_id','external_message_id','provider_timestamp'] loop
   if jsonb_typeof(e->k) is distinct from 'string' then raise exception 'Campo de evento inválido.' using errcode='22023'; end if;
  end loop;
  if e->>'kind' not in ('inbound','status')
   or (e->>'waba_id') !~ '^[0-9]{1,64}$' or (e->>'phone_number_id') !~ '^[0-9]{1,64}$'
   or length(e->>'external_message_id') not between 1 and 256
   or (e->>'provider_timestamp') !~ '^[0-9]{1,12}$' then
   raise exception 'Evento inválido.' using errcode='22023';
  end if;
  if (e->>'provider_timestamp')::bigint > 253402300799 then raise exception 'Timestamp inválido.' using errcode='22023'; end if;
  event_time:=to_timestamp((e->>'provider_timestamp')::double precision);
  if e->>'kind'='inbound' then
   if not (e ?& array['wa_id','type','text_body'])
    or exists(select 1 from jsonb_object_keys(e) j(key) where key<>all(array['kind','waba_id','phone_number_id','external_message_id','provider_timestamp','wa_id','display_name','type','text_body']))
    or jsonb_typeof(e->'wa_id') is distinct from 'string' or length(e->>'wa_id') not between 1 and 128
    or jsonb_typeof(e->'type') is distinct from 'string' or e->>'type'<>'text'
    or jsonb_typeof(e->'text_body') is distinct from 'string' or length(e->>'text_body') not between 1 and 10000
    or (e ? 'display_name' and (jsonb_typeof(e->'display_name') not in ('string','null') or length(e->>'display_name')>120)) then
     raise exception 'Mensagem de entrada inválida ou não suportada.' using errcode='22023';
   end if;
   -- Normalize contact metadata once, before duplicate/new-message decisions.
   -- Keep e unchanged: original event payload and immutable identity are preserved.
   normalized_display_name:=nullif(btrim(e->>'display_name',name_whitespace),'');
  else
   if not (e ?& array['status','wa_id'])
    or exists(select 1 from jsonb_object_keys(e) j(key) where key<>all(array['kind','waba_id','phone_number_id','external_message_id','provider_timestamp','status','wa_id']))
    or jsonb_typeof(e->'status') is distinct from 'string' or e->>'status' not in ('SENT','DELIVERED','READ','FAILED')
    or jsonb_typeof(e->'wa_id') is distinct from 'string' or length(e->>'wa_id') not between 1 and 128 then
     raise exception 'Status de mensagem inválido.' using errcode='22023';
   end if;
  end if;
  select * into account from public.whatsapp_accounts where phone_number_id=e->>'phone_number_id' and waba_id=e->>'waba_id' and active for update;
  if not found then raise exception 'Conta WhatsApp desconhecida ou inativa.' using errcode='22023'; end if;
  event_key_value:=case when e->>'kind'='inbound' then 'message:' else 'status:' end || account.id::text || ':' || (e->>'external_message_id');
  if e->>'kind'='status' then event_key_value:=event_key_value || ':' || (e->>'status') || ':' || (e->>'provider_timestamp'); end if;
  event_id_value:=null;
  insert into public.webhook_events(provider,event_key,payload) values('WHATSAPP',event_key_value,e)
   on conflict(provider,event_key) do nothing returning id into event_id_value;
  if event_id_value is null then
   if exists(select 1 from public.webhook_events where provider='WHATSAPP' and event_key=event_key_value and (case when e->>'kind'='inbound' then payload - 'display_name' else payload end)
      is distinct from (case when e->>'kind'='inbound' then e - 'display_name' else e end)) then
    raise exception 'Identificador externo reutilizado com conteúdo divergente.' using errcode='22023';
   end if;
   if e->>'kind'='inbound' then
    -- Metadata-only enrichment; preserve original event/message and closed conversation.
    update public.contacts set display_name=normalized_display_name
     where whatsapp_account_id=account.id and wa_id=e->>'wa_id' and display_name is null
      and normalized_display_name is not null;
   end if;
   duplicate_count:=duplicate_count+1;
   continue;
  end if;
  if e->>'kind'='inbound' then
   -- Check before touching contacts: an external ID cannot change account/owner.
   if exists(select 1 from public.messages where external_message_id=e->>'external_message_id') then
    raise exception 'Identificador de mensagem já utilizado.' using errcode='22023';
   end if;
   insert into public.contacts(whatsapp_account_id,wa_id,phone,display_name)
    values(account.id,e->>'wa_id',case when (e->>'wa_id') ~ '^[0-9]{8,15}$' then '+' || (e->>'wa_id') else null end,normalized_display_name)
    on conflict(whatsapp_account_id,wa_id) do update set display_name=coalesce(public.contacts.display_name,excluded.display_name)
    returning id into contact_id_value;
   insert into public.conversations(whatsapp_account_id,contact_id)
    values(account.id,contact_id_value)
    on conflict(whatsapp_account_id,contact_id) where status='OPEN' do nothing;
   select id into strict conversation_id_value from public.conversations
    where whatsapp_account_id=account.id and contact_id=contact_id_value and status='OPEN' for update;
   insert into public.messages(conversation_id,external_message_id,direction,type,text_body,status,provider_timestamp)
    values(conversation_id_value,e->>'external_message_id','INBOUND','text',e->>'text_body','RECEIVED',event_time) returning id into intake_message_id;
   intake_message_ids:=array_append(intake_message_ids,intake_message_id);
   update public.conversations set last_message_at=greatest(last_message_at,event_time) where id=conversation_id_value;
   inserted_count:=inserted_count+1;
  else
   select m.* into message_row from public.messages m
    join public.conversations c on c.id=m.conversation_id
    join public.contacts ct on ct.id=c.contact_id
    where m.external_message_id=e->>'external_message_id' and c.whatsapp_account_id=account.id
     and ct.wa_id=e->>'wa_id' and m.direction='OUTBOUND' for update of m;
   if not found then raise exception 'Mensagem de saída desconhecida para esta conta/contato.' using errcode='22023'; end if;
   target_status:=(e->>'status')::public.message_status;
   -- Monotonic evidence, independent of callback arrival order: delivered/read beat failure.
   if (case target_status when 'SENT' then 1 when 'FAILED' then 2 when 'DELIVERED' then 3 when 'READ' then 4 else 0 end)
     > (case message_row.status when 'SENT' then 1 when 'FAILED' then 2 when 'DELIVERED' then 3 when 'READ' then 4 else 0 end) then
    update public.messages set status=target_status where id=message_row.id;
   end if;
   status_count:=status_count+1;
  end if;
  update public.webhook_events set processed_at=now() where id=event_id_value;
 end loop;
 -- Only genuinely new inbound messages enter intake. Duplicate legacy events never start it.
 -- Provider time then original order within this batch; transaction order across deliveries.
 for intake_message_id in
  select m.id from jsonb_array_elements(p_events) with ordinality e(value,position)
   join public.messages m on m.external_message_id=e.value->>'external_message_id'
  where m.id=any(intake_message_ids) and e.value->>'kind'='inbound'
  order by m.provider_timestamp,e.position
 loop
  perform app_private.process_whatsapp_intake(intake_message_id);
 end loop;
 return jsonb_build_object('inserted',inserted_count,'duplicates',duplicate_count,'statuses',status_count);
end;
$$;
revoke all on function public.ingest_whatsapp_events(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp_events(jsonb) to service_role;
