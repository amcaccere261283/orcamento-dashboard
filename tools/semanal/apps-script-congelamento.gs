// Web App que guarda a Tendência CONGELADA por semana, gravada pelo botão
// "Congelar próxima semana" do Consolidado.
//
// Duas regras que não podem ser afrouxadas:
//  1. A semana só pode ser congelada UMA vez. doPost recusa se já existir
//     QUALQUER linha da semana -- inclusive de uma gravação interrompida no
//     meio. Refazer exige apagar as linhas na planilha à mão. É a promessa do
//     recurso: o número nunca muda depois.
//  2. Datas são gravadas como TEXTO. O Sheets coage '2026-08-31' pra Date, e
//     String(Date) nunca casa com a string ISO na releitura -- o script
//     gravaria e descartaria a própria linha, em silêncio.
var ABA = 'Congelamento';
var CABECALHO = ['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe',
  'ProdutividadeMedia', 'Autor', 'CongeladoEm'];

function tokenEsperado() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN_DASHBOARD');
}

function tokenValido(recebido) {
  var esperado = tokenEsperado();
  return !!esperado && String(recebido || '') === String(esperado);
}

function abaCongelamento() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
  }
  return aba;
}

// O Sheets pode devolver Date onde gravamos texto (planilha antiga, edição
// manual). Normaliza os dois casos pra 'YYYY-MM-DD'.
function normalizarDia(valor) {
  if (valor instanceof Date) {
    var ano = valor.getUTCFullYear();
    var mes = ('0' + (valor.getUTCMonth() + 1)).slice(-2);
    var dia = ('0' + valor.getUTCDate()).slice(-2);
    return ano + '-' + mes + '-' + dia;
  }
  return String(valor || '');
}

function linhasDaSemana(chaveSemana) {
  var dados = abaCongelamento().getDataRange().getValues();
  var alvo = String(chaveSemana || '');
  var saida = [];
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][1]) !== alvo) continue;
    saida.push({
      chaveMatriz: String(dados[i][2]),
      volume: dados[i][3] === '' ? null : Number(dados[i][3]),
      financeiro: dados[i][4] === '' ? null : Number(dados[i][4]),
      equipe: dados[i][5] === '' ? null : Number(dados[i][5]),
      produtividadeMedia: dados[i][6] === '' ? null : Number(dados[i][6]),
      autor: String(dados[i][7] || ''),
      congeladoEm: String(dados[i][8] || ''),
    });
  }
  return saida;
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!tokenValido(p.token)) return resposta({ erro: 'token' });
  return resposta({ linhas: linhasDaSemana(p.semana) });
}

function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  if (!tokenValido(corpo.token)) return resposta({ erro: 'token' });

  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    // A checagem olha a semana INTEIRA (todos os fragmentos gravados sob a
    // mesma chaveSegunda entram como linhas com chaves diferentes, então a
    // varredura é por qualquer linha cuja SemanaInicio pertença a esta
    // gravação). Basta uma linha existir pra recusar.
    var existentes = [];
    (corpo.linhas || []).forEach(function (linha) {
      if (existentes.length) return;
      var achadas = linhasDaSemana(linha.chave);
      if (achadas.length) existentes = achadas;
    });
    if (existentes.length) {
      return resposta({ erro: 'ja-congelada', autor: existentes[0].autor, congeladoEm: existentes[0].congeladoEm });
    }

    var aba = abaCongelamento();
    var linhasParaGravar = (corpo.linhas || []).map(function (linha) {
      return [String(corpo.chaveSegunda).slice(0, 4), linha.chave, linha.chaveMatriz,
        linha.volume, linha.financeiro, linha.equipe, linha.produtividadeMedia,
        corpo.autor || '', corpo.congeladoEm || ''];
    });
    if (linhasParaGravar.length) {
      var primeira = Math.max(aba.getLastRow() + 1, 2);
      var faixa = aba.getRange(primeira, 1, linhasParaGravar.length, CABECALHO.length);
      faixa.setNumberFormat('@'); // ANTES de escrever -- é o que impede a coerção de data
      faixa.setValues(linhasParaGravar);
    }
    return resposta({ ok: true, gravadas: linhasParaGravar.length });
  } finally {
    trava.releaseLock();
  }
}
