// Cole este código no editor do Apps Script da Sheet de ALOCAÇÃO (Extensões >
// Apps Script). Ele guarda a alocação de equipes por semana e responde ao
// dashboard de Planejamento Semanal.
//
// Diferente dos dois espelhos (apps-script-espelho-eq.gs e
// apps-script-espelho-avancos.gs), este NÃO copia nada: ele é o dono do dado.
// A alocação não existe em planilha nenhuma antes daqui.
//
// ATENÇÃO ao copiar este arquivo: se você abrir no navegador e o Chrome
// oferecer traduzir a página, RECUSE. A tradução troca as palavras-chave do
// JavaScript ("try" vira "tentar") e o script para de compilar. O caminho
// seguro é abrir o arquivo local no Bloco de Notas e copiar de lá.
//
// Setup (uma vez só):
//   1. Crie uma Google Sheet em branco -- esta vai ser a Sheet de alocação.
//   2. Nela: Extensões > Apps Script, apague o conteúdo padrão e cole este
//      arquivo inteiro.
//   3. Implantar > Nova implantação > tipo "App da Web".
//      - Executar como: EU (sua conta).
//      - Quem tem acesso: QUALQUER PESSOA.
//      Copie a URL que termina em /exec e me mande.
//   4. A aba "ALOCACAO" é criada sozinha na primeira gravação.
//
// SEGURANÇA, dita com todas as letras: "qualquer pessoa" é necessário porque a
// página é um HTML estático, sem login. A URL vai DENTRO do blob cifrado do
// dashboard, então só quem tem a senha a enxerga -- mas quem tem a senha pode
// gravar. É o mesmo nível de confiança de quem já vê os dados.

var ABA = 'ALOCACAO';
var CABECALHO = ['ano', 'semanaInicio', 'equipeId', 'sup', 'coluna', 'autor', 'atualizadoEm'];

function abaAlocacao() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
  }
  return aba;
}

// 'chaveSemana' chega como '2026|2026-08-10' e é gravada nas DUAS primeiras
// colunas, para a planilha continuar legível por um humano.
function partesDaChave(chave) {
  var pedacos = String(chave || '').split('|');
  return { ano: pedacos[0] || '', semanaInicio: pedacos[1] || '' };
}

function linhasDaSemana(chave) {
  var p = partesDaChave(chave);
  var aba = abaAlocacao();
  var dados = aba.getDataRange().getValues();
  var linhas = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== p.ano) continue;
    if (String(dados[i][1]) !== p.semanaInicio) continue;
    if (!dados[i][3]) continue;
    linhas.push({
      equipeId: String(dados[i][2]),
      sup: String(dados[i][3]),
      coluna: String(dados[i][4]),
      autor: String(dados[i][5]),
      atualizadoEm: String(dados[i][6]),
    });
  }
  return linhas;
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var chave = (e && e.parameter && e.parameter.semana) || '';
  return resposta({ linhas: linhasDaSemana(chave) });
}

function doPost(e) {
  var corpo = JSON.parse(e.postData.contents);
  var p = partesDaChave(corpo.chaveSemana);
  var aba = abaAlocacao();
  var dados = aba.getDataRange().getValues();

  // Upsert por (ano, semanaInicio, equipeId). Gravar o MOVIMENTO, e não o
  // quadro inteiro, é o que impede duas pessoas mexendo em equipes diferentes
  // de se atropelarem; só a mesma equipe colide, e aí vence a última escrita.
  var alvo = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== p.ano) continue;
    if (String(dados[i][1]) !== p.semanaInicio) continue;
    if (String(dados[i][2]) !== String(corpo.equipeId)) continue;
    alvo = i + 1;
    break;
  }

  var linha = [p.ano, p.semanaInicio, String(corpo.equipeId),
    corpo.sup || '', corpo.coluna || '', corpo.autor || '', corpo.atualizadoEm || ''];

  if (alvo === -1) aba.appendRow(linha);
  else aba.getRange(alvo, 1, 1, CABECALHO.length).setValues([linha]);

  return resposta({ ok: true, linhas: linhasDaSemana(corpo.chaveSemana) });
}
