-- Phase 03A: ADMIN converts an OPEN conversation using the existing lead rules.
-- The row lock serializes retries/double clicks. The first successful conversion wins.
create function public.convert_conversation_to_lead(
 p_conversation_id uuid,
 p_name text,
 p_phone text,
 p_email text,
 p_city text,
 p_state text,
 p_product_id uuid,
 p_notes text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 target public.conversations;
 result uuid;
begin
 perform app_private.require_admin();
 select * into target from public.conversations where id=p_conversation_id for update;
 if not found then raise exception 'Conversa não encontrada.'; end if;

 -- A retry never changes the original lead, even if the submitted fields differ.
 if target.lead_id is not null then return target.lead_id; end if;
 if target.status <> 'OPEN' then raise exception 'Somente conversas abertas podem ser convertidas.'; end if;

 result := public.create_lead(p_name,p_phone,p_email,p_city,p_state,p_product_id,p_notes);
 update public.conversations set lead_id=result where id=target.id;
 insert into public.lead_events(lead_id,actor_id,action,data)
 values(result,auth.uid(),'CONVERTED_FROM_CONVERSATION',
  jsonb_build_object('conversation_id',target.id,'actor_name',
   (select name from public.employees where profile_id=auth.uid()),'status','NEW'));
 return result;
end;
$$;
revoke all on function public.convert_conversation_to_lead(uuid,text,text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.convert_conversation_to_lead(uuid,text,text,text,text,text,uuid,text) to authenticated;
