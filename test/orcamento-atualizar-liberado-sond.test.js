'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  autenticar,
  buscarDemandas,
  coletar,
  gravarCsv,
  HEADER,
} = require('../tools/orcamento/atualizar-liberado-sond.js');

function contrato(overrides) {
  return {
    cliente: 'CLIENTE X',
    numeroContrato: 'SUP-0001-01',
    contratoId: 111,
    ativo: true,
    ...overrides,
  };
}

function respostaOk(demandas) {
  return { status: 200, json: async () => ({ success: true, data: { demandas } }) };
}

function resposta429(retryAfter) {
  return { status: 429, json: async () => ({ retry_after: retryAfter }) };
}

function respostaFalha(mensagem) {
  return { status: 200, json: async () => ({ success: false, error: mensagem }) };
}

function semSleep() {
  return async () => {};
}

test('autenticar: usa env var quando presente', () => {
  const chave = autenticar({ env: 'chave-do-env' });
  assert.equal(chave, 'chave-do-env');
});

test('autenticar: usa arquivo de fallback quando env var ausente', () => {
  const chave = autenticar({
    env: undefined,
    caminhoFallback: 'C:\\caminho\\fake\\chave_api.txt',
    lerArquivo: (caminho) => {
      assert.equal(caminho, 'C:\\caminho\\fake\\chave_api.txt');
      return '  chave-do-arquivo  \n';
    },
  });
  assert.equal(chave, 'chave-do-arquivo');
});

test('autenticar: lança erro claro quando nem env var nem arquivo estão disponíveis', () => {
  assert.throws(
    () => autenticar({
      env: undefined,
      caminhoFallback: 'C:\\caminho\\inexistente\\chave_api.txt',
      lerArquivo: () => { throw new Error('ENOENT'); },
    }),
    /SOND_API_KEY não definida/
  );
});

test('autenticar: lança erro quando arquivo de fallback existe mas está vazio', () => {
  assert.throws(
    () => autenticar({
      env: undefined,
      caminhoFallback: 'C:\\caminho\\vazio\\chave_api.txt',
      lerArquivo: () => '   \n',
    }),
    /SOND_API_KEY não definida/
  );
});

test('buscarDemandas: chamada de sucesso devolve o array de demandas', async () => {
  let urlChamada = null;
  let headersChamados = null;
  const httpGet = async (url, opts) => {
    urlChamada = url;
    headersChamados = opts.headers;
    return respostaOk([{ sigla: 'SPT', prevista: 100, executada: 40, saldo: 60 }]);
  };
  const demandas = await buscarDemandas('minha-chave', 111, { httpGet, sleep: semSleep() });
  assert.deepEqual(demandas, [{ sigla: 'SPT', prevista: 100, executada: 40, saldo: 60 }]);
  assert.equal(urlChamada, 'https://app.sond.com.br/api/v1/pmo/extrato?contrato_id=111&blocos=demandas');
  assert.deepEqual(headersChamados, { 'X-API-Key': 'minha-chave' });
});

test('buscarDemandas: success:false lança erro com a mensagem da API', async () => {
  const httpGet = async () => respostaFalha('contrato não encontrado');
  await assert.rejects(
    buscarDemandas('chave', 999, { httpGet, sleep: semSleep() }),
    /contrato não encontrado/
  );
});

test('buscarDemandas: 429 com retry_after dorme e tenta de novo, retorna sucesso na 2ª tentativa', async () => {
  let chamadas = 0;
  const sleepsChamados = [];
  const httpGet = async () => {
    chamadas++;
    if (chamadas === 1) return resposta429(5);
    return respostaOk([{ sigla: 'LAB', prevista: 10, executada: 2, saldo: 8 }]);
  };
  const sleep = async (ms) => { sleepsChamados.push(ms); };

  const demandas = await buscarDemandas('chave', 111, { httpGet, sleep });
  assert.equal(chamadas, 2);
  assert.deepEqual(sleepsChamados, [5000]);
  assert.deepEqual(demandas, [{ sigla: 'LAB', prevista: 10, executada: 2, saldo: 8 }]);
});

test('buscarDemandas: 429 repetido esgota tentativas e lança erro (não loop infinito)', async () => {
  let chamadas = 0;
  const httpGet = async () => { chamadas++; return resposta429(1); };
  const sleep = semSleep();

  await assert.rejects(buscarDemandas('chave', 111, { httpGet, sleep, maxTentativas: 2 }));
  assert.equal(chamadas, 2);
});

test('buscarDemandas: teto padrão de tentativas é bem mais alto que 2 (segue insistindo além de 2 tentativas de 429)', async () => {
  // Não testamos o valor exato de MAX_TENTATIVAS_429_PADRAO (não exportado),
  // só o comportamento observável: com o default, uma 10ª tentativa que
  // finalmente tem sucesso ainda é alcançada -- provando que o teto não é 2.
  let chamadas = 0;
  const httpGet = async () => {
    chamadas++;
    if (chamadas < 10) return resposta429(0);
    return respostaOk([{ sigla: 'SPT', prevista: 1, executada: 0, saldo: 1 }]);
  };
  const demandas = await buscarDemandas('chave', 111, { httpGet, sleep: semSleep() });
  assert.equal(chamadas, 10);
  assert.deepEqual(demandas, [{ sigla: 'SPT', prevista: 1, executada: 0, saldo: 1 }]);
});

test('coletar: contratos ativo:false nunca são chamados', async () => {
  const contratos = [
    contrato({ cliente: 'ATIVO', numeroContrato: 'SUP-1', contratoId: 1, ativo: true }),
    contrato({ cliente: 'INATIVO', numeroContrato: 'SUP-2', contratoId: 2, ativo: false }),
  ];
  const idsChamados = [];
  const httpGet = async (url) => {
    const contratoId = Number(new URL(url).searchParams.get('contrato_id'));
    idsChamados.push(contratoId);
    return respostaOk([{ sigla: 'SPT', prevista: 1, executada: 0, saldo: 1 }]);
  };
  const linhas = await coletar(contratos, 'chave', { httpGet, sleep: semSleep(), logInfo: () => {}, logAviso: () => {} });
  assert.deepEqual(idsChamados, [1]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0][0], 'ATIVO');
});

test('coletar: contrato com falha é pulado com aviso, os demais continuam processados', async () => {
  const contratos = [
    contrato({ cliente: 'FALHA', numeroContrato: 'SUP-F', contratoId: 1 }),
    contrato({ cliente: 'OK', numeroContrato: 'SUP-OK', contratoId: 2 }),
  ];
  const httpGet = async (url) => {
    const contratoId = Number(new URL(url).searchParams.get('contrato_id'));
    if (contratoId === 1) return respostaFalha('erro simulado');
    return respostaOk([{ sigla: 'SPT', prevista: 5, executada: 1, saldo: 4 }]);
  };
  const avisos = [];
  const linhas = await coletar(contratos, 'chave', {
    httpGet,
    sleep: semSleep(),
    logInfo: () => {},
    logAviso: (msg) => avisos.push(msg),
  });
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0][0], 'OK');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /FALHA/);
  assert.match(avisos[0], /erro simulado/);
});

test('coletar: gera uma linha por (contrato, sigla) para múltiplos contratos e siglas', async () => {
  const contratos = [
    contrato({ cliente: 'A', numeroContrato: 'SUP-A', contratoId: 1 }),
    contrato({ cliente: 'B', numeroContrato: 'SUP-B', contratoId: 2 }),
  ];
  const httpGet = async (url) => {
    const contratoId = Number(new URL(url).searchParams.get('contrato_id'));
    if (contratoId === 1) {
      return respostaOk([
        { sigla: 'SPT', prevista: 100, executada: 30, saldo: 70 },
        { sigla: 'LAB', prevista: 50, executada: 10, saldo: 40 },
      ]);
    }
    return respostaOk([{ sigla: 'SPT', prevista: 20, executada: 20, saldo: 0 }]);
  };
  const linhas = await coletar(contratos, 'chave', { httpGet, sleep: semSleep(), logInfo: () => {}, logAviso: () => {} });
  assert.equal(linhas.length, 3);
  assert.deepEqual(linhas[0], ['A', 'SUP-A', 'SPT', 100, 30, 70]);
  assert.deepEqual(linhas[1], ['A', 'SUP-A', 'LAB', 50, 10, 40]);
  assert.deepEqual(linhas[2], ['B', 'SUP-B', 'SPT', 20, 20, 0]);
});

test('coletar: dorme entre contratos mas não depois do último', async () => {
  const contratos = [
    contrato({ cliente: 'A', numeroContrato: 'SUP-A', contratoId: 1 }),
    contrato({ cliente: 'B', numeroContrato: 'SUP-B', contratoId: 2 }),
    contrato({ cliente: 'C', numeroContrato: 'SUP-C', contratoId: 3 }),
  ];
  const httpGet = async () => respostaOk([{ sigla: 'SPT', prevista: 1, executada: 0, saldo: 1 }]);
  const sleeps = [];
  await coletar(contratos, 'chave', {
    httpGet,
    sleep: async (ms) => { sleeps.push(ms); },
    logInfo: () => {},
    logAviso: () => {},
  });
  assert.deepEqual(sleeps, [2100, 2100]);
});

test('coletar: contrato sem demandas (array vazio) não gera linhas e não quebra', async () => {
  const contratos = [contrato({ cliente: 'VAZIO', numeroContrato: 'SUP-V', contratoId: 1 })];
  const httpGet = async () => respostaOk([]);
  const linhas = await coletar(contratos, 'chave', { httpGet, sleep: semSleep(), logInfo: () => {}, logAviso: () => {} });
  assert.deepEqual(linhas, []);
});

test('gravarCsv: cabeçalho e linhas corretos, incluindo escaping de vírgula', () => {
  const destino = path.join(__dirname, '..', '.test-temp-liberado-sond.csv');
  try {
    const linhas = [
      ['CLIENTE, COM VIRGULA', 'SUP-0001-01', 'SPT', 100, 30, 70],
      ['CLIENTE B', 'SUP-0002-02', 'LAB', 50, 10, 40],
    ];
    gravarCsv(linhas, destino);
    const conteudo = fs.readFileSync(destino, 'utf8');
    const linhasArquivo = conteudo.trim().split('\n');
    assert.equal(linhasArquivo[0], HEADER.join(','));
    assert.equal(linhasArquivo[1], '"CLIENTE, COM VIRGULA",SUP-0001-01,SPT,100,30,70');
    assert.equal(linhasArquivo[2], 'CLIENTE B,SUP-0002-02,LAB,50,10,40');
  } finally {
    if (fs.existsSync(destino)) fs.unlinkSync(destino);
  }
});
