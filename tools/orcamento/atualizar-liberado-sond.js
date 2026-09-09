'use strict';

// Porta de saldo_contratos.py (extrato-gerencial-mensal, sibling repo, Python):
// consulta o bloco `demandas` da API PMO/BI (GET /api/v1/pmo/extrato) pra cada
// contrato ATIVO do catálogo (tools/orcamento/parse-contratos-yaml.js) e grava
// dist/liberado-sond-online.csv -- uma linha por (contrato, sigla), que uma
// etapa posterior do build (Task 3) lê e junta na MATRIZ pelo campo `sup`
// (== numeroContrato aqui, NÃO contratoId).
//
// `saldo = prevista - executada`, o quanto ainda resta do volume liberado por
// tipo -- não confundir com `pendente` (saldo de OS/pins já solicitados e
// ainda não executados), que este script não trata.

const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('../semanal/csv-writer-avancos.js');
const { lerContratos } = require('./parse-contratos-yaml.js');
const config = require('./config.js');

const BASE_URL = 'https://app.sond.com.br';
// Caminho fixo de máquina, sem override por env var -- espelha
// saldo_contratos.py:autenticar() exatamente (env var primeiro, depois este
// caminho fixo, sem variável de ambiente pro caminho em si). Documentado como
// dependência de máquina no CLAUDE.md deste repo, nunca em arquivo do repo.
const CAMINHO_CHAVE_API_FALLBACK = 'C:\\Users\\amcac\\OneDrive\\Desktop\\Projetos IA\\extrato-gerencial-mensal\\API\\chave_api.txt';
const INTERVALO_ENTRE_CHAMADAS_MS = 2100; // 30 req/min permitidas -> ~1 a cada 2s, com folga
const TIMEOUT_MS = 30000;
// saldo_contratos.py:buscar_demandas retenta 429 de forma REALMENTE
// ilimitada (recursão sem contador, só sleep(retry_after) e chama de novo).
// Aqui o retry é DELIBERADAMENTE finito -- um teto bem alto (não 2) pra imitar
// "insiste até passar" na prática, mas com uma rede de segurança: uma API
// permanentemente hostil não trava este processo pra sempre, só desiste após
// um número de tentativas grande o bastante pra representar dezenas de
// minutos de backoff legítimo. Não é paridade exata com o Python -- é uma
// aproximação segura de propósito.
const MAX_TENTATIVAS_429_PADRAO = 50;
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'liberado-sond-online.csv');
const HEADER = ['Cliente', 'Contrato', 'Sigla', 'Prevista', 'Executada', 'Saldo'];

/**
 * Resolve a chave de API: env var primeiro, senão lê o arquivo de fallback
 * (1 linha, trim). Lança erro claro se nenhuma das duas estiver disponível.
 *
 * @param {object} [opts]
 * @param {string} [opts.env] - valor de process.env.SOND_API_KEY (injetável pra teste)
 * @param {string} [opts.caminhoFallback] - caminho do arquivo de fallback (injetável pra teste)
 * @param {(caminho: string) => string} [opts.lerArquivo] - leitor injetável (fs.readFileSync por padrão)
 * @returns {string}
 */
function autenticar(opts = {}) {
  const env = opts.env !== undefined ? opts.env : process.env.SOND_API_KEY;
  const caminhoFallback = opts.caminhoFallback || CAMINHO_CHAVE_API_FALLBACK;
  const lerArquivo = opts.lerArquivo || ((caminho) => fs.readFileSync(caminho, 'utf8'));

  if (env) return env;

  try {
    const conteudo = lerArquivo(caminhoFallback);
    const chave = conteudo.trim();
    if (chave) return chave;
  } catch (err) {
    // Arquivo ausente ou ilegível: cai no erro genérico abaixo, igual ao Python.
  }

  throw new Error(`SOND_API_KEY não definida (nem em ${caminhoFallback}).`);
}

/**
 * Uma chamada GET ao endpoint de demandas, com retry em 429 respeitando
 * retry_after (segundos) -- mesma lógica do Python (buscar_demandas), exceto
 * que o número de tentativas é um teto alto e finito, não recursão
 * ilimitada (ver comentário de MAX_TENTATIVAS_429_PADRAO acima). `httpGet` e
 * `sleep` são injetáveis pra teste (sem rede real, sem timers reais).
 *
 * @param {string} chaveApi
 * @param {number} contratoId
 * @param {object} [opts]
 * @param {(url: string, opts: {headers: object, timeoutMs: number}) => Promise<{status: number, json: () => Promise<any>}>} [opts.httpGet]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {number} [opts.maxTentativas] - default MAX_TENTATIVAS_429_PADRAO (50):
 *   teto de segurança, não paridade exata com a recursão ilimitada do Python.
 *   Testes que precisam exercitar "desiste eventualmente" passam um valor baixo.
 * @returns {Promise<Array<{sigla: string, prevista: number, executada: number, saldo: number}>>}
 */
async function buscarDemandas(chaveApi, contratoId, opts = {}) {
  const httpGet = opts.httpGet || httpGetPadrao;
  const sleep = opts.sleep || sleepPadrao;
  const maxTentativas = opts.maxTentativas || MAX_TENTATIVAS_429_PADRAO;

  let tentativa = 0;
  for (;;) {
    tentativa++;
    const url = `${BASE_URL}/api/v1/pmo/extrato?contrato_id=${contratoId}&blocos=demandas`;
    const resposta = await httpGet(url, { headers: { 'X-API-Key': chaveApi }, timeoutMs: TIMEOUT_MS });
    const corpo = await resposta.json();

    if (resposta.status === 429) {
      if (tentativa >= maxTentativas) {
        throw new Error(corpo && corpo.error ? corpo.error : 'Limite de requisições excedido (429) repetidamente.');
      }
      const retryAfter = (corpo && corpo.retry_after) || 60;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!corpo || !corpo.success) {
      throw new Error((corpo && corpo.error) || 'Erro desconhecido na API PMO/BI.');
    }
    return (corpo.data && corpo.data.demandas) || [];
  }
}

async function httpGetPadrao(url, { headers, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleepPadrao(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Itera contratos ATIVOS, rate-limitado, tolerante a falha por contrato
 * (loga aviso em stderr e segue pros demais). Devolve linhas prontas pro CSV.
 *
 * @param {Array<{cliente: string, numeroContrato: string, contratoId: number, ativo: boolean}>} contratos
 * @param {string} chaveApi
 * @param {object} [opts] - mesmas opções injetáveis de buscarDemandas, mais `logInfo`/`logAviso`
 * @returns {Promise<Array<[string, string, string, number, number, number]>>}
 */
async function coletar(contratos, chaveApi, opts = {}) {
  const sleep = opts.sleep || sleepPadrao;
  const logInfo = opts.logInfo || ((msg) => console.log(msg));
  const logAviso = opts.logAviso || ((msg) => console.warn(msg));

  const ativos = contratos.filter((c) => c.ativo);
  const linhas = [];

  for (let i = 0; i < ativos.length; i++) {
    const c = ativos[i];
    const rotulo = `${c.cliente} - ${c.numeroContrato}`;
    let demandas = [];
    try {
      demandas = await buscarDemandas(chaveApi, c.contratoId, opts);
    } catch (erro) {
      logAviso(`  [${i + 1}/${ativos.length}] AVISO: ${rotulo}: ${erro.message}`);
    }
    for (const d of demandas) {
      linhas.push([c.cliente, c.numeroContrato, d.sigla, d.prevista, d.executada, d.saldo]);
    }
    logInfo(`  [${i + 1}/${ativos.length}] ${rotulo} -> ${demandas.length} tipo(s)`);
    if (i < ativos.length - 1) {
      await sleep(INTERVALO_ENTRE_CHAMADAS_MS);
    }
  }

  return linhas;
}

function gravarCsv(linhas, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, gridParaCsv([HEADER, ...linhas]), 'utf8');
}

async function main() {
  const chaveApi = autenticar();
  const contratos = lerContratos(config.caminhoContratosSond);
  const ativos = contratos.filter((c) => c.ativo);
  console.log(`${contratos.length} contrato(s) no cadastro, ${ativos.length} ativo(s). Consultando API PMO/BI...`);

  const linhas = await coletar(ativos, chaveApi);

  gravarCsv(linhas, OUT_PATH);
  console.log(`Pronto: ${linhas.length} linha(s) gravada(s) em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { autenticar, buscarDemandas, coletar, gravarCsv, main, HEADER, OUT_PATH };
