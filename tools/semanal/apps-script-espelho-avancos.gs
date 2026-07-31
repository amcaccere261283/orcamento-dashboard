// Cole este código no editor do Apps Script da Sheet "espelho" (Extensões >
// Apps Script). Ele copia as abas "Avanços" e "Lab Concluido" do arquivo
// real (.xlsx no Drive) pra dentro desta própria Sheet, periodicamente --
// você continua editando só o .xlsx normalmente, esta Sheet é só um espelho
// automático. Companheiro de tools/orcamento/apps-script-espelho-matriz.gs
// (mesmo padrão, mesma Sheet de origem que MATRIZ NÃO é -- este script
// espelha o workbook "Avanço Sond.xlsx", não o de orçamento).
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet espelho.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este arquivo inteiro.
//   3. No editor do Apps Script: no menu lateral "Serviços" (ícone +), adicione "Drive API"
//      (serviço avançado -- é diferente do DriveApp básico).
//   4. Na barra de funções (topo), selecione "atualizarEspelhoAvancos" e clique Executar --
//      vai pedir autorização (sua conta Google), autorize. Isso já popula as abas "Avanços"
//      e "Lab Concluido" dentro desta Sheet pela primeira vez.
//   5. Selecione "criarGatilho" e clique Executar uma vez -- isso agenda a
//      atualização automática a cada 30 min daqui pra frente (não precisa rodar de novo).
//   6. De volta na Sheet (não no editor de script): Arquivo > Compartilhar > Publicar na web >
//      selecione a aba "Avanços" > formato CSV > Publicar. Repita pra "Lab Concluido"
//      (são DUAS publicações, uma por aba -- duas URLs diferentes). Guarde as duas URLs
//      e me envie -- é o que eu uso pra terminar de ligar o botão "Atualizar dados" do
//      Planejamento Semanal.

var ORIGEM_FILE_ID = 'SUBSTITUA_PELO_ID_DO_ARQUIVO_AVANCO_SOND_XLSX'; // "Avanço Sond.xlsx"
var ABAS_ORIGEM = ['Avanços', 'Lab Concluido'];

// Mesmo mecanismo de tools/orcamento/apps-script-espelho-matriz.gs
// (atualizarEspelhoMatriz): converte o .xlsx numa cópia temporária em
// formato Sheets nativo, copia CADA aba de ABAS_ORIGEM pra dentro desta
// Sheet, e apaga a cópia temporária. Diferença: duas abas por vez, não uma.
function atualizarEspelhoAvancos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tempFile = Drive.Files.copy(
    { title: '__temp_avancos_sync__', mimeType: MimeType.GOOGLE_SHEETS },
    ORIGEM_FILE_ID
  );
  try {
    var tempSs = SpreadsheetApp.openById(tempFile.id);
    ABAS_ORIGEM.forEach(function (nomeAba) {
      var abaOrigem = tempSs.getSheetByName(nomeAba);
      if (!abaOrigem) throw new Error('Aba "' + nomeAba + '" não encontrada no arquivo de origem -- confira ORIGEM_FILE_ID e o nome da aba.');
      var dados = abaOrigem.getDataRange().getValues();

      var abaEspelho = ss.getSheetByName(nomeAba);
      if (!abaEspelho) abaEspelho = ss.insertSheet(nomeAba);
      abaEspelho.clearContents();
      if (dados.length && dados[0].length) {
        abaEspelho.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
      }
      abaEspelho.getRange(1, 1).setNote('Espelho automático -- atualizado em ' + new Date().toISOString());
    });
  } finally {
    Drive.Files.remove(tempFile.id);
  }
}

// Agenda atualizarEspelhoAvancos pra rodar sozinha a cada 30 min. Roda esta
// função manualmente UMA vez só (remove qualquer gatilho antigo da mesma
// função antes de criar um novo, então rodar de novo não duplica).
function criarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'atualizarEspelhoAvancos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('atualizarEspelhoAvancos')
    .timeBased()
    .everyMinutes(30)
    .create();
}
