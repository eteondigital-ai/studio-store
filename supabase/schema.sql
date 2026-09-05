-- ============================================================
-- STUDIO STORE — Schema v1.0 (Supabase / Postgres)
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ---------- TABLAS ----------

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  role text not null check (role in ('owner','monitor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text default '',
  emoji text not null default '👤',
  credit_limit int not null default 50000,
  status text not null default 'active' check (status in ('active','inactive','written_off')),
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🛒',
  image_url text,
  sell_price int not null check (sell_price > 0),
  avg_cost int not null check (avg_cost >= 0),
  stock int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 5,
  active boolean not null default true,
  sort_order int not null default 999999,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products,
  units int not null check (units > 0),
  unit_cost int not null check (unit_cost >= 0),
  supplier text,
  note text,
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  void_reason text, voided_by uuid references profiles, voided_at timestamptz
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers,
  payment_method text not null check (payment_method in ('cash','transfer','credit','internal')),
  total int not null check (total >= 0),
  total_cost int not null check (total_cost >= 0),
  sale_type text not null default 'sale' check (sale_type in ('sale','internal')),
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  void_reason text, voided_by uuid references profiles, voided_at timestamptz
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales on delete restrict,
  product_id uuid not null references products,
  qty int not null check (qty > 0),
  unit_price int not null,
  unit_cost int not null
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers,
  amount int not null check (amount > 0),
  method text not null check (method in ('cash','transfer')),
  note text,
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  void_reason text, voided_by uuid references profiles, voided_at timestamptz
);

create table if not exists stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products,
  qty_delta int not null check (qty_delta <> 0),
  reason text not null check (reason in ('expired','damaged','gift','count_correction','other')),
  note text,
  unit_cost_snapshot int not null,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('expense','withdrawal','deposit')),
  method text not null check (method in ('cash','transfer')),
  amount int not null check (amount > 0),
  note text not null,
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  void_reason text, voided_by uuid references profiles, voided_at timestamptz
);

create table if not exists cash_closings (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null default now(),
  expected_cash int not null,
  counted_cash int not null,
  difference int generated always as (counted_cash - expected_cash) stored,
  note text,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table if not exists write_offs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers,
  amount int not null check (amount > 0),
  reason text not null,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

-- ---------- VISTAS ----------

-- Saldo de cada cliente = fiados no anulados − abonos no anulados − castigos
create or replace view customer_balances as
select
  c.id, c.name, c.tag, c.emoji, c.credit_limit, c.status,
  coalesce((select sum(s.total) from sales s
            where s.customer_id = c.id and s.payment_method = 'credit'
              and s.voided = false and s.sale_type = 'sale'),0)
  - coalesce((select sum(p.amount) from payments p
              where p.customer_id = c.id and p.voided = false),0)
  - coalesce((select sum(w.amount) from write_offs w
              where w.customer_id = c.id),0) as balance
from customers c;

-- ---------- HELPERS ----------

create or replace function current_role_ss()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active = true;
$$;

create or replace function assert_owner()
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_role_ss() is distinct from 'owner' then
    raise exception 'Solo el dueño puede hacer esto';
  end if;
end $$;

create or replace function assert_user()
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_role_ss() is null then
    raise exception 'Usuario no autorizado';
  end if;
end $$;

-- Efectivo esperado en caja desde el último cierre
create or replace function expected_cash_now()
returns int language plpgsql stable security definer set search_path = public as $$
declare
  last_close record;
  base int := 0;
  since timestamptz := '-infinity';
  v int;
begin
  select counted_cash, created_at into last_close
    from cash_closings order by created_at desc limit 1;
  if found then base := last_close.counted_cash; since := last_close.created_at; end if;

  select base
    + coalesce((select sum(total) from sales
        where payment_method='cash' and sale_type='sale' and voided=false and created_at > since),0)
    + coalesce((select sum(amount) from payments
        where method='cash' and voided=false and created_at > since),0)
    + coalesce((select sum(amount) from cash_movements
        where method='cash' and type='deposit' and voided=false and created_at > since),0)
    - coalesce((select sum(amount) from cash_movements
        where method='cash' and type in ('expense','withdrawal') and voided=false and created_at > since),0)
  into v;
  return v;
end $$;

-- ---------- FUNCIONES TRANSACCIONALES (RPC) ----------
-- Toda escritura pasa por aquí. Nunca updates directos desde el cliente.

-- items: [{"product_id":"uuid","qty":2}, ...]
create or replace function create_sale(
  p_items jsonb,
  p_method text,
  p_customer uuid default null,
  p_sale_type text default 'sale'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  it record;
  prod record;
  v_total int := 0;
  v_cost int := 0;
  v_sale_id uuid;
  v_balance int;
  v_limit int;
begin
  perform assert_user();
  if p_sale_type = 'internal' then p_method := 'internal'; end if;
  if p_method = 'credit' and p_customer is null then
    raise exception 'A clientes de paso no se les fía';
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Venta vacía'; end if;

  -- validar stock y calcular totales con precios congelados
  for it in select (e->>'product_id')::uuid pid, (e->>'qty')::int qty
            from jsonb_array_elements(p_items) e loop
    select * into prod from products where id = it.pid and active for update;
    if not found then raise exception 'Producto no existe'; end if;
    if prod.stock < it.qty then
      raise exception 'No hay stock suficiente de %', prod.name;
    end if;
    if p_sale_type = 'internal' then
      v_total := v_total + prod.avg_cost * it.qty;  -- consumo interno a costo
    else
      v_total := v_total + prod.sell_price * it.qty;
    end if;
    v_cost := v_cost + prod.avg_cost * it.qty;
  end loop;

  -- validar límite de fiado
  if p_method = 'credit' then
    select balance, credit_limit into v_balance, v_limit
      from customer_balances where id = p_customer;
    if v_balance + v_total > v_limit then
      raise exception 'Límite de fiado alcanzado (% de %)', v_balance, v_limit;
    end if;
  end if;

  insert into sales (customer_id, payment_method, total, total_cost, sale_type, created_by)
  values (p_customer, p_method, v_total, v_cost, p_sale_type, auth.uid())
  returning id into v_sale_id;

  for it in select (e->>'product_id')::uuid pid, (e->>'qty')::int qty
            from jsonb_array_elements(p_items) e loop
    select * into prod from products where id = it.pid for update;
    insert into sale_items (sale_id, product_id, qty, unit_price, unit_cost)
    values (v_sale_id, it.pid, it.qty,
            case when p_sale_type='internal' then prod.avg_cost else prod.sell_price end,
            prod.avg_cost);
    update products set stock = stock - it.qty where id = it.pid;
  end loop;

  return v_sale_id;
end $$;

create or replace function create_payment(p_customer uuid, p_amount int, p_method text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_balance int; v_id uuid;
begin
  perform assert_user();
  select balance into v_balance from customer_balances where id = p_customer;
  if v_balance is null then raise exception 'Cliente no existe'; end if;
  if p_amount > v_balance then raise exception 'El abono (%) supera el saldo (%)', p_amount, v_balance; end if;
  insert into payments (customer_id, amount, method, note, created_by)
  values (p_customer, p_amount, p_method, p_note, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function create_purchase(p_product uuid, p_units int, p_unit_cost int, p_supplier text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare prod record; v_id uuid;
begin
  perform assert_user();
  select * into prod from products where id = p_product for update;
  if not found then raise exception 'Producto no existe'; end if;
  insert into purchases (product_id, units, unit_cost, supplier, note, created_by)
  values (p_product, p_units, p_unit_cost, p_supplier, p_note, auth.uid()) returning id into v_id;
  -- costo promedio ponderado
  update products set
    avg_cost = case when stock + p_units > 0
      then round((avg_cost::numeric * stock + p_unit_cost::numeric * p_units) / (stock + p_units))
      else p_unit_cost end,
    stock = stock + p_units
  where id = p_product;
  return v_id;
end $$;

create or replace function create_adjustment(p_product uuid, p_qty_delta int, p_reason text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare prod record; v_id uuid;
begin
  perform assert_owner();
  select * into prod from products where id = p_product for update;
  if not found then raise exception 'Producto no existe'; end if;
  if prod.stock + p_qty_delta < 0 then raise exception 'El ajuste dejaría el stock negativo'; end if;
  insert into stock_adjustments (product_id, qty_delta, reason, note, unit_cost_snapshot, created_by)
  values (p_product, p_qty_delta, p_reason, p_note, prod.avg_cost, auth.uid()) returning id into v_id;
  update products set stock = stock + p_qty_delta where id = p_product;
  return v_id;
end $$;

create or replace function create_cash_movement(p_type text, p_method text, p_amount int, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_owner();
  if coalesce(trim(p_note),'') = '' then raise exception 'La nota es obligatoria'; end if;
  if p_method = 'cash' and p_type in ('expense','withdrawal') and p_amount > expected_cash_now() then
    raise exception 'No hay tanto efectivo en caja';
  end if;
  insert into cash_movements (type, method, amount, note, created_by)
  values (p_type, p_method, p_amount, p_note, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function close_register(p_counted int, p_note text default null)
returns cash_closings language plpgsql security definer set search_path = public as $$
declare v_expected int; v_start timestamptz; row cash_closings;
begin
  perform assert_owner();
  v_expected := expected_cash_now();
  select coalesce(max(created_at), now() - interval '100 years') into v_start from cash_closings;
  insert into cash_closings (period_start, expected_cash, counted_cash, note, created_by)
  values (v_start, v_expected, p_counted, p_note, auth.uid()) returning * into row;
  return row;
end $$;

create or replace function create_write_off(p_customer uuid, p_amount int, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_owner();
  insert into write_offs (customer_id, amount, reason, created_by)
  values (p_customer, p_amount, p_reason, auth.uid()) returning id into v_id;
  update customers set status = 'written_off' where id = p_customer;
  return v_id;
end $$;

-- Anulaciones con rastro: revierten stock; los saldos se corrigen solos (vista)
create or replace function void_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare it record;
begin
  perform assert_owner();
  if coalesce(trim(p_reason),'') = '' then raise exception 'El motivo es obligatorio'; end if;
  update sales set voided=true, void_reason=p_reason, voided_by=auth.uid(), voided_at=now()
    where id = p_sale and voided=false;
  if not found then raise exception 'Venta no existe o ya está anulada'; end if;
  for it in select product_id, qty from sale_items where sale_id = p_sale loop
    update products set stock = stock + it.qty where id = it.product_id;
  end loop;
end $$;

create or replace function void_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner();
  if coalesce(trim(p_reason),'') = '' then raise exception 'El motivo es obligatorio'; end if;
  update payments set voided=true, void_reason=p_reason, voided_by=auth.uid(), voided_at=now()
    where id = p_payment and voided=false;
  if not found then raise exception 'Abono no existe o ya está anulado'; end if;
end $$;

create or replace function void_cash_movement(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner();
  if coalesce(trim(p_reason),'') = '' then raise exception 'El motivo es obligatorio'; end if;
  update cash_movements set voided=true, void_reason=p_reason, voided_by=auth.uid(), voided_at=now()
    where id = p_id and voided=false;
  if not found then raise exception 'Movimiento no existe o ya está anulado'; end if;
end $$;

-- ---------- ROW LEVEL SECURITY ----------
-- Lectura: cualquier usuario activo. Escritura: SOLO vía funciones de arriba
-- (security definer). products/customers: el dueño puede editar directo.

alter table profiles enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table purchases enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table payments enable row level security;
alter table stock_adjustments enable row level security;
alter table cash_movements enable row level security;
alter table cash_closings enable row level security;
alter table write_offs enable row level security;

create policy "leer perfiles" on profiles for select using (auth.uid() is not null);
create policy "leer clientes" on customers for select using (current_role_ss() is not null);
create policy "leer productos" on products for select using (current_role_ss() is not null);
create policy "leer compras" on purchases for select using (current_role_ss() is not null);
create policy "leer ventas" on sales for select using (current_role_ss() is not null);
create policy "leer items" on sale_items for select using (current_role_ss() is not null);
create policy "leer abonos" on payments for select using (current_role_ss() is not null);
create policy "leer ajustes" on stock_adjustments for select using (current_role_ss() is not null);
create policy "leer caja" on cash_movements for select using (current_role_ss() is not null);
create policy "leer cierres" on cash_closings for select using (current_role_ss() is not null);
create policy "leer castigos" on write_offs for select using (current_role_ss() is not null);

-- Dueño administra catálogo y clientes directo (sin delete: nada se borra)
create policy "dueño crea productos" on products for insert with check (current_role_ss() = 'owner');
create policy "dueño edita productos" on products for update using (current_role_ss() = 'owner');
create policy "dueño crea clientes" on customers for insert with check (current_role_ss() = 'owner');
create policy "dueño edita clientes" on customers for update using (current_role_ss() = 'owner');

-- ---------- HISTORIAL DE CAMBIOS DE PRECIO/COSTO ----------
create table if not exists product_price_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  old_cost int, new_cost int,
  old_price int, new_price int,
  created_at timestamptz not null default now()
);
alter table product_price_log enable row level security;
create policy "owners see price log" on product_price_log for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'owner'));

create or replace function log_product_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.sell_price is distinct from new.sell_price
     or old.avg_cost is distinct from new.avg_cost then
    insert into product_price_log (product_id, old_cost, new_cost, old_price, new_price)
    values (new.id, old.avg_cost, new.avg_cost, old.sell_price, new.sell_price);
  end if;
  return new;
end $$;

drop trigger if exists trg_product_price_log on products;
create trigger trg_product_price_log after update on products
  for each row execute function log_product_price_change();

-- ---------- STORAGE: fotos de productos ----------
-- Bucket público para que las fotos carguen rápido en la app.
-- Solo el dueño puede subir o cambiar fotos.

alter table products add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('product-photos','product-photos', true)
on conflict (id) do nothing;

create policy "fotos publicas" on storage.objects
  for select using (bucket_id = 'product-photos');
create policy "duenio sube fotos" on storage.objects
  for insert with check (bucket_id = 'product-photos' and current_role_ss() = 'owner');
create policy "duenio actualiza fotos" on storage.objects
  for update using (bucket_id = 'product-photos' and current_role_ss() = 'owner');

-- ---------- SEED (productos y clientes de arranque; edítalos a gusto) ----------

insert into products (name, emoji, sell_price, avg_cost, stock) values
 ('De Todito','🥔',4500,3200,0),
 ('Coca-Cola 400ml','🥤',4000,2600,0),
 ('Chocorramo','🍫',3500,2300,0),
 ('Bon Bon Bum','🍭',800,450,0),
 ('Papas Margarita','🍟',3000,2000,0),
 ('Postobón Manzana','🧃',3500,2200,0),
 ('Café tinto','☕',1500,500,0),
 ('Agua 600ml','💧',2500,1300,0)
on conflict do nothing;

-- ============================================================
-- DESPUÉS DE EJECUTAR ESTE SCRIPT:
-- 1. Authentication → Users → crea los usuarios (tú, tu hermano, monitora)
-- 2. Corre esto por cada uno (con su UUID de la lista de users):
--    insert into profiles (id, name, role) values
--      ('UUID-AQUI', 'Jósef', 'owner');
--      ('UUID-AQUI', 'Hermano', 'owner');
--      ('UUID-AQUI', 'Monitora', 'monitor');
-- 3. El stock inicial se carga desde la app con "Surtir" (queda como
--    compra registrada) — por eso el seed arranca en 0.
-- ============================================================
