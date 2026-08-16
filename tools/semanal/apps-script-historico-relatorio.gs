// Cole este código no editor do Apps Script da Sheet de HISTÓRICO DO
// RELATÓRIO SEMANAL (Extensões > Apps Script). Ele só GRAVA -- diferente de
// apps-script-alocacao.gs, não há doGet nem upsert: cada geração de
// relatório é um lote de linhas novo, sempre em appendRow.
//
// ATENÇÃO ao copiar: se o Chrome oferecer traduzir a página, RECUSE -- a
// tradução troca palavras-chave do JavaScript e o script para de compilar.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet de histórico.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este
//      arquivo inteiro.
//   3. Implantar > Nova implantação > tipo "App da Web".
//      - Executar como: EU (sua conta).
//      - Quem tem acesso: QUALQUER PESSOA.
//      Copie a URL que termina em /exec.
//   4. A aba "HISTORICO_RELATORIO" nasce sozinha na 1ª gravação.
//   5. Troque URL_HISTORICO_RELATORIO em tools/semanal/render-semanal.js
//      pela URL copiada, reconstrua e publique.

var ABA = 'HISTORICO_RELATORIO';
var CABECALHO = [
  'geradoEm', 'semanaInicio', 'semanaFim', 'sup', 'tipologia', 'dimensao',
  'previstoSemanaAnterior', 'realizadoSemanaAnterior', 'tendenciaSemanaAnterior',
  'previstoAcumulado', 'realizadoAcumulado', 'tendenciaAcumulado',
  'previstoSemanaQueVem', 'tendenciaSemanaQueVem', 'qtdCritico', 'qtdAtencao', 'autor',
];

function abaHistorico() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
    // Só as colunas de IDENTIDADE viram texto puro (evita coerção de Data em
    // geradoEm/semanaInicio/semanaFim -- mesma cautela de apps-script-alocacao.gs,
    // normalizarDia). As colunas de MEDIDA (previsto/realizado/tendência das 3
    // janelas + qtdCritico/qtdAtencao) ficam em formato numérico padrão de
    // propósito -- formatá-las como texto (como esta função fazia antes)
    // faz SUM()/gráfico sobre o histórico sempre devolver 0.
    var maxLinhas = aba.getMaxRows();
    aba.getRange(1, 1, maxLinhas, 6).setNumberFormat('@');
    aba.getRange(1, CABECALHO.length, maxLinhas, 1).setNumberFormat('@');
  }
  return aba;
}

function valorOuVazio(v) {
  return (v === null || v === undefined) ? '' : v;
}

function linhaParaArray(l) {
  return [
    valorOuVazio(l.geradoEm), valorOuVazio(l.semanaInicio), valorOuVazio(l.semanaFim),
    valorOuVazio(l.sup), valorOuVazio(l.tipologia), valorOuVazio(l.dimensao),
    valorOuVazio(l.previstoSemanaAnterior), valorOuVazio(l.realizadoSemanaAnterior), valorOuVazio(l.tendenciaSemanaAnterior),
    valorOuVazio(l.previstoAcumulado), valorOuVazio(l.realizadoAcumulado), valorOuVazio(l.tendenciaAcumulado),
    valorOuVazio(l.previstoSemanaQueVem), valorOuVazio(l.tendenciaSemanaQueVem),
    valorOuVazio(l.qtdCritico), valorOuVazio(l.qtdAtencao), valorOuVazio(l.autor),
  ];
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// corpo: { linhas: [...] } -- um lote inteiro por geração de relatório.
// Um setValues() só (não appendRow por linha): sem upsert, sem checagem de
// duplicata -- cada clique no botão é um registro histórico novo, mesmo que
// a semana seja a mesma. Com dado realista (~340 registros MATRIZ, 681
// linhas por lote) 681 appendRow separados custavam 15-60s de trava por
// clique -- cada um é uma ida-e-volta própria à planilha.
function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  var aba = abaHistorico();
  var linhas = (corpo && corpo.linhas) || [];
  if (linhas.length) {
    var valores = linhas.map(linhaParaArray);
    aba.getRange(aba.getLastRow() + 1, 1, valores.length, CABECALHO.length).setValues(valores);
  }
  return resposta({ ok: true, gravadas: linhas.length });
}
