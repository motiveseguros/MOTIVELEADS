-- 03B2B1: validity and per-conversation ordering only. No network/provider.
-- Refuse an unexpected legacy state without destroying dispatch evidence.
do $$ begin
 if exists(select 1 from public.whatsapp_outbound_jobs where status='PROCESSING'
  group by conversation_id having count(*)>1) then
  raise exception 'Upgrade requer reconciliação de PROCESSING concorrentes antes da 013.' using errcode='55000';
 end if;
end $$;

alter table public.whatsapp_outbound_jobs
 add column draft_sequence bigint,
 add column validity_version smallint not null default 0 check(validity_version in (0,1)),
 add column cancellation_reason text check(cancellation_reason in
 ('PROMPT_SUPERSEDED','CONVERSATION_CONVERTED','CONVERSATION_CLOSED','ADMIN_CANCELLED'));
-- Metadata only: legacy rows retain status, attempts, tokens and evidence.
update public.whatsapp_outbound_jobs j set draft_sequence=d.sequence
 from public.whatsapp_outbound_drafts d where d.id=j.draft_id;
alter table public.whatsapp_outbound_jobs alter column draft_sequence set not null;
alter table public.whatsapp_outbound_jobs add constraint whatsapp_job_sequence_positive check(draft_sequence>0);
alter table public.whatsapp_outbound_jobs alter column validity_version set default 1;
-- Attribute legacy human cancellation without rewriting its audit.
update public.whatsapp_outbound_jobs set cancellation_reason='ADMIN_CANCELLED' where status='CANCELLED';
alter table public.whatsapp_outbound_jobs add constraint whatsapp_job_cancellation_reason
 check((status='CANCELLED')=(cancellation_reason is not null));
create unique index whatsapp_one_processing_per_conversation
 on public.whatsapp_outbound_jobs(conversation_id) where status='PROCESSING';
create index whatsapp_job_conversation_order on public.whatsapp_outbound_jobs(conversation_id,draft_sequence);
alter table public.whatsapp_outbound_events drop constraint whatsapp_outbound_events_action_check;
alter table public.whatsapp_outbound_events add constraint whatsapp_outbound_events_action_check check(action in
 ('ACTIVATED','DISABLED','ENQUEUED','CLAIMED','DISPATCH_STARTED','ACCEPTED_FAKE','RETRY_SCHEDULED',
 'FAILED','UNCERTAIN','RECOVERED_BEFORE_DISPATCH','CANCELLED','PROMPT_SUPERSEDED',
 'CONVERSATION_CONVERTED_INVALIDATION','CONVERSATION_CLOSED_INVALIDATION'));
-- The existing actor CHECK already requires NULL for technical actions.

-- Caller holds the conversation lock. No account/config locks are taken here:
-- manual conversion and direct authorized close already lock the conversation.
create function app_private.invalidate_whatsapp_prompts(p_conversation_id uuid,p_reason text,p_before_sequence bigint default null)
 returns void language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; event_action text;
begin
 event_action:=case p_reason when 'PROMPT_SUPERSEDED' then 'PROMPT_SUPERSEDED'
 when 'CONVERSATION_CONVERTED' then 'CONVERSATION_CONVERTED_INVALIDATION'
 when 'CONVERSATION_CLOSED' then 'CONVERSATION_CLOSED_INVALIDATION' end;
 if event_action is null then raise exception 'Motivo de invalidação inválido.' using errcode='22023'; end if;
 for j in select * from public.whatsapp_outbound_jobs
 where conversation_id=p_conversation_id and status in ('QUEUED','PROCESSING')
 and dispatch_started_at is null and (p_before_sequence is null or draft_sequence<p_before_sequence)
 order by draft_sequence for update loop
  update public.whatsapp_outbound_jobs set status='CANCELLED',cancellation_reason=p_reason,
   claim_token=null,locked_at=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
  insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
  values(j.whatsapp_account_id,j.id,event_action,j.activation_generation,j.attempts);
 end loop;
end;
$$;

create function app_private.invalidate_conversation_prompts() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.status='CLOSED' and old.status is distinct from new.status then
  perform app_private.invalidate_whatsapp_prompts(new.id,'CONVERSATION_CLOSED');
 elsif new.lead_id is not null and old.lead_id is distinct from new.lead_id then
  perform app_private.invalidate_whatsapp_prompts(new.id,'CONVERSATION_CONVERTED');
 end if;
 return new;
end;
$$;
create trigger whatsapp_conversation_prompt_validity after update of status,lead_id on public.conversations
 for each row execute function app_private.invalidate_conversation_prompts();

-- Latest draft is determined by identity sequence, never created_at.
-- COMPLETE acknowledgement is valid only for the completing turn/session.
create function app_private.whatsapp_job_is_current(p_job_id uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.whatsapp_outbound_jobs j
 join public.whatsapp_outbound_drafts d on d.id=j.draft_id and d.sequence=j.draft_sequence
 join public.whatsapp_intake_sessions s on s.id=d.session_id and s.conversation_id=j.conversation_id
 join public.whatsapp_intake_turns t on t.message_id=d.in_reply_to_message_id and t.session_id=s.id
 join public.conversations c on c.id=j.conversation_id
 where j.id=p_job_id and j.validity_version=1 and j.cancellation_reason is null and c.status='OPEN'
 and ((c.lead_id is null and s.status='ACTIVE' and t.step_after=s.current_step)
 or (c.lead_id is not null and s.status='COMPLETE' and t.outcome='COMPLETE' and t.step_after='COMPLETE'))
 and not exists(select 1 from public.whatsapp_outbound_drafts newer
 where newer.session_id=s.id and newer.sequence>d.sequence));
$$;

create or replace function app_private.enqueue_new_whatsapp_draft() returns trigger
 language plpgsql security definer set search_path='' as $$
declare c public.conversations; cfg public.whatsapp_outbound_transport_config; jid uuid;
begin
 -- Ingestion already holds account -> conversation. No lock inversion with manual conversion.
 select co.* into strict c from public.conversations co
 join public.whatsapp_intake_sessions s on s.conversation_id=co.id where s.id=new.session_id for update of co;
 perform app_private.invalidate_whatsapp_prompts(c.id,'PROMPT_SUPERSEDED',new.sequence);
 if c.status<>'OPEN' then return new; end if;
 if not exists(select 1 from public.whatsapp_accounts where id=c.whatsapp_account_id and active) then return new; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=c.whatsapp_account_id for share;
 if not found or cfg.mode<>'LIVE' or new.sequence<=cfg.activation_draft_sequence then return new; end if;
 insert into public.whatsapp_outbound_jobs(draft_id,draft_sequence,whatsapp_account_id,conversation_id,contact_id,activation_generation)
 values(new.id,new.sequence,c.whatsapp_account_id,c.id,c.contact_id,cfg.generation) returning id into jid;
 if not app_private.whatsapp_job_is_current(jid) then
  raise exception 'Draft incompatível com estado da coleta.' using errcode='22023';
 end if;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(c.whatsapp_account_id,jid,'ENQUEUED',cfg.generation,0);
 return new;
end;
$$;

-- account SHARE -> conversation UPDATE SKIP LOCKED -> config SHARE -> job UPDATE.
-- A locked conversation is skipped as a unit; other conversations remain parallel.
create or replace function public.claim_whatsapp_outbound_job(p_account_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_outbound_transport_config; j public.whatsapp_outbound_jobs; cid uuid;
begin
 perform 1 from public.whatsapp_accounts where id=p_account_id and active for share;
 if not found then return null; end if;
 -- Account SHARE fences activation/ingestion, so config cannot change during candidate selection.
 select c.id into cid from public.conversations c where c.whatsapp_account_id=p_account_id and c.status='OPEN'
 and exists(select 1 from public.whatsapp_outbound_jobs q
 join public.whatsapp_outbound_transport_config cf on cf.whatsapp_account_id=q.whatsapp_account_id
 where q.conversation_id=c.id and cf.mode='LIVE' and q.activation_generation=cf.generation
 and q.status='QUEUED' and q.dispatch_started_at is null and q.available_at<=clock_timestamp() and q.attempts<5
 and app_private.whatsapp_job_is_current(q.id)
 and not exists(select 1 from public.whatsapp_outbound_jobs prev where prev.conversation_id=c.id
 and prev.draft_sequence<q.draft_sequence and prev.status not in ('ACCEPTED','FAILED','CANCELLED')))
 order by c.id limit 1 for update of c skip locked;
 if not found then return null; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=p_account_id for share;
 if not found or cfg.mode<>'LIVE' then return null; end if;
 select * into j from public.whatsapp_outbound_jobs q where q.conversation_id=cid
 and q.activation_generation=cfg.generation and q.status='QUEUED' and q.dispatch_started_at is null
 and q.available_at<=clock_timestamp() and q.attempts<5 and app_private.whatsapp_job_is_current(q.id)
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
 select text_body into body from public.whatsapp_outbound_drafts where id=j.draft_id;
 select wa_id into recipient from public.contacts where id=j.contact_id;
 update public.whatsapp_outbound_jobs set dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(aid,j.id,'DISPATCH_STARTED',j.activation_generation,j.attempts);
 return jsonb_build_object('id',j.id,'text_body',body,'recipient',recipient);
end;
$$;

-- No automatic retry after a dispatch marker. Known rejection is terminal;
-- ambiguous outcomes require reconciliation and block all successors, across generations.
create or replace function public.fail_whatsapp_outbound_job(p_job_id uuid,p_claim_token uuid,p_failure public.whatsapp_transport_failure) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; next_status public.whatsapp_job_status; action_name text;
begin
 if p_failure is null or p_failure not in ('RATE_LIMITED','TEMPORARY_UNAVAILABLE','PERMANENT_REJECTION','NETWORK_UNCERTAIN','PROVIDER_EXCEPTION')
 then raise exception 'Categoria de falha inválida.' using errcode='22023'; end if;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found or j.status<>'PROCESSING' or j.claim_token is distinct from p_claim_token
 or j.dispatch_started_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'Tentativa inválida.' using errcode='40001'; end if;
 if p_failure in ('NETWORK_UNCERTAIN','PROVIDER_EXCEPTION') then next_status:='RECONCILIATION_REQUIRED'; action_name:='UNCERTAIN';
 else next_status:='FAILED'; action_name:='FAILED'; end if;
 update public.whatsapp_outbound_jobs set status=next_status,locked_at=null,lease_expires_at=null,
 last_error_code=p_failure,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt,error_code)
 values(j.whatsapp_account_id,j.id,action_name,j.activation_generation,j.attempts,p_failure);
end;
$$;

create or replace function public.cancel_whatsapp_outbound_job(p_job_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs;
begin
 perform app_private.require_admin();
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found then raise exception 'Job inexistente.' using errcode='22023'; end if;
 if j.status='CANCELLED' then return; end if;
 if j.status not in ('QUEUED','FAILED') or (j.status='QUEUED' and j.dispatch_started_at is not null)
 then raise exception 'Job exige conclusão ou reconciliação.' using errcode='22023'; end if;
 update public.whatsapp_outbound_jobs set status='CANCELLED',cancellation_reason='ADMIN_CANCELLED',
 claim_token=null,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,actor_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,auth.uid(),'CANCELLED',j.activation_generation,j.attempts);
end;
$$;

revoke all on function app_private.invalidate_whatsapp_prompts(uuid,text,bigint),
 app_private.invalidate_conversation_prompts(),app_private.whatsapp_job_is_current(uuid),
 app_private.enqueue_new_whatsapp_draft() from public,anon,authenticated,service_role;
revoke all on function public.claim_whatsapp_outbound_job(uuid),public.begin_whatsapp_outbound_dispatch(uuid,uuid),
 public.fail_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure),public.cancel_whatsapp_outbound_job(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.claim_whatsapp_outbound_job(uuid),public.begin_whatsapp_outbound_dispatch(uuid,uuid),
 public.fail_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure) to service_role;
grant execute on function public.cancel_whatsapp_outbound_job(uuid) to authenticated;
