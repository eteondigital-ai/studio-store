'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');

const FILTERS = [
  { id: 'todos',       label: 'Todos',       icon: '🛍️' },
  { id: 'disponible',  label: 'Disponibles', icon: '✅' },
  { id: 'agotado',     label: 'Agotados',    icon: '🚫' },
];

const SORTS = [
  { id: 'manual',    label: 'Destacados', icon: '⭐' },
  { id: 'nombre',    label: 'Nombre A-Z', icon: '🔤' },
  { id: 'precio-a',  label: 'Precio ↑',   icon: '💲' },
  { id: 'precio-d',  label: 'Precio ↓',   icon: '💰' },
];

export default function Catalogo() {
  const [products, setProducts] = useState(null);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('todos');
  const [sort, setSort]         = useState('manual');
  const [showSort, setShowSort] = useState(false);

  useEffect(() => {
    supabase.from('public_catalog').select('*').order('sort_order')
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  const visible = useMemo(() => {
    if (!products) return [];
    let list = products;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (filter === 'disponible') list = list.filter(p => p.disponible);
    if (filter === 'agotado')    list = list.filter(p => !p.disponible);

    const arr = [...list];
    if (sort === 'nombre')   arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'precio-a') arr.sort((a, b) => a.sell_price - b.sell_price);
    if (sort === 'precio-d') arr.sort((a, b) => b.sell_price - a.sell_price);

    return arr;
  }, [products, search, filter, sort]);

  const currentSort = SORTS.find(s => s.id === sort);

  return (
    <div className="cat-page">
      {/* Hero */}
      <div className="cat-hero">
        <div className="cat-logo">⚡</div>
        <h1 className="cat-title">Studio Store</h1>
        <p className="cat-subtitle">Productos disponibles para ti</p>
      </div>

      {/* Sticky controls */}
      <div className="cat-controls">
        {/* Search */}
        <div className="cat-search-box">
          <span className="cat-search-icon">🔍</span>
          <input
            className="cat-search-input"
            type="text"
            placeholder="Buscar producto…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="cat-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        {/* Filter pills */}
        <div className="cat-filter-row">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={'cat-filter-pill' + (filter === f.id ? ' on' : '')}
              onClick={() => setFilter(f.id)}
            >
              <span>{f.icon}</span>{f.label}
            </button>
          ))}

          {/* Sort dropdown */}
          <div className="cat-sort-wrap">
            <button
              className={'cat-sort-btn' + (showSort ? ' open' : '')}
              onClick={() => setShowSort(v => !v)}
            >
              <span>{currentSort.icon}</span>
              <span className="cat-sort-label">{currentSort.label}</span>
              <span className="cat-sort-chevron">{showSort ? '▲' : '▼'}</span>
            </button>
            {showSort && (
              <div className="cat-sort-dropdown">
                {SORTS.map(s => (
                  <button
                    key={s.id}
                    className={'cat-sort-option' + (sort === s.id ? ' on' : '')}
                    onClick={() => { setSort(s.id); setShowSort(false); }}
                  >
                    <span>{s.icon}</span>{s.label}
                    {sort === s.id && <span className="cat-sort-check">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="cat-body">
        {products === null && (
          <div className="cat-loading">
            <div className="cat-spinner" />
            <span>Cargando catálogo…</span>
          </div>
        )}

        {products !== null && visible.length === 0 && (
          <div className="cat-empty">
            <span style={{ fontSize: 48 }}>🛍️</span>
            <p>{search ? 'No encontramos ese producto' : 'Sin productos por ahora'}</p>
          </div>
        )}

        <div className="cat-grid">
          {visible.map(p => (
            <div key={p.id} className={'cat-card' + (p.disponible ? '' : ' cat-card--out')}>
              <div className={'cat-badge' + (p.disponible ? ' cat-badge--ok' : ' cat-badge--out')}>
                {p.disponible ? '✓ Disponible' : 'Agotado'}
              </div>
              <div className="cat-img-wrap">
                {p.image_url
                  ? <img className="cat-img" src={p.image_url} alt={p.name} />
                  : <span className="cat-emoji">{p.emoji}</span>}
              </div>
              <div className="cat-info">
                <span className="cat-name">{p.name}</span>
                <span className="cat-price">{fmt(p.sell_price)}</span>
              </div>
            </div>
          ))}
        </div>

        {visible.length > 0 && (
          <div className="cat-count">
            {visible.length} producto{visible.length !== 1 ? 's' : ''}
          </div>
        )}

        <div className="cat-footer">⚡ Studio Store · GlamourCam</div>
      </div>
    </div>
  );
}
