'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');

const SORTS = [
  { id: 'manual',   label: 'Destacados',   icon: '⭐' },
  { id: 'nombre',   label: 'A → Z',        icon: '🔤' },
  { id: 'precio-a', label: 'Menor precio', icon: '💲' },
  { id: 'precio-d', label: 'Mayor precio', icon: '💰' },
];

const CATS = [
  { id: 'Todos',   label: 'Todos',   icon: '🛍️' },
  { id: 'Bebidas', label: 'Bebidas', icon: '🥤' },
  { id: 'Snacks',  label: 'Snacks',  icon: '🍟' },
  { id: 'Dulces',  label: 'Dulces',  icon: '🍬' },
];

// Client-side category map — replace with DB field once migration is applied
const PRODUCT_CAT = {
  'Agua 600ml':               'Bebidas',
  'Bon Bon Bum':              'Dulces',
  'Café tinto':               'Bebidas',
  'Choclitos':                'Snacks',
  'Chocorramo Brownie Mini':  'Dulces',
  'Coca-Cola 400ml':          'Bebidas',
  'Colombiana':               'Bebidas',
  'De Todito Amarillo':       'Snacks',
  'De Todito Azul':           'Snacks',
  'De Todito Rojo':           'Snacks',
  'Golozetas Chocolate':      'Dulces',
  'Golpe':                    'Dulces',
  'Gomitas Trululu Trolli':   'Dulces',
  'Hit Mango 500 ml':         'Bebidas',
  'Hit Mora 500 ml':          'Bebidas',
  'Hit Piña 500 ml':          'Bebidas',
  'Hit Tropical 500 ml':      'Bebidas',
  'Natuchips Maduro':         'Snacks',
  'Natuchips Verde':          'Snacks',
  'Oreo BTS':                 'Dulces',
  'Oreo Original':            'Dulces',
  'Papas Margarita Limon':    'Snacks',
  'Papas Margarita Pollo':    'Snacks',
  'Papitas Margaritas Natural':'Snacks',
  'Piazza Barquillo':         'Dulces',
  'Postobón Manzana':         'Bebidas',
  'Quipitos':                 'Dulces',
  'Uva Postobon':             'Bebidas',
  'Wafer Nucita':             'Dulces',
};

const SKELETON_COUNT = 8;

export default function Catalogo() {
  const [products, setProducts]   = useState(null);
  const [search, setSearch]       = useState('');
  const [onlyAvail, setOnlyAvail] = useState(true);
  const [sort, setSort]           = useState('manual');
  const [cat, setCat]             = useState('Todos');
  const [scrolled, setScrolled]   = useState(false);

  useEffect(() => {
    const el = document.getElementById('app');
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 280);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    supabase.from('public_catalog').select('*').order('sort_order')
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  // Enrich products with client-side category
  const enriched = useMemo(() =>
    (products ?? []).map(p => ({ ...p, _cat: p.category ?? PRODUCT_CAT[p.name] ?? 'Otros' })),
  [products]);

  const catCounts = useMemo(() => {
    const base = enriched.filter(p => !onlyAvail || p.disponible);
    return Object.fromEntries(CATS.map(c => [
      c.id,
      c.id === 'Todos' ? base.length : base.filter(p => p._cat === c.id).length,
    ]));
  }, [enriched, onlyAvail]);

  const visible = useMemo(() => {
    if (!products) return [];
    let list = enriched;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (onlyAvail) list = list.filter(p => p.disponible);
    if (cat !== 'Todos') list = list.filter(p => p._cat === cat);

    const arr = [...list];
    if (sort === 'nombre')   arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'precio-a') arr.sort((a, b) => a.sell_price - b.sell_price);
    if (sort === 'precio-d') arr.sort((a, b) => b.sell_price - a.sell_price);
    if (sort !== 'manual')
      arr.sort((a, b) => (a.disponible === b.disponible ? 0 : a.disponible ? -1 : 1));

    return arr;
  }, [products, enriched, search, onlyAvail, sort, cat]);

  const availCount = products?.filter(p => p.disponible).length ?? 0;

  return (
    <div className="cat-page">

      {/* ── Top header ── */}
      <div className="cat-topbar">
        <div className="cat-brand">
          <span className="cat-brand-icon">⚡</span>
          <div>
            <span className="cat-brand-name">Studio Store</span>
            <span className="cat-brand-sub">GlamourCam · Snacks &amp; bebidas para tu sesión</span>
          </div>
        </div>
        {products !== null && (
          <span className="cat-avail-chip">
            {availCount} disponible{availCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Sticky controls ── */}
      <div className="cat-controls">

        {/* Search */}
        <div className="cat-search-box">
          <span className="cat-search-icon">🔍</span>
          <input
            className="cat-search-input"
            type="text"
            placeholder="Buscar en el catálogo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="cat-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        {/* Category chips */}
        <div className="cat-pills-row cat-pills-row--cats">
          {CATS.map(c => (
            <button
              key={c.id}
              className={'cat-pill cat-pill--cat' + (cat === c.id ? ' on' : '')}
              onClick={() => setCat(c.id)}
            >
              <span>{c.icon}</span>
              {c.label}
              {catCounts[c.id] > 0 && (
                <span className="cat-pill-count">{catCounts[c.id]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Sort + availability */}
        <div className="cat-pills-row">
          {SORTS.map(s => (
            <button
              key={s.id}
              className={'cat-pill' + (sort === s.id ? ' on' : '')}
              onClick={() => setSort(s.id)}
            >
              <span>{s.icon}</span>{s.label}
            </button>
          ))}
          <div className="cat-pill-divider" />
          <button
            className={'cat-pill cat-pill--avail' + (onlyAvail ? ' on' : '')}
            onClick={() => setOnlyAvail(v => !v)}
          >
            <span>✅</span>Solo disponibles
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="cat-body">
        {products === null && (
          <div className="cat-grid">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div key={i} className="cat-skeleton-card">
                <div className="cat-skeleton-img" />
                <div className="cat-skeleton-info">
                  <div className="cat-skeleton-line cat-skeleton-line--name" />
                  <div className="cat-skeleton-line cat-skeleton-line--price" />
                </div>
              </div>
            ))}
          </div>
        )}

        {products !== null && visible.length === 0 && (
          <div className="cat-empty">
            <span style={{ fontSize: 52 }}>🛍️</span>
            <strong>No encontramos nada</strong>
            <span>Intenta con otro filtro o búsqueda</span>
          </div>
        )}

        <div className="cat-grid">
          {visible.map(p => (
            <div key={p.id} className={'cat-card' + (p.disponible ? '' : ' cat-card--out')}>
              <div className="cat-img-wrap">
                {p.image_url
                  ? <img className="cat-img" src={p.image_url} alt={p.name} loading="lazy" decoding="async" />
                  : <span className="cat-emoji">{p.emoji}</span>}
                <div className={'cat-badge' + (p.disponible ? ' cat-badge--ok' : ' cat-badge--out')}>
                  {p.disponible ? '✓ Disponible' : 'Agotado'}
                </div>
              </div>
              <div className="cat-info">
                <span className="cat-name">{p.name}</span>
                <span className="cat-price">{fmt(p.sell_price)}</span>
              </div>
            </div>
          ))}
        </div>

        {visible.length > 0 && (
          <p className="cat-count">{visible.length} producto{visible.length !== 1 ? 's' : ''}</p>
        )}
      </div>

      <div className="cat-footer">⚡ Studio Store · GlamourCam Studio</div>

      {scrolled && (
        <button
          className="cat-fab-top"
          onClick={() => document.getElementById('app')?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Volver arriba"
        >
          ↑
        </button>
      )}
    </div>
  );
}
