-- Add store_bank payment method for purchases paid from the store's bank account
-- (money accumulated from customer transfer payments, not the owner's personal funds)

-- Expand the CHECK constraint to include store_bank
alter table purchases drop constraint if exists purchases_payment_method_check;
alter table purchases
  add constraint purchases_payment_method_check
  check (payment_method in ('cash', 'transfer', 'owner_investment', 'store_bank'));

-- Update create_purchase to handle store_bank
create or replace function create_purchase(
  p_product uuid,
  p_units int,
  p_unit_cost int,
  p_supplier text default null,
  p_note text default null,
  p_method text default 'transfer'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  prod record;
  v_id uuid;
  v_total int;
begin
  perform assert_user();

  if p_method not in ('cash', 'transfer', 'owner_investment', 'store_bank') then
    raise exception 'Método de pago inválido';
  end if;

  select * into prod from products where id = p_product for update;
  if not found then raise exception 'Producto no existe'; end if;

  v_total := p_units * p_unit_cost;

  -- Validate cash availability if paying from physical register
  if p_method = 'cash' and v_total > expected_cash_now() then
    raise exception 'No hay suficiente efectivo en caja (disponible: $%, necesario: $%)',
      expected_cash_now(), v_total;
  end if;

  insert into purchases (product_id, units, unit_cost, supplier, note, payment_method, created_by)
  values (p_product, p_units, p_unit_cost, p_supplier, p_note, p_method, auth.uid())
  returning id into v_id;

  -- Weighted average cost update
  update products set
    avg_cost = case when stock + p_units > 0
      then round((avg_cost::numeric * stock + p_unit_cost::numeric * p_units) / (stock + p_units))
      else p_unit_cost end,
    stock = stock + p_units
  where id = p_product;

  -- Record cash movement: physical cash deducted from register
  if p_method = 'cash' then
    insert into cash_movements (type, method, amount, note, created_by)
    values ('expense', 'cash', v_total, 'Surtido: ' || prod.name || ' x' || p_units || ' u.', auth.uid());
  end if;

  -- Record bank movement: transfer out from store's bank balance
  if p_method = 'store_bank' then
    insert into cash_movements (type, method, amount, note, created_by)
    values ('expense', 'transfer', v_total, 'Surtido (banco tienda): ' || prod.name || ' x' || p_units || ' u.', auth.uid());
  end if;

  return v_id;
end $$;

-- Update void_purchase to also reverse store_bank movements
create or replace function void_purchase(p_purchase uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pur record;
begin
  perform assert_owner();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select * into pur from purchases where id = p_purchase and voided = false;
  if not found then
    raise exception 'Surtido no existe o ya está anulado';
  end if;

  update purchases
    set voided = true, void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
    where id = p_purchase;

  -- Revert stock
  update products set stock = stock - pur.units where id = pur.product_id;

  -- Reverse cash movement for cash or store_bank purchases
  if pur.payment_method in ('cash', 'store_bank') then
    update cash_movements
      set voided = true, void_reason = 'Anulación surtido ' || p_purchase,
          voided_by = auth.uid(), voided_at = now()
      where id = (
        select id from cash_movements
        where type = 'expense'
          and method = case when pur.payment_method = 'cash' then 'cash' else 'transfer' end
          and amount = pur.units * pur.unit_cost
          and voided = false
          and created_at between pur.created_at - interval '1 minute' and pur.created_at + interval '1 minute'
        order by created_at limit 1
      );
  end if;
end $$;
