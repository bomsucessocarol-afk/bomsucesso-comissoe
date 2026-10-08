-- ══════════════════════════════════════════════════════════════════
-- MIGRAÇÃO FASE 3 — Novos campos opcionais em lancamentos
-- Bom Sucesso · 2026-10-08
--
-- REGRAS:
--  - ADD COLUMN IF NOT EXISTS → seguro rodar mais de uma vez
--  - Todas as colunas são NULLable → registros antigos não quebram
--  - Não altera, renomeia nem remove colunas existentes
-- ══════════════════════════════════════════════════════════════════

-- 1. Campo comissao_manual (booleano, padrão FALSE)
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS comissao_manual BOOLEAN DEFAULT FALSE;

-- 2. CPF do cliente (texto, ex: "123.456.789-00")
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS cpf TEXT;

-- 3. Telefone do cliente (texto, ex: "(69) 99999-9999")
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS telefone TEXT;

-- 4. Número do contrato (texto livre)
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS num_contrato TEXT;

-- 5. Prazo em meses (inteiro, ex: 72)
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS prazo INTEGER;

-- 6. Valor da parcela mensal (decimal, ex: 350.00)
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS valor_parcela NUMERIC(12,2);

-- 7. Observação livre (texto curto)
ALTER TABLE lancamentos
  ADD COLUMN IF NOT EXISTS obs TEXT;

-- Verificação: lista as colunas da tabela após a migração
-- (execute separadamente se quiser confirmar)
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'lancamentos'
-- ORDER BY ordinal_position;
