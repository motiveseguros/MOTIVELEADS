-- F03 only: explicit Unicode White_Space normalization for contact display names.
-- U+0009..000D, 0020, 0085, 00A0, 1680, 2000..200A, 2028, 2029, 202F, 205F, 3000.
-- Trim only at the edges; preserve internal characters and every existing useful name.
-- A01/A02 identity, transaction boundaries, locks, RLS and grants remain unchanged.
-- Repair only legacy empty/whitespace-only values; never rewrite useful names/history.
update public.contacts set display_name=null
 where display_name is not null
  and nullif(btrim(display_name,U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'),'') is null;

create or replace function public.ingest_whatsapp_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 e jsonb; k text; account public.whatsapp_accounts; contact_id_value uuid;
 conversation_id_value uuid; event_id_value uuid; message_row public.messages;
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
 -- Fixed account lock order prevents cross-account batch deadlocks.
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
    values(conversation_id_value,e->>'external_message_id','INBOUND','text',e->>'text_body','RECEIVED',event_time);
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
 return jsonb_build_object('inserted',inserted_count,'duplicates',duplicate_count,'statuses',status_count);
end;
$$;
revoke all on function public.ingest_whatsapp_events(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp_events(jsonb) to service_role;
