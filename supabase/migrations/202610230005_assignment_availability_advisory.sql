-- Availability informs the ADMIN decision; it is not an assignment authorization gate.
-- Keep the signature, SECURITY DEFINER, row locks, permission checks and existing grants.
-- CREATE OR REPLACE preserves the function ACL. RLS and audit trigger are unchanged.
create or replace function public.assign_lead(p_lead_id uuid,p_employee_id uuid,p_expected_employee_id uuid) returns void language plpgsql security definer set search_path='' as $$
 declare target public.leads; employee public.employees;
 begin
 perform app_private.require_admin();
 select * into target from public.leads where id=p_lead_id for update;
 if not found then raise exception 'Lead não encontrado.'; end if;
 if target.assigned_employee_id is distinct from p_expected_employee_id then raise exception 'Responsável alterado por outra operação. Atualize a página.'; end if;
 if target.status in ('CLOSED_WON','CLOSED_LOST') then raise exception 'Lead encerrado não pode ser atribuído.'; end if;
 if target.assigned_employee_id=p_employee_id then raise exception 'Este funcionário já é o responsável.'; end if;
 select * into employee from public.employees where id=p_employee_id for update;
 if not found or not employee.active then raise exception 'Funcionário inativo ou inexistente.'; end if;
 if not exists(select 1 from public.employee_products where employee_id=p_employee_id and product_id=target.product_id) then raise exception 'Funcionário não atende este produto.'; end if;
 perform 1 from public.products where id=target.product_id and active for share;
 if not found then raise exception 'Produto indisponível.'; end if;
 update public.leads set assigned_employee_id=p_employee_id,assigned_at=now(),status='ASSIGNED',updated_at=now() where id=p_lead_id;
 end;
$$;
