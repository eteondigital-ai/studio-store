-- Migration: track how inventory purchases are paid
-- payment_method: cash (from register), transfer (owner's own transfer), owner_investment (loan/capital from owner)

alter table purchases
  add column if not exists payment_method text not null default 'transfer'
  check (payment_method in ('cash', 'transfer', 'owner_investment'));

-- Replace create_purchase to handle payment method and auto-generate cash_movement when paid from register
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

  if p_method not in ('cash', 'transfer', 'owner_investment') then
    raise exception 'Método de pago inválido';
  end if;

  select * into prod from products where id = p_product for update;
  if not found then raise exception 'Producto no existe'; end if;

  v_total := p_units * p_unit_cost;

  -- Validate cash availability if paying from register
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

  -- Deduct from cash register if paid with cash
  if p_method = 'cash' then
    insert into cash_movements (type, method, amount, note, created_by)
    values (
      'expense',
      'cash',
      v_total,
      'Surtido: ' || prod.name || ' x' || p_units || ' u.',
      auth.uid()
    );
  end if;

  return v_id;
end $$;
