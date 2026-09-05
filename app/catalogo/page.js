'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');

const SORTS = [
  { id: 'manual',    label: 'Destacados', icon: '⭐' },
  { id: 'nombre',    label: 'A → Z',      icon: '🔤' },
  { id: 'precio-a',  label: 'Menor precio', icon: '💲' },
  { id: 'precio-d',  label: 'Mayor precio', icon: '💰' },
];

const SKELETON_COUNT = 8;

export default function Catalogo() {
  const [products, setProducts] = useState(null);
  const [search, setSearch]     = useState('');
  const [onlyAvail, setOnlyAvail] = useState(true);
  const [sort, setSort]           = useState('manual');
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

  const visible = useMemo(() => {
    if (!products) return [];
    let list = products;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (onlyAvail) list = list.filter(p => p.disponible);

    const arr = [...list];
    if (sort === 'nombre')   arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'precio-a') arr.sort((a, b) => a.sell_price - b.sell_price);
    if (sort === 'precio-d') arr.sort((a, b) => b.sell_price - a.sell_price);

    // Always push unavailable to end
    if (sort !== 'manual') {
      arr.sort((a, b) => (a.disponible === b.disponible ? 0 : a.disponible ? -1 : 1));
    }
    return arr;
  }, [products, search, onlyAvail, sort]);

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

        {/* Sort + filter pills — always visible */}
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
              {/* Image */}
              <div className="cat-img-wrap">
                {p.image_url
                  ? <img className="cat-img" src={p.image_url} alt={p.name} loading="lazy" decoding="async" />
                  : <span className="cat-emoji">{p.emoji}</span>}

                {/* Overlay badge */}
                <div className={'cat-badge' + (p.disponible ? ' cat-badge--ok' : ' cat-badge--out')}>
                  {p.disponible ? '✓ Disponible' : 'Agotado'}
                </div>
              </div>

              {/* Info */}
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
