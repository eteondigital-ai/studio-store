-- Anular un surtido: marca la compra como voided y revierte el stock.
-- El avg_cost NO se recalcula (es un promedio histórico y no es reversible de forma exacta).
-- Si se necesita corregir el stock, usar create_adjustment después.

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

  -- Revertir stock
  update products set stock = stock - pur.units where id = pur.product_id;

  -- Si fue pagado con efectivo de caja, revertir el cash_movement correspondiente
  -- (lo anulamos buscando el gasto por nota y monto en la misma ventana de tiempo)
  if pur.payment_method = 'cash' then
    update cash_movements
      set voided = true, void_reason = 'Anulación surtido ' || p_purchase,
          voided_by = auth.uid(), voided_at = now()
      where type = 'expense' and method = 'cash'
        and amount = pur.units * pur.unit_cost
        and voided = false
        and created_at between pur.created_at - interval '1 minute' and pur.created_at + interval '1 minute'
      limit 1;
  end if;
end $$;
