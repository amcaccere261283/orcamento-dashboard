// Web App que guarda a Tendência CONGELADA por semana, gravada pelo botão
// "Congelar próxima semana" do Consolidado.
//
// O mecanismo de congelamento foi redefinido de "write-once" para "toggle":
//  - travar: marca uma semana como travada (não permite mais congelar)
//  - destravar: desbloqueia uma semana travada (permite congelar de novo)
//  - congelar: grava um snapshot, só se a semana estiver aberta (não travada)
//  - desfazer: apaga linhas (mecanismo manual, mantido sem UI)
//
// Duas regras permanentes:
//  1. Datas são gravadas como TEXTO. O Sheets coage '2026-08-31' pra Date, e
//     String(Date) nunca casa com a string ISO na releitura -- o script
//     gravaria e descartaria a própria linha, em silêncio.
//  2. O estado (travada/não travada) é persistido na aba CongelamentoEstado.
//     Compatibilidade: se uma semana tem pontos gravados mas sem linha de
//     estado (aba nova em um deploy), ela é tratada como travada, protegendo
//     trabalho anterior feito sob a regra old "write-once".
//
// Na aba Congelamento (pontos), o formato de texto vale SÓ para as duas
// colunas de data (SemanaInicio e CongeladoEm). Aplicá-lo à faixa inteira
// colocava as 4 colunas NUMÉRICAS em texto também, e aí o Sheets pode guardar
// o número na representação textual do locale da planilha ('3,5' em vez de
// '3.5'): na releitura Number('3,5') vira NaN, que não é null e passa direto
// pelos `=== null` abaixo, contaminando qualquer soma em silêncio.
//
// A aba CongelamentoEstado (abaixo) é diferente: NENHUMA das 4 colunas é
// numérica (SemanaInicio, Travada, Autor, AtualizadoEm são todas texto/data),
// então lá o cinto cobre a FAIXA INTEIRA -- inclusive a coluna Travada, que
// guarda a string 'TRUE'/'FALSE'. Sem esse formato, o Sheets coage 'TRUE' pra
// BOOLEANO na gravação (mesma classe de armadilha da coerção de Date, uma
// terceira vez, agora num tipo novo): na releitura String(true) é 'true'
// minúsculo, nunca 'TRUE', e toda semana travada voltava a ler como
// destravada. `lerEstado` abaixo também aceita o boolean diretamente, cinto e
// suspensório.
var ABA = 'Congelamento';
var CABECALHO = ['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe',
  'ProdutividadeMedia', 'Autor', 'CongeladoEm'];
var COL_SEMANA_INICIO = 2;
var COL_CONGELADO_EM = 9;

var ABA_ESTADO = 'CongelamentoEstado';
var CABECALHO_ESTADO = ['SemanaInicio', 'Travada', 'Autor', 'AtualizadoEm'];
var COL_ESTADO_SEMANA = 1;

// Formata como TEXTO PURO só as duas colunas de data da faixa que começa em
// 'primeiraLinha' e tem 'numLinhas' linhas. Duas chamadas em faixas separadas:
// as colunas não são contíguas, e getRangeList não expõe setNumberFormat em
// todas as versões do runtime -- duas faixas explícitas funcionam em qualquer.
function formatarColunasDeDataComoTexto(aba, primeiraLinha, numLinhas) {
  aba.getRange(primeiraLinha, COL_SEMANA_INICIO, numLinhas, 1).setNumberFormat('@');
  aba.getRange(primeiraLinha, COL_CONGELADO_EM, numLinhas, 1).setNumberFormat('@');
}

function abaCongelamentoEstado() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA_ESTADO);
  if (!aba) {
    aba = planilha.insertSheet(ABA_ESTADO);
    // Faixa INTEIRA (4 colunas) como texto -- ver o comentário no topo do
    // arquivo. Diferente de abaCongelamento(), aqui não há coluna numérica a
    // proteger da coerção contrária.
    aba.getRange(1, 1, aba.getMaxRows(), CABECALHO_ESTADO.length).setNumberFormat('@');
    aba.getRange(1, 1, 1, CABECALHO_ESTADO.length).setValues([CABECALHO_ESTADO]);
  }
  return aba;
}

// {travada, autor, atualizadoEm} para chaveSegunda. Sem linha em
// CongelamentoEstado (aba nova, ou semana nunca travada/destravada por
// aqui), cai no fallback de compatibilidade com o mecanismo write-once
// antigo: travada = temPontosExistentes. Sem isso, o primeiro "Atualizar
// dados" rodado depois deste deploy sobrescreveria em silêncio uma semana
// que alguém já tratava como definitiva sob a regra antiga.
function lerEstado(chaveSegunda, temPontosExistentes) {
  var dados = abaCongelamentoEstado().getDataRange().getValues();
  var alvo = String(chaveSegunda || '');
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][0]) === alvo) {
      // Cinto e suspensório: o formato de texto da coluna 2 é o que evita a
      // coerção pra boolean na gravação (ver o comentário no topo do
      // arquivo), mas a leitura aceita o boolean direto também -- se algum
      // dia esse formato for perdido (edição manual, reimplantação sem essa
      // correção), a leitura ainda reconhece a trava em vez de silenciosamente
      // devolver destravada.
      var v = dados[i][1];
      return {
        travada: v === true || String(v).toUpperCase() === 'TRUE',
        autor: String(dados[i][2] || ''),
        atualizadoEm: String(dados[i][3] || ''),
      };
    }
  }
  return { travada: !!temPontosExistentes, autor: '', atualizadoEm: '' };
}

function gravarEstado(chaveSegunda, travada, autor, quando) {
  var aba = abaCongelamentoEstado();
  var dados = aba.getDataRange().getValues();
  var alvo = String(chaveSegunda || '');
  var valores = [alvo, travada ? 'TRUE' : 'FALSE', autor || '', quando || ''];
  for (var i = 1; i < dados.length; i++) {
    if (normalizarDia(dados[i][0]) === alvo) {
      // Formata a faixa ANTES de escrever -- mesmo padrão de
      // formatarColunasDeDataComoTexto/abaCongelamento. Sem isso, uma linha
      // já existente que nunca tinha sido formatada (aba herdada de antes
      // desta correção) continuaria vulnerável à coerção mesmo depois do
      // update.
      aba.getRange(i + 1, 1, 1, CABECALHO_ESTADO.length).setNumberFormat('@');
      aba.getRange(i + 1, 1, 1, CABECALHO_ESTADO.length).setValues([valores]);
      return;
    }
  }
  var linha = aba.getLastRow() + 1;
  aba.getRange(linha, 1, 1, CABECALHO_ESTADO.length).setNumberFormat('@');
  aba.getRange(linha, 1, 1, CABECALHO_ESTADO.length).setValues([valores]);
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

  if (corpo.acao === 'ler') {
    var linhas = linhasDaSemana(corpo.semana);
    var chaveEstado = corpo.chaveSegunda || corpo.semana;
    var fragmentosParaChecagem = (corpo.chavesFragmentos && corpo.chavesFragmentos.length)
      ? corpo.chavesFragmentos : [corpo.semana];
    var temPontosExistentes = fragmentosParaChecagem.some(function (c) { return linhasDaSemana(c).length > 0; });
    return resposta({ linhas: linhas, estado: lerEstado(chaveEstado, temPontosExistentes) });
  }

  if (corpo.acao === 'desfazer') {
    var travaDesfazer = LockService.getScriptLock();
    travaDesfazer.waitLock(30000);
    try {
      var chavesApagar = {};
      (corpo.chaves || []).forEach(function (c) { chavesApagar[String(c)] = true; });
      var abaDesfazer = abaCongelamento();
      var dadosDesfazer = abaDesfazer.getDataRange().getValues();
      var linhasParaApagar = [];
      for (var j = 1; j < dadosDesfazer.length; j++) {
        if (chavesApagar[normalizarDia(dadosDesfazer[j][COL_SEMANA_INICIO - 1])]) linhasParaApagar.push(j + 1);
      }
      linhasParaApagar.sort(function (a, b) { return b - a; })
        .forEach(function (linha) { abaDesfazer.deleteRow(linha); });
      return resposta({ ok: true, apagadas: linhasParaApagar.length });
    } finally {
      travaDesfazer.releaseLock();
    }
  }

  // congelar (upsert condicionado ao estado) / travar (upsert + trava) /
  // destravar (só destrava, nunca apaga ponto). As três compartilham a
  // trava de concorrência porque as três podem escrever em Congelamento
  // e/ou CongelamentoEstado.
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    if (corpo.acao === 'destravar') {
      gravarEstado(corpo.chaveSegunda, false, corpo.autor, corpo.destravadoEm);
      return resposta({ ok: true });
    }

    var linhasPayload = corpo.linhas || [];
    var temPontosExistentes = false;
    var abaPontos = abaCongelamento();
    var dadosPontos = null;

    // UMA leitura única da planilha para: (1) fallback de compatibilidade,
    // (2) upsert. Mesmo padrão de custo constante já usado em desfazer.
    if (corpo.acao === 'congelar' || linhasPayload.length) {
      var chavesAlvo = {};
      linhasPayload.forEach(function (l) { chavesAlvo[String(l.chave)] = true; });
      dadosPontos = abaPontos.getDataRange().getValues();

      // Verifica se há pontos existentes (para fallback de compatibilidade)
      for (var i = 1; i < dadosPontos.length; i++) {
        if (chavesAlvo[normalizarDia(dadosPontos[i][COL_SEMANA_INICIO - 1])]) {
          temPontosExistentes = true;
          break;
        }
      }
    }

    if (corpo.acao === 'congelar') {
      var estadoAtual = lerEstado(corpo.chaveSegunda, temPontosExistentes);
      if (estadoAtual.travada) {
        return resposta({ erro: 'travada', autor: estadoAtual.autor, atualizadoEm: estadoAtual.atualizadoEm });
      }
    }

    if (linhasPayload.length) {
      // Upsert: apaga as linhas EXISTENTES das chaves-alvo (se houver) e
      // grava as novas no lugar. Usa a leitura única feita acima.
      var linhasParaSubstituir = [];
      for (var i = 1; i < dadosPontos.length; i++) {
        if (chavesAlvo[normalizarDia(dadosPontos[i][COL_SEMANA_INICIO - 1])]) linhasParaSubstituir.push(i + 1);
      }
      linhasParaSubstituir.sort(function (a, b) { return b - a; })
        .forEach(function (linha) { abaPontos.deleteRow(linha); });

      var novasLinhas = linhasPayload.map(function (linha) {
        return [String(corpo.chaveSegunda).slice(0, 4), linha.chave, linha.chaveMatriz,
          linha.volume, linha.financeiro, linha.equipe, linha.produtividadeMedia,
          corpo.autor || '', corpo.congeladoEm || corpo.travadoEm || ''];
      });
      var primeira = Math.max(abaPontos.getLastRow() + 1, 2);
      formatarColunasDeDataComoTexto(abaPontos, primeira, novasLinhas.length);
      abaPontos.getRange(primeira, 1, novasLinhas.length, CABECALHO.length).setValues(novasLinhas);
    }

    if (corpo.acao === 'congelar' && linhasPayload.length) {
      // Grava estado explícito travada=false após upsert, evita fallback no próximo congelar
      gravarEstado(corpo.chaveSegunda, false, corpo.autor, corpo.congeladoEm);
    }

    if (corpo.acao === 'travar') {
      gravarEstado(corpo.chaveSegunda, true, corpo.autor, corpo.travadoEm);
    }

    return resposta({ ok: true, gravadas: linhasPayload.length });
  } finally {
    trava.releaseLock();
  }
}
