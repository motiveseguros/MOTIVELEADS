-- Only the trusted backend can invoke this atomic batch processor.
-- IDs of contacts/conversations/leads/actors are never accepted from the provider.
create function public.ingest_whatsapp_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 e jsonb; k text; account public.whatsapp_accounts; contact_id_value uuid;
 conversation_id_value uuid; event_id_value uuid; message_row public.messages;
 event_key_value text; event_time timestamptz; target_status public.message_status;
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
   if not (e ?& array['wa_id','display_name','type','text_body'])
    or exists(select 1 from jsonb_object_keys(e) j(key) where key<>all(array['kind','waba_id','phone_number_id','external_message_id','provider_timestamp','wa_id','display_name','type','text_body']))
    or jsonb_typeof(e->'wa_id') is distinct from 'string' or length(e->>'wa_id') not between 1 and 128
    or jsonb_typeof(e->'type') is distinct from 'string' or e->>'type'<>'text'
    or jsonb_typeof(e->'text_body') is distinct from 'string' or length(e->>'text_body') not between 1 and 10000
    or jsonb_typeof(e->'display_name') not in ('string','null') or length(e->>'display_name')>120 then
     raise exception 'Mensagem de entrada inválida ou não suportada.' using errcode='22023';
   end if;
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
   if exists(select 1 from public.webhook_events where provider='WHATSAPP' and event_key=event_key_value and payload is distinct from e) then
    raise exception 'Identificador externo reutilizado com conteúdo divergente.' using errcode='22023';
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
    values(account.id,e->>'wa_id',case when (e->>'wa_id') ~ '^[0-9]{8,15}$' then '+' || (e->>'wa_id') else null end,e->>'display_name')
    on conflict(whatsapp_account_id,wa_id) do update set display_name=coalesce(excluded.display_name,public.contacts.display_name)
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
