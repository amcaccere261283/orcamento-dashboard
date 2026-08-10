'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasLab } = require('./parse-lab.js');
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
const { linhaExcluida, colunaTolerante } = require('../comum/exclusoes.js');
const { hojeNoFusoProjeto } = require('../comum/datas.js');
const { mesesParaBuscar } = require('./atualizar-avancos-online.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv');
const CACHE_DIR = path.join(__dirname, '..', '..', 'dist', 'cache');

// Cobertura desde 2025-01, decidida pelo dono do projeto em 2026-08-10
// ("Realizado Sondagem e Realizado Lab devemos considerar de 2025 pra cá").
//
// Até então este fetcher buscava SÓ o mês corrente, e era a divergência de
// cobertura mais grave do projeto: com 20 meses de Sondagem contra 1 de Lab,
// escolher qualquer mês que não fosse o corrente mostrava LAB.C/LAB.E com
// Realizado ZERO -- indistinguível de "não houve ensaio". Pior, o estoque de
// Demandas de lab virava um contador que só subia (13 em janeiro, 11.116 em
// agosto), porque a única saída do estoque é a data de ensaio e ela só
// existia para o mês corrente. Ver o documento de regras, achados 01 e 02.
//
// mesesParaBuscar é reaproveitada de atualizar-avancos-online.js de
// propósito: as duas fontes de Realizado têm que cobrir EXATAMENTE a mesma
// janela, e duas listas de meses calculadas em paralelo divergiriam na
// primeira correção que só uma recebesse.

function caminhoCache(ano, mes) {
  return path.join(CACHE_DIR, `ensaios-realizados-${ano}-${String(mes).padStart(2, '0')}.csv`);
}

// O extrato traz 11 colunas; parseLab lê 4 (ID Contrato, Ensaiado Dia, Tipo
// de Ensaio, Data Programada) e a exclusão de auto-consumo lê Tomadora --
// que já rodou antes de gravar. As outras 6 (Usuário, Tipo de Amostra, Cod.
// Amostra, Identificação, OS, Ações) não têm consumidor nenhum.
//
// Projetar só estas cinco na gravação corta o CSV de 33 MB para 12 MB
// (-63%), medido em 2026-08-10 sobre os 230.084 ensaios dos 20 meses. Não é
// cosmético: este arquivo é PUBLICADO no Pages, e o botão "Atualizar dados"
// o baixa inteiro a cada clique -- 33 MB por clique, mais ~66 MB por commit
// (dist/ + docs/) num repositório que já tinha 142 MB. Tomadora fica pela
// rastreabilidade (dá pra conferir uma linha sem refazer a busca).
//
// O CACHE em dist/cache/ continua com as 11 colunas de propósito: ele é
// local, nunca publicado, e cacheUtilizavel() compara o cabeçalho gravado
// com o que a busca de agora devolveu -- se o cache fosse projetado, todo
// mês fechado seria considerado "formato antigo" e rebuscado a cada run.
const COLUNAS_PUBLICADAS = [
  'Data Programada', 'Ensaiado Dia', 'Tomadora', 'ID Contrato', 'Tipo de Ensaio',
];

function projetarColunas(cabecalho, linhas) {
  const indices = COLUNAS_PUBLICADAS.map((rotulo) => {
    const i = cabecalho.findIndex((c) => String(c || '').replace(/\s+/g, ' ').trim() === rotulo);
    if (i === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no extrato de lab -- o layout mudou. Cabeçalho recebido: ${cabecalho.join(', ')}`);
    }
    return i;
  });
  return {
    cabecalho: COLUNAS_PUBLICADAS.slice(),
    linhas: linhas.map((linha) => indices.map((i) => linha[i])),
  };
}

// UTC-3 ("considerar o utc-3 sempre") -- este arquivo lia a hora LOCAL da
// máquina enquanto atualizar-avancos-online.js lia UTC, e nas últimas 3h de
// cada mês os dois discordavam sobre qual é o mês corrente.
function mesAnoDeHoje(agora = new Date()) {
  const { ano, mes } = hojeNoFusoProjeto(agora);
  return { mes: String(mes).padStart(2, '0'), ano: String(ano) };
}

// A exclusão de auto-consumo interno passou a valer TAMBÉM aqui em
// 2026-08-10 ("aplica a exclusão em todas as fontes") -- esta era uma das
// duas fontes que gravavam o grid cru, sem filtro nenhum. O extrato de lab
// chama a coluna de "Tomadora"; linhaExcluida() aceita as duas grafias.
// O tipo desta fonte é o "Tipo de Ensaio" -- os tipos SEG/SN são de
// sondagem, então na prática quem filtra aqui é o tomador.
function filtrarLinhasLab(headers, rows) {
  const mantidas = [];
  let excluidos = 0;
  for (const row of rows) {
    const objeto = {};
    headers.forEach((h, i) => { objeto[h] = row[i]; });
    if (linhaExcluida(objeto, colunaTolerante(objeto, 'Tipo de Ensaio'))) {
      excluidos++;
      continue;
    }
    mantidas.push(row);
  }
  return { rows: mantidas, excluidos };
}

// Mesmo guard de formato de atualizar-avancos-online.js: um cache gravado
// antes da exclusão passar a valer aqui traria linhas de auto-consumo de
// volta, e um gravado com outro conjunto de colunas desalinharia o grid
// combinado em silêncio. Cache com cabeçalho divergente do da busca de agora
// é tratado como inexistente.
function cacheUtilizavel(grid, cabecalhoAtual) {
  const cabecalho = (grid && grid[0]) || [];
  if (!cabecalhoAtual || cabecalho.length !== cabecalhoAtual.length) return false;
  return cabecalhoAtual.every((rotulo, i) => String(cabecalho[i] || '').trim() === String(rotulo || '').trim());
}

async function buscarMesLab(ano, mes, ehMesCorrente, cabecalhoConhecido) {
  const cache = caminhoCache(ano, mes);
  if (!ehMesCorrente && fs.existsSync(cache)) {
    const grid = parseCsvGrid(fs.readFileSync(cache, 'utf8'));
    if (cacheUtilizavel(grid, cabecalhoConhecido || grid[0])) {
      return { headers: grid[0], rows: grid.slice(1), excluidos: 0, doCache: true };
    }
    console.warn(`  cache de ${ano}-${String(mes).padStart(2, '0')} está no formato antigo -- rebuscando.`);
  }

  const mm = String(mes).padStart(2, '0');
  const url = `${SITE_ORIGIN}/extrato-ensaios-realizados/mes/${mm}/ano/${ano}/`;
  const { session, target } = await cdp.abrirSessao(url);
  try {
    const tabela = await cdp.rasparTabelaDataTable(session, '.producao-grid', { timeoutMs: 45000 });
    // Mês sem nenhum ensaio é possível e não é erro (diferente do fetcher
    // antigo, que só buscava o mês corrente e tratava vazio como falha).
    // Quem decide se o resultado GLOBAL é aceitável é main().
    if (!tabela.rows.length) return { headers: tabela.headers, rows: [], excluidos: 0, doCache: false };

    locateColunasLab(tabela.headers);
    const { rows, excluidos } = filtrarLinhasLab(tabela.headers, tabela.rows);

    if (!ehMesCorrente) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cache, gridParaCsv([tabela.headers, ...rows]), 'utf8');
    }
    return { headers: tabela.headers, rows, excluidos, doCache: false };
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const meses = mesesParaBuscar(new Date());
  console.log(`Buscando ${meses.length} mes(es) de extrato-ensaios-realizados (2025-01 ate o mes corrente)...`);

  let cabecalho = null;
  const linhasTodas = [];
  const falhas = [];
  let excluidosTotal = 0;

  for (const m of meses) {
    const rotulo = `${m.ano}-${String(m.mes).padStart(2, '0')}`;
    try {
      const r = await buscarMesLab(m.ano, m.mes, m.ehMesCorrente, cabecalho);
      if (!cabecalho && r.headers && r.headers.length) cabecalho = r.headers;
      linhasTodas.push(...r.rows);
      excluidosTotal += r.excluidos;
      console.log(`  ${rotulo}${m.ehMesCorrente ? ' (corrente)' : ''}${r.doCache ? ' [cache]' : ''}: ${r.rows.length} ensaio(s)`);
    } catch (err) {
      falhas.push({ mes: rotulo, erro: err.message, ehMesCorrente: m.ehMesCorrente });
      console.warn(`  ${rotulo}: FALHOU -- ${err.message}`);
    }
  }

  // Mesmo guard de atualizar-avancos-online.js: meses fechados vêm do cache
  // na maioria das execuções, então uma sessão CDP quebrada derruba só o mês
  // corrente -- e regravar o CSV sem ele deixaria o Realizado de Lab do mês
  // em curso perto de zero, em silêncio.
  const falhaMesCorrente = falhas.find((f) => f.ehMesCorrente);
  if (falhaMesCorrente) {
    throw new Error(
      `O mês CORRENTE (${falhaMesCorrente.mes}) falhou ao buscar -- abortando SEM gravar ${OUT_PATH} ` +
      `pra não substituir o CSV bom já publicado por um sem o mês em curso. Erro original: ${falhaMesCorrente.erro}`
    );
  }
  if (!cabecalho) {
    throw new Error('Nenhum mês devolveu cabeçalho -- abortando sem gravar (sessao expirada? confira se o Chrome ainda esta logado em sond.com.br).');
  }
  if (!linhasTodas.length) {
    throw new Error('Nenhum ensaio em nenhum mês -- abortando sem gravar (não é o caso normal, confira antes de aceitar um CSV vazio).');
  }

  locateColunasLab(cabecalho);

  // Projeta para as colunas publicadas ANTES de gravar -- ver
  // COLUNAS_PUBLICADAS. locateColunasLab roda nos dois cabeçalhos: no
  // completo acima (o que a fonte devolveu) e no projetado abaixo (o que vai
  // pro disco), pra garantir que o recorte não derrubou nenhuma obrigatória.
  const projetado = projetarColunas(cabecalho, linhasTodas);
  locateColunasLab(projetado.cabecalho);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, gridParaCsv([projetado.cabecalho, ...projetado.linhas]), 'utf8');
  const mb = (fs.statSync(OUT_PATH).size / 1048576).toFixed(1);
  console.log(`Pronto: ${linhasTodas.length} ensaio(s) de ${meses.length - falhas.length}/${meses.length} mes(es) gravado(s) em ${OUT_PATH} (${mb} MB, ${COLUNAS_PUBLICADAS.length} de ${cabecalho.length} colunas).`);
  if (excluidosTotal > 0) console.log(`${excluidosTotal} ensaio(s) excluído(s) no total (Suporte Sondagens/SEG/SN).`);
  if (falhas.length) console.warn(`${falhas.length} mes(es) falharam e ficaram DE FORA: ${falhas.map((f) => f.mes).join(', ')}`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main, mesAnoDeHoje, filtrarLinhasLab, cacheUtilizavel, buscarMesLab, projetarColunas, COLUNAS_PUBLICADAS };
