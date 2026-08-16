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
    // Texto puro desde o nascimento -- mesma cautela de apps-script-alocacao.gs
    // (normalizarDia): evita qualquer coerção silenciosa do Sheets, inclusive
    // nas colunas numéricas vazias (a linha-resumo tem previsto/realizado/
    // tendência em branco).
    aba.getRange(1, 1, aba.getMaxRows(), CABECALHO.length).setNumberFormat('@');
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
// appendRow por linha: sem upsert, sem checagem de duplicata -- cada clique
// no botão é um registro histórico novo, mesmo que a semana seja a mesma.
function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  var aba = abaHistorico();
  var linhas = (corpo && corpo.linhas) || [];
  linhas.forEach(function (l) { aba.appendRow(linhaParaArray(l)); });
  return resposta({ ok: true, gravadas: linhas.length });
}
