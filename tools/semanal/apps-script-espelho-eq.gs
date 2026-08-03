// Cole este código no editor do Apps Script da Sheet "espelho" (Extensões >
// Apps Script). Ele copia a aba EQ DO MÊS CORRENTE da planilha de equipes
// (a mesma do dashboard Matriz de Controle) para uma aba de nome FIXO
// ("EQ ESPELHO") dentro desta Sheet.
//
// POR QUE UMA ABA DE NOME FIXO, e não publicar a aba original direto:
// a aba EQ é recriada todo mês, com um gid novo ("2026 - AGOSTO (EQ)",
// "2026 - SETEMBRO (EQ)", ...). Uma URL publicada aponta para UM gid, então
// em setembro ela continuaria servindo agosto -- sem erro, sem aviso, só dado
// velho. Aqui o gid publicado é o desta aba espelho, que nunca muda; quem
// resolve "qual é o mês corrente" é o script, toda vez que roda.
//
// Companheiro de apps-script-espelho-avancos.gs, com duas diferenças:
//   - a origem já é uma Google Sheet nativa (não um .xlsx), então não precisa
//     de cópia temporária nem da Drive API -- é só abrir e ler;
//   - a aba de origem MUDA de nome todo mês, e é isso que ACHAR_ABA_EQ resolve.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet espelho.
//      (NÃO faça isso dentro da planilha de equipes: ela é compartilhada e de
//      produção; uma aba nova lá apareceria para todo mundo.)
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este
//      arquivo inteiro.
//   3. Na barra de funções (topo), selecione "atualizarEspelhoEq" e clique
//      Executar -- vai pedir autorização (sua conta Google), autorize. Isso
//      cria e popula a aba "EQ ESPELHO" pela primeira vez.
//   4. Selecione "criarGatilho" e clique Executar UMA vez -- agenda a
//      atualização a cada 30 min daqui pra frente.
//   5. De volta na Sheet (não no editor de script): Arquivo > Compartilhar >
//      Publicar na web > selecione a aba "EQ ESPELHO" > formato CSV >
//      Publicar. Me mande essa URL -- é uma só, e vale para sempre.
//
// ATENÇÃO ao copiar este arquivo: se você abrir no navegador e o Chrome
// oferecer traduzir a página, RECUSE. A tradução troca as palavras-chave do
// JavaScript ("try" vira "tentar") e o script para de compilar. O caminho
// seguro é abrir o arquivo local no Bloco de Notas e copiar de lá.

var ORIGEM_FILE_ID = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU'; // planilha de equipes (Matriz de Controle)
var ABA_ESPELHO = 'EQ ESPELHO';

// Nome da aba do mês: "AAAA - MÊS (EQ)". A planilha escreve o mês tanto
// abreviado quanto por extenso, e às vezes com espaço sobrando -- por isso a
// busca é por padrão, não por igualdade de string. Mesma tolerância que
// tools/matriz/discover-gids.js já aplica do lado do build.
var MESES = [
  ['JAN', 'JANEIRO'], ['FEV', 'FEVEREIRO'], ['MAR', 'MARCO', 'MARÇO'],
  ['ABR', 'ABRIL'], ['MAI', 'MAIO'], ['JUN', 'JUNHO'],
  ['JUL', 'JULHO'], ['AGO', 'AGOSTO'], ['SET', 'SETEMBRO'],
  ['OUT', 'OUTUBRO'], ['NOV', 'NOVEMBRO'], ['DEZ', 'DEZEMBRO'],
];

function acharAbaEqDoMes(planilha, data) {
  var ano = data.getFullYear();
  var nomesDoMes = MESES[data.getMonth()];
  var abas = planilha.getSheets();
  for (var i = 0; i < abas.length; i++) {
    var nome = abas[i].getName().toUpperCase().replace(/\s+/g, ' ').trim();
    // Exige o ano, a categoria (EQ) e um dos nomes do mês -- nunca adivinha.
    if (nome.indexOf(String(ano)) === -1) continue;
    if (nome.indexOf('(EQ)') === -1) continue;
    for (var m = 0; m < nomesDoMes.length; m++) {
      if (nome.indexOf(nomesDoMes[m]) !== -1) return abas[i];
    }
  }
  return null;
}

function atualizarEspelhoEq() {
  var origem = SpreadsheetApp.openById(ORIGEM_FILE_ID);
  var hoje = new Date();
  var abaOrigem = acharAbaEqDoMes(origem, hoje);
  if (!abaOrigem) {
    throw new Error(
      'Não achei a aba EQ de ' + (hoje.getMonth() + 1) + '/' + hoje.getFullYear()
      + ' na planilha de equipes. Confira se ela já foi criada e se o nome segue "AAAA - MÊS (EQ)".'
    );
  }

  var dados = abaOrigem.getDataRange().getValues();
  var destino = SpreadsheetApp.getActiveSpreadsheet();
  var abaEspelho = destino.getSheetByName(ABA_ESPELHO);
  if (!abaEspelho) abaEspelho = destino.insertSheet(ABA_ESPELHO);
  abaEspelho.clearContents();
  if (dados.length && dados[0].length) {
    abaEspelho.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
  }
  // A nota registra QUAL aba foi copiada, não só quando: se um dia o espelho
  // servir o mês errado, é aqui que se descobre na hora.
  abaEspelho.getRange(1, 1).setNote(
    'Espelho automático de "' + abaOrigem.getName() + '" -- atualizado em ' + new Date().toISOString()
  );
}

// Agenda atualizarEspelhoEq a cada 30 min. Roda esta função manualmente UMA
// vez só (remove qualquer gatilho antigo da mesma função antes de criar um
// novo, então rodar de novo não duplica).
function criarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'atualizarEspelhoEq') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('atualizarEspelhoEq')
    .timeBased()
    .everyMinutes(30)
    .create();
}
