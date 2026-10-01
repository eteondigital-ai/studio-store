-- bank_balance_now(): total de transferencias de la tienda (banco)
-- = ventas cobradas por transfer + abonos por transfer + ingresos manuales transfer
--   - gastos pagados con banco tienda (store_bank purchases)
create or replace function bank_balance_now()
returns int language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := '-infinity';
  last_close record;
  base int := 0;
  v int;
begin
  perform assert_user();

  -- No existe el concepto de "cierre de banco" aún, así que sumamos todo desde el inicio
  select
    coalesce((select sum(total) from sales
        where payment_method = 'transfer' and sale_type = 'sale' and voided = false), 0)
    + coalesce((select sum(amount) from payments
        where method = 'transfer' and voided = false), 0)
    + coalesce((select sum(amount) from cash_movements
        where method = 'transfer' and type = 'income' and voided = false), 0)
    - coalesce((select sum(amount) from cash_movements
        where method = 'transfer' and type = 'expense' and voided = false), 0)
  into v;

  return coalesce(v, 0);
end $$;
