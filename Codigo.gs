/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   JA AGRO INTELLIGENCE — Apps Script Backend                ║
 * ║   Versão: 2.0.0  |  Multi-tenant (1 script por planilha)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * COMO INSTALAR NA PLANILHA DO PRODUTOR:
 * 1. Abra a planilha no Google Sheets
 * 2. Extensões → Apps Script
 * 3. Apague todo o código existente
 * 4. Cole este arquivo completo
 * 5. Salve (Ctrl+S)
 * 6. Implantar → Nova implantação
 *    - Tipo: App da Web
 *    - Executar como: Eu (seu e-mail)
 *    - Quem tem acesso: Qualquer pessoa
 * 7. Autorize e copie a URL
 * 8. Cole a URL no painel admin ao cadastrar o produtor
 */

// ══════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DAS ABAS (não altere os nomes)
// ══════════════════════════════════════════════════════════════
const ABAS = {
  MOVIMENTACOES: 'MOVIMENTACOES_CAMPO',
  LISTAS:        'LISTAS',
  TALHOES:       'CAD_TALHOES',
  SAFRAS:        'CAD_SAFRA',
  ATIVIDADES:    'CAD_ATIVIDADES',
  ITENS:         'CAD_ITENS',
  PRODUTOS:      'CAD_PRODUTOS',
  LOG:           'LOG_SISTEMA',
};

// Linha onde começam os dados (a planilha tem 2 linhas de cabeçalho)
const DATA_ROW = 3;

// ══════════════════════════════════════════════════════════════
// CORS + RESPOSTA JSON
// ══════════════════════════════════════════════════════════════
function resp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function respErr(msg, code) {
  return resp({ ok: false, error: msg, code: code || 'ERROR' });
}

// ══════════════════════════════════════════════════════════════
// GET — Retorna listas de referência para o app mobile
// ══════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = (e.parameter.action || '').trim();

    switch(action) {
      case 'getListas': return resp(buildListas());
      case 'ping':      return resp({ ok: true, ts: new Date().toISOString(), planilha: SpreadsheetApp.getActiveSpreadsheet().getName() });
      default:          return respErr('Ação não reconhecida: ' + action);
    }
  } catch(err) {
    return respErr(err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// POST — Recebe movimentações do app mobile
// ══════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = (body.action || '').trim();

    switch(action) {
      case 'addMovimentacao':
        return resp(inserirMovimentacao(body.data));

      case 'addMovimentacaoBatch':
        const resultados = (body.data || []).map(reg => {
          try { return inserirMovimentacao(reg); }
          catch(err) { return { ok: false, id: reg.id, error: err.message }; }
        });
        const ok  = resultados.filter(r => r.ok).length;
        const err = resultados.filter(r => !r.ok).length;
        return resp({ ok: true, total: resultados.length, enviados: ok, erros: err, detalhes: resultados });

      default:
        return respErr('Ação não reconhecida: ' + action);
    }
  } catch(err) {
    return respErr(err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// INSERIR MOVIMENTAÇÃO
// ══════════════════════════════════════════════════════════════
function inserirMovimentacao(data) {
  if (!data) throw new Error('Dados não informados');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABAS.MOVIMENTACOES);
  if (!sheet) throw new Error('Aba ' + ABAS.MOVIMENTACOES + ' não encontrada na planilha');

  // Verifica se a safra não está fechada
  if (safraEstaBloqueada(data.SAFRA)) {
    return { ok: false, id: data.id, error: 'Safra ' + data.SAFRA + ' está fechada. Lançamento bloqueado.' };
  }

  // Monta linha respeitando a ordem das colunas da planilha (A a Z)
  const row = [
    toDate(data.DATA),               // A - DATA
    data.SAFRA          || '',        // B - SAFRA
    data.TALHAO         || '',        // C - TALHÃO
    data.ATIVIDADE      || '',        // D - ATIVIDADE
    data.ITEM           || '',        // E - ITEM
    data.PRODUTO        || '',        // F - PRODUTO (produto comercial)
    data.APLICACAO      || '',        // G - APLICAÇÃO
    toNum(data.QTDE_HA),              // H - QTDE/HA
    toNum(data.QTDE_TOTAL),           // I - QTDE_TOTAL
    data.RESPONSAVEL    || '',        // J - RESPONSÁVEL
    data.MAQUINA        || '',        // K - MÁQUINA
    data.FORNECEDOR     || '',        // L - FORNECEDOR
    data.DOCUMENTO      || '',        // M - DOCUMENTO
    data.OBS            || '',        // N - OBS
    data.FORMA_PAGAMENTO|| '',        // O - FORMA_PAGAMENTO
    data.COMPETENCIA    || '',        // P - COMPETENCIA
    toDate(data.VENCIMENTO),          // Q - VENCIMENTO
    '',                               // R - STATUS_PAGAMENTO (planilha calcula)
    '',                               // S - ⚡ ATIVIDADE (col calculada)
    '',                               // T - ⚡ TIPO_MOV (col calculada)
    '',                               // U - 🔒 TRAVA_SAFRA (col calculada)
    '',                               // V - 📅 TRAVA_DATA (col calculada)
    '',                               // W - ✅ STATUS_VALIDACAO (col calculada)
    '',                               // X - ⚡ TIPO_CUSTO (col calculada)
    toNum(data.CUSTO_UNIT),           // Y - ⚡ CUSTO_UNIT
    toNum(data.CUSTO_TOTAL),          // Z - 💰 CUSTO TOTAL
  ];

  sheet.appendRow(row);

  // Registra no LOG_SISTEMA
  registrarLog({
    modulo:   'APP_MOBILE',
    aba:      ABAS.MOVIMENTACOES,
    tipo:     'INSERT',
    registro: data.id || '',
    valor:    JSON.stringify({ safra: data.SAFRA, talhao: data.TALHAO, atividade: data.ATIVIDADE }),
    usuario:  data._produtor || 'APP',
    obs:      'Lançamento via app mobile · id: ' + (data.id || ''),
  });

  return {
    ok:         true,
    id:         data.id,
    linha:      sheet.getLastRow(),
    planilha:   SpreadsheetApp.getActiveSpreadsheet().getName(),
    timestamp:  new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════
// VERIFICAR TRAVA DE SAFRA
// ══════════════════════════════════════════════════════════════
function safraEstaBloqueada(nomeSafra) {
  if (!nomeSafra) return false;
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('TRAVAS_SAFRA');
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const safra     = String(data[i][0]).trim();
      const bloqueado = String(data[i][3]).trim().toUpperCase();
      if (safra === nomeSafra && (bloqueado === 'SIM' || bloqueado === 'TRUE')) {
        return true;
      }
    }
    return false;
  } catch(e) {
    return false; // Se não conseguir verificar, permite o lançamento
  }
}

// ══════════════════════════════════════════════════════════════
// CONSTRUIR LISTAS DE REFERÊNCIA
// ══════════════════════════════════════════════════════════════
function buildListas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    safras:         colValues(ss, ABAS.SAFRAS,     'B', 2),
    talhoes:        colValues(ss, ABAS.TALHOES,    'B', 2),
    atividades:     colValues(ss, ABAS.ATIVIDADES, 'B', 2),
    itens:          colValues(ss, ABAS.ITENS,      'B', 2),
    produtos:       colValues(ss, ABAS.PRODUTOS,   'B', 2),
    responsaveis:   listValues(ss, 'OPERADORES'),
    maquinas:       listValues(ss, 'MAQUINAS'),
    fornecedores:   listValues(ss, 'FORNECEDORES'),
    formaspgto:     listValues(ss, 'FORMA_PAGAMENTO'),
    itemDoses:      buildItemDoses(ss),
    areaTalhao:     buildAreaTalhao(ss),
    talhaoInfo:     buildTalhaoInfo(ss),
    atividadeItens: buildAtividadeItens(ss),
    itemProdutos:   buildItemProdutos(ss),
    itemCusto:      buildItemCusto(ss),
    _ts:            new Date().toISOString(),
    _planilha:      ss.getName(),
  };
}

/**
 * Mapa talhao -> { cultura, area, variedade }
 */
function buildTalhaoInfo(ss) {
  const sheet = ss.getSheetByName(ABAS.TALHOES);
  if (!sheet) return {};
  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iNome  = header.indexOf('TALHAO');
  const iArea  = header.indexOf('AREA_HA');
  const iCult  = header.indexOf('CULTURA_PRINCIPAL');
  const iVar   = header.indexOf('VARIEDADE');
  if (iNome === -1) return {};
  const info = {};
  for (let r = 1; r < data.length; r++) {
    const nome = data[r][iNome] ? data[r][iNome].toString().trim() : '';
    if (!nome) continue;
    info[nome] = {
      cultura:   iCult >= 0 ? data[r][iCult].toString().trim() : '',
      area:      iArea >= 0 ? parseFloat(data[r][iArea]) || 0 : 0,
      variedade: iVar  >= 0 ? data[r][iVar].toString().trim()  : '',
    };
  }
  return info;
}

/**
 * Mapa atividade -> [itens] baseado no campo ATIVIDADE_PADRAO de CAD_ITENS
 */
function buildAtividadeItens(ss) {
  const sheet = ss.getSheetByName(ABAS.ITENS);
  if (!sheet) return {};
  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iItem  = header.indexOf('ITEM');
  const iAtiv  = header.indexOf('ATIVIDADE_PADRAO');
  const iAtivo = header.indexOf('ATIVO');
  if (iItem === -1 || iAtiv === -1) return {};
  const mapa = {};
  for (let r = 1; r < data.length; r++) {
    const item = data[r][iItem] ? data[r][iItem].toString().trim() : '';
    const atv  = data[r][iAtiv] ? data[r][iAtiv].toString().trim() : '';
    const ativo = iAtivo >= 0 ? data[r][iAtivo].toString().trim().toUpperCase() : 'SIM';
    if (!item || !atv || ativo === 'NAO' || ativo === 'NÃO') continue;
    if (!mapa[atv]) mapa[atv] = [];
    if (!mapa[atv].includes(item)) mapa[atv].push(item);
  }
  return mapa;
}

/**
 * Mapa item -> [produtos comerciais] baseado em CAD_PRODUTOS
 */
function buildItemProdutos(ss) {
  const sheet = ss.getSheetByName(ABAS.PRODUTOS);
  if (!sheet) return {};
  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iProd  = header.indexOf('PRODUTO_COMERCIAL');
  const iItem  = header.indexOf('ID_ITEM');
  const iAtivo = header.indexOf('ATIVO');
  if (iProd === -1 || iItem === -1) return {};
  // Precisamos tambem do CAD_ITENS para cruzar ID_ITEM -> nome do item
  const sheetItens = ss.getSheetByName(ABAS.ITENS);
  const idToNome = {};
  if (sheetItens) {
    const di = sheetItens.getDataRange().getValues();
    const hi = di[0].map(h => h.toString().toUpperCase().trim());
    const iId   = hi.indexOf('ID_ITEM');
    const iNome = hi.indexOf('ITEM');
    if (iId >= 0 && iNome >= 0) {
      for (let r = 1; r < di.length; r++) {
        const id   = di[r][iId]   ? di[r][iId].toString().trim()   : '';
        const nome = di[r][iNome] ? di[r][iNome].toString().trim() : '';
        if (id && nome) idToNome[id] = nome;
      }
    }
  }
  const mapa = {};
  for (let r = 1; r < data.length; r++) {
    const prod  = data[r][iProd]  ? data[r][iProd].toString().trim()  : '';
    const idItem= data[r][iItem]  ? data[r][iItem].toString().trim()  : '';
    const ativo = iAtivo >= 0     ? data[r][iAtivo].toString().trim().toUpperCase() : 'SIM';
    if (!prod || !idItem || ativo === 'NAO' || ativo === 'NÃO') continue;
    const nomeItem = idToNome[idItem] || idItem;
    if (!mapa[nomeItem]) mapa[nomeItem] = [];
    if (!mapa[nomeItem].includes(prod)) mapa[nomeItem].push(prod);
  }
  return mapa;
}

/**
 * Mapa item -> custo de referencia
 */
function buildItemCusto(ss) {
  const sheet = ss.getSheetByName(ABAS.PRODUTOS);
  if (!sheet) return {};
  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iProd  = header.indexOf('PRODUTO_COMERCIAL');
  const iCusto = header.indexOf('CUSTO_REFERENCIA');
  if (iProd === -1 || iCusto === -1) return {};
  const mapa = {};
  for (let r = 1; r < data.length; r++) {
    const prod  = data[r][iProd]  ? data[r][iProd].toString().trim() : '';
    const custo = parseFloat(data[r][iCusto]);
    if (prod && !isNaN(custo) && custo > 0) mapa[prod] = custo;
  }
  return mapa;
}

/**
 * Lê coluna de uma aba, retorna valores únicos não-vazios
 * @param onlyAtivo - se true, filtra apenas STATUS=SIM/ATIVA/EM ANDAMENTO
 */
function colValues(ss, sheetName, col, startRow, onlyAtivo) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const last = sheet.getLastRow();
  if (last < startRow) return [];

  const vals = sheet.getRange(col + startRow + ':' + col + last).getValues().flat()
    .map(v => v.toString().trim())
    .filter(v => v && v !== 'nan' && v !== 'NaN');

  return [...new Set(vals)]; // únicos
}

/**
 * Lê lista da aba LISTAS pelo nome do cabeçalho da coluna
 */
function listValues(ss, headerName) {
  const sheet = ss.getSheetByName(ABAS.LISTAS);
  if (!sheet) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx     = headers.indexOf(headerName);
  if (idx === -1) return [];

  return sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1)
    .getValues().flat()
    .map(v => v.toString().trim())
    .filter(v => v !== '');
}

/**
 * Mapa item → { min, max, ref, unit } para validação de dose no app
 */
function buildItemDoses(ss) {
  const sheet = ss.getSheetByName(ABAS.ITENS);
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iNome  = header.indexOf('ITEM');
  const iMin   = header.indexOf('DOSE_MIN');
  const iMax   = header.indexOf('DOSE_MAX');
  const iRef   = header.indexOf('DOSE_REFERENCIA');
  const iUnit  = header.indexOf('UNIDADE_DOSE');
  if (iNome === -1) return {};

  const doses = {};
  for (let r = 1; r < data.length; r++) {
    const nome = data[r][iNome]?.toString().trim();
    if (!nome) continue;
    const min  = parseFloat(data[r][iMin]);
    const max  = parseFloat(data[r][iMax]);
    const ref  = parseFloat(data[r][iRef]);
    const unit = data[r][iUnit]?.toString().trim() || '';
    if (!isNaN(min) || !isNaN(max)) doses[nome] = { min, max, ref, unit };
  }
  return doses;
}

/**
 * Mapa talhão → área (ha) para cálculo automático no app
 */
function buildAreaTalhao(ss) {
  const sheet = ss.getSheetByName(ABAS.TALHOES);
  if (!sheet) return {};

  const data   = sheet.getDataRange().getValues();
  const header = data[0].map(h => h.toString().toUpperCase().trim());
  const iNome  = header.indexOf('TALHAO');
  const iArea  = header.indexOf('AREA_HA');
  if (iNome === -1 || iArea === -1) return {};

  const areas = {};
  for (let r = 1; r < data.length; r++) {
    const nome = data[r][iNome]?.toString().trim();
    const area = parseFloat(data[r][iArea]);
    if (nome && !isNaN(area)) areas[nome] = area;
  }
  return areas;
}

// ══════════════════════════════════════════════════════════════
// LOG DO SISTEMA
// ══════════════════════════════════════════════════════════════
function registrarLog(params) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ABAS.LOG);
    if (!sheet) return;

    const rowNum = sheet.getLastRow() + 1;
    sheet.appendRow([
      new Date(),           // DATA_HORA
      params.modulo || '',  // MÓDULO
      params.aba    || '',  // ABA
      params.tipo   || '',  // TIPO_OPERACAO
      params.registro||'',  // REGISTRO_AFETADO
      '',                   // CAMPO_ALTERADO
      '',                   // VALOR_ANTERIOR
      params.valor  || '',  // VALOR_NOVO
      params.usuario|| '',  // USUARIO
      'OK',                 // STATUS
      params.obs    || '',  // OBSERVACAO
      'LOG-APP-' + rowNum,  // ID_LOG
    ]);
  } catch(e) {
    // Log não é crítico — falha silenciosa
    console.error('Erro LOG:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════════════
function toDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d;
  } catch(e) { return val; }
}

function toNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ══════════════════════════════════════════════════════════════
// TESTE (execute manualmente para testar sem o app)
// ══════════════════════════════════════════════════════════════
function testarBackend() {
  const resultado = inserirMovimentacao({
    id:             'TESTE-' + Date.now(),
    DATA:           '2026-04-07',
    SAFRA:          '2025-2026',
    TALHAO:         'CAF-01',
    ATIVIDADE:      'ADUBAÇÃO',
    ITEM:           'NPK CAFÉ 20-05-20',
    PRODUTO:        'YaraBela Nitromag 20-05-20',
    APLICACAO:      'SOLO',
    QTDE_HA:        250,
    QTDE_TOTAL:     3125,
    RESPONSAVEL:    'Equipe A',
    CUSTO_UNIT:     3.80,
    CUSTO_TOTAL:    11875,
    _produtor:      'TESTE',
  });
  Logger.log(JSON.stringify(resultado, null, 2));
}

function testarListas() {
  const listas = buildListas();
  Logger.log('Safras: ' + JSON.stringify(listas.safras));
  Logger.log('Talhões: ' + JSON.stringify(listas.talhoes));
  Logger.log('Itens: ' + JSON.stringify(listas.itens));
  Logger.log('Áreas: ' + JSON.stringify(listas.areaTalhao));
}
