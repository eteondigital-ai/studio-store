# Studio Store — Puesta en marcha

Sistema de control de la tienda del estudio: ventas, fiados, inventario, caja y panel.
Stack: Next.js 14 + Supabase + Vercel. UI en español, mobile-first, instalable como app.

## Paso 1 — Crear el proyecto en Supabase (5 min)

1. Entra a https://supabase.com → New project (plan gratis sirve).
2. Cuando cargue, ve a **SQL Editor** → New query → pega TODO el contenido de
   `supabase/schema.sql` → **Run**. Eso crea tablas, seguridad (RLS), funciones y
   productos de arranque.
3. Ve a **Authentication → Users → Add user** y crea los 3 usuarios con correo y
   contraseña (tú, tu hermano, la monitora). Copia el UUID de cada uno.
4. Vuelve al SQL Editor y corre (con los UUID reales):

```sql
insert into profiles (id, name, role) values
  ('UUID-TUYO',     'Jósef',    'owner'),
  ('UUID-HERMANO',  'Hermano',  'owner'),
  ('UUID-MONITORA', 'Monitora', 'monitor');
```

5. Ve a **Project Settings → API** y copia la **URL** y la **anon key**.

## Paso 2 — Correr la app en local (2 min)

```bash
cd studio-store
cp .env.local.example .env.local   # y pega la URL y la anon key
npm install
npm run dev                        # abre http://localhost:3000
```

Entra con tu usuario. Primer flujo: pestaña **Inventario** → toca cada producto
→ **Surtir** para cargar el stock real (queda registrado como compra). Luego a vender.

## Paso 3 — Desplegar en Vercel (5 min)

1. Sube la carpeta a un repo de GitHub.
2. En https://vercel.com → New Project → importa el repo.
3. En Environment Variables agrega `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` con los mismos valores.
4. Deploy. Opcional: agrega el dominio `store.eteondigital.com` en Settings → Domains.
5. En cada celular: abrir la URL en Chrome/Safari → menú → **Agregar a pantalla de inicio**.

## Qué incluye esta versión (v1)

- Ventas en efectivo / transferencia / fiado, con carrito táctil.
- Fiados con límite de crédito que bloquea, abonos con método, historial (anulados tachados).
- Inventario: agregar/editar productos, surtir con costo promedio ponderado,
  invertido / si-se-vende-todo / utilidad esperada.
- Caja: efectivo esperado en tiempo real, gastos/retiros con nota obligatoria,
  cierre de caja con diferencia registrada.
- Panel (solo dueños): ventas, utilidad real, dónde está la plata, top productos, alertas.
- Consumo interno a costo. Roles owner/monitor aplicados en la base de datos (RLS),
  no solo en la interfaz. Nada se borra: todo se anula con motivo y responsable.

## Pendiente para v1.1 (la ficha técnica lo define)

- Reporte de quincena + descuento masivo de nómina.
- Ajustes de merma desde la UI (la función `create_adjustment` ya existe en la DB).
- Write-offs desde la UI (la función `create_write_off` ya existe).
- Anular movimientos desde la UI (funciones `void_*` ya existen).
- Bot de Telegram (stock bajo, límite de fiado, cierre con diferencia, resumen diario).
- Service worker para PWA completa e íconos (`public/icon-192.png`, `public/icon-512.png`).

Referencias: `studio-store-ficha-tecnica-v1.md` (contrato técnico) y
`studio-store-prototipo-v2.html` (referencia visual exacta).
