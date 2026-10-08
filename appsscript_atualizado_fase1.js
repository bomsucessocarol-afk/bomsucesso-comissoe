// ═══════════════════════════════════════════════════════════════
// APPS SCRIPT — BOM SUCESSO Sistema de Comissões
// ATUALIZADO — FASE 1 (adiciona doPost, mantém doGet intacto)
// Data: 2026-10-08
//
// COMO USAR:
// 1. Abra seu Apps Script em script.google.com
// 2. Substitua o conteúdo do arquivo Code.gs por este código
// 3. Clique em "Implantar" → "Gerenciar implantações" →
//    Edite sua implantação existente → Versão: Nova versão
// 4. Copie o URL da implantação (não muda, é o mesmo)
// ═══════════════════════════════════════════════════════════════

// ID da sua planilha — substitua pelo id real se necessário
const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ─── doGet — MANTIDO IGUAL (não quebra nada existente) ───────
function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || '';

  if (action === 'salvarLancamento') {
    try {
      const payload = JSON.parse(decodeURIComponent(params.payload || '{}'));
      const resultado = _salvarLinha(payload);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, erro: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === 'deletarLancamento') {
    try {
      const id = params.id || '';
      const resultado = _deletarLinha(id);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, erro: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, erro: 'Ação desconhecida: ' + action }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── doPost — NOVO (recebe JSON no body, mais seguro) ────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';
    const payload = body.payload || {};

    if (action === 'salvarLancamento') {
      const resultado = _salvarLinha(payload);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'deletarLancamento') {
      const id = payload.id || body.id || '';
      const resultado = _deletarLinha(id);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, erro: 'Ação desconhecida: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, erro: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Função interna: salva/atualiza uma linha ─────────────────
function _salvarLinha(row) {
  if (!row || !row.id) return 'sem id';

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('lancamentos') || ss.getSheets()[0];

  // Cabeçalhos na ordem original — NÃO alterar posição das existentes
  const HEADERS = [
    'id','data_dig','data_pg','data_comissao_rec','nome_cliente',
    'status','status_comissao','modalidade','tipo_op','operacao',
    'valor_cliente','perc_comissao','comissao','banco','promotora',
    'pact_fixo','mes_ref','created_at','updated_at'
  ];

  // Garante cabeçalho na linha 1
  const headerRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (!headerRow[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  // Procura linha existente pelo id
  const allData = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(row.id)) {
      targetRow = i + 1; // 1-indexed
      break;
    }
  }

  // Monta array de valores (sem sync_status — campo só local)
  const agora = new Date().toISOString();
  const valores = HEADERS.map(h => {
    if (h === 'updated_at') return agora;
    if (h === 'created_at') return row.created_at || agora;
    const v = row[h];
    return v !== undefined && v !== null ? v : '';
  });

  if (targetRow > 0) {
    // Atualiza linha existente
    sheet.getRange(targetRow, 1, 1, valores.length).setValues([valores]);
    return 'atualizado na linha ' + targetRow;
  } else {
    // Insere nova linha
    sheet.appendRow(valores);
    return 'inserido';
  }
}

// ─── Função interna: deleta uma linha pelo id ─────────────────
function _deletarLinha(id) {
  if (!id) return 'sem id';

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('lancamentos') || ss.getSheets()[0];
  const allData = sheet.getDataRange().getValues();

  for (let i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return 'deletado linha ' + (i + 1);
    }
  }
  return 'id não encontrado: ' + id;
}
