// Cole este código no editor do Apps Script da Sheet "espelho" (Extensões >
// Apps Script). Ele copia a aba MATRIZ do arquivo real (.xlsx no Drive)
// pra dentro desta própria Sheet, periodicamente -- você continua editando
// só o .xlsx normalmente, esta Sheet é só um espelho automático.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet espelho.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este arquivo inteiro.
//   3. No editor do Apps Script: no menu lateral "Serviços" (ícone +), adicione "Drive API"
//      (serviço avançado -- é diferente do DriveApp básico).
//   4. Na barra de funções (topo), selecione "atualizarEspelhoMatriz" e clique Executar --
//      vai pedir autorização (sua conta Google), autorize. Isso já popula a aba MATRIZ
//      dentro desta Sheet pela primeira vez.
//   5. Selecione "criarGatilho" e clique Executar uma vez -- isso agenda a
//      atualização automática a cada 30 min daqui pra frente (não precisa rodar de novo).
//   6. De volta na Sheet (não no editor de script): Arquivo > Compartilhar > Publicar na web >
//      selecione a aba "MATRIZ" > formato CSV > Publicar. Guarde a URL gerada e me envie --
//      é o que eu uso pra terminar de ligar o botão "Atualizar dados" do dashboard.

var ORIGEM_FILE_ID = '1oeOdCftCmXw6QweMNqLcC0e1KbjAILtH'; // "OR - 2026 (04.A) - Base Frcst 6+6 Atual R00.1.xlsx"
var NOME_ABA = 'MATRIZ';

// Converte o .xlsx de origem numa cópia temporária em formato Sheets nativo
// (só assim dá pra ler os valores calculados via SpreadsheetApp -- um .xlsx
// puro no Drive não é legível linha a linha sem abrir como Sheets antes),
// copia a aba MATRIZ pra dentro desta Sheet, e apaga a cópia temporária.
function atualizarEspelhoMatriz() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tempFile = Drive.Files.copy(
    { title: '__temp_matriz_sync__', mimeType: MimeType.GOOGLE_SHEETS },
    ORIGEM_FILE_ID
  );
  try {
    var tempSs = SpreadsheetApp.openById(tempFile.id);
    var abaOrigem = tempSs.getSheetByName(NOME_ABA);
    if (!abaOrigem) throw new Error('Aba "' + NOME_ABA + '" não encontrada no arquivo de origem -- confira ORIGEM_FILE_ID e o nome da aba.');
    var dados = abaOrigem.getDataRange().getValues();

    var abaEspelho = ss.getSheetByName(NOME_ABA);
    if (!abaEspelho) abaEspelho = ss.insertSheet(NOME_ABA);
    abaEspelho.clearContents();
    if (dados.length && dados[0].length) {
      abaEspelho.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
    }
    abaEspelho.getRange(1, 1).setNote('Espelho automático -- atualizado em ' + new Date().toISOString());
  } finally {
    Drive.Files.remove(tempFile.id);
  }
}

// Agenda atualizarEspelhoMatriz pra rodar sozinha a cada 30 min. Roda esta
// função manualmente UMA vez só (remove qualquer gatilho antigo da mesma
// função antes de criar um novo, então rodar de novo não duplica).
function criarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'atualizarEspelhoMatriz') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('atualizarEspelhoMatriz')
    .timeBased()
    .everyMinutes(30)
    .create();
}
