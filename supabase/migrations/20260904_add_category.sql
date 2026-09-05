-- Migration: add category field to products
-- Run once on Supabase dashboard > SQL Editor
-- After this, the client-side PRODUCT_CAT map in catalogo/page.js can be removed
-- and public_catalog view will serve the category field directly.

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text DEFAULT 'Otros';

UPDATE products SET category = 'Bebidas' WHERE name IN (
  'Agua 600ml', 'Café tinto', 'Coca-Cola 400ml', 'Colombiana',
  'Hit Mango 500 ml', 'Hit Mora 500 ml', 'Hit Piña 500 ml', 'Hit Tropical 500 ml',
  'Postobón Manzana', 'Uva Postobon'
);
UPDATE products SET category = 'Snacks' WHERE name IN (
  'Choclitos', 'De Todito Amarillo', 'De Todito Azul', 'De Todito Rojo',
  'Natuchips Maduro', 'Natuchips Verde',
  'Papas Margarita Limon', 'Papas Margarita Pollo', 'Papitas Margaritas Natural'
);
UPDATE products SET category = 'Dulces' WHERE name IN (
  'Bon Bon Bum', 'Chocorramo Brownie Mini', 'Golozetas Chocolate', 'Golpe',
  'Gomitas Trululu Trolli', 'Oreo BTS', 'Oreo Original',
  'Piazza Barquillo', 'Quipitos', 'Wafer Nucita'
);

-- Recreate public_catalog view to expose category
CREATE OR REPLACE VIEW public_catalog AS
  SELECT
    id,
    name,
    emoji,
    image_url,
    sell_price,
    category,
    (stock > 0) AS disponible,
    sort_order
  FROM products
  WHERE active = true;

GRANT SELECT ON public_catalog TO anon, authenticated;
