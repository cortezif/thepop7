-- Row-Level Security: aplicar APÓS prisma db push criar as tabelas.
-- Idempotente (drops + creates).
--
-- Prisma usa identificadores quoted camelCase ("tenantId"), não snake_case.
--
-- Padrão: cada conexão define `app.current_tenant_id` por transação,
-- e o RLS filtra automaticamente toda query por tenant.

BEGIN;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text AS $$
  SELECT current_setting('app.current_tenant_id', true);
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','contacts','products','conversations','orders',
    'stock_reservations','suppliers','domain_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING ("tenantId" = current_tenant_id())
       WITH CHECK ("tenantId" = current_tenant_id());', t);
  END LOOP;
END $$;

-- order_items, messages, returns: filtram via FK (não têm tenantId direto)
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_order_items ON order_items;
CREATE POLICY tenant_isolation_order_items ON order_items
  USING ("orderId" IN (SELECT id FROM orders))
  WITH CHECK ("orderId" IN (SELECT id FROM orders));

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_messages ON messages;
CREATE POLICY tenant_isolation_messages ON messages
  USING ("conversationId" IN (SELECT id FROM conversations))
  WITH CHECK ("conversationId" IN (SELECT id FROM conversations));

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_returns ON returns;
CREATE POLICY tenant_isolation_returns ON returns
  USING ("orderId" IN (SELECT id FROM orders))
  WITH CHECK ("orderId" IN (SELECT id FROM orders));

COMMIT;
