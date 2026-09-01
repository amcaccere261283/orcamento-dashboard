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
//
// O formato de texto vale SÓ para as duas colunas de data (SemanaInicio e
// CongeladoEm). Aplicá-lo à faixa inteira colocava as 4 colunas NUMÉRICAS em
// texto também, e aí o Sheets pode guardar o número na representação textual
// do locale da planilha ('3,5' em vez de '3.5'): na releitura Number('3,5')
// vira NaN, que não é null e passa direto pelos `=== null` abaixo, contaminando
// qualquer soma em silêncio.
var ABA = 'Congelamento';
var CABECALHO = ['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe',
  'ProdutividadeMedia', 'Autor', 'CongeladoEm'];
var COL_SEMANA_INICIO = 2;
var COL_CONGELADO_EM = 9;

// Formata como TEXTO PURO só as duas colunas de data da faixa que começa em
// 'primeiraLinha' e tem 'numLinhas' linhas. Duas chamadas em faixas separadas:
// as colunas não são contíguas, e getRangeList não expõe setNumberFormat em
// todas as versões do runtime -- duas faixas explícitas funcionam em qualquer.
function formatarColunasDeDataComoTexto(aba, primeiraLinha, numLinhas) {
  aba.getRange(primeiraLinha, COL_SEMANA_INICIO, numLinhas, 1).setNumberFormat('@');
  aba.getRange(primeiraLinha, COL_CONGELADO_EM, numLinhas, 1).setNumberFormat('@');
}

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
    // Colunas de DATA em TEXTO PURO desde o nascimento -- ver normalizarDia
    // abaixo para o motivo. Protege quem pré-preencher uma linha à mão antes
    // do primeiro doPost. As numéricas ficam de fora de propósito (ver o
    // comentário no topo).
    formatarColunasDeDataComoTexto(aba, 1, aba.getMaxRows());
  }
  return aba;
}

// O Sheets pode devolver Date onde gravamos texto (planilha antiga, edição
// manual). Normaliza os dois casos pra 'YYYY-MM-DD'.
//
// getFullYear/getMonth/getDate, e NÃO os getUTC*: uma célula de data-sem-hora
// volta como meia-noite no fuso da PLANILHA. Em fuso negativo (o nosso,
// GMT-3) os dois dariam o mesmo dia, mas em fuso positivo o getUTC* cairia no
// dia anterior -- e o erro só apareceria para quem mudasse o fuso da
// planilha.
//
// Object.prototype.toString em vez de instanceof: o Date pode vir de outro
// contexto de execução, e aí instanceof devolve false sem avisar.
function normalizarDia(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    var mes = valor.getMonth() + 1;
    var dia = valor.getDate();
    return valor.getFullYear()
      + '-' + (mes < 10 ? '0' : '') + mes
      + '-' + (dia < 10 ? '0' : '') + dia;
  }
  return String(valor === undefined || valor === null ? '' : valor);
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

// A LEITURA também é POST (corpo com acao: 'ler'), não GET. O token viajava na
// query string do GET, onde aparece nos logs de execução do Apps Script e em
// qualquer registro de requisição -- e um token vazado é senha do dashboard
// vazada. No corpo do POST ele não é registrado.
//
// doGet fica só como resposta explícita a quem abrir a URL no navegador.
function doGet() {
  return resposta({ erro: 'use-post' });
}

function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  if (!tokenValido(corpo.token)) return resposta({ erro: 'token' });
  if (corpo.acao === 'ler') return resposta({ linhas: linhasDaSemana(corpo.semana) });

  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    // A checagem olha a semana INTEIRA (todos os fragmentos gravados sob a
    // mesma chaveSegunda entram como linhas com chaves diferentes, então a
    // varredura é por qualquer linha cuja SemanaInicio pertença a esta
    // gravação). Basta uma linha existir pra recusar.
    //
    // UMA leitura da planilha, não uma por linha do payload: o payload tem
    // ~340 linhas e no máximo 2 chaves distintas de semana, e linhasDaSemana
    // faz getDataRange().getValues() (a planilha INTEIRA) a cada chamada --
    // varrer por linha custava até 340 leituras completas por clique, com o
    // custo crescendo com o QUADRADO das semanas já congeladas até estourar o
    // limite de 6 min do Apps Script. Extrai as chaves DISTINTAS primeiro e
    // varre os dados uma vez só. Regra observável idêntica: recusa quando
    // qualquer linha de qualquer chave-alvo já existe, com autor/congeladoEm
    // do primeiro achado.
    var chaves = {};
    (corpo.linhas || []).forEach(function (l) { chaves[String(l.chave)] = true; });
    var dados = abaCongelamento().getDataRange().getValues();
    var existentes = [];
    for (var i = 1; i < dados.length && !existentes.length; i++) {
      // normalizarDia: mesma proteção contra a coerção de Date que
      // linhasDaSemana usa na releitura.
      if (chaves[normalizarDia(dados[i][COL_SEMANA_INICIO - 1])]) {
        existentes = [{ autor: String(dados[i][7] || ''), congeladoEm: String(dados[i][8] || '') }];
      }
    }
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
      // ANTES de escrever -- é o que impede a coerção de data. Só as duas
      // colunas de data: ver o comentário no topo do arquivo.
      formatarColunasDeDataComoTexto(aba, primeira, linhasParaGravar.length);
      aba.getRange(primeira, 1, linhasParaGravar.length, CABECALHO.length).setValues(linhasParaGravar);
    }
    return resposta({ ok: true, gravadas: linhasParaGravar.length });
  } finally {
    trava.releaseLock();
  }
}
