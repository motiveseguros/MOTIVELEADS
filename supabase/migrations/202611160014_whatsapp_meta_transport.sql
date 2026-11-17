-- 03B2B2: explicit real acceptance, never activation, backfill or network I/O.
alter table public.whatsapp_outbound_jobs
 drop constraint whatsapp_outbound_jobs_provider_kind_check,
 drop constraint whatsapp_outbound_jobs_check1,
 add column outbound_message_id uuid unique references public.messages(id),
 add column provider_http_status integer check(provider_http_status between 100 and 599),
 add column provider_error_code integer check(provider_error_code>=0),
 add column provider_error_subcode integer check(provider_error_subcode>=0),
 add constraint whatsapp_job_provider_kind check(provider_kind in ('FAKE','META')),
 add constraint whatsapp_job_acceptance check(
 (status='ACCEPTED' and dispatch_started_at is not null and provider_kind is not null and provider_message_id is not null and
 ((provider_kind='FAKE' and provider_message_id ~ '^fake:[0-9a-f-]{36}$' and outbound_message_id is null)
 or (provider_kind='META' and provider_message_id ~ '^wamid\.[A-Za-z0-9+/=_-]+$' and length(provider_message_id)<=256 and outbound_message_id is not null)))
 or (status<>'ACCEPTED' and provider_kind is null and provider_message_id is null and outbound_message_id is null));
alter table public.whatsapp_outbound_jobs drop constraint whatsapp_outbound_jobs_cancellation_reason_check;
alter table public.whatsapp_outbound_jobs add constraint whatsapp_outbound_jobs_cancellation_reason_check check(cancellation_reason in
 ('PROMPT_SUPERSEDED','CONVERSATION_CONVERTED','CONVERSATION_CLOSED','ADMIN_CANCELLED','CUSTOMER_SERVICE_WINDOW_EXPIRED'));
alter table public.whatsapp_outbound_events drop constraint whatsapp_outbound_events_action_check;
alter table public.whatsapp_outbound_events add constraint whatsapp_outbound_events_action_check check(action in
 ('ACTIVATED','DISABLED','ENQUEUED','CLAIMED','DISPATCH_STARTED','ACCEPTED_FAKE','RETRY_SCHEDULED','FAILED','UNCERTAIN','RECOVERED_BEFORE_DISPATCH','CANCELLED','PROMPT_SUPERSEDED','CONVERSATION_CONVERTED_INVALIDATION','CONVERSATION_CLOSED_INVALIDATION','ACCEPTED_META','META_REJECTED','META_UNCERTAIN','SERVICE_WINDOW_EXPIRED'));

-- Bounded durable early callbacks, no client grants; original sanitized payload is in webhook_events.
create table public.whatsapp_pending_statuses (
 event_id uuid primary key references public.webhook_events(id),
 whatsapp_account_id uuid not null references public.whatsapp_accounts(id),
 external_message_id text not null check(length(external_message_id) between 1 and 256),
 wa_id text not null check(length(wa_id) between 1 and 128),
 status public.message_status not null check(status in ('SENT','DELIVERED','READ','FAILED')),
 provider_timestamp timestamptz not null,
 resolved_message_id uuid references public.messages(id)
);
create index whatsapp_pending_lookup on public.whatsapp_pending_statuses(whatsapp_account_id,external_message_id) where resolved_message_id is null;
alter table public.whatsapp_pending_statuses enable row level security;
revoke all on public.whatsapp_pending_statuses from public,anon,authenticated,service_role;

-- No fabricated provider time. Callbacks are status evidence, not a new message timestamp.
create view public.message_timeline with (security_invoker=true) as
 select m.*,coalesce(m.provider_timestamp,m.created_at) as timeline_at from public.messages m;
revoke all on public.message_timeline from public,anon,authenticated,service_role;
grant select on public.message_timeline to authenticated;
create index messages_effective_time_idx on public.messages(conversation_id,coalesce(provider_timestamp,created_at) desc,created_at desc,id desc);
create or replace view public.conversation_inbox with (security_invoker=true) as
 select c.*,ct.display_name as contact_name,ct.phone as contact_phone,ct.wa_id,
 latest.text_body as last_message_text,latest.type as last_message_type
 from public.conversations c join public.contacts ct on ct.id=c.contact_id
 left join lateral (select m.text_body,m.type from public.messages m where m.conversation_id=c.id
 order by coalesce(m.provider_timestamp,m.created_at) desc,m.created_at desc,m.id desc limit 1) latest on true;

-- Conservative 24h window from inbound evidence; late/future timestamps never extend it via receipt time.
-- Calls/templates are not supported in this phase. Contact identity is scoped to the same account.
create function app_private.whatsapp_service_window_open(p_conversation_id uuid) returns boolean
 language sql volatile security definer set search_path='' as $$
 select coalesce(max(least(m.provider_timestamp,m.created_at))>clock_timestamp()-interval '24 hours',false)
 from public.conversations target join public.conversations c
 on c.whatsapp_account_id=target.whatsapp_account_id and c.contact_id=target.contact_id
 join public.messages m on m.conversation_id=c.id and m.direction='INBOUND' and m.provider_timestamp is not null
 where target.id=p_conversation_id and m.provider_timestamp<=clock_timestamp();
$$;
create function app_private.expire_whatsapp_service_prompt(p_job_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs;
begin
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found or j.validity_version<>1 or j.status not in ('QUEUED','PROCESSING') or j.dispatch_started_at is not null then return; end if;
 update public.whatsapp_outbound_jobs set status='CANCELLED',cancellation_reason='CUSTOMER_SERVICE_WINDOW_EXPIRED',
 claim_token=null,locked_at=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,'SERVICE_WINDOW_EXPIRED',j.activation_generation,j.attempts);
end;
$$;

create or replace function public.claim_whatsapp_outbound_job(p_account_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_outbound_transport_config; j public.whatsapp_outbound_jobs; cid uuid; expired_id uuid;
begin
 perform 1 from public.whatsapp_accounts where id=p_account_id and active for share;
 if not found then return null; end if;
 -- Only current-version/current-generation prompts expire; never mutate legacy jobs.
 for cid in select c.id from public.conversations c where c.whatsapp_account_id=p_account_id and exists(
 select 1 from public.whatsapp_outbound_jobs q join public.whatsapp_outbound_transport_config cf on cf.whatsapp_account_id=q.whatsapp_account_id
 where q.conversation_id=c.id and cf.mode='LIVE' and q.activation_generation=cf.generation and q.validity_version=1
 and q.status='QUEUED' and q.dispatch_started_at is null and not app_private.whatsapp_service_window_open(c.id))
 order by c.id for update of c skip locked loop
  for expired_id in select q.id from public.whatsapp_outbound_jobs q join public.whatsapp_outbound_transport_config cf on cf.whatsapp_account_id=q.whatsapp_account_id
  where q.conversation_id=cid and q.activation_generation=cf.generation and q.validity_version=1 and q.status='QUEUED' and q.dispatch_started_at is null
  loop perform app_private.expire_whatsapp_service_prompt(expired_id); end loop;
 end loop;
 -- Account SHARE fences activation/ingestion, so config cannot change during candidate selection.
 select c.id into cid from public.conversations c where c.whatsapp_account_id=p_account_id and c.status='OPEN'
 and exists(select 1 from public.whatsapp_outbound_jobs q
 join public.whatsapp_outbound_transport_config cf on cf.whatsapp_account_id=q.whatsapp_account_id
 where q.conversation_id=c.id and cf.mode='LIVE' and q.activation_generation=cf.generation
 and q.status='QUEUED' and q.dispatch_started_at is null and q.available_at<=clock_timestamp() and q.attempts<5
 and app_private.whatsapp_job_is_current(q.id) and app_private.whatsapp_service_window_open(q.conversation_id)
 and not exists(select 1 from public.whatsapp_outbound_jobs prev where prev.conversation_id=c.id
 and prev.draft_sequence<q.draft_sequence and prev.status not in ('ACCEPTED','FAILED','CANCELLED')))
 order by c.id limit 1 for update of c skip locked;
 if not found then return null; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=p_account_id for share;
 if not found or cfg.mode<>'LIVE' then return null; end if;
 select * into j from public.whatsapp_outbound_jobs q where q.conversation_id=cid
 and q.activation_generation=cfg.generation and q.status='QUEUED' and q.dispatch_started_at is null
 and q.available_at<=clock_timestamp() and q.attempts<5 and app_private.whatsapp_job_is_current(q.id) and app_private.whatsapp_service_window_open(q.conversation_id)
 and not exists(select 1 from public.whatsapp_outbound_jobs prev where prev.conversation_id=cid
 and prev.draft_sequence<q.draft_sequence and prev.status not in ('ACCEPTED','FAILED','CANCELLED'))
 order by q.draft_sequence limit 1 for update of q skip locked;
 if not found then return null; end if;
 update public.whatsapp_outbound_jobs set status='PROCESSING',attempts=attempts+1,locked_at=clock_timestamp(),
 lease_expires_at=clock_timestamp()+interval '2 minutes',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
 where id=j.id returning * into j;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,'CLAIMED',j.activation_generation,j.attempts);
 return jsonb_build_object('id',j.id,'claim_token',j.claim_token,'attempts',j.attempts);
end;
$$;


create or replace function public.begin_whatsapp_outbound_dispatch(p_job_id uuid,p_claim_token uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; cfg public.whatsapp_outbound_transport_config;
 aid uuid; cid uuid; body text; recipient text;
begin
 select whatsapp_account_id,conversation_id into aid,cid from public.whatsapp_outbound_jobs where id=p_job_id;
 if not found then return null; end if;
 perform 1 from public.whatsapp_accounts where id=aid and active for share;
 if not found then return null; end if;
 perform 1 from public.conversations where id=cid for update;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=aid for share;
 if not found or cfg.mode<>'LIVE' then return null; end if;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if j.status<>'PROCESSING' or j.claim_token is distinct from p_claim_token or j.lease_expires_at<=clock_timestamp()
 then raise exception 'Claim expirado ou inválido.' using errcode='40001'; end if;
 if j.activation_generation<>cfg.generation or not app_private.whatsapp_job_is_current(j.id) then return null; end if;
 if exists(select 1 from public.whatsapp_outbound_jobs prev where prev.conversation_id=cid
 and prev.draft_sequence<j.draft_sequence and prev.status not in ('ACCEPTED','FAILED','CANCELLED')) then return null; end if;
 if j.dispatch_started_at is not null then raise exception 'Tentativa já iniciada.' using errcode='40001'; end if;
 if not app_private.whatsapp_service_window_open(cid) then
  perform app_private.expire_whatsapp_service_prompt(j.id); return null;
 end if;
 select text_body into body from public.whatsapp_outbound_drafts where id=j.draft_id;
 select wa_id into recipient from public.contacts where id=j.contact_id;
 update public.whatsapp_outbound_jobs set dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(aid,j.id,'DISPATCH_STARTED',j.activation_generation,j.attempts);
 return jsonb_build_object('id',j.id,'text_body',body,'recipient',recipient,'phone_number_id',(select phone_number_id from public.whatsapp_accounts where id=aid));
end;
$$;


create function public.accept_meta_whatsapp_outbound(p_job_id uuid,p_claim_token uuid,p_external_message_id text) returns uuid
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; aid uuid; cid uuid; mid uuid; message_time timestamptz; body text; wa text; pending public.whatsapp_pending_statuses;
begin
 if p_external_message_id is null or p_external_message_id !~ '^wamid\.[A-Za-z0-9+/=_-]+$' or length(p_external_message_id)>256 then
  raise exception 'ID de mensagem inválido.' using errcode='22023'; end if;
 select whatsapp_account_id,conversation_id into aid,cid from public.whatsapp_outbound_jobs where id=p_job_id;
 if not found then raise exception 'Job inexistente.' using errcode='22023'; end if;
 -- Same order as begin. SHARE permits other conversations to accept concurrently;
 -- callbacks take account UPDATE and therefore cannot miss this insertion.
 perform 1 from public.whatsapp_accounts where id=aid for share;
 perform 1 from public.conversations where id=cid for update;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if p_claim_token is null or j.claim_token is distinct from p_claim_token then raise exception 'Claim inválido.' using errcode='40001'; end if;
 if j.status='ACCEPTED' then
  if j.provider_kind='META' and j.provider_message_id=p_external_message_id then return j.outbound_message_id; end if;
  raise exception 'Aceitação divergente.' using errcode='22023';
 end if;
 if j.status<>'PROCESSING' or j.validity_version<>1 or j.dispatch_started_at is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'Tentativa exige reconciliação.' using errcode='40001'; end if;
 select text_body into strict body from public.whatsapp_outbound_drafts where id=j.draft_id;
 select wa_id into strict wa from public.contacts where id=j.contact_id;
 if exists(select 1 from public.whatsapp_pending_statuses where whatsapp_account_id=aid and external_message_id=p_external_message_id and wa_id<>wa) then
  raise exception 'Status incompatível com contato.' using errcode='22023'; end if;
 message_time:=clock_timestamp();
 insert into public.messages(conversation_id,external_message_id,direction,type,text_body,status,sent_by_profile_id,provider_timestamp,created_at)
 values(cid,p_external_message_id,'OUTBOUND','text',body,'PENDING',null,null,message_time) returning id into mid;
 update public.whatsapp_outbound_jobs set status='ACCEPTED',provider_kind='META',provider_message_id=p_external_message_id,outbound_message_id=mid,
 locked_at=null,lease_expires_at=null,last_error_code=null,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(aid,j.id,'ACCEPTED_META',j.activation_generation,j.attempts);
 update public.conversations set last_message_at=greatest(last_message_at,message_time) where id=cid;
 -- Real webhook evidence may already exist. Never regress status; never fabricate provider time.
 for pending in select * from public.whatsapp_pending_statuses where whatsapp_account_id=aid and external_message_id=p_external_message_id and wa_id=wa and resolved_message_id is null loop
  update public.messages set status=pending.status where id=mid and
   (case pending.status when 'SENT' then 1 when 'FAILED' then 2 when 'DELIVERED' then 3 when 'READ' then 4 else 0 end)>
   (case status when 'SENT' then 1 when 'FAILED' then 2 when 'DELIVERED' then 3 when 'READ' then 4 else 0 end);
  update public.whatsapp_pending_statuses set resolved_message_id=mid where event_id=pending.event_id;
  update public.webhook_events set processed_at=clock_timestamp() where id=pending.event_id;
 end loop;
 return mid;
end;
$$;
create function public.fail_meta_whatsapp_outbound_job(p_job_id uuid,p_claim_token uuid,p_failure public.whatsapp_transport_failure,
 p_http_status integer default null,p_error_code integer default null,p_error_subcode integer default null) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; uncertain boolean;
begin
 if p_failure is null or p_failure not in ('RATE_LIMITED','TEMPORARY_UNAVAILABLE','PERMANENT_REJECTION','NETWORK_UNCERTAIN','PROVIDER_EXCEPTION')
 or (p_http_status is not null and p_http_status not between 100 and 599) or p_error_code<0 or p_error_subcode<0 then
 raise exception 'Categoria/evidência inválida.' using errcode='22023'; end if;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found or p_claim_token is null or j.claim_token is distinct from p_claim_token or j.status<>'PROCESSING'
 or j.validity_version<>1 or j.dispatch_started_at is null or j.lease_expires_at<=clock_timestamp() then
 raise exception 'Tentativa exige reconciliação.' using errcode='40001'; end if;
 uncertain:=p_failure in ('NETWORK_UNCERTAIN','PROVIDER_EXCEPTION');
 update public.whatsapp_outbound_jobs set status=case when uncertain then 'RECONCILIATION_REQUIRED'::public.whatsapp_job_status else 'FAILED'::public.whatsapp_job_status end,
 locked_at=null,lease_expires_at=null,last_error_code=p_failure,provider_http_status=p_http_status,provider_error_code=p_error_code,provider_error_subcode=p_error_subcode,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt,error_code)
 values(j.whatsapp_account_id,j.id,case when uncertain then 'META_UNCERTAIN' else 'META_REJECTED' end,j.activation_generation,j.attempts,p_failure);
end;
$$;
revoke all on function public.accept_meta_whatsapp_outbound(uuid,uuid,text),public.fail_meta_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.accept_meta_whatsapp_outbound(uuid,uuid,text),public.fail_meta_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure,integer,integer,integer) to service_role;
revoke all on function app_private.whatsapp_service_window_open(uuid),app_private.expire_whatsapp_service_prompt(uuid) from public,anon,authenticated,service_role;

-- Existing 011 ingest, only unknown-status durable handling added. A01/A02/F03/intake unchanged.
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
   if not found then
    -- Refuse known IDs with a mismatching direction/account/contact. Unknown IDs are durable,
    -- bounded, and associated only with a contact already known to this verified account.
    if exists(select 1 from public.messages where external_message_id=e->>'external_message_id')
     or not exists(select 1 from public.contacts where whatsapp_account_id=account.id and wa_id=e->>'wa_id') then
     raise exception 'Mensagem de saída desconhecida para esta conta/contato.' using errcode='22023'; end if;
    if (select count(*) from public.whatsapp_pending_statuses where whatsapp_account_id=account.id and resolved_message_id is null)>=1000 then
     raise exception 'Status pendentes exigem revisão.' using errcode='54000'; end if;
    insert into public.whatsapp_pending_statuses(event_id,whatsapp_account_id,external_message_id,wa_id,status,provider_timestamp)
    values(event_id_value,account.id,e->>'external_message_id',e->>'wa_id',(e->>'status')::public.message_status,event_time);
    status_count:=status_count+1;
    continue; -- processed_at stays NULL until matching acceptance; duplicate delivery is safe.
   end if;
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

-- Minimal technical preflight; no table SELECT or arbitrary account details exposed.
create function public.whatsapp_meta_target(p_account_id uuid,p_phone_number_id text) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.whatsapp_accounts where id=p_account_id and active and phone_number_id=p_phone_number_id);
$$;
revoke all on function public.whatsapp_meta_target(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_meta_target(uuid,text) to service_role;
