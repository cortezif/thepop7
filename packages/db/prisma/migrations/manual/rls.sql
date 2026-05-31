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
    'stock_reservations','suppliers','domain_events','integrations','product_barcodes','stock_movements',
    'raw_materials','bills_of_materials','production_batches','delivery_tariffs',
    -- Defesa em profundidade: tabelas tenant-scoped que dependiam só do código.
    -- (NÃO inclui wholesale_*/b2b_buyers: são marketplace cross-tenant — ADR-024.)
    'purchase_requests','quotes','supplier_offers','price_researches','price_research_invites',
    'price_quotes','research_attachments','nps_responses','ad_campaigns','audit_logs',
    'cashback_entries','marketing_campaigns','financial_entries'
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

-- bom_items: filtra via FK para bills_of_materials (não tem tenantId direto) — ADR-030
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_bom_items ON bom_items;
CREATE POLICY tenant_isolation_bom_items ON bom_items
  USING ("bomId" IN (SELECT id FROM bills_of_materials))
  WITH CHECK ("bomId" IN (SELECT id FROM bills_of_materials));

COMMIT;
