'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');

export default function Catalogo() {
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('public_catalog').select('*').order('sort_order')
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  const filtered = products?.filter(p =>
    !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
  ) ?? [];

  const available = filtered.filter(p => p.disponible);
  const unavailable = filtered.filter(p => !p.disponible);
  const all = [...available, ...unavailable];

  return (
    <div className="cat-page">
      {/* Hero header */}
      <div className="cat-hero">
        <div className="cat-hero-inner">
          <div className="cat-logo">⚡</div>
          <h1 className="cat-title">Studio Store</h1>
          <p className="cat-subtitle">Productos disponibles para ti</p>
        </div>
      </div>

      {/* Search */}
      <div className="cat-search-wrap">
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
      </div>

      {/* Content */}
      <div className="cat-body">
        {products === null && (
          <div className="cat-loading">
            <div className="cat-spinner" />
            <span>Cargando catálogo…</span>
          </div>
        )}

        {products !== null && all.length === 0 && (
          <div className="cat-empty">
            <span style={{ fontSize: 48 }}>🛍️</span>
            <p>{search ? 'No encontramos ese producto' : 'Sin productos por ahora'}</p>
          </div>
        )}

        <div className="cat-grid">
          {all.map(p => (
            <div key={p.id} className={'cat-card' + (p.disponible ? '' : ' cat-card--out')}>
              {/* Badge */}
              <div className={'cat-badge' + (p.disponible ? ' cat-badge--ok' : ' cat-badge--out')}>
                {p.disponible ? '✓ Disponible' : 'Agotado'}
              </div>

              {/* Image */}
              <div className="cat-img-wrap">
                {p.image_url
                  ? <img className="cat-img" src={p.image_url} alt={p.name} />
                  : <span className="cat-emoji">{p.emoji}</span>}
              </div>

              {/* Info */}
              <div className="cat-info">
                <span className="cat-name">{p.name}</span>
                <span className="cat-price">{fmt(p.sell_price)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="cat-footer">
          <span>⚡ Studio Store · GlamourCam</span>
        </div>
      </div>
    </div>
  );
}
