'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');
const fmtDate = d => new Date(d).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function resizeImage(file, max = 640) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
}

export default function Store() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [todaySales, setTodaySales] = useState([]);
  const [weekSales, setWeekSales] = useState([]);
  const [weekItems, setWeekItems] = useState([]);
  const [weekPayments, setWeekPayments] = useState([]);
  const [closings, setClosings] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [profilesMap, setProfilesMap] = useState({});
  const [expectedCash, setExpectedCash] = useState(0);
  const [tab, setTab] = useState('vender');
  const [clienteTab, setClienteTab] = useState('todos');
  const [cart, setCart] = useState({});
  const [sheet, setSheet] = useState(null); // {kind, data}
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('todos');
  const [sortBy, setSortBy] = useState('manual');
  const [dragId, setDragId] = useState(null);

  const owner = profile?.role === 'owner';
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);
  const rowRefs = useRef({});

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter(p => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const inventoryProducts = useMemo(() => {
    let list = filteredProducts;
    if (stockFilter === 'stock') list = list.filter(p => p.stock > p.low_stock_threshold);
    else if (stockFilter === 'bajo') list = list.filter(p => p.stock > 0 && p.stock <= p.low_stock_threshold);
    else if (stockFilter === 'agotado') list = list.filter(p => p.stock === 0);
    if (sortBy === 'manual') return list;
    const arr = [...list];
    if (sortBy === 'nombre') arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'precio') arr.sort((a, b) => a.sell_price - b.sell_price);
    else if (sortBy === 'stock') arr.sort((a, b) => a.stock - b.stock);
    return arr;
  }, [filteredProducts, stockFilter, sortBy]);

  const canDrag = owner && !search.trim() && stockFilter === 'todos' && sortBy === 'manual';

  function reorder(fromId, overId) {
    setProducts(prev => {
      const from = prev.findIndex(p => p.id === fromId);
      const to = prev.findIndex(p => p.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
    });
  }

  const dragIdRef = useRef(null);

  function handlePointerMove(e) {
    const id = dragIdRef.current;
    if (!id) return;
    for (const [otherId, el] of Object.entries(rowRefs.current)) {
      if (!el || otherId === id) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) { reorder(id, otherId); break; }
    }
  }

  async function handlePointerUp() {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    dragIdRef.current = null;
    setDragId(null);
    await Promise.all(productsRef.current.map((p, i) =>
      supabase.from('products').update({ sort_order: i }).eq('id', p.id)));
  }

  function handlePointerDown(e, id) {
    if (!canDrag) return;
    e.preventDefault();
    dragIdRef.current = id;
    setDragId(id);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  const notify = (msg, warn) => {
    setToast({ msg, warn });
    setTimeout(() => setToast(null), 2400);
  };

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }

    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 864e5);

    const [prof, prods, custs, tSales, wSales, wPays, cls, exp, recent, allProfs] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('products').select('*').eq('active', true).order('sort_order'),
      supabase.from('customer_balances').select('*').neq('status', 'inactive').order('name'),
      supabase.from('sales').select('*').gte('created_at', startToday.toISOString()).eq('voided', false),
      supabase.from('sales').select('*').gte('created_at', weekAgo.toISOString()).eq('voided', false),
      supabase.from('payments').select('*').gte('created_at', weekAgo.toISOString()).eq('voided', false),
      supabase.from('cash_closings').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.rpc('expected_cash_now'),
      supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('profiles').select('id,name'),
    ]);

    if (!prof.data) { notify('Tu usuario no tiene perfil asignado', true); return; }
    setProfile(prof.data);
    setProducts(prods.data ?? []);
    setCustomers(custs.data ?? []);
    setTodaySales(tSales.data ?? []);
    setWeekSales(wSales.data ?? []);
    setWeekPayments(wPays.data ?? []);
    setClosings(cls.data ?? []);
    setExpectedCash(exp.data ?? 0);
    setRecentSales(recent.data ?? []);
    const map = {};
    (allProfs.data ?? []).forEach(p => { map[p.id] = p.name; });
    setProfilesMap(map);

    const saleIds = (wSales.data ?? []).filter(s => s.sale_type === 'sale').map(s => s.id);
    if (saleIds.length) {
      const { data } = await supabase.from('sale_items').select('*').in('sale_id', saleIds);
      setWeekItems(data ?? []);
    } else setWeekItems([]);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  /* ---------- derivados ---------- */
  const today = useMemo(() => {
    const real = todaySales.filter(s => s.sale_type === 'sale');
    const sum = m => real.filter(s => s.payment_method === m).reduce((a, s) => a + s.total, 0);
    return { sales: real.reduce((a, s) => a + s.total, 0), cash: sum('cash'), transfer: sum('transfer'), credit: sum('credit') };
  }, [todaySales]);

  const week = useMemo(() => {
    const real = weekSales.filter(s => s.sale_type === 'sale');
    const revenue = real.reduce((a, s) => a + s.total, 0);
    const cost = real.reduce((a, s) => a + s.total_cost, 0);
    const transferIn = real.filter(s => s.payment_method === 'transfer').reduce((a, s) => a + s.total, 0)
      + weekPayments.filter(p => p.method === 'transfer').reduce((a, p) => a + p.amount, 0);
    const units = {};
    weekItems.forEach(i => { units[i.product_id] = (units[i.product_id] || 0) + i.qty; });
    return { revenue, cost, transferIn, units };
  }, [weekSales, weekItems, weekPayments]);

  const street = useMemo(() => customers.reduce((a, c) => a + (c.balance > 0 ? c.balance : 0), 0), [customers]);
  const invValue = useMemo(() => products.reduce((a, p) => a + p.avg_cost * p.stock, 0), [products]);
  const cartTotal = useMemo(() => Object.entries(cart).reduce((a, [id, q]) => {
    const p = products.find(x => x.id === id); return a + (p ? p.sell_price * q : 0);
  }, 0), [cart, products]);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  /* ---------- acciones ---------- */
  const addToCart = p => {
    const q = cart[p.id] || 0;
    if (q >= p.stock) { notify('No hay más stock de ' + p.name, true); return; }
    setCart(c => ({ ...c, [p.id]: q + 1 }));
  };

  const removeFromCart = p => {
    setCart(c => {
      const n = { ...c };
      if (n[p.id] > 1) n[p.id]--;
      else delete n[p.id];
      return n;
    });
  };

  async function confirmSale(method, customerId, saleType = 'sale') {
    if (busy) return; setBusy(true);
    const items = Object.entries(cart).map(([product_id, qty]) => ({ product_id, qty }));
    const { error } = await supabase.rpc('create_sale', {
      p_items: items, p_method: method, p_customer: customerId, p_sale_type: saleType,
    });
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setCart({}); setSheet(null);
    const msg = saleType === 'internal' ? 'Consumo interno registrado'
      : method === 'credit' ? 'Fiado guardado · ' + fmt(cartTotal)
      : 'Venta guardada · ' + fmt(cartTotal) + (method === 'cash' ? ' en efectivo' : ' por transferencia');
    notify(msg, method === 'credit');
    load();
  }

  async function savePayment(customerId, amount, method) {
    if (busy) return; setBusy(true);
    const { error } = await supabase.rpc('create_payment', { p_customer: customerId, p_amount: amount, p_method: method });
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setSheet(null); notify('Abono guardado · ' + fmt(amount)); load();
  }

  async function confirmSplitSale(customerId, upfrontAmount, upfrontMethod) {
    if (busy) return; setBusy(true);
    const items = Object.entries(cart).map(([product_id, qty]) => ({ product_id, qty }));
    const { error: saleErr } = await supabase.rpc('create_sale', {
      p_items: items, p_method: 'credit', p_customer: customerId,
    });
    if (saleErr) { setBusy(false); notify(saleErr.message, true); return; }
    if (upfrontAmount > 0) {
      const { error: payErr } = await supabase.rpc('create_payment', {
        p_customer: customerId, p_amount: upfrontAmount, p_method: upfrontMethod,
      });
      if (payErr) {
        setBusy(false);
        notify('Venta guardada, pero no se pudo registrar el abono: ' + payErr.message, true);
        load(); return;
      }
    }
    setBusy(false);
    setCart({}); setSheet(null);
    const fiado = cartTotal - upfrontAmount;
    const mLabel = upfrontMethod === 'cash' ? 'efectivo' : 'transfer.';
    notify('Mixto · ' + fmt(upfrontAmount) + ' ' + mLabel + ' + ' + fmt(fiado) + ' fiado');
    load();
  }

  async function savePurchase(productId, units, unitCost) {
    if (busy) return; setBusy(true);
    const { error } = await supabase.rpc('create_purchase', { p_product: productId, p_units: units, p_unit_cost: unitCost });
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setSheet(null); notify(units + ' unidades sumadas'); load();
  }

  async function saveProduct(data, editingId, imageFile) {
    if (busy) return; setBusy(true);
    let image_url = data.image_url ?? null;
    if (imageFile) {
      try {
        const blob = await resizeImage(imageFile);
        const path = (editingId || crypto.randomUUID()) + '-' + Date.now() + '.jpg';
        const up = await supabase.storage.from('product-photos')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (up.error) throw up.error;
        image_url = supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
      } catch (e) {
        setBusy(false); notify('No se pudo subir la foto: ' + e.message, true); return;
      }
    }
    let error;
    if (editingId) {
      ({ error } = await supabase.from('products')
        .update({ name: data.name, emoji: data.emoji, sell_price: data.price, avg_cost: data.cost, image_url })
        .eq('id', editingId));
    } else {
      ({ error } = await supabase.from('products')
        .insert({ name: data.name, emoji: data.emoji, sell_price: data.price, avg_cost: data.cost, stock: 0, image_url }));
    }
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setSheet(null);
    notify(editingId ? 'Producto actualizado' : data.name + ' agregado — usa "Surtir" para cargar el stock');
    load();
  }

  async function saveCashMovement(type, amount, note) {
    if (busy) return; setBusy(true);
    const { error } = await supabase.rpc('create_cash_movement', { p_type: type, p_method: 'cash', p_amount: amount, p_note: note });
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setSheet(null); notify((type === 'expense' ? 'Gasto' : 'Retiro') + ' guardado · ' + fmt(amount)); load();
  }

  async function saveClosing(counted) {
    if (busy) return; setBusy(true);
    const { data, error } = await supabase.rpc('close_register', { p_counted: counted });
    setBusy(false);
    if (error) { notify(error.message, true); return; }
    setSheet(null);
    const d = data.counted_cash - data.expected_cash;
    notify(d === 0 ? 'Caja cerrada — cuadró perfecto ✓' : 'Caja cerrada con diferencia de ' + fmt(Math.abs(d)), d !== 0);
    load();
  }

  async function logout() { await supabase.auth.signOut(); router.replace('/login'); }

  if (!profile) return <div className="hint" style={{ margin: 'auto' }}>Cargando…</div>;

  /* ---------- UI ---------- */
  const isSellingTab = tab === 'vender';
  const showDesktopCart = isSellingTab;
  const initials = profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const tabLabels = { vender: 'Vender', clientes: 'Clientes', inventario: 'Inventario', caja: 'Caja', panel: 'Panel', notif: 'Alertas' };

  return (
    <>
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="brand">Studio Store</span>
          <span className="header-tab-label">{tabLabels[tab]}</span>
        </div>
        <div className="user-menu">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <span className="user-name">{profile.name}</span>
            <span className={'user-role' + (owner ? ' owner' : '')}>{owner ? 'Administrador' : 'Monitor'}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Cerrar sesión">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      <main className={showDesktopCart ? 'with-cart' : ''}>
        {tab === 'vender' && (
          <section>
            <div className="today-strip">
              <div><small>Ventas hoy</small><strong>{fmt(today.sales)}</strong></div>
              <div><small>Efectivo</small><strong className="v-cash">{fmt(today.cash)}</strong></div>
              <div><small>Transfer.</small><strong className="v-transfer">{fmt(today.transfer)}</strong></div>
              <div><small>Fiado</small><strong className="v-debt">{fmt(today.credit)}</strong></div>
            </div>
            <button className="btn-dashed" style={{ marginTop: 0, marginBottom: 14, padding: 10 }}
              onClick={() => setSheet({ kind: 'movs' })}>
              🕐 Ver movimientos recientes (fecha y hora)
            </button>
            <input className="search-input" placeholder="🔍 Buscar producto…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
            <div className="product-grid">
              {filteredProducts.map(p => {
                const inCart = cart[p.id] || 0;
                return (
                  <div key={p.id}
                    className={'prod' + (p.stock === 0 ? ' out' : p.stock <= p.low_stock_threshold ? ' low' : '') + (inCart ? ' in-cart' : '')}
                    onClick={() => addToCart(p)}>
                    <span className="p-stock">{p.stock === 0 ? 'agotado' : 'quedan ' + p.stock}</span>
                    {p.image_url
                      ? <img className="p-photo" src={p.image_url} alt="" loading="lazy" decoding="async" />
                      : <span className="emoji">{p.emoji}</span>}
                    <span className="p-name">{p.name}</span>
                    {inCart ? (
                      <div className="prod-qty-bar" onClick={e => e.stopPropagation()}>
                        <button className="prod-qty-btn" onClick={() => removeFromCart(p)}>−</button>
                        <span className="prod-qty-count">{inCart}</span>
                        <button className="prod-qty-btn" onClick={() => addToCart(p)}>+</button>
                      </div>
                    ) : (
                      <span className="p-price">{fmt(p.sell_price)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'clientes' && (
          <section>
            <h2 className="screen-title">Clientes</h2>

            {/* Sub-nav */}
            <div className="sub-tabs">
              <button className={clienteTab === 'todos' ? 'on' : ''} onClick={() => setClienteTab('todos')}>👥 Directorio</button>
              <button className={clienteTab === 'fiados' ? 'on' : ''} onClick={() => setClienteTab('fiados')}>
                🧾 Fiados
                {customers.filter(c => c.balance > 0).length > 0 && (
                  <span className="sub-tab-badge">{customers.filter(c => c.balance > 0).length}</span>
                )}
              </button>
            </div>

            {clienteTab === 'fiados' && (
              <div className="card yellow-card row">
                <div>
                  <small style={{ fontWeight: 700, fontSize: 11.5, color: '#7a6a1d' }}>Plata en la calle (por cobrar)</small>
                  <br /><strong style={{ fontSize: 23 }}>{fmt(street)}</strong>
                </div>
                <div style={{ fontSize: 32 }}>🧾</div>
              </div>
            )}

            {clienteTab === 'todos' && owner && (
              <button className="btn-dashed" style={{ marginBottom: 14 }} onClick={() => setSheet({ kind: 'cliente' })}>＋ Agregar persona</button>
            )}

            {(clienteTab === 'todos' ? customers : customers.filter(c => c.balance > 0)).map(c => {
              const pct = Math.min(100, Math.round((c.balance / c.credit_limit) * 100));
              return (
                <div key={c.id} className="card" style={{ cursor: 'pointer' }}
                  onClick={() => setSheet({ kind: 'persona', data: c })}>
                  <div className="row">
                    <div className="avatar">{c.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>{c.name}</strong>
                      <small style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>{c.tag}</small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ display: 'block', fontSize: 15, color: c.balance === 0 ? 'var(--green)' : 'var(--red)' }}>
                        {c.balance === 0 ? 'Al día ✓' : fmt(c.balance)}
                      </strong>
                      <small style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{pct}% del límite</small>
                    </div>
                  </div>
                  <div className="limit-track"><div className={'limit-fill' + (pct < 70 ? ' ok' : '')} style={{ width: pct + '%' }} /></div>
                </div>
              );
            })}

            {clienteTab === 'fiados' && customers.filter(c => c.balance > 0).length === 0 && (
              <div className="hint" style={{ marginTop: 24 }}>No hay fiados pendientes 🎉</div>
            )}
          </section>
        )}

        {tab === 'inventario' && (
          <section>
            <h2 className="screen-title">Inventario</h2>
            {owner && (
              <div className="card row" style={{ textAlign: 'left' }}>
                <div><small style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Invertido en stock</small><br /><strong>{fmt(invValue)}</strong></div>
                <div><small style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Si se vende todo</small><br /><strong>{fmt(products.reduce((a, p) => a + p.sell_price * p.stock, 0))}</strong></div>
                <div><small style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Utilidad esperada</small><br /><strong style={{ color: 'var(--green)' }}>{fmt(products.reduce((a, p) => a + (p.sell_price - p.avg_cost) * p.stock, 0))}</strong></div>
              </div>
            )}
            {owner && <button className="btn-dashed" style={{ marginBottom: 14 }} onClick={() => setSheet({ kind: 'producto' })}>＋ Agregar producto</button>}
            <input className="search-input" placeholder="🔍 Buscar producto…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="chip-row" style={{ marginBottom: 8 }}>
              {[['todos', 'Todos'], ['stock', 'En stock'], ['bajo', 'Stock bajo'], ['agotado', 'Agotado']].map(([id, label]) => (
                <button key={id} className={'chip' + (stockFilter === id ? ' on' : '')} onClick={() => setStockFilter(id)}>{label}</button>
              ))}
            </div>
            <select className="search-input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ marginBottom: 12 }}>
              <option value="manual">Orden manual</option>
              <option value="nombre">Ordenar por nombre</option>
              <option value="precio">Ordenar por precio</option>
              <option value="stock">Ordenar por stock</option>
            </select>
            {canDrag && inventoryProducts.length > 1 && (
              <div className="hint" style={{ textAlign: 'left', marginBottom: 8 }}>Mantén presionado ⠿ y arrastra para reordenar</div>
            )}
            {inventoryProducts.map(p => (
              <div key={p.id} ref={el => { rowRefs.current[p.id] = el; }}
                className="card row" style={{ opacity: dragId === p.id ? 0.4 : 1 }}>
                {canDrag && (
                  <span className="drag-handle" onPointerDown={e => handlePointerDown(e, p.id)}>⠿</span>
                )}
                <div className="avatar" style={{ borderRadius: 12, overflow: 'hidden' }}>
                  {p.image_url ? <img src={p.image_url} alt="" /> : p.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0, cursor: owner ? 'pointer' : 'default' }}
                  onClick={() => owner && setSheet({ kind: 'producto', data: p })}>
                  <strong style={{ fontSize: 13, display: 'block' }}>{p.name}{owner ? ' ✏️' : ''}</strong>
                  <small style={{ color: 'var(--muted)', fontSize: 10.5, fontWeight: 600 }}>
                    Vende {fmt(p.sell_price)}
                    {owner && <><br />costo {fmt(p.avg_cost)} · en stock {fmt(p.avg_cost * p.stock)} · margen {p.sell_price ? Math.round(((p.sell_price - p.avg_cost) / p.sell_price) * 100) : 0}%</>}
                  </small>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: p.stock <= p.low_stock_threshold ? 'var(--red)' : 'inherit' }}>
                  {p.stock}<small style={{ display: 'block', fontSize: 9, color: 'var(--muted)' }}>en stock</small>
                </div>
                <button className="btn-secondary" onClick={() => setSheet({ kind: 'surtir', data: p })}>Surtir</button>
              </div>
            ))}
            {inventoryProducts.length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Sin resultados</div>}
          </section>
        )}

        {tab === 'caja' && (
          <section>
            <h2 className="screen-title">Caja</h2>
            <div className="card green-card">
              <small style={{ opacity: .85, fontSize: 11.5, fontWeight: 700 }}>Efectivo que debe haber en caja</small>
              <strong style={{ fontSize: 26, display: 'block' }}>{fmt(expectedCash)}</strong>
              <small style={{ opacity: .85, fontSize: 11.5, fontWeight: 700, display: 'block', marginTop: 6 }}>
                Transferencias de la semana: {fmt(week.transferIn)}
              </small>
            </div>
            {owner && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginBottom: 14 }}>
                <button className="card" style={{ marginBottom: 0, textAlign: 'center', fontWeight: 800, fontSize: 13 }}
                  onClick={() => setSheet({ kind: 'gasto' })}>
                  <span style={{ fontSize: 22, display: 'block' }}>💸</span>Registrar gasto o retiro
                </button>
                <button className="card" style={{ marginBottom: 0, textAlign: 'center', fontWeight: 800, fontSize: 13 }}
                  onClick={() => setSheet({ kind: 'cierre' })}>
                  <span style={{ fontSize: 22, display: 'block' }}>🔒</span>Cerrar caja
                </button>
              </div>
            )}
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Cierres anteriores</strong>
              {closings.length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Aún no hay cierres.</div>}
              {closings.map(c => (
                <div key={c.id} className="dashed-line">
                  <span>{new Date(c.created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                  <span style={{ fontWeight: 800, color: c.difference === 0 ? 'var(--green)' : 'var(--red)' }}>
                    {c.difference === 0 ? 'Cuadró ✓' : (c.difference > 0 ? 'Sobró ' : 'Faltó ') + fmt(Math.abs(c.difference))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'panel' && (
          <section>
            <h2 className="screen-title">Esta semana</h2>
            <div className="kpi-grid">
              <div className="kpi"><small>Ventas</small><strong>{fmt(week.revenue)}</strong></div>
              <div className="kpi"><small>Utilidad</small><strong style={{ color: 'var(--green)' }}>{fmt(week.revenue - week.cost)}</strong></div>
              <div className="kpi"><small>En la calle</small><strong style={{ color: 'var(--red)' }}>{fmt(street)}</strong></div>
              <div className="kpi"><small>Valor inventario</small><strong>{fmt(invValue)}</strong></div>
            </div>
            {owner && (
              <div className="card row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13, display: 'block' }}>🔗 Catálogo público</strong>
                  <small style={{ color: 'var(--muted)', fontSize: 10.5, fontWeight: 600 }}>Compártelo con las clientas, no necesita cuenta</small>
                </div>
                <button className="btn-secondary" onClick={() => {
                  navigator.clipboard.writeText(window.location.origin + '/catalogo');
                  notify('Link copiado');
                }}>Copiar link</button>
              </div>
            )}
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>¿Dónde está la plata?</strong>
              <div className="money-line"><span>💵 Caja física (esperado)</span><strong>{fmt(expectedCash)}</strong></div>
              <div className="money-line"><span>📲 Transferencias de la semana</span><strong style={{ color: 'var(--blue)' }}>{fmt(week.transferIn)}</strong></div>
              <div className="money-line"><span>🧾 Pendiente por cobrar</span><strong style={{ color: 'var(--red)' }}>{fmt(street)}</strong></div>
            </div>
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>Productos top de la semana</strong>
              {Object.entries(week.units).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pid, u]) => {
                const p = products.find(x => x.id === pid);
                const max = Math.max(...Object.values(week.units), 1);
                return p ? (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12 }}>
                    <span style={{ width: 100, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.emoji} {p.name}</span>
                    <div style={{ flex: 1, height: 9, background: 'var(--bg)', border: '1.5px solid var(--ink)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: Math.round((u / max) * 100) + '%', background: 'var(--red)' }} />
                    </div>
                    <span style={{ width: 32, textAlign: 'right', fontWeight: 800, fontSize: 11, color: 'var(--muted)' }}>{u}</span>
                  </div>
                ) : null;
              })}
              {Object.keys(week.units).length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Aún no hay ventas esta semana.</div>}
            </div>
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Necesita atención</strong>
              {products.filter(p => p.stock <= p.low_stock_threshold).map(p => (
                <div key={p.id} className="dashed-line"><span>🔴 {p.emoji} {p.name}</span><span>{p.stock === 0 ? 'agotado' : 'quedan ' + p.stock}</span></div>
              ))}
              {customers.filter(c => c.balance / c.credit_limit >= 0.8).map(c => (
                <div key={c.id} className="dashed-line"><span>🧾 {c.emoji} {c.name}</span><span>{Math.round((c.balance / c.credit_limit) * 100)}% del límite</span></div>
              ))}
              {closings[0] && closings[0].difference !== 0 && (
                <div className="dashed-line"><span>💵 Último cierre</span><span>diferencia de {fmt(Math.abs(closings[0].difference))}</span></div>
              )}
            </div>
          </section>
        )}

        {tab === 'notif' && (
          <section>
            <h2 className="screen-title">Alertas</h2>
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>📦 Stock bajo</strong>
              {products.filter(p => p.stock <= p.low_stock_threshold).map(p => (
                <div key={p.id} className="dashed-line"><span>🔴 {p.emoji} {p.name}</span><span>{p.stock === 0 ? 'agotado' : 'quedan ' + p.stock}</span></div>
              ))}
              {products.filter(p => p.stock <= p.low_stock_threshold).length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Todo el stock está bien.</div>}
            </div>
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>🧾 Fiados cerca del límite</strong>
              {customers.filter(c => c.credit_limit > 0 && c.balance / c.credit_limit >= 0.9).map(c => (
                <div key={c.id} className="dashed-line"><span>{c.emoji} {c.name}</span><span>{Math.round((c.balance / c.credit_limit) * 100)}% del límite</span></div>
              ))}
              {customers.filter(c => c.credit_limit > 0 && c.balance / c.credit_limit >= 0.9).length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Nadie cerca del límite.</div>}
            </div>
            <div className="card">
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>💵 Último cierre de caja</strong>
              {closings[0] ? (
                <div className="dashed-line">
                  <span>{new Date(closings[0].created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                  <span style={{ fontWeight: 800, color: closings[0].difference === 0 ? 'var(--green)' : 'var(--red)' }}>
                    {closings[0].difference === 0 ? 'Cuadró ✓' : (closings[0].difference > 0 ? 'Sobró ' : 'Faltó ') + fmt(Math.abs(closings[0].difference))}
                  </span>
                </div>
              ) : <div className="hint" style={{ textAlign: 'left' }}>Aún no hay cierres.</div>}
            </div>
          </section>
        )}
      </main>

      {cartCount > 0 && (
        <div className="cart-bar" onClick={() => setSheet({ kind: 'cobrar' })}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{cartCount} {cartCount === 1 ? 'producto' : 'productos'}</span>
          <span>
            <span style={{ fontSize: 11.5, textDecoration: 'underline', marginRight: 12 }}
              onClick={e => { e.stopPropagation(); setCart({}); }}>vaciar</span>
            <span style={{ fontSize: 17 }}>{fmt(cartTotal)}</span>
          </span>
        </div>
      )}

      <nav className="tabs">
        {[['vender', '🛒', 'Vender'], ['clientes', '👥', 'Clientes'], ['inventario', '📦', 'Inventario'], ['caja', '💵', 'Caja'],
          ['panel', '📊', 'Panel'], ['notif', '🔔', 'Alertas']].map(([id, ico, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <span className="ico">{ico}</span>{label}
          </button>
        ))}
      </nav>

      {/* Desktop persistent cart panel */}
      {isSellingTab && (
        <div className="desktop-cart">
          <div className="desktop-cart-title">🛒 Orden actual</div>
          {cartCount === 0 ? (
            <div className="desktop-cart-empty">
              <span className="dce-ico">🛍️</span>
              Toca un producto para agregar al carrito
            </div>
          ) : (
            <>
              <div className="desktop-cart-items">
                {Object.entries(cart).map(([id, qty]) => {
                  const p = products.find(x => x.id === id);
                  return p ? (
                    <div key={id} className="dci">
                      <span className="dci-emoji">{p.image_url ? <img src={p.image_url} className="p-photo" style={{ width: 28, height: 28, margin: 0 }} alt="" /> : p.emoji}</span>
                      <div className="dci-info">
                        <span className="dci-name">{p.name}</span>
                        <span className="dci-sub">{qty} × {fmt(p.sell_price)}</span>
                      </div>
                      <span className="dci-price">{fmt(p.sell_price * qty)}</span>
                      <button className="dci-rm" onClick={() => setCart(c => { const n = { ...c }; if (n[id] > 1) n[id]--; else delete n[id]; return n; })}>−</button>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="desktop-cart-divider" />
              <div className="desktop-cart-total">
                <div><small>Total a cobrar</small>{fmt(cartTotal)}</div>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{cartCount} {cartCount === 1 ? 'item' : 'items'}</span>
              </div>
              <button className="desktop-cart-btn" onClick={() => setSheet({ kind: 'cobrar' })}>
                Cobrar {fmt(cartTotal)}
              </button>
              <button className="desktop-cart-clear" onClick={() => setCart({})}>Vaciar carrito</button>
            </>
          )}
        </div>
      )}

      {sheet && <Sheets sheet={sheet} close={() => setSheet(null)} busy={busy}
        {...{ products, customers, cart, cartTotal, expectedCash, owner, recentSales, profilesMap, confirmSale, confirmSplitSale, savePayment, savePurchase, saveProduct, saveCashMovement, saveClosing, supabase, notify, load }} />}

      {toast && <div className={'toast' + (toast.warn ? ' warn' : '')}>{toast.msg}</div>}
    </>
  );
}

/* ================= hojas (bottom sheets) ================= */
function Sheets(props) {
  const { sheet, close } = props;

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <>
      <div className="backdrop" onClick={close} />
      <div className="sheet">
        <div className="grabber" />
        {sheet.kind === 'cobrar' && <ChargeSheet {...props} />}
        {sheet.kind === 'movs' && <MovsSheet {...props} />}
        {sheet.kind === 'persona' && <PersonSheet {...props} person={sheet.data} />}
        {sheet.kind === 'surtir' && <RestockSheet {...props} product={sheet.data} />}
        {sheet.kind === 'producto' && <ProductSheet {...props} product={sheet.data} />}
        {sheet.kind === 'cliente' && <CustomerSheet {...props} />}
        {sheet.kind === 'gasto' && <ExpenseSheet {...props} />}
        {sheet.kind === 'cierre' && <ClosingSheet {...props} />}
      </div>
    </>
  );
}

function ChargeSheet({ customers, cartTotal, confirmSale, confirmSplitSale, busy, owner }) {
  const [buyer, setBuyer]             = useState(null);
  const [mode, setMode]               = useState(null); // 'cash'|'transfer'|'credit'|'split'
  const [upfrontMethod, setUpMethod]  = useState('cash');
  const [upfrontRaw, setUpfrontRaw]   = useState('');

  const person     = buyer && buyer !== 'walkin' ? buyer : null;
  const upfront    = parseInt(upfrontRaw, 10) || 0;
  const remaining  = cartTotal - upfront;
  const overLimit  = person && person.balance + cartTotal > person.credit_limit;
  const splitOverLimit = person && person.balance + remaining > person.credit_limit;
  const canCredit  = person && !overLimit;
  const canSplit   = person && upfront > 0 && upfront < cartTotal && !splitOverLimit;

  function handleCharge() {
    if (!mode || busy) return;
    if (mode === 'split') {
      if (canSplit) confirmSplitSale(person.id, upfront, upfrontMethod);
    } else if (mode === 'credit') {
      if (canCredit) confirmSale('credit', person.id);
    } else {
      confirmSale(mode, person?.id ?? null);
    }
  }

  const modeHint = () => {
    if (!buyer) return 'Elige un comprador para poder fiar o registrar a quién le vendiste';
    if (buyer === 'walkin' && (mode === 'credit' || mode === 'split'))
      return 'A clientes de paso no se les fía';
    if (mode === 'credit' && overLimit)
      return `${person.name} llegó al límite de fiado — debe abonar primero`;
    if (mode === 'split') {
      if (upfront <= 0) return 'Ingresa cuánto paga ahora';
      if (upfront >= cartTotal) return 'El pago cubre el total — usa Efectivo o Transfer.';
      if (splitOverLimit) return `${person.name} llegaría al límite con $${fmt(remaining)} de fiado`;
      return `${person.name} paga ${fmt(upfront)} ahora y queda debiendo ${fmt(remaining)}`;
    }
    if (person) return `${person.name} debe ${fmt(person.balance)} · límite ${fmt(person.credit_limit)}`;
    return null;
  };

  const hint = modeHint();
  const isWarn = (mode === 'credit' && overLimit) || (mode === 'split' && splitOverLimit)
    || (buyer === 'walkin' && (mode === 'credit' || mode === 'split'));

  const readyToCharge = mode && !busy && (
    mode === 'cash' || mode === 'transfer'
    || (mode === 'credit' && canCredit)
    || (mode === 'split' && canSplit)
  );

  return (
    <>
      <h3>Cobrar {fmt(cartTotal)}</h3>

      <div className="field"><label>¿Quién compra?</label>
        <div className="chip-row">
          <button className={'chip' + (buyer === 'walkin' ? ' on' : '')} onClick={() => setBuyer('walkin')}>👤 De paso</button>
          {customers.filter(c => c.status === 'active').map(c => (
            <button key={c.id}
              className={'chip' + (person?.id === c.id ? ' on' : '') + (c.balance + cartTotal > c.credit_limit ? ' blocked' : '')}
              onClick={() => setBuyer(c)}>{c.emoji} {c.name}</button>
          ))}
        </div>
      </div>

      <div className="field"><label>¿Cómo paga?</label>
        <div className="pay-row">
          <button className={'pay-btn cash'  + (mode === 'cash'     ? ' active' : '')} onClick={() => setMode('cash')}>💵 Efectivo</button>
          <button className={'pay-btn transfer' + (mode === 'transfer' ? ' active' : '')} onClick={() => setMode('transfer')}>📲 Transfer.</button>
          <button className={'pay-btn credit' + (mode === 'credit'  ? ' active' : '')}
            disabled={!person} onClick={() => setMode('credit')}>🧾 Fiar</button>
          <button className={'pay-btn split'  + (mode === 'split'   ? ' active' : '')}
            disabled={!person} onClick={() => setMode('split')}>✂️ Mixto</button>
        </div>
      </div>

      {mode === 'split' && (
        <div className="split-block">
          <div className="field" style={{ marginBottom: 8 }}>
            <label>¿Cuánto paga ahora?</label>
            <input type="number" inputMode="numeric" placeholder="0"
              value={upfrontRaw} onChange={e => setUpfrontRaw(e.target.value)} autoFocus />
          </div>
          <div className="chip-row" style={{ marginBottom: 8 }}>
            <button className={'chip' + (upfrontMethod === 'cash'     ? ' on' : '')} onClick={() => setUpMethod('cash')}>💵 Efectivo</button>
            <button className={'chip' + (upfrontMethod === 'transfer' ? ' on' : '')} onClick={() => setUpMethod('transfer')}>📲 Transfer.</button>
          </div>
          {upfront > 0 && upfront < cartTotal && (
            <div className="split-summary">
              <div className="split-row"><span>Paga ahora</span><strong>{fmt(upfront)}</strong></div>
              <div className="split-row fiado-row"><span>Queda fiado</span><strong>{fmt(remaining)}</strong></div>
            </div>
          )}
        </div>
      )}

      {hint && <div className={'hint' + (isWarn ? ' warn' : '')}>{hint}</div>}

      <button className="btn-primary" style={{ marginTop: 12 }}
        disabled={!readyToCharge} onClick={handleCharge}>
        Cobrar {fmt(cartTotal)}
      </button>

      {owner && (
        <button className="btn-dashed" style={{ marginTop: 10 }} disabled={busy}
          onClick={() => confirmSale('internal', null, 'internal')}>
          Registrar como consumo interno (a costo)
        </button>
      )}
    </>
  );
}

function PersonSheet({ person, savePayment, busy, supabase, owner, notify, load }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [tag, setTag] = useState(person.tag ?? '');
  const [emoji, setEmoji] = useState(person.emoji);
  const [limit, setLimit] = useState(String(person.credit_limit));
  const [savingEdit, setSavingEdit] = useState(false);
  const pct = Math.min(100, Math.round((person.balance / person.credit_limit) * 100));

  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from('sales')
          .select('id,total,created_at,voided,sale_items(qty,unit_price,products(name,emoji))')
          .eq('customer_id', person.id)
          .eq('payment_method', 'credit')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('payments')
          .select('id,amount,method,created_at,voided')
          .eq('customer_id', person.id)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
      const rows = [
        ...(s.data ?? []).map(x => ({ ...x, kind: 'credit', amt: x.total })),
        ...(p.data ?? []).map(x => ({ ...x, kind: 'pay', amt: x.amount })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setHistory(rows);
    })();
  }, [person.id, supabase]);

  async function saveEdit() {
    const l = parseInt(limit, 10);
    if (!name.trim() || !l || l < 0) return;
    setSavingEdit(true);
    const { error } = await supabase.from('customers')
      .update({ name: name.trim(), tag: tag.trim(), emoji: emoji.trim() || '👤', credit_limit: l })
      .eq('id', person.id);
    setSavingEdit(false);
    if (error) { notify(error.message, true); return; }
    notify('Datos actualizados'); setEditing(false); load();
  }

  if (editing) {
    return (
      <>
        <h3>✏️ Editar — {person.name}</h3>
        <div className="row" style={{ gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Nombre</label>
            <input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="field" style={{ width: 76, marginBottom: 0 }}><label>Emoji</label>
            <input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4} style={{ textAlign: 'center' }} /></div>
        </div>
        <div className="field"><label>Rol o sala (opcional)</label>
          <input value={tag} onChange={e => setTag(e.target.value)} placeholder="ej. Modelo · Sala 2" /></div>
        <div className="field"><label>Límite de fiado (pesos)</label>
          <input type="number" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} /></div>
        <button className="btn-primary" disabled={savingEdit} onClick={saveEdit}>{savingEdit ? 'Guardando…' : 'Guardar cambios'}</button>
        <button className="btn-dashed" style={{ marginTop: 10 }} onClick={() => setEditing(false)}>Cancelar</button>
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: 0 }}>{person.emoji} {person.name}</h3>
        {owner && <button className="btn-secondary" onClick={() => setEditing(true)}>✏️ Editar</button>}
      </div>
      <div className="card" style={{ marginBottom: 14, marginTop: 12 }}>
        <div className="row">
          <small style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>Saldo actual</small>
          <strong style={{ color: 'var(--red)', fontSize: 18 }}>{fmt(person.balance)}</strong>
        </div>
        <div className="limit-track"><div className={'limit-fill' + (pct < 70 ? ' ok' : '')} style={{ width: pct + '%' }} /></div>
        <div className="row" style={{ marginTop: 6 }}>
          <small style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 700 }}>Límite de fiado</small>
          <small style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 700 }}>{fmt(person.credit_limit)}</small>
        </div>
      </div>
      <div className="field"><label>Registrar un abono</label>
        <input type="number" inputMode="numeric" placeholder="Monto en pesos" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className="field"><label>¿Cómo pagó?</label>
        <div className="chip-row" style={{ marginBottom: 2 }}>
          <button className={'chip' + (method === 'cash' ? ' on' : '')} onClick={() => setMethod('cash')}>💵 Efectivo</button>
          <button className={'chip' + (method === 'transfer' ? ' on' : '')} onClick={() => setMethod('transfer')}>📲 Transferencia</button>
        </div>
      </div>
      <button className="btn-primary" disabled={busy}
        onClick={() => {
          const v = parseInt(amount, 10);
          if (!v || v <= 0) return;
          savePayment(person.id, Math.min(v, person.balance), method);
        }}>Guardar abono</button>
      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 12, color: 'var(--muted)' }}>Historial</strong>
        {history === null && <div className="hint" style={{ textAlign: 'left' }}>Cargando…</div>}
        {history?.map(h => (
          <div key={h.kind + h.id} className={'history-line' + (h.voided ? ' voided' : '')}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h-top-row">
                <span style={{ fontWeight: 700, textDecoration: h.voided ? 'line-through' : 'none' }}>
                  {h.kind === 'pay' ? '💵 Abono · ' + (h.method === 'cash' ? 'efectivo' : 'transferencia') : '🧾 Fiado'}
                </span>
                <span className={'h-amt' + (h.kind === 'pay' ? ' pay' : '')}>{h.kind === 'pay' ? '−' : '+'}{fmt(h.amt)}</span>
              </div>
              <span className="h-when">
                {new Date(h.created_at).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                {h.voided ? ' · anulado' : ''}
              </span>
              {h.kind === 'credit' && h.sale_items?.length > 0 && (
                <div className="h-items">
                  {h.sale_items.map((si, i) => (
                    <span key={i} className="h-item">
                      {si.products?.emoji} {si.products?.name} ×{si.qty}
                      <span className="h-item-price">{fmt(si.unit_price * si.qty)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function RestockSheet({ product, savePurchase, busy, supabase, profilesMap }) {
  const [units, setUnits] = useState('');
  const [cost, setCost] = useState(String(product.avg_cost));
  const [history, setHistory] = useState(null);

  useEffect(() => {
    supabase.from('purchases').select('*').eq('product_id', product.id)
      .order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setHistory(data ?? []));
  }, [product.id, supabase]);

  return (
    <>
      <h3>Surtir — {product.name}</h3>
      <div className="field"><label>Unidades compradas</label>
        <input type="number" inputMode="numeric" placeholder="ej. 24" value={units} onChange={e => setUnits(e.target.value)} /></div>
      <div className="field"><label>Costo por unidad (pesos)</label>
        <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)} /></div>
      <button className="btn-primary" disabled={busy} onClick={() => {
        const u = parseInt(units, 10), c = parseInt(cost, 10);
        if (!u || u <= 0 || !c || c < 0) return;
        savePurchase(product.id, u, c);
      }}>Sumar al inventario</button>
      <div className="hint">El stock y el costo promedio se actualizan solos, y la compra queda registrada con fecha y hora</div>
      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 12, color: 'var(--muted)' }}>Últimos surtidos de este producto</strong>
        {history === null && <div className="hint" style={{ textAlign: 'left' }}>Cargando…</div>}
        {history?.length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Sin compras registradas aún.</div>}
        {history?.map(h => (
          <div key={h.id} className="history-line" style={{ opacity: h.voided ? 0.45 : 1 }}>
            <div>
              <span style={{ fontWeight: 700, textDecoration: h.voided ? 'line-through' : 'none' }}>
                {h.units} unidades a {fmt(h.unit_cost)} c/u
              </span>
              <span className="h-when">{fmtDate(h.created_at)} · registró {profilesMap[h.created_by] || '—'}{h.voided ? ' · anulada' : ''}</span>
            </div>
            <span className="h-amt pay">{fmt(h.units * h.unit_cost)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function MovsSheet({ recentSales, customers, profilesMap }) {
  const methodLbl = { cash: '💵 Efectivo', transfer: '📲 Transferencia', credit: '🧾 Fiado', internal: '🏠 Consumo interno' };
  return (
    <>
      <h3>Movimientos recientes</h3>
      {recentSales.length === 0 && <div className="hint" style={{ textAlign: 'left' }}>Aún no hay ventas registradas.</div>}
      {recentSales.map(s => {
        const c = customers.find(x => x.id === s.customer_id);
        return (
          <div key={s.id} className="history-line" style={{ opacity: s.voided ? 0.45 : 1 }}>
            <div>
              <span style={{ fontWeight: 700, textDecoration: s.voided ? 'line-through' : 'none' }}>
                {methodLbl[s.payment_method] || s.payment_method}
                {c ? ' · ' + c.name : (s.payment_method !== 'internal' ? ' · Cliente de paso' : '')}
              </span>
              <span className="h-when">
                {fmtDate(s.created_at)} · registró {profilesMap[s.created_by] || '—'}{s.voided ? ' · anulada' : ''}
              </span>
            </div>
            <span className="h-amt" style={{ color: s.payment_method === 'credit' ? 'var(--red)' : 'var(--green)' }}>{fmt(s.total)}</span>
          </div>
        );
      })}
      <div className="hint" style={{ marginTop: 10 }}>Se muestran las últimas 30 · cada registro guarda fecha, hora exacta y quién lo hizo</div>
    </>
  );
}

function ProductSheet({ product, saveProduct, busy, supabase }) {
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? '');
  const [emoji, setEmoji] = useState(product?.emoji ?? '');
  const [cost, setCost] = useState(product ? String(product.avg_cost) : '');
  const [price, setPrice] = useState(product ? String(product.sell_price) : '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(product?.image_url ?? null);
  const [priceLog, setPriceLog] = useState([]);

  useEffect(() => {
    if (!editing || !product?.id) return;
    supabase.from('product_price_log').select('*')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setPriceLog(data ?? []));
  }, [editing, product?.id]);

  const c = parseInt(cost, 10), v = parseInt(price, 10);
  const margin = c > 0 && v > 0
    ? (v > c
      ? `Ganas ${fmt(v - c)} por unidad · margen ${Math.round(((v - c) / v) * 100)}%`
      : '⚠️ A ese precio no ganas nada')
    : (editing ? 'El stock se cambia desde "Surtir"' : 'Escribe costo y precio para ver la ganancia');

  return (
    <>
      <h3>{editing ? '✏️ ' + product.name : 'Agregar producto'}</h3>
      <div className="photo-picker">
        <div className="photo-preview">
          {preview ? <img src={preview} alt="" /> : (emoji || '🛒')}
        </div>
        <div style={{ flex: 1 }}>
          <label className="btn-secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
            📷 {preview ? 'Cambiar foto' : 'Tomar foto'}
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                setFile(f); setPreview(URL.createObjectURL(f));
              }} />
          </label>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginTop: 4 }}>
            Sin foto se usa el emoji como ícono.
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="ej. Gomitas Trululu" /></div>
        <div className="field" style={{ width: 76, marginBottom: 0 }}><label>Emoji</label>
          <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🍬" maxLength={4} style={{ textAlign: 'center' }} /></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>💰 Costo (lo que te cuesta)</label>
          <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)} placeholder="ej. 1200" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>🏷️ Precio de venta</label>
          <input type="number" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="ej. 2000" />
        </div>
      </div>

      {c > 0 && v > 0 && (
        <div style={{ background: v > c ? '#ecfdf5' : '#fef2f2', border: `1px solid ${v > c ? '#6ee7b7' : '#fca5a5'}`, borderRadius: 10, padding: '10px 14px', marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: v > c ? 'var(--green)' : 'var(--red)' }}>{margin}</span>
          {v > c && <span style={{ fontSize: 18 }}>📈</span>}
        </div>
      )}
      {!(c > 0 && v > 0) && <div className="hint" style={{ marginTop: 8 }}>{margin}</div>}

      <button className="btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => {
        if (!name.trim() || !c || c <= 0 || !v || v <= 0) return;
        saveProduct({ name: name.trim(), emoji: emoji.trim() || '🛒', cost: c, price: v, image_url: product?.image_url ?? null }, product?.id, file);
      }}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar producto'}</button>

      {!editing && <div className="hint" style={{ marginTop: 8 }}>Después de guardarlo, usa "Surtir" para cargar las unidades físicas</div>}

      {editing && priceLog.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <strong style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Historial de precios</strong>
          {priceLog.map(l => (
            <div key={l.id} className="dashed-line" style={{ fontSize: 11.5 }}>
              <span style={{ color: 'var(--muted)' }}>{fmtDate(l.created_at)}</span>
              <span>
                {l.old_cost !== l.new_cost && <span>Costo {fmt(l.old_cost)} → <strong>{fmt(l.new_cost)}</strong> </span>}
                {l.old_price !== l.new_price && <span>Venta {fmt(l.old_price)} → <strong>{fmt(l.new_price)}</strong></span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CustomerSheet({ supabase, notify, load, busy }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [emoji, setEmoji] = useState('');
  const [limit, setLimit] = useState('50000');
  return (
    <>
      <h3>Agregar persona</h3>
      <div className="row" style={{ gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="ej. Valentina" /></div>
        <div className="field" style={{ width: 76, marginBottom: 0 }}><label>Emoji</label>
          <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="💄" maxLength={4} style={{ textAlign: 'center' }} /></div>
      </div>
      <div className="field"><label>Rol o sala (opcional)</label>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="ej. Modelo · Sala 2" /></div>
      <div className="field"><label>Límite de fiado (pesos)</label>
        <input type="number" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} /></div>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        const l = parseInt(limit, 10);
        if (!name.trim() || !l || l < 0) return;
        const { error } = await supabase.from('customers')
          .insert({ name: name.trim(), tag: tag.trim(), emoji: emoji.trim() || '👤', credit_limit: l });
        if (error) { notify(error.message, true); return; }
        notify(name + ' agregado'); load();
      }}>Guardar persona</button>
    </>
  );
}

function ExpenseSheet({ saveCashMovement, busy }) {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  return (
    <>
      <h3>Gasto o retiro de caja</h3>
      <div className="field"><label>Tipo</label>
        <div className="chip-row" style={{ marginBottom: 2 }}>
          <button className={'chip' + (type === 'expense' ? ' on' : '')} onClick={() => setType('expense')}>💸 Gasto</button>
          <button className={'chip' + (type === 'withdrawal' ? ' on' : '')} onClick={() => setType('withdrawal')}>🏧 Retiro</button>
        </div>
      </div>
      <div className="field"><label>Monto (pesos)</label>
        <input type="number" inputMode="numeric" placeholder="ej. 50000" value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div className="field"><label>¿Para qué? (obligatorio)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="ej. compra de mercancía" /></div>
      <button className="btn-primary" disabled={busy} onClick={() => {
        const v = parseInt(amount, 10);
        if (!v || v <= 0 || !note.trim()) return;
        saveCashMovement(type, v, note.trim());
      }}>Guardar movimiento</button>
      <div className="hint">Sale del efectivo esperado en caja</div>
    </>
  );
}

function ClosingSheet({ expectedCash, saveClosing, busy }) {
  const [counted, setCounted] = useState('');
  const v = parseInt(counted, 10);
  const d = Number.isFinite(v) ? v - expectedCash : null;
  return (
    <>
      <h3>Cerrar caja</h3>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><span style={{ fontSize: 12.5, fontWeight: 700 }}>El sistema espera</span>
          <strong style={{ fontSize: 17 }}>{fmt(expectedCash)}</strong></div>
      </div>
      <div className="field"><label>¿Cuánto contaste en efectivo?</label>
        <input type="number" inputMode="numeric" placeholder="Monto contado" value={counted} onChange={e => setCounted(e.target.value)} /></div>
      <div className={'hint' + (d !== null && d !== 0 ? ' warn' : '')} style={d === 0 ? { color: 'var(--green)' } : {}}>
        {d === null ? 'Ingresa lo contado para ver la diferencia' : d === 0 ? '¡Cuadra perfecto! ✓' : (d > 0 ? 'Sobran ' : 'Faltan ') + fmt(Math.abs(d))}
      </div>
      <button className="btn-primary" style={{ marginTop: 10 }} disabled={busy || d === null}
        onClick={() => saveClosing(v)}>Guardar cierre</button>
    </>
  );
}
