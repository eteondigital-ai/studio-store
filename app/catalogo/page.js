'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');

export default function Catalogo() {
  const [products, setProducts] = useState(null);

  useEffect(() => {
    supabase.from('public_catalog').select('*').order('sort_order')
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  return (
    <>
      <header>
        <span className="brand">Studio Store</span>
        <span className="pill">Catálogo</span>
      </header>

      <main>
        {products === null && <div className="hint" style={{ marginTop: 40 }}>Cargando…</div>}
        {products?.length === 0 && <div className="hint" style={{ marginTop: 40 }}>Sin productos disponibles por ahora.</div>}

        <div className="product-grid">
          {products?.map(p => (
            <div key={p.id} className={'prod' + (p.disponible ? '' : ' out')}>
              <span className="p-stock">{p.disponible ? 'Disponible' : 'Agotado'}</span>
              {p.image_url
                ? <img className="p-photo" src={p.image_url} alt="" />
                : <span className="emoji">{p.emoji}</span>}
              <span className="p-name">{p.name}</span>
              <span className="p-price">{fmt(p.sell_price)}</span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
