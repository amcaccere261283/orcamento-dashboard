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
    // Colunas em TEXTO PURO desde o nascimento -- ver normalizarDia abaixo
    // para o motivo. Só vale para planilha nova; a de quem já implantou antes
    // desta correção é curada linha a linha, no setNumberFormat do doPost.
    aba.getRange(1, 1, aba.getMaxRows(), CABECALHO.length).setNumberFormat('@');
  }
  return aba;
}

// O Sheets COAGE '2026-08-10' para um valor de Data na gravação, e devolve um
// objeto Date no getValues(). String(date) vira "Mon Aug 10 2026 00:00:00
// GMT-0300 (...)", que nunca é igual a '2026-08-10' -- então a linha gravada
// deixava de casar na releitura e a semana voltava VAZIA.
//
// O estrago era total e silencioso: chaveSemana() (alocacao-sheet.js) sempre
// monta ano + '|' + YYYY-MM-DD, então TODO arrasto era gravado e sumia. A tela
// não acusava nada, porque a gravação local acontece primeiro e sempre dá
// certo; o quadro só voltava vazio ao recarregar, ou para qualquer outra
// pessoa. Encontrado ao testar a escrita de ponta a ponta em 2026-08-11,
// depois de a leitura sozinha ter passado.
//
// Dois cintos, de propósito: as colunas são gravadas como texto (não coage
// mais) E a leitura normaliza (cura o que já foi gravado torto, inclusive na
// planilha de quem implantou a versão anterior).
//
// getFullYear/getMonth/getDate, e NÃO os getUTC*: uma célula de data-sem-hora
// volta como meia-noite no fuso da PLANILHA. Em fuso negativo (o nosso, GMT-3)
// os dois dariam o mesmo dia, mas em fuso positivo o getUTC* cairia no dia
// anterior -- e o erro só apareceria para quem mudasse o fuso da planilha.
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
    if (normalizarDia(dados[i][1]) !== p.semanaInicio) continue;
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
    if (normalizarDia(dados[i][1]) !== p.semanaInicio) continue;
    if (String(dados[i][2]) !== String(corpo.equipeId)) continue;
    alvo = i + 1;
    break;
  }

  var linha = [p.ano, p.semanaInicio, String(corpo.equipeId),
    corpo.sup || '', corpo.coluna || '', corpo.autor || '', corpo.atualizadoEm || ''];

  // appendRow saiu de propósito: ele não deixa formatar ANTES de escrever, e é
  // o formato que impede o Sheets de coagir a data (ver normalizarDia). Aqui a
  // faixa é formatada como texto e só então recebe o valor -- o que também
  // cura, linha a linha, a planilha de quem implantou a versão anterior.
  if (alvo === -1) alvo = Math.max(aba.getLastRow() + 1, 2);
  var faixa = aba.getRange(alvo, 1, 1, CABECALHO.length);
  faixa.setNumberFormat('@');
  faixa.setValues([linha]);

  return resposta({ ok: true, linhas: linhasDaSemana(corpo.chaveSemana) });
}
