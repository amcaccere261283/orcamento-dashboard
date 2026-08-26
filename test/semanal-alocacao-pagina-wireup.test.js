'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

// Migrado de test/semanal-render-semanal-wireup.test.js (linhas 1723-2300,
// "--- Alocação Equipes: a sétima aba, o blob cifrado e o invariante") pra
// esta página própria, quando a Alocação Equipes deixou de ser uma aba de
// planejamento-semanal.html pra virar tools/semanal/render-alocacao-pagina.js
// (ver docs/superpowers/sdd/2026-08-25-alocacao-equipes-pagina-propria).
// A Task 3 já removeu a aba de lá (planejamento-semanal.html não tem mais
// id="aba-alocacao"/id="secao-alocacao" nem os 3 campos exclusivos do blob --
// ver o teste de regressão em semanal-render-semanal-wireup.test.js). As duas
// suítes terem ficado verdes durante a migração é o que provou que ela não
// mudou nenhum comportamento.

// Senha fictícia -- nunca a real (ver CLAUDE.md/instruções do projeto).
const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';

// Os 12 meses da MATRIZ como datas -- em produção vêm do cabeçalho da
// planilha (tools/semanal/build-dashboard.js) e alimentam calcularVigenteIdx
// (tools/comum/datas.js). 2026 é o ano de todos os geradoEm deste arquivo.
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

// A aba Demandas passou a ser obrigatória no payload (renderAlocacaoPagina
// lança sem ela, de propósito -- ver o comentário lá). Agregado mínimo
// válido: sem tipologia nenhuma, renderAbaDemandas rende o aviso de "sem
// dado".
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico(sup, tomador, financeiroMes) {
  const zeros = new Array(12).fill(0);
  const fin = new Array(12).fill(0);
  fin[6] = financeiroMes; // julho -- mesmo vigenteIdx usado nos testes abaixo
  const bloco = (equipes, volume, financeiro) => ({
    equipes, volume, financeiro,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: financeiroMes, totalInicial: financeiroMes },
  });
  return {
    sup, grupo: 'Grupo-Sintetico-Beta', tomador, tipologia: 'ST',
    previsto: bloco(new Array(12).fill(2), zeros, fin),
    realizado: bloco(new Array(12).fill(0), zeros, zeros),
    total: bloco(new Array(12).fill(0), zeros, zeros),
  };
}

// Mesmo mock de window.localStorage do arquivo original -- ver o comentário
// lá (test/semanal-render-semanal-wireup.test.js): o marcador de "semana já
// vista" (ESTADO_ALOCACAO.semanaCarregada/semanaJaVista) depende dele pra
// distinguir "nunca teve alocação salva" de "foi esvaziada de propósito".
function localStorageFalso() {
  const dados = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    removeItem: (k) => { delete dados[k]; },
  };
}

// Extrai e roda, num Realm isolado (vm.Context), TODOS os <script> inline do
// HTML gerado, na mesma ordem em que um navegador executaria -- nenhum
// reescrito, nenhum resumido. Versão LOCAL (não reaproveita a do arquivo
// original): a página nova não tem markupAbas/sete abas, mas continua com os
// mesmos 8 blocos de <script> do arquivo original (vigenteIdx,
// __ULTIMA_ATUALIZACAO_OK__, aviso de atualização atrasada, dados cifrados,
// gate, fonteParaCliente, bundle, cliente) -- markupAbas nunca foi um
// <script> à parte em nenhuma das duas páginas, então a contagem não muda.
// Confirmado rodando renderAlocacaoPagina({...}) e contando os pares
// <script>...</script> que esta mesma regex extrai (não a contagem bruta de
// aberturas '<script>', que inclui ocorrências do literal dentro do bundle
// de módulos) -- 8, não 7.
function montarSandbox(html, fetchMock) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocos.length, 8, 'esperava exatamente 8 <script> (vigenteIdx, __ULTIMA_ATUALIZACAO_OK__, aviso de atualização atrasada, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const codigo = blocos.join('\n;\n');

  const documentoFalso = criarDocumentoFalso();
  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    fetch: fetchMock || (() => Promise.reject(new Error('fetch não mockado neste teste'))),
    localStorage: localStorageFalso(),
  };
  sandbox.window = sandbox; // window É o global object, como no navegador
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'alocacao-pagina-cliente.js' });
  return { sandbox, documentoFalso };
}

// --- Alocação Equipes: a sétima aba, o blob cifrado e o invariante (Task 10,
// 2026-08-10) --------------------------------------------------------------
// Task 9 deixou pronto o estado/montarAbaAlocacao/aplicarMovimento/etc, e o
// bundle já registrado (o teste de wire-up destes módulos vive em
// test/semanal-alocacao-interacao.test.js). O que falta provar aqui é a
// INTEGRAÇÃO: a aba é alcançável de verdade, e osParaSup -- que Task 9 deixou
// defaultando para {} -- agora sai do build/live-refresh, atravessa o blob
// cifrado e chega em equipesDoQuadro.

// CSV mínimo de uma equipe da aba EQ, com um único dia (01/08/2026) marcado
// com uma OS entre parênteses -- é o texto que classificarDiaEquipe reconhece
// como 'mobilizada' com aquela OS (RE_OS). Reaproveita a mesma estrutura de
// colunas que test/semanal-build-dashboard.test.js já usa para este roster.
function csvEqComOs(textoDoDia) {
  return [
    'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda,Tomador,sinalização 3P,01/08/2026',
    ',,do condutor,-,-,-,-,-,-,-,-,-,-,-,,SÁBADO',
    '4,José I. Amaral,D,ST,Amaral,-,-,N/A,N/A,N/A,N/A,N/A,,CCR RioSP,,' + textoDoDia,
  ].join('\n');
}

test('depois da senha certa, #secao-alocacao é montada de verdade -- não fica um <div> vazio', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  assert.equal(documentoFalso.getElementById('conteudo-protegido').style.display, '');
  assert.notEqual(documentoFalso.getElementById('secao-alocacao').innerHTML, '');
});

test('osParaSup viaja dentro do blob cifrado e chega em equipesDoQuadro -- supRealizado/colunaRealizada não ficam null numa página real', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)]; // tipologia 'ST' (registroSintetico)
  const geradoEm = new Date('2026-08-01T00:00:00Z'); // vigenteIdx = 7 (agosto)
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.strictEqual(sandbox.window.__DEMANDAS__.osParaSup['16925-25'], 'SUP-0001-24',
    'o mapa precisa sobreviver a serialização/cifragem/decifragem dentro do blob');

  // Força a semana S1 (cobre 01-02/08/2026, onde a equipe tem a OS marcada)
  // -- não depende do relógio real da máquina que roda o teste.
  sandbox.ESTADO_ALOCACAO.semanaIdx = 0;
  sandbox.montarAbaAlocacao();

  const equipe = sandbox.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  assert.ok(equipe, 'esperava a equipe 4 no roster');
  assert.strictEqual(equipe.supRealizado, 'SUP-0001-24',
    'sem osParaSup chegando de verdade, supRealizado ficaria sempre null -- o exato defeito que esta task fecha');
  assert.strictEqual(equipe.colunaRealizada, 'ST');

  // "Repor o realizado" prova a ponta a ponta: a equipe entra alocada no
  // SUP/coluna reais, não no pool vazio de sugestão que {} produziria.
  // Campo a campo, não deepStrictEqual: o objeto nasce dentro do vm.Context
  // (outro Realm), e deepStrictEqual compara protótipo -- Object do sandbox
  // não é === Object deste processo, mesmo com a MESMA estrutura de dados.
  sandbox.semearDoRealizado();
  const alocado = sandbox.ESTADO_ALOCACAO.alocacao['4'];
  assert.ok(alocado, 'esperava a equipe 4 alocada depois de "Repor o realizado"');
  assert.strictEqual(alocado.sup, 'SUP-0001-24');
  assert.strictEqual(alocado.coluna, 'ST');
});

// --- I-1/I-2 (revisão final de 2026-08-25): o live-refresh copiado
// (atualizarDadosAoVivoSemanal, ~250 linhas) não tinha nenhum teste nesta
// página nova -- a página antiga mantém dois testes equivalentes em
// test/semanal-render-semanal-wireup.test.js, esta não tinha nenhum. Monta o
// mesmo csvMatriz/csvAvancos/csvLab mínimos que aquele arquivo já usa.
function csvMatrizComSup(sup) {
  return 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + `Origem-B,Grupo-B,Tomador-Novo,${sup},Escopo,Apoio,01/2026,12/2026,ST,P,`
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,9999,'
    + Array(12).fill('0').join(',') + ',100,100,\n'
    + ',,,,,,,,,T,'
    + Array(12).fill('0').join(',') + ',0,0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,\n';
}
const CSV_AVANCOS_VAZIO = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n';
const CSV_LAB_VAZIO = 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n';

test('I-1: clicar em "Atualizar dados" redesenha #secao-alocacao com o roster NOVO -- equipesCsv atualizado chega em equipesDoQuadro', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z'); // vigenteIdx = 7 (agosto)
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  // Roster NOVO: equipe 77 no lugar da 4, mesma coluna do dia -- prova que o
  // refresh TROCA o roster (não acrescenta) e que o quadro reflete o CSV que
  // acabou de chegar do clique, não o do build.
  const csvEqNovo = csvEqComOs('CCR RioSP (16925-25)').replace('4,José I. Amaral', '77,Equipe Setenta e Sete');

  // Grava toda URL requisitada (Achado #4 da revisão final, 2026-08-25): as
  // rotas de 'equipes-online.csv'/'equipes-roster-online.csv' SAÍRAM daqui --
  // eram 404 morto, porque o wrapper desta página (atualizarDadosAoVivoSemanal
  // em render-alocacao-pagina.js) nunca passa producao/roster em fontes (só
  // alimentam equipesPorDia/equipesNaoProdutivas, que esta página não lê -- ver
  // o comentário lá). Se algum dia alguém acrescentar essas duas linhas de
  // volta, o 404 morto faria este mock continuar "funcionando" (o fetch bateria
  // no 404 esperado por ele) sem revelar que a intenção era nunca pedir aquilo
  // -- por isso a asserção abaixo prova a ausência da URL, não só o resultado.
  const urlsRequisitadas = [];
  const fetchMock = (url) => {
    urlsRequisitadas.push(url);
    if (url.indexOf('demandas-sondagem-online.csv') !== -1 || url.indexOf('demandas-lab-online.json') !== -1) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    if (url.indexOf('pub?gid=609773455') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(csvMatrizComSup('SUP-0001-24')) });
    if (url.indexOf('pub?gid=199381651') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(csvEqNovo) });
    if (url.indexOf('avancos-online.csv') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_AVANCOS_VAZIO) });
    if (url.indexOf('lab-online.csv') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_LAB_VAZIO) });
    return Promise.reject(new Error('fetch inesperado neste teste: ' + url));
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  sandbox.ESTADO_ALOCACAO.semanaIdx = 0;
  sandbox.montarAbaAlocacao();
  await new Promise((resolve) => setImmediate(resolve));

  const secaoAntes = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.notStrictEqual(secaoAntes, '', 'pré-condição: a grade do roster inicial (build) já está desenhada');
  assert.ok(sandbox.ESTADO_ALOCACAO.equipes.some((e) => e.id === '4'), 'pré-condição: a equipe do build (id 4) está no quadro antes do clique');

  // Dispara o clique de verdade (não chama atualizarDadosAoVivoSemanal()
  // direto) -- prova que o listener registrado em
  // document.getElementById('atualizar-dashboard').addEventListener('click', ...)
  // está de fato ligado nesta página nova, não só que a função existe.
  documentoFalso.getElementById('atualizar-dashboard').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(sandbox.window.__DEMANDAS__.equipesCsv, /Equipe Setenta e Sete/, 'o roster novo (equipesCsv) precisa chegar em window.__DEMANDAS__ depois do clique');

  const equipeNova = sandbox.ESTADO_ALOCACAO.equipes.find((e) => e.id === '77');
  assert.ok(equipeNova, 'esperava a equipe 77 (do roster NOVO) em ESTADO_ALOCACAO.equipes -- prova que equipesDoQuadro recebeu o equipesCsv atualizado');
  assert.strictEqual(sandbox.ESTADO_ALOCACAO.equipes.some((e) => e.id === '4'), false, 'a equipe antiga (do build) não pode sobreviver ao refresh -- o quadro reflete o roster NOVO');

  const secaoDepois = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.notStrictEqual(secaoDepois, secaoAntes, '#secao-alocacao precisa ser REDESENHADA pelo clique -- não pode ficar com o HTML de antes');

  assert.ok(!urlsRequisitadas.some((u) => String(u).indexOf('equipes-online') !== -1), 'a URL de produção (equipes-online.csv) nunca pode ter sido pedida -- producao fica de fora de fontes de propósito');
  assert.ok(!urlsRequisitadas.some((u) => String(u).indexOf('equipes-roster-online') !== -1), 'a URL de roster (equipes-roster-online.csv) nunca pode ter sido pedida -- roster fica de fora de fontes de propósito');
});

// I-2: uma falha na Sheet EQ (textos[3], catch(() => null)) não pode apagar
// a grade que já estava na tela -- antes desta correção, csvEq null zerava
// incondicionalmente equipesCsv/osParaSup/equipesRosterPeriodo em
// demandasNovas (um objeto NOVO desde ComputeDemandas.computeDemandas, não
// mais window.__DEMANDAS__), e montarAbaAlocacao via semRoster mostrava só a
// guarda -- com o status dizendo "Atualizado" em verde.
test('I-2: a Sheet EQ falhando no "Atualizar dados" preserva o roster que já estava na tela -- não esvazia a grade', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  // Grava toda URL requisitada (Achado #4 da revisão final, 2026-08-25): ver o
  // comentário equivalente no teste I-1 acima -- mesmo motivo pra remover as
  // rotas de 404 de 'equipes-online.csv'/'equipes-roster-online.csv' e provar
  // a ausência da URL em vez de confiar num 404 que nunca deveria acontecer.
  const urlsRequisitadas = [];
  const fetchMock = (url) => {
    urlsRequisitadas.push(url);
    if (url.indexOf('demandas-sondagem-online.csv') !== -1 || url.indexOf('demandas-lab-online.json') !== -1) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    if (url.indexOf('pub?gid=609773455') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(csvMatrizComSup('SUP-0001-24')) });
    // A Sheet EQ (gid=199381651) está fora do ar -- atualizarDadosAoVivoSemanal
    // engole isso com .catch(() => null), então textos[3] chega null aqui.
    if (url.indexOf('pub?gid=199381651') !== -1) return Promise.reject(new Error('Sheet EQ fora do ar (simulado)'));
    if (url.indexOf('avancos-online.csv') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_AVANCOS_VAZIO) });
    if (url.indexOf('lab-online.csv') !== -1) return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV_LAB_VAZIO) });
    return Promise.reject(new Error('fetch inesperado neste teste: ' + url));
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  sandbox.ESTADO_ALOCACAO.semanaIdx = 0;
  sandbox.montarAbaAlocacao();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sandbox.ESTADO_ALOCACAO.equipes.some((e) => e.id === '4'), 'pré-condição: a grade do build está desenhada com a equipe 4 antes do clique');

  documentoFalso.getElementById('atualizar-dashboard').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(
    sandbox.window.__DEMANDAS__.equipesCsv, /José I\. Amaral/,
    'com a Sheet EQ fora do ar, equipesCsv precisa continuar sendo o CSV do build (preservado), nunca null'
  );
  // JSON.parse(JSON.stringify(...)), não deepStrictEqual direto: o objeto
  // nasce dentro do vm.Context (outro Realm), e deepStrictEqual compara
  // protótipo -- {} do sandbox não é === {} deste processo, mesmo com a
  // MESMA estrutura de dados (mesmo achado registrado nos outros testes
  // deste arquivo, ex. "semearDoRealizado").
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(sandbox.window.__DEMANDAS__.osParaSup)), { '16925-25': 'SUP-0001-24' },
    'osParaSup também precisa ser preservado, mesma regra'
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(sandbox.window.__DEMANDAS__.equipesRosterPeriodo)), { ano: 2026, mes: 8 },
    'equipesRosterPeriodo idem'
  );

  assert.strictEqual(
    documentoFalso.getElementById('secao-alocacao').innerHTML.indexOf('Sheet espelho da aba EQ não respondeu') === -1,
    true,
    'a guarda semRoster NÃO pode aparecer -- a grade continua desenhada com o roster preservado, não em branco'
  );
  assert.ok(
    sandbox.ESTADO_ALOCACAO.equipes.some((e) => e.id === '4'),
    'a equipe 4 (do roster preservado) continua no quadro depois do clique, mesmo com a Sheet EQ fora do ar'
  );

  assert.ok(!urlsRequisitadas.some((u) => String(u).indexOf('equipes-online') !== -1), 'a URL de produção (equipes-online.csv) nunca pode ter sido pedida -- producao fica de fora de fontes de propósito');
  assert.ok(!urlsRequisitadas.some((u) => String(u).indexOf('equipes-roster-online') !== -1), 'a URL de roster (equipes-roster-online.csv) nunca pode ter sido pedida -- roster fica de fora de fontes de propósito');
});

// --- Rodada de correção 1 (verificação em navegador real, 2026-08-10): o
// quadro abria com 114 células vazias e 114 cartões no pool -- "Repor o
// realizado" preenchia certo (provando que osParaSup/semearDoRealizado
// funcionavam), mas nada disparava sozinho no primeiro desenho da semana.
// Decisão 9 do spec: "ao abrir uma semana sem alocação salva, o quadro é
// semeado com onde as equipes estão de fato". Os dois testes abaixo pinam o
// contrato: abrir SEM nada salvo semeia sozinho; abrir uma semana ESVAZIADA
// de propósito (Limpar alocação) NÃO volta a semear -- as duas situações são
// {} na hora de ler, e é o marcador 'alocacao-equipes:vista:<chave>'
// (ESTADO_ALOCACAO.semanaCarregada/semanaJaVista, render-alocacao-pagina.js) que as
// distingue.

test('a semana abre semeada do realizado no PRIMEIRO desenho da aba, sem precisar clicar em "Repor o realizado" -- a regressão relatada', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  // tentarDesbloquear já roda montarDashboard -> recalcularSemanal ->
  // montarAbaAlocacao sozinho -- nenhum botão de semana é clicado neste teste.
  await sandbox.tentarDesbloquear();

  // Força a semana S1 (a que o CSV cobre) chamando montarAbaAlocacao()
  // direto -- a MESMA função que recalcularSemanal já chama sozinha a cada
  // desenho, não o caminho de troca EXPLÍCITA de semana
  // (selecionarSemanaAlocacao, coberto no teste seguinte). Sem isto o teste
  // dependeria de qual semana o relógio real da máquina que roda a suíte
  // classifica como "em curso" hoje.
  sandbox.ESTADO_ALOCACAO.semanaIdx = 0;
  sandbox.montarAbaAlocacao();
  // carregarAlocacaoDaSemana é disparada de dentro de montarAbaAlocacao sem
  // ser esperada (fire-and-forget, de propósito -- a tela não pode travar
  // esperando storage/rede) -- um boundary de macrotask garante que a
  // cadeia de microtasks (carregar -> then -> semear -> gravar) já
  // assentou. Mesma técnica de chamarEsperarAtualizacao, mais acima.
  await new Promise((resolve) => setImmediate(resolve));

  const alocado = sandbox.ESTADO_ALOCACAO.alocacao['4'];
  assert.ok(alocado, 'esperava a equipe 4 já alocada sem clicar em "Repor o realizado" -- 114 células vazias e 114 cartões no pool era o defeito relatado');
  assert.strictEqual(alocado.sup, 'SUP-0001-24');
  assert.strictEqual(alocado.coluna, 'ST');
});

test('trocar para uma semana nunca vista (selecionarSemanaAlocacao) também semeia sozinha, não só o primeiro desenho da aba', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  await sandbox.selecionarSemanaAlocacao(0);

  const alocado = sandbox.ESTADO_ALOCACAO.alocacao['4'];
  assert.ok(alocado, 'trocar de semana (não só o primeiro desenho da aba) também precisa semear quando não há nada salvo');
  assert.strictEqual(alocado.sup, 'SUP-0001-24');
  assert.strictEqual(alocado.coluna, 'ST');
});

test('uma semana esvaziada de propósito ("Limpar alocação") NÃO volta a semear sozinha na próxima vez que é aberta', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  await sandbox.selecionarSemanaAlocacao(0);
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'pré-condição: a primeira abertura semeou sozinha');

  sandbox.limparAlocacao(); // ação explícita do usuário, "Limpar alocação"
  // Object.keys(...).length, não deepStrictEqual(..., {}): o objeto nasce
  // dentro do vm.Context (outro Realm), e deepStrictEqual compara protótipo
  // -- {} deste processo não é === {} do sandbox, mesmo os dois vazios.
  assert.strictEqual(Object.keys(sandbox.ESTADO_ALOCACAO.alocacao).length, 0, 'pré-condição: a limpeza esvaziou de fato');

  // "Reabrir" a mesma semana -- o mesmo gesto de clicar de novo no botão da
  // semana, ou recarregar a página com o mesmo cache local (o cliente de
  // teste usa o MESMO armazenamento falso entre as duas chamadas, dentro do
  // mesmo sandbox -- não é um novo processo, mas é a mesma leitura que uma
  // nova carga de página faria).
  await sandbox.selecionarSemanaAlocacao(0);

  assert.strictEqual(Object.keys(sandbox.ESTADO_ALOCACAO.alocacao).length, 0,
    'a semana esvaziada de propósito não pode ser reenchida sozinha -- reencheria atrás do usuário, o mesmo defeito trocado de lugar');
});

test('sem equipesCsv (Sheet espelho da EQ não respondeu), a aba mostra a guarda semRoster, nunca um quadro vazio', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, { equipesCsv: null, equipesRosterPeriodo: null, osParaSup: null });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.match(documentoFalso.getElementById('secao-alocacao').innerHTML, /Sheet espelho da aba EQ não respondeu/);
});

test('semana de um mês diferente do que o espelho da EQ cobre entra em somenteLeitura -- a grade desenha, mas nada é arrastável', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho) -- espelho cobre agosto
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('OK'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: {},
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.strictEqual(sandbox.mesSelecionadoIdx, 6, 'pré-condição: a página abre em julho, mês diferente do espelho');
  assert.match(documentoFalso.getElementById('secao-alocacao').innerHTML, /Somente leitura: o espelho da/);
});

test('window.__ALOCACAO_URL__ vem do blob cifrado (URL_ALOCACAO) -- nunca em texto puro no HTML cru, mesmo padrão de window.__DEMANDAS__', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderAlocacaoPagina({
    registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const url = sandbox.window.__ALOCACAO_URL__;
  assert.ok(url, 'a URL tem que chegar ao cliente depois do desbloqueio');

  // Aferido contra o VALOR QUE CHEGOU, e não contra um literal fixo: assim o
  // teste continua verdadeiro quando a URL mudar (o Apps Script foi publicado
  // em 2026-08-11, e a versão anterior deste assert prendia o literal
  // 'PENDENTE-...'). O que importa aqui nunca foi qual é a URL -- é ela não
  // vazar em texto puro, porque é uma URL de ESCRITA: quem a lê pode gravar na
  // planilha, mesmo sem a senha do dashboard.
  assert.ok(!html.includes(url),
    'a URL de alocação só pode existir dentro do blob cifrado, nunca no HTML cru');
});

// --- Correção pré-publicação do Apps Script (2026-08-11): a corrida entre
// carregarAlocacaoDaSemana (assíncrona) e o redesenho (síncrono) --------
//
// Em modo local carregar() resolve numa microtask (leitura síncrona de
// localStorage embrulhada em async) -- rápido demais para um clique de
// usuário colidir, por isso "praticamente inalcançável" hoje. Assim que
// URL_ALOCACAO deixar de ser 'PENDENTE-...', carregar() vira uma
// ida-e-volta de rede de verdade (centenas de ms numa conexão lenta), e a
// janela de corrida deixa de ser teórica. Os dois testes abaixo forçam modo
// 'sheet' e SEGURAM a resposta do fetch aberta manualmente (o mock nunca
// resolve sozinho) para provar que uma ação do usuário no meio do caminho
// sobrevive -- sem a proteção de ESTADO_ALOCACAO.geracaoAlocacao
// (carregarAlocacaoDaSemana, render-alocacao-pagina.js) estes dois falhariam.
//
// clienteAlocacao() memoiza o cliente na PRIMEIRA chamada (dentro do
// primeiro montarAbaAlocacao, que já roda em modo local durante
// tentarDesbloquear). URL_ALOCACAO é uma constante fixa em
// render-alocacao-pagina.js -- a URL do Apps Script publicado, não mais
// 'PENDENTE-...' (ver o teste logo acima, que confirma que ela chega ao
// cliente pelo blob cifrado). Por isso os dois
// testes resetam ESTADO_ALOCACAO.cliente pra null DEPOIS de desbloquear,
// simulando o momento em que o dono do projeto publica o Apps Script e a
// página é recarregada com a URL nova.
function fetchMockAlocacaoSheet(resolversGet) {
  // POSTs (gravar -- o aplicarMovimento do teste também tenta persistir em
  // paralelo) resolvem na hora, sem travar: não são o alvo destes testes.
  // Só o GET de carregar() fica em voo, sob controle do teste.
  //
  // DUAS FASES, e a primeira passou a ser necessária em 2026-08-11, quando o
  // Apps Script foi publicado e URL_ALOCACAO deixou de ser 'PENDENTE-...'.
  // Antes disso o desbloqueio rodava a aba em modo LOCAL e não tocava a rede,
  // então segurar todo GET era inofensivo. Com a URL real, o primeiro
  // montarAbaAlocacao (lá dentro de tentarDesbloquear) já BUSCA -- e um mock
  // que segura todo GET pendura o próprio desbloqueio, antes de o teste ter a
  // chance de resolver coisa nenhuma. O sintoma é feio de diagnosticar: os
  // testes que já rodaram passam, e o ARQUIVO estoura o timeout sem apontar
  // para nenhum deles.
  //
  //   fase 1 (setup) ..... GET resolve na hora, com a Sheet vazia
  //   fase 2 (a corrida).. o teste chama segurar(), e a partir daí os GETs
  //                        ficam em voo, sob controle dele
  let segurando = false;
  const mock = function (url, opcoes) {
    if (opcoes && opcoes.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (!segurando) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ linhas: [] }) });
    }
    return new Promise((resolve) => { resolversGet.push(resolve); });
  };
  mock.segurar = () => { segurando = true; };
  return mock;
}

test('um arrasto que aterrissa ENQUANTO carregarAlocacaoDaSemana está em voo sobrevive -- a resposta tardia da rede não pode desfazê-lo', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)]; // tipologia 'ST'
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });

  const resolversGet = [];
  const fetchMock = fetchMockAlocacaoSheet(resolversGet);
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Assenta a semana S1 primeiro (determinístico, sem depender do relógio
  // real da máquina que roda a suíte) -- a equipe 4 nasce semeada aqui,
  // prova de que o roster está pronto.
  await sandbox.selecionarSemanaAlocacao(0);
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'pré-condição: a semana abriu semeada');

  // Daqui pra frente os GETs ficam em voo, sob controle do teste.
  fetchMock.segurar();

  // Troca para modo SHEET -- simula o Apps Script recém-publicado.
  sandbox.ESTADO_ALOCACAO.cliente = null;
  sandbox.window.__ALOCACAO_URL__ = 'https://exemplo.com/exec-alocacao-teste';

  // Dispara um carregamento de verdade (reabrir a mesma semana) -- fica
  // preso em voo até resolversGet[0](...) ser chamado.
  const chave = sandbox.chaveSemanaAtual();
  const promessaCarregamento = sandbox.carregarAlocacaoDaSemana(chave);
  assert.strictEqual(resolversGet.length, 1, 'esperava que carregar() em modo sheet chamasse fetch() uma vez (GET)');

  // O ARRASTO acontece ENQUANTO a busca está em voo.
  const ok = sandbox.aplicarMovimento('4', 'SUP-B', 'ST');
  assert.strictEqual(ok, true, 'pré-condição: o movimento durante o carregamento foi aceito');
  assert.strictEqual(sandbox.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-B', 'pré-condição: o arrasto aplicou de verdade, antes da rede responder');

  // A resposta da rede finalmente chega -- de uma Sheet vazia (o caso mais
  // comum de um Apps Script recém-publicado, sem nada salvo ainda).
  resolversGet[0]({ ok: true, json: () => Promise.resolve({ linhas: [] }) });
  await promessaCarregamento;

  // SEM a proteção de geracaoAlocacao, o .then() reatribuiria
  // ESTADO_ALOCACAO.alocacao = {} (o que a Sheet vazia devolveu) por cima do
  // arrasto -- a equipe 4 "pularia" de volta pro pool, sem erro nenhum na
  // tela.
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'o arrasto não pode ter sido desfeito pela resposta tardia da rede');
  assert.strictEqual(sandbox.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-B', 'o destino do arrasto precisa sobreviver, não o que a rede devolveu depois dele');
});

test('trocar de semana enquanto um carregamento anterior está em voo não deixa a resposta da semana ABANDONADA aterrissar no quadro da semana nova', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-08-01T00:00:00Z');
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });

  const resolversGet = [];
  const fetchMock = fetchMockAlocacaoSheet(resolversGet);
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  await sandbox.selecionarSemanaAlocacao(0); // assenta a semana, determinístico

  fetchMock.segurar(); // daqui pra frente os GETs ficam em voo
  sandbox.ESTADO_ALOCACAO.cliente = null;
  sandbox.window.__ALOCACAO_URL__ = 'https://exemplo.com/exec-alocacao-teste';

  // Dispara a busca da semana 0 (fica em voo) e troca IMEDIATAMENTE para a
  // semana 1, antes dela resolver -- mesmo gesto de um clique duplo rápido
  // num botão de semana, ou um clique seguido de arrependimento.
  const promessaSemana0 = sandbox.selecionarSemanaAlocacao(0);
  const promessaSemana1 = sandbox.selecionarSemanaAlocacao(1);
  assert.strictEqual(resolversGet.length, 2, 'esperava uma busca de rede por troca de semana (GET)');

  // A resposta da semana 0 (a ABANDONADA) chega DEPOIS que o usuário já
  // está olhando a semana 1 -- traz uma equipe alocada num SUP que só fazia
  // sentido pra semana 0.
  resolversGet[0]({
    ok: true,
    json: () => Promise.resolve({
      linhas: [{ equipeId: '4', sup: 'SUP-OLD-DA-SEMANA-0', coluna: 'ST', autor: 'x', atualizadoEm: 'y' }],
    }),
  });
  await promessaSemana0;

  assert.notStrictEqual(
    sandbox.ESTADO_ALOCACAO.alocacao['4'] && sandbox.ESTADO_ALOCACAO.alocacao['4'].sup,
    'SUP-OLD-DA-SEMANA-0',
    'a resposta atrasada da semana ABANDONADA não pode pintar o quadro da semana atual -- é a mesma corrida, com consequência pior (dado de OUTRA semana na tela)'
  );

  // A resposta da semana 1 (a atual) chega por último e é a que deve valer.
  resolversGet[1]({ ok: true, json: () => Promise.resolve({ linhas: [] }) });
  await promessaSemana1;
});

// --- Devolução ao pool (2026-08-11, Decisões 1/2/3 do spec) ------------------
//
// Os gestos não passam por dispatchEvent: test/helpers/dom-falso-semanal.js não
// o implementa (ver os comentários espalhados acima). Os testes chamam as
// funções do sandbox direto, que é como o resto deste arquivo já faz.

function sandboxAlocacao() {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    equipesRosterPeriodo: { ano: 2026, mes: 8 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({
    registros, demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z'),
  });
  return montarSandbox(html);
}

// closest() dos elementos do DOM falso devolve sempre o próprio elemento,
// ignorando o seletor -- inútil para provar que resolverAlvoAlocacao distingue
// célula de pool. Estes stubs respeitam o seletor, que é o ponto do teste.
function alvoStub(classe, attrs) {
  const el = {
    closest: (sel) => (sel === classe ? el : null),
    getAttribute: (a) => (attrs || {})[a] || null,
  };
  return el;
}

test('resolverAlvoAlocacao distingue célula, pool e vazio', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.strictEqual(typeof sandbox.resolverAlvoAlocacao, 'function');

  const celula = alvoStub('.celula-alocacao', { 'data-sup': 'SUP-0001-24', 'data-coluna': 'ST' });
  const alvoCelula = sandbox.resolverAlvoAlocacao({ target: celula });
  assert.strictEqual(alvoCelula.tipo, 'celula');
  assert.strictEqual(alvoCelula.el.getAttribute('data-sup'), 'SUP-0001-24');

  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: alvoStub('.pool-alocacao') }).tipo, 'pool');

  const nada = { closest: () => null };
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: nada }), null,
    'fora de célula e de pool não é alvo nenhum -- soltar no vazio não pode devolver');
});

test('devolver apaga a alocação; soltar no vazio a preserva', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  assert.strictEqual(sandbox.aplicarMovimento('4', 'SUP-0001-24', 'ST'), true);
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'pré-condição: alocada');

  // Soltar no vazio: resolverAlvoAlocacao devolve null, ninguém chama
  // aplicarMovimento, e a alocação sobrevive.
  assert.strictEqual(sandbox.resolverAlvoAlocacao({ target: { closest: () => null } }), null);
  assert.ok(sandbox.ESTADO_ALOCACAO.alocacao['4'], 'soltar no vazio não pode desfazer');

  // Soltar no pool: devolve.
  sandbox.aplicarMovimento('4', '', '');
  assert.strictEqual(sandbox.ESTADO_ALOCACAO.alocacao['4'], undefined);
});

test('o destaque do pool acende só para equipe ALOCADA, e morre na limpeza', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  documentoFalso.registrarCelulasAlocacao(['SP', 'ST']);
  const pool = documentoFalso.poolAlocacao();

  // Equipe no pool: devolver seria no-op, então o pool não acende.
  sandbox.destacarCelulasCompativeis(['ST'], false);
  assert.strictEqual(pool.classes.has('pool-alvo'), false);
  sandbox.limparDestaquesAlocacao();

  // Equipe alocada: acende.
  sandbox.destacarCelulasCompativeis(['ST'], true);
  assert.strictEqual(pool.classes.has('pool-alvo'), true);
  const celulas = documentoFalso.querySelectorAll('.celula-alocacao');
  assert.strictEqual(celulas.filter((c) => c.classes.has('celula-alvo')).length, 1, 'só a coluna ST');
  assert.strictEqual(celulas.filter((c) => c.classes.has('celula-inerte')).length, 1);

  // E a limpeza tem que apagar TUDO -- é o modo de falha da Decisão 3: limpar o
  // pool em outro lugar o deixaria aceso para sempre em um dos quatro caminhos
  // de saída do arrasto.
  sandbox.limparDestaquesAlocacao();
  assert.strictEqual(pool.classes.has('pool-alvo'), false, 'o destaque do pool tem que morrer junto');
  assert.strictEqual(celulas.filter((c) => c.classes.has('celula-alvo')).length, 0);
  assert.strictEqual(celulas.filter((c) => c.classes.has('celula-inerte')).length, 0);
});

test('em somenteLeitura nenhum cartão é arrastável -- nem alocar nem devolver começam', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const demandas = Object.assign({}, DEMANDAS_VAZIAS, {
    equipesCsv: csvEqComOs('CCR RioSP (16925-25)'),
    // Espelho de JULHO com a página em agosto dispara somenteLeitura.
    equipesRosterPeriodo: { ano: 2026, mes: 7 },
    osParaSup: { '16925-25': 'SUP-0001-24' },
  });
  const html = renderAlocacaoPagina({ registros, demandas, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z') });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const secao = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.match(secao, /Somente leitura/);
  assert.doesNotMatch(secao, /data-arrastavel="sim"/);
});


// --- A busca de equipe pelo caminho REAL do listener (2026-08-11) ------------
//
// Este grupo faltava, e a falta custou caro: a busca foi entregue filtrando só
// o pool, e como a semana nasce SEMEADA do realizado o pool fica vazio -- na
// tela, digitar não mudava nada. Os testes de render passavam porque exercitam
// renderAbaAlocacao direto, com uma alocação vazia que a tela real nunca tem.
//
// O DOM falso não implementa dispatchEvent, mas guarda os listeners em
// el.listeners[tipo] -- dá para invocar o handler REAL, que é o que importa.

test('digitar no campo de busca poda a GRADE, não só o pool', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  const secao = documentoFalso.getElementById('secao-alocacao');
  const antes = secao.innerHTML;
  const cartoes = (h) => (h.match(/data-equipe="/g) || []).length;
  const linhas = (h) => (h.match(/data-sup="/g) || []).length;

  assert.ok(cartoes(antes) > 0, 'pré-condição: a semana nasce semeada, com equipe no quadro');
  assert.ok(linhas(antes) > 0, 'pré-condição: há linha na grade');

  const handler = secao.listeners.input;
  assert.strictEqual(typeof handler, 'function');
  handler({ target: { id: 'busca-equipe', value: 'zzzznaoexiste' } });

  const depois = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.strictEqual(cartoes(depois), 0, 'nenhuma equipe casa -- nenhum cartão pode sobrar');
  assert.strictEqual(linhas(depois), 0, 'e a grade tem que esvaziar junto');
});

test('limpar a busca traz o quadro inteiro de volta', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  const secao = documentoFalso.getElementById('secao-alocacao');
  const original = secao.innerHTML;
  const handler = secao.listeners.input;

  handler({ target: { id: 'busca-equipe', value: 'zzzznaoexiste' } });
  handler({ target: { id: 'busca-equipe', value: '' } });

  const voltou = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.strictEqual(voltou, original, 'a poda é de exibição -- limpar restaura tudo');
});

test('o filtro de tipologia da aba recorta as colunas', async () => {
  const { sandbox, documentoFalso } = sandboxAlocacao();
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  await sandbox.selecionarSemanaAlocacao(0);

  const secao = documentoFalso.getElementById('secao-alocacao');
  assert.match(secao.innerHTML, /id="filtro-tipologia-alocacao"/);

  const handler = secao.listeners.change;
  assert.strictEqual(typeof handler, 'function', 'precisa haver listener de change');
  handler({ target: { id: 'filtro-tipologia-alocacao', value: 'PI' } });

  const depois = documentoFalso.getElementById('secao-alocacao').innerHTML;
  assert.doesNotMatch(depois, /data-coluna="ST"/, 'só a coluna escolhida sobrevive');
});
