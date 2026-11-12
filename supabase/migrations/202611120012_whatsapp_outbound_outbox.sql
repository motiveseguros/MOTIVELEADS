-- 03B2A: outbox authorization only. No backfill, network call or real provider.
create type public.whatsapp_transport_mode as enum ('DISABLED','LIVE');
create type public.whatsapp_job_status as enum ('QUEUED','PROCESSING','ACCEPTED','FAILED','CANCELLED','RECONCILIATION_REQUIRED');
create type public.whatsapp_transport_failure as enum ('RATE_LIMITED','TEMPORARY_UNAVAILABLE','PERMANENT_REJECTION','NETWORK_UNCERTAIN','PROVIDER_EXCEPTION','LEASE_EXPIRED','ATTEMPTS_EXHAUSTED');
create table public.whatsapp_outbound_transport_config (
 whatsapp_account_id uuid primary key references public.whatsapp_accounts(id) on delete cascade,
 mode public.whatsapp_transport_mode not null default 'DISABLED',
 generation bigint not null default 0 check(generation>=0),
 activated_at timestamptz,
 activation_draft_sequence bigint,
 updated_at timestamptz not null default clock_timestamp(),
 check ((generation=0 and mode='DISABLED' and activated_at is null and activation_draft_sequence is null)
 or (generation>0 and activated_at is not null and activation_draft_sequence is not null and activation_draft_sequence>=0))
);
create table public.whatsapp_outbound_jobs (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null unique references public.whatsapp_outbound_drafts(id) on delete cascade,
 whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 activation_generation bigint not null check(activation_generation>0),
 status public.whatsapp_job_status not null default 'QUEUED',
 attempts integer not null default 0 check(attempts between 0 and 5),
 available_at timestamptz not null default clock_timestamp(),
 locked_at timestamptz,
 lease_expires_at timestamptz,
 claim_token uuid,
 dispatch_started_at timestamptz,
 provider_kind text check(provider_kind='FAKE'),
 provider_message_id text unique,
 last_error_code public.whatsapp_transport_failure,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check ((status='PROCESSING' and claim_token is not null and locked_at is not null and lease_expires_at is not null and attempts>0)
 or (status<>'PROCESSING' and locked_at is null and lease_expires_at is null)),
 check ((status='ACCEPTED' and provider_kind is not null and provider_message_id is not null and provider_kind='FAKE' and provider_message_id ~ '^fake:[0-9a-f-]{36}$' and dispatch_started_at is not null)
 or (status<>'ACCEPTED' and provider_kind is null and provider_message_id is null))
);
create index whatsapp_jobs_ready_idx on public.whatsapp_outbound_jobs(status,available_at,created_at) where status='QUEUED';
create index whatsapp_jobs_account_idx on public.whatsapp_outbound_jobs(whatsapp_account_id,activation_generation);
create index whatsapp_jobs_conversation_idx on public.whatsapp_outbound_jobs(conversation_id);
create index whatsapp_jobs_expired_idx on public.whatsapp_outbound_jobs(lease_expires_at) where status='PROCESSING';
create table public.whatsapp_outbound_events (
 id uuid primary key default gen_random_uuid(),
 whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
 job_id uuid references public.whatsapp_outbound_jobs(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 action text not null check(action in ('ACTIVATED','DISABLED','ENQUEUED','CLAIMED','DISPATCH_STARTED','ACCEPTED_FAKE','RETRY_SCHEDULED','FAILED','UNCERTAIN','RECOVERED_BEFORE_DISPATCH','CANCELLED')),
 generation bigint not null,
 draft_boundary bigint,
 attempt integer,
 error_code public.whatsapp_transport_failure,
 created_at timestamptz not null default clock_timestamp(),
 check((action in ('ACTIVATED','DISABLED','CANCELLED') and actor_id is not null) or
 (action not in ('ACTIVATED','DISABLED','CANCELLED') and actor_id is null))
);
create index whatsapp_outbound_events_job_idx on public.whatsapp_outbound_events(job_id,created_at);
create index whatsapp_outbound_events_account_idx on public.whatsapp_outbound_events(whatsapp_account_id,created_at);
alter table public.whatsapp_outbound_transport_config enable row level security;
alter table public.whatsapp_outbound_jobs enable row level security;
alter table public.whatsapp_outbound_events enable row level security;
revoke all on public.whatsapp_outbound_transport_config,public.whatsapp_outbound_jobs,public.whatsapp_outbound_events from public,anon,authenticated,service_role;
grant select on public.whatsapp_outbound_transport_config,public.whatsapp_outbound_jobs,public.whatsapp_outbound_events to authenticated;
create policy outbound_config_admin_read on public.whatsapp_outbound_transport_config for select to authenticated using(app_private.current_role()='ADMIN');
create policy outbound_jobs_admin_read on public.whatsapp_outbound_jobs for select to authenticated using(app_private.current_role()='ADMIN');
create policy outbound_events_admin_read on public.whatsapp_outbound_events for select to authenticated using(app_private.current_role()='ADMIN');

-- Administrative RPC, intentionally without a browser toggle. actor is always auth.uid().
create function public.set_whatsapp_outbound_transport(p_account_id uuid,p_mode public.whatsapp_transport_mode)
 returns public.whatsapp_outbound_transport_config language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_outbound_transport_config; boundary bigint;
begin
 perform app_private.require_admin();
 if p_mode is null then raise exception 'Modo obrigatório.' using errcode='22023'; end if;
 perform 1 from public.whatsapp_accounts where id=p_account_id and (active or p_mode='DISABLED') for update;
 if not found then raise exception 'Conta ausente ou inativa.' using errcode='22023'; end if;
 insert into public.whatsapp_outbound_transport_config(whatsapp_account_id) values(p_account_id) on conflict do nothing;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=p_account_id for update;
 if cfg.mode=p_mode then return cfg; end if;
 if p_mode='LIVE' then
  select coalesce(max(d.sequence),0) into boundary from public.whatsapp_outbound_drafts d
  join public.whatsapp_intake_sessions s on s.id=d.session_id
  join public.conversations c on c.id=s.conversation_id where c.whatsapp_account_id=p_account_id;
  update public.whatsapp_outbound_transport_config set mode=p_mode,generation=generation+1,
   activated_at=clock_timestamp(),activation_draft_sequence=boundary,updated_at=clock_timestamp()
   where whatsapp_account_id=p_account_id returning * into cfg;
 else
  update public.whatsapp_outbound_transport_config set mode=p_mode,updated_at=clock_timestamp()
   where whatsapp_account_id=p_account_id returning * into cfg;
 end if;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,actor_id,action,generation,draft_boundary)
 values(p_account_id,auth.uid(),case when p_mode='LIVE' then 'ACTIVATED' else 'DISABLED' end,cfg.generation,cfg.activation_draft_sequence);
 return cfg;
end;
$$;

-- INSERT-only hook. There is deliberately no RPC/job that scans drafts for eligibility.
-- Ingestion already holds the account lock before allocating the draft sequence.
create function app_private.enqueue_new_whatsapp_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; cfg public.whatsapp_outbound_transport_config; jid uuid;
begin
 select co.* into c from public.conversations co join public.whatsapp_intake_sessions s on s.conversation_id=co.id where s.id=new.session_id;
 perform 1 from public.whatsapp_accounts where id=c.whatsapp_account_id and active for update;
 if not found then return new; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=c.whatsapp_account_id for share;
 if not found or cfg.mode<>'LIVE' or new.sequence<=cfg.activation_draft_sequence then return new; end if;
 insert into public.whatsapp_outbound_jobs(draft_id,whatsapp_account_id,conversation_id,contact_id,activation_generation)
 values(new.id,c.whatsapp_account_id,c.id,c.contact_id,cfg.generation) returning id into jid;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(c.whatsapp_account_id,jid,'ENQUEUED',cfg.generation,0);
 return new;
end;
$$;
create trigger whatsapp_draft_enqueue after insert on public.whatsapp_outbound_drafts
 for each row execute function app_private.enqueue_new_whatsapp_draft();

-- Per-account shared gate allows independent workers; job locks are skipped, never waited on.
create function public.claim_whatsapp_outbound_job(p_account_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_outbound_transport_config; j public.whatsapp_outbound_jobs;
begin
 perform 1 from public.whatsapp_accounts where id=p_account_id and active for share;
 if not found then return null; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=p_account_id for share;
 if not found or cfg.mode<>'LIVE' then return null; end if;
 select * into j from public.whatsapp_outbound_jobs where whatsapp_account_id=p_account_id
 and activation_generation=cfg.generation and status='QUEUED' and available_at<=clock_timestamp() and attempts<5
 order by available_at,created_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 update public.whatsapp_outbound_jobs set status='PROCESSING',attempts=attempts+1,locked_at=clock_timestamp(),
 lease_expires_at=clock_timestamp()+interval '2 minutes',claim_token=gen_random_uuid(),dispatch_started_at=null,updated_at=clock_timestamp()
 where id=j.id returning * into j;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,'CLAIMED',j.activation_generation,j.attempts);
 return jsonb_build_object('id',j.id,'claim_token',j.claim_token,'attempts',j.attempts);
end;
$$;

-- A committed dispatch marker precedes any provider call. Deactivation wins if it commits first.
-- If dispatch already began, disabling cannot recall an external side effect.
create function public.begin_whatsapp_outbound_dispatch(p_job_id uuid,p_claim_token uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; cfg public.whatsapp_outbound_transport_config; aid uuid; body text; recipient text;
begin
 select whatsapp_account_id into aid from public.whatsapp_outbound_jobs where id=p_job_id;
 perform 1 from public.whatsapp_accounts where id=aid and active for share;
 if not found then return null; end if;
 select * into cfg from public.whatsapp_outbound_transport_config where whatsapp_account_id=aid for share;
 if not found or cfg.mode<>'LIVE' then return null; end if;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if j.status<>'PROCESSING' or j.claim_token is distinct from p_claim_token or j.lease_expires_at<=clock_timestamp()
 then raise exception 'Claim expirado ou inválido.' using errcode='40001'; end if;
 if j.activation_generation<>cfg.generation then return null; end if;
 -- Repeating begin must not authorize a second send with the same token.
 if j.dispatch_started_at is not null then raise exception 'Tentativa já iniciada.' using errcode='40001'; end if;
 select text_body into body from public.whatsapp_outbound_drafts where id=j.draft_id;
 select wa_id into recipient from public.contacts where id=j.contact_id;
 update public.whatsapp_outbound_jobs set dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(aid,j.id,'DISPATCH_STARTED',j.activation_generation,j.attempts);
 return jsonb_build_object('id',j.id,'text_body',body,'recipient',recipient);
end;
$$;

-- 03B2A only acknowledges explicitly fake receipts. It NEVER writes public.messages.
-- A real evidence/message transaction belongs to a separately reviewed 03B2B adapter.
create function public.accept_fake_whatsapp_outbound(p_job_id uuid,p_claim_token uuid,p_receipt uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs;
begin
 if p_receipt is null then raise exception 'Recibo de teste obrigatório.' using errcode='22023'; end if;
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found or j.claim_token is distinct from p_claim_token then raise exception 'Claim inválido.' using errcode='40001'; end if;
 if j.status='ACCEPTED' and j.provider_message_id='fake:'||p_receipt::text then return; end if;
 if j.status<>'PROCESSING' or j.dispatch_started_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'Tentativa não pode ser confirmada.' using errcode='40001'; end if;
 update public.whatsapp_outbound_jobs set status='ACCEPTED',provider_kind='FAKE',provider_message_id='fake:'||p_receipt::text,
 locked_at=null,lease_expires_at=null,last_error_code=null,updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,'ACCEPTED_FAKE',j.activation_generation,j.attempts);
end;
$$;
create function public.fail_whatsapp_outbound_job(p_job_id uuid,p_claim_token uuid,p_failure public.whatsapp_transport_failure) returns void
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
 elsif p_failure='PERMANENT_REJECTION' or j.attempts>=5 then next_status:='FAILED'; action_name:='FAILED';
 else next_status:='QUEUED'; action_name:='RETRY_SCHEDULED'; end if;
 update public.whatsapp_outbound_jobs set status=next_status,locked_at=null,lease_expires_at=null,last_error_code=p_failure,
 available_at=clock_timestamp()+make_interval(secs=>least(300,30*(2^(j.attempts-1))::integer)),updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt,error_code)
 values(j.whatsapp_account_id,j.id,action_name,j.activation_generation,j.attempts,p_failure);
end;
$$;

-- Explicit recovery only; no background reaper installed. Never requeue an uncertain side effect.
create function public.recover_whatsapp_outbound_job(p_job_id uuid) returns public.whatsapp_job_status
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs; next_status public.whatsapp_job_status; action_name text; code public.whatsapp_transport_failure;
begin
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found then raise exception 'Job inexistente.' using errcode='22023'; end if;
 if j.status<>'PROCESSING' or j.lease_expires_at>clock_timestamp() then return j.status; end if;
 if j.dispatch_started_at is not null then next_status:='RECONCILIATION_REQUIRED'; action_name:='UNCERTAIN'; code:='LEASE_EXPIRED';
 elsif j.attempts>=5 then next_status:='FAILED'; action_name:='FAILED'; code:='ATTEMPTS_EXHAUSTED';
 else next_status:='QUEUED'; action_name:='RECOVERED_BEFORE_DISPATCH'; code:='LEASE_EXPIRED'; end if;
 update public.whatsapp_outbound_jobs set status=next_status,locked_at=null,lease_expires_at=null,last_error_code=code,
 available_at=clock_timestamp()+make_interval(secs=>least(300,30*(2^(j.attempts-1))::integer)),updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,action,generation,attempt,error_code)
 values(j.whatsapp_account_id,j.id,action_name,j.activation_generation,j.attempts,code);
 return next_status;
end;
$$;
-- Old-generation QUEUED jobs remain held, never resumed by activation. Explicit cancellation is available.
create function public.cancel_whatsapp_outbound_job(p_job_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_outbound_jobs;
begin
 perform app_private.require_admin();
 select * into j from public.whatsapp_outbound_jobs where id=p_job_id for update;
 if not found then raise exception 'Job inexistente.' using errcode='22023'; end if;
 if j.status='CANCELLED' then return; end if;
 if j.status not in ('QUEUED','FAILED') then raise exception 'Job exige conclusão ou reconciliação.' using errcode='22023'; end if;
 update public.whatsapp_outbound_jobs set status='CANCELLED',updated_at=clock_timestamp() where id=j.id;
 insert into public.whatsapp_outbound_events(whatsapp_account_id,job_id,actor_id,action,generation,attempt)
 values(j.whatsapp_account_id,j.id,auth.uid(),'CANCELLED',j.activation_generation,j.attempts);
end;
$$;
revoke all on function app_private.enqueue_new_whatsapp_draft() from public,anon,authenticated,service_role;
revoke all on function public.set_whatsapp_outbound_transport(uuid,public.whatsapp_transport_mode),public.cancel_whatsapp_outbound_job(uuid),
 public.claim_whatsapp_outbound_job(uuid),public.begin_whatsapp_outbound_dispatch(uuid,uuid),public.accept_fake_whatsapp_outbound(uuid,uuid,uuid),
 public.fail_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure),public.recover_whatsapp_outbound_job(uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_whatsapp_outbound_transport(uuid,public.whatsapp_transport_mode),public.cancel_whatsapp_outbound_job(uuid) to authenticated;
grant execute on function public.claim_whatsapp_outbound_job(uuid),public.begin_whatsapp_outbound_dispatch(uuid,uuid),public.accept_fake_whatsapp_outbound(uuid,uuid,uuid),
 public.fail_whatsapp_outbound_job(uuid,uuid,public.whatsapp_transport_failure),public.recover_whatsapp_outbound_job(uuid) to service_role;
