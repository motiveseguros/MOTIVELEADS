create function public.create_lead(p_name text,p_phone text,p_email text,p_city text,p_state text,p_product_id uuid,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 perform app_private.require_admin();
 perform 1 from public.products where id=p_product_id and active for share;
 if not found then raise exception 'Produto indisponível.'; end if;
 insert into public.leads(name,phone,email,city,state,product_id,notes) values(trim(p_name),trim(p_phone),nullif(trim(p_email),''),nullif(trim(p_city),''),nullif(upper(trim(p_state)),''),p_product_id,coalesce(p_notes,'')) returning id into result;
 return result;
 end;
$$;
create function public.assign_lead(p_lead_id uuid,p_employee_id uuid,p_expected_employee_id uuid) returns void language plpgsql security definer set search_path='' as $$
 declare target public.leads; employee public.employees;
 begin
 perform app_private.require_admin();
 select * into target from public.leads where id=p_lead_id for update;
 if not found then raise exception 'Lead não encontrado.'; end if;
 if target.assigned_employee_id is distinct from p_expected_employee_id then raise exception 'Responsável alterado por outra operação. Atualize a página.'; end if;
 if target.status in ('CLOSED_WON','CLOSED_LOST') then raise exception 'Lead encerrado não pode ser atribuído.'; end if;
 if target.assigned_employee_id=p_employee_id then raise exception 'Este funcionário já é o responsável.'; end if;
 select * into employee from public.employees where id=p_employee_id for update;
 if not found or not employee.active or employee.availability<>'AVAILABLE' then raise exception 'Funcionário não está disponível.'; end if;
 if not exists(select 1 from public.employee_products where employee_id=p_employee_id and product_id=target.product_id) then raise exception 'Funcionário não atende este produto.'; end if;
 perform 1 from public.products where id=target.product_id and active for share;
 if not found then raise exception 'Produto indisponível.'; end if;
 update public.leads set assigned_employee_id=p_employee_id,assigned_at=now(),status='ASSIGNED',updated_at=now() where id=p_lead_id;
 end;
$$;
create function public.transition_lead(p_lead_id uuid,p_status public.lead_status,p_expected_status public.lead_status) returns void language plpgsql security definer set search_path='' as $$
 declare target public.leads;
 begin
 if app_private.current_role() is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select * into target from public.leads where id=p_lead_id for update;
 if not found or (app_private.current_role()<>'ADMIN' and target.assigned_employee_id is distinct from app_private.current_employee_id()) then raise exception 'Lead não encontrado ou acesso negado.' using errcode='42501'; end if;
 if p_expected_status is null or p_status is null or target.status<>p_expected_status then raise exception 'Status alterado por outra operação. Atualize a página.'; end if;
 if not ((target.status='ASSIGNED' and p_status='IN_PROGRESS') or (target.status='IN_PROGRESS' and p_status in ('CLOSED_WON','CLOSED_LOST'))) then raise exception 'Transição de status inválida.'; end if;
 update public.leads set status=p_status,updated_at=now() where id=p_lead_id;
 end;
$$;
create function public.set_availability(p_employee_id uuid,p_availability public.availability) returns void language plpgsql security definer set search_path='' as $$
 begin
 if app_private.current_role() is null or (app_private.current_role()<>'ADMIN' and p_employee_id is distinct from app_private.current_employee_id()) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 update public.employees set availability=p_availability,updated_at=now() where id=p_employee_id and active;
 if not found then raise exception 'Funcionário inativo ou inexistente.'; end if;
 end;
$$;
-- Service-role only: called after a server-side administrator check, or initial bootstrap.
create function public.provision_employee(p_profile_id uuid,p_name text,p_email text,p_phone text,p_products uuid[],p_role public.app_role default 'AGENT') returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 if p_products is null then raise exception 'Especialidades obrigatórias.'; end if;
 if exists(select 1 from unnest(p_products) x where not exists(select 1 from public.products p where p.id=x and p.active)) then raise exception 'Produto inválido.'; end if;
 insert into public.profiles(id,role) values(p_profile_id,p_role);
 insert into public.employees(profile_id,name,email,phone) values(p_profile_id,trim(p_name),lower(trim(p_email)),coalesce(p_phone,'')) returning id into result;
 insert into public.employee_products select result,x from unnest(p_products) x;
 return result;
 end;
$$;
create function public.update_employee(p_id uuid,p_name text,p_phone text,p_active boolean,p_products uuid[]) returns void language plpgsql security definer set search_path='' as $$
 declare employee public.employees;
 begin
 perform app_private.require_admin();
 if p_products is null or cardinality(p_products)=0 or p_active is null then raise exception 'Informe acesso e especialidades.'; end if;
 select * into employee from public.employees where id=p_id for update;
 if not found then raise exception 'Funcionário não encontrado.'; end if;
 if not p_active and employee.profile_id=auth.uid() then raise exception 'Não é possível desativar seu próprio acesso.'; end if;
 if exists(select 1 from public.leads where assigned_employee_id=p_id and status in ('ASSIGNED','IN_PROGRESS') and (not p_active or not (product_id=any(p_products)))) then raise exception 'Transfira os leads abertos antes de desativar ou remover a especialidade.'; end if;
 if exists(select 1 from unnest(p_products) x where not exists(select 1 from public.products p where p.id=x)) then raise exception 'Produto inválido.'; end if;
 update public.employees set name=trim(p_name),phone=p_phone,active=p_active,availability=case when p_active then availability else 'OFFLINE' end,updated_at=now() where id=p_id;
 delete from public.employee_products where employee_id=p_id;
 insert into public.employee_products select p_id,x from unnest(p_products) x;
 end;
$$;
create function public.save_product(p_id uuid,p_name text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 perform app_private.require_admin();
 if p_id is null then insert into public.products(name,active) values(trim(p_name),p_active) returning id into result;
 else update public.products set name=trim(p_name),active=p_active where id=p_id returning id into result;
 if result is null then raise exception 'Produto não encontrado.'; end if;
 end if; return result;
 end;
$$;
revoke all on function public.create_lead(text,text,text,text,text,uuid,text), public.assign_lead(uuid,uuid,uuid),public.transition_lead(uuid,public.lead_status,public.lead_status),public.set_availability(uuid,public.availability),public.provision_employee(uuid,text,text,text,uuid[],public.app_role),public.update_employee(uuid,text,text,boolean,uuid[]),public.save_product(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.create_lead(text,text,text,text,text,uuid,text),public.assign_lead(uuid,uuid,uuid),public.transition_lead(uuid,public.lead_status,public.lead_status),public.set_availability(uuid,public.availability),public.update_employee(uuid,text,text,boolean,uuid[]),public.save_product(uuid,text,boolean) to authenticated;
grant execute on function public.provision_employee(uuid,text,text,text,uuid[],public.app_role) to service_role;
