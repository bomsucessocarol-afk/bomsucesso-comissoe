-- ═══════════════════════════════════════════════════════════════
-- MIGRAÇÃO FASE 1 — BOM SUCESSO Sistema de Comissões
-- Data: 2026-10-08
-- Executar no Supabase: SQL Editor → Cole e rode
-- ═══════════════════════════════════════════════════════════════

-- Cria tabela de backups diários automáticos (1.5)
-- Nenhuma coluna da tabela lancamentos é alterada aqui.
CREATE TABLE IF NOT EXISTS backups_lancamentos (
  id          SERIAL PRIMARY KEY,
  data_backup TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_registros INT,
  dados       JSONB
);

-- Índice para consulta por data (facilita limpeza dos backups com mais de 30 dias)
CREATE INDEX IF NOT EXISTS idx_backups_lancamentos_data
  ON backups_lancamentos (data_backup);

-- ═══════════════════════════════════════════════════════════════
-- OBSERVAÇÕES IMPORTANTES
-- ═══════════════════════════════════════════════════════════════
-- • A tabela "lancamentos" NÃO foi alterada.
-- • O campo sync_status existe APENAS no cache local (localStorage).
--   Ele NÃO vai para o Supabase nem para a planilha Google Sheets.
-- • Colunas existentes: id, data_dig, data_pg, data_comissao_rec,
--   nome_cliente, status, status_comissao, modalidade, tipo_op,
--   operacao, valor_cliente, perc_comissao, comissao, banco,
--   promotora, pact_fixo, mes_ref, created_at, updated_at
--   — NENHUMA foi renomeada, removida ou com tipo alterado.
-- ═══════════════════════════════════════════════════════════════
