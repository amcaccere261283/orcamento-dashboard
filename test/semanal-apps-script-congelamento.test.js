'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOKEN_BOM = 'token-de-teste-abc123';

// O Sheets COAGE uma string tipo '2026-08-31' pra Date na gravação, e
// String(Date) nunca casa com a string ISO na releitura -- o script gravaria e
// descartaria a própria linha, em silêncio. Este dublê IMITA a coerção: sem
// isso, o teste passaria com o bug. Foi exatamente essa armadilha que mordeu o
// apps-script-alocacao.gs em 2026-08-11.
//
// A coerção real do Sheets produz meia-noite no FUSO DA PLANILHA, não em UTC
// -- por isso o Date aqui é construído com o construtor local (ano, mes-1,
// dia), igual ao dublê de apps-script-alocacao.test.js. Um dublê que usasse
// UTC ('...T00:00:00Z') não daria dente ao teste: em fuso negativo (o nosso)
// os getters getUTC* e os locais bateriam com o mesmo dia mesmo estando
// errados, e a mutação que remove a proteção não derrubaria nada.
//
// O formato é por CÉLULA, não por chamada de getRange: o script formata só as
// duas colunas de data (SemanaInicio e CongeladoEm) e depois escreve a faixa
// inteira de 9 colunas de uma vez. Um dublê que guardasse o formato "da faixa"
// não conseguiria distinguir isso, e o teste passaria com qualquer combinação.
//
// As colunas NUMÉRICAS em texto também são modeladas: o Sheets guardaria o
// número na representação do locale ('3,5'), que na releitura vira NaN.
function criarSheetsDuble() {
  const linhas = [['Ano', 'SemanaInicio', 'Chave', 'Volume', 'Financeiro', 'Equipe', 'ProdutividadeMedia', 'Autor', 'CongeladoEm']];
  const formatoTextoDe = new Map(); // 'linha,coluna' (1-based) -> bool
  function chaveCelula(l, c) { return l + ',' + c; }
  function faixa(inicioLinha, inicioColuna, numLinhas, numColunas) {
    return {
      setNumberFormat(f) {
        for (let l = inicioLinha; l < inicioLinha + numLinhas; l++) {
          for (let c = inicioColuna; c < inicioColuna + numColunas; c++) {
            formatoTextoDe.set(chaveCelula(l, c), f === '@');
          }
        }
        return this;
      },
      setValues(valores) {
        valores.forEach((linha, i) => {
          const numeroDaLinha = inicioLinha + i;
          linhas[numeroDaLinha - 1] = linha.map((v, j) => {
            const texto = formatoTextoDe.get(chaveCelula(numeroDaLinha, inicioColuna + j)) === true;
            // A coerção só acontece quando a célula NÃO está formatada como texto.
            if (!texto && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
              const [ano, mes, dia] = v.split('-').map(Number);
              return new Date(ano, mes - 1, dia);
            }
            // Número numa célula de TEXTO: o Sheets guarda a representação
            // textual seguindo o locale da planilha (pt-BR usa vírgula).
            if (texto && typeof v === 'number') return String(v).replace('.', ',');
            return v;
          });
        });
        return this;
      },
    };
  }
  const contadores = { getDataRange: 0 };
  const aba = {
    getDataRange: () => {
      contadores.getDataRange++;
      return { getValues: () => linhas.map((l) => l.slice()) };
    },
    getLastRow: () => linhas.length,
    getMaxRows: () => Math.max(linhas.length, 1000),
    getRange: (l, c, nl, nc) => faixa(l, c, nl, nc),
    appendRow: (l) => { linhas.push(l); },
    // 1-based, igual ao Sheets real: remove a linha e desloca as seguintes.
    deleteRow: (l) => { linhas.splice(l - 1, 1); },
    // Escreve uma linha IGNORANDO qualquer formato de célula, para simular o
    // que uma gravação torta deixaria na planilha (sem setNumberFormat('@')
    // antes de setValues) -- o mesmo mecanismo que
    // apps-script-alocacao.test.js usa para provar que a LEITURA (normalizarDia)
    // também precisa estar correta, independente de a escrita proteger ou não.
    // Não existe no Sheet de verdade -- é porta dos fundos só do dublê.
    __injetarLinhaCrua(valores) {
      const [ano, mes, dia] = String(valores[1]).split('-').map(Number);
      linhas.push(valores.map((v, i) => (i === 1 ? new Date(ano, mes - 1, dia) : v)));
    },
  };
  return {
    aba,
    linhas,
    contadores,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => aba, insertSheet: () => aba }) },
  };
}

function carregarScript(duble) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'tools', 'semanal', 'apps-script-congelamento.gs'), 'utf8');
  const contexto = {
    SpreadsheetApp: duble.SpreadsheetApp,
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ conteudo: t }) }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k === 'TOKEN_DASHBOARD' ? TOKEN_BOM : null) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  return contexto;
}

function corpoDe(saida) { return JSON.parse(saida.conteudo); }

// A LEITURA é POST com acao: 'ler' -- o token saiu da query string do GET,
// onde aparecia nos logs de execução do Apps Script (um token vazado permite
// recuperar a senha do dashboard).
function ler(ctx, semana, token) {
  return corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    acao: 'ler', token: token, semana: semana,
  }) } }));
}

test('doGet nao le nada -- responde que a leitura e por POST', () => {
  const ctx = carregarScript(criarSheetsDuble());
  assert.equal(corpoDe(ctx.doGet({ parameter: { semana: '2026-08-31', token: TOKEN_BOM } })).erro, 'use-post');
});

test('doPost grava e a leitura por POST traz de volta a MESMA chave de semana (sobrevive a coercao de data)', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const gravado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5 }],
  }) } }));
  assert.equal(gravado.ok, true);
  assert.equal(gravado.gravadas, 1);

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas.length, 1, 'a linha gravada tem de ser encontrada na releitura');
  assert.equal(lido.linhas[0].chaveMatriz, 'SUP-1||SP');
  assert.equal(lido.linhas[0].volume, 10);
});

test('doPost RECUSA quando a semana ja tem qualquer linha, sem sobrescrever', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const corpo = (volume) => ({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'primeiro', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: volume, financeiro: 0, equipe: 1, produtividadeMedia: volume }],
  }) } });
  ctx.doPost(corpo(10));
  const segunda = corpoDe(ctx.doPost(corpo(999)));
  assert.equal(segunda.erro, 'ja-congelada');
  assert.equal(segunda.autor, 'primeiro');

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas[0].volume, 10, 'o valor original NAO pode ter sido sobrescrito');
});

test('doPost grava a SemanaInicio como STRING na celula, nunca como Date', () => {
  // Espelho do teste de leitura acima, mas para o cinto de ESCRITA: inspeciona
  // DIRETO o array interno do dublê (sem passar por doGet/normalizarDia), então
  // este teste só morde se setNumberFormat('@') estiver de fato protegendo a
  // gravação -- normalizarDia estar correto na leitura não ajuda em nada aqui.
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 10, financeiro: 20, equipe: 2, produtividadeMedia: 5 }],
  }) } });

  const linhaGravada = duble.linhas[duble.linhas.length - 1];
  assert.equal(typeof linhaGravada[1], 'string', 'a coluna SemanaInicio tem de ser gravada como string, nunca coagida a Date');
  assert.equal(linhaGravada[1], '2026-08-31');
});

test('a leitura cura linha já gravada como Date (sem proteção de texto), no fuso da planilha', () => {
  // Isola o `normalizarDia` do resto do doPost: injeta uma linha JÁ coagida a
  // Date (como uma gravação antiga, sem setNumberFormat('@'), teria deixado
  // na planilha), sem passar pelo caminho de escrita do script. Se
  // normalizarDia usar `instanceof Date` (falha ao atravessar o sandbox `vm`,
  // que é outro realm) ou getters UTC (dia errado num fuso positivo), esta
  // linha nunca é encontrada na releitura -- é a MESMA armadilha do
  // apps-script-alocacao.gs, mordida em 2026-08-11.
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  duble.aba.__injetarLinhaCrua(['2026', '2026-08-31', 'SUP-2||ST', 5, 15, 1, 5, 'antigo', '2026-08-20T00:00:00Z']);

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(lido.linhas.length, 1, 'a linha gravada como Date tem de ser encontrada na releitura');
  assert.equal(lido.linhas[0].chaveMatriz, 'SUP-2||ST');
});

test('token errado e recusado na leitura e na escrita', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  assert.equal(ler(ctx, '2026-08-31', 'errado').erro, 'token');
  assert.equal(corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', chaveSegunda: '2026-08-31', linhas: [],
  }) } })).erro, 'token');
});

// Achado 4 da revisão final: o cinto de setNumberFormat('@') estava sendo
// aplicado à faixa INTEIRA de 9 colunas, incluindo as 4 numéricas. Número em
// célula de texto vira a representação do locale ('3,5'), e Number('3,5') é
// NaN -- que não é null, passa direto pelos `=== null` do .gs e contamina
// somarTendenciaCongelada em silêncio.
test('valor fracionario volta como NUMERO na releitura, nunca string nem NaN', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 3.5, financeiro: 20.25, equipe: 1.5, produtividadeMedia: 2.75 }],
  }) } });

  const lido = ler(ctx, '2026-08-31', TOKEN_BOM);
  assert.equal(typeof lido.linhas[0].volume, 'number');
  assert.equal(lido.linhas[0].volume, 3.5, 'Volume nao pode virar NaN nem string por causa do formato de texto');
  assert.equal(lido.linhas[0].financeiro, 20.25);
  assert.equal(lido.linhas[0].equipe, 1.5);
  assert.equal(lido.linhas[0].produtividadeMedia, 2.75);
});

// Achado 1 da revisão final: doPost varria a Sheet INTEIRA uma vez por LINHA do
// payload (~340 linhas reais, no máximo 2 chaves distintas de semana), com o
// custo crescendo com o quadrado das semanas já congeladas até estourar o
// limite de 6 min do Apps Script.
test('doPost le a planilha um numero CONSTANTE de vezes, nao uma por linha do payload', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const linhasPayload = [];
  for (let i = 0; i < 200; i++) {
    linhasPayload.push({ chave: i % 2 ? '2026-08-31' : '2026-09-01', chaveMatriz: 'SUP-' + i + '||SP',
      volume: i, financeiro: i, equipe: 1, produtividadeMedia: 1 });
  }
  duble.contadores.getDataRange = 0;
  const r = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'teste', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: linhasPayload,
  }) } }));
  assert.equal(r.ok, true);
  assert.equal(r.gravadas, 200);
  assert.ok(duble.contadores.getDataRange <= 2,
    'a checagem de "ja congelada" tem de ler a planilha UMA vez, nao uma vez por linha do payload (leu '
    + duble.contadores.getDataRange + ' vezes)');
});

// A regra observável da recusa não pode mudar com a reescrita: basta UMA linha
// de QUALQUER uma das chaves-alvo já existir para recusar a gravação inteira --
// inclusive quando a colisão está no SEGUNDO fragmento (semana que cruza mês).
test('doPost recusa quando so o SEGUNDO fragmento da semana ja existe', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'primeiro', congeladoEm: '2026-08-28T22:00:00Z',
    linhas: [{ chave: '2026-09-01', chaveMatriz: 'SUP-9||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });
  const segunda = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, chaveSegunda: '2026-08-31', autor: 'segundo', congeladoEm: '2026-08-31T22:00:00Z',
    linhas: [
      { chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 },
      { chave: '2026-09-01', chaveMatriz: 'SUP-9||SP', volume: 2, financeiro: 2, equipe: 1, produtividadeMedia: 1 },
    ],
  }) } }));
  assert.equal(segunda.erro, 'ja-congelada');
  assert.equal(segunda.autor, 'primeiro');
});

test('doPost com acao desfazer apaga so as linhas das chaves pedidas', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  // Duas semanas congeladas, uma linha cada.
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-09-07', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-09-07', chaveMatriz: 'SUP-1||SP', volume: 2, financeiro: 2, equipe: 2, produtividadeMedia: 2 }],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2026-08-31'],
  }) } }));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.apagadas, 1);

  // doGet nao le nada (so devolve {erro:'use-post'}) -- leitura e sempre via
  // doPost com acao 'ler', mesmo padrao que os testes de 'ler'/'congelar' ja
  // usam neste arquivo.
  const lida0831 = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  const lida0907 = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-09-07' }) } }));
  assert.equal(lida0831.linhas.length, 0, 'a semana apagada nao pode mais aparecer');
  assert.equal(lida0907.linhas.length, 1, 'a semana NAO listada pra apagar continua intacta');
});

test('doPost com acao desfazer apaga os DOIS fragmentos de uma semana que cruza mes', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [
      { chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 },
      { chave: '2026-09-01', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 },
    ],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2026-08-31', '2026-09-01'],
  }) } }));
  assert.equal(resultado.apagadas, 2);

  const lida = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  assert.equal(lida.linhas.length, 0);
});

test('doPost com acao desfazer e token errado recusa sem apagar nada', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'congelar', chaveSegunda: '2026-08-31', autor: 'a', congeladoEm: 'x',
    linhas: [{ chave: '2026-08-31', chaveMatriz: 'SUP-1||SP', volume: 1, financeiro: 1, equipe: 1, produtividadeMedia: 1 }],
  }) } });

  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'errado', acao: 'desfazer', chaves: ['2026-08-31'],
  }) } }));
  assert.equal(resultado.erro, 'token');

  const lida = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN_BOM, acao: 'ler', semana: '2026-08-31' }) } }));
  assert.equal(lida.linhas.length, 1, 'nada pode ter sido apagado com token errado');
});

test('doPost com acao desfazer e nenhuma linha encontrada devolve sucesso com apagadas 0, nao erro', () => {
  const duble = criarSheetsDuble();
  const ctx = carregarScript(duble);
  const resultado = corpoDe(ctx.doPost({ postData: { contents: JSON.stringify({
    token: TOKEN_BOM, acao: 'desfazer', chaves: ['2099-01-01'],
  }) } }));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.apagadas, 0);
});
