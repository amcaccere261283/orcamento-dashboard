'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaSemanal } = require('../tools/semanal/render-aba-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');
const { diaEpoch } = require('../tools/comum/datas.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');

// Task 8 originalmente deixou o módulo pronto no bundle mas NUNCA chamado --
// a aba Semanal abria vazia no navegador (achado do coordenador). Este
// arquivo prova o wire-up de verdade: gera a página com renderSemanal, RODA
// os <script> de cliente de dentro dela (gate + bundle + SCRIPT_CLIENTE_SEMANAL)
// num vm.Context à parte, simula a senha certa sendo digitada e confirma que
// #secao-semanal acaba com o HTML exato que renderAbaSemanal(registros
// decifrados, todos os índices, ['financeiro'], vigenteIdx) produz -- não só
// que a <div> existe.
//
// Usa o Web Crypto NATIVO do Node (globalThis.crypto/atob/btoa/TextEncoder/
// TextDecoder, disponíveis sem nenhuma dependência de npm) para rodar o
// MESMO caminho de decifragem (crypto.subtle) que um navegador real
// executaria -- não uma versão simplificada.

// Senha fictícia -- nunca a real (ver CLAUDE.md/instruções do projeto).
const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';

// Os 12 meses da MATRIZ como datas -- em produção vêm do cabeçalho da
// planilha (tools/semanal/build-dashboard.js) e alimentam calcularVigenteIdx
// (tools/comum/datas.js). 2026 é o ano de todos os geradoEm deste arquivo.
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

// A aba Demandas passou a ser obrigatória no payload (renderSemanal lança sem
// ela, de propósito -- ver o comentário lá). Agregado mínimo válido: sem
// tipologia nenhuma, renderAbaDemandas rende o aviso de "sem dado".
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

// Extrai e roda, num Realm isolado (vm.Context), TODOS os <script> inline do
// HTML gerado, na mesma ordem em que um navegador executaria (vigenteIdx,
// dados cifrados, gate, fonteParaCliente, bundle, SCRIPT_CLIENTE_SEMANAL) --
// nenhum reescrito, nenhum resumido. A Task 10 acrescentou o <script> de
// fonteParaCliente() (mediaEquipesPonderada como global, consumida por
// compute-balanco.js dentro do bundle) ANTES do bundle -- por isso 6
// blocos agora, não mais 5. A Task 9 desta fase manteve os 6 blocos (a
// contagem não muda), só engordou o CONTEÚDO deste 4º bloco: agora
// concatena 5 fontes (calculo-equipes, tipologias-avancos, tipologias-lab,
// datas, linha-base) em vez de só calculo-equipes.
// fetchMock (Task 12): injetado como window.fetch pro botão "Atualizar
// dados" (atualizarDadosAoVivoSemanal(), que chama fetch() de dentro do
// bundle de cliente) ter algo pra chamar dentro do vm.Context -- sem
// fetchMock, qualquer teste que dispare o refresh rejeita imediatamente com
// um erro claro, em vez de vazar pra uma tentativa de rede de verdade.
function montarSandbox(html, fetchMock) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocos.length, 6, 'esperava exatamente 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const codigo = blocos.join('\n;\n');

  const documentoFalso = criarDocumentoFalso();
  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    fetch: fetchMock || (() => Promise.reject(new Error('fetch não mockado neste teste'))),
  };
  sandbox.window = sandbox; // window É o global object, como no navegador
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'planejamento-semanal-cliente.js' });
  return { sandbox, documentoFalso };
}

test('depois da senha certa, a aba Semanal é montada de verdade em #secao-semanal -- não fica um <div> vazio', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)

  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  // Antes de rodar qualquer script, a div está mesmo vazia no HTML cru --
  // nada pode estar montado antes da senha (dado de cliente vazaria num
  // Pages público). Se este assert falhasse, seria porque algo tentou
  // montar a tabela em build-time, fora do gate.
  assert.match(html, /<div id="secao-semanal"><\/div>/);

  const { sandbox, documentoFalso } = montarSandbox(html);

  // Simula o usuário digitando a senha certa e clicando "Abrir".
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  assert.equal(typeof sandbox.tentarDesbloquear, 'function', 'tentarDesbloquear precisa existir no escopo global depois de rodar os scripts');
  await sandbox.tentarDesbloquear();

  // Sem erro de senha; gate escondido, conteúdo revelado -- mesmo contrato
  // de scriptDesbloqueio() (../tools/comum/render-shell.js).
  assert.notEqual(documentoFalso.getElementById('gate-senha-erro').style.display, 'block');
  assert.equal(documentoFalso.getElementById('gate-senha').style.display, 'none');
  assert.equal(documentoFalso.getElementById('conteudo-protegido').style.display, '');

  const vigenteIdx = geradoEm.getUTCMonth();
  const indicesTodos = registros.map((_, i) => i);
  // Financeiro agora TAMBÉM ativa Realizado/Tendência quando demandas está
  // presente (mesmo com DEMANDAS_VAZIAS -- porRegistroEventos:{} é um
  // agregado real, ativa a linha com zeros). O lado real (recalcularSemanal)
  // sempre passa demandas + hojeEpoch calculado na hora -- reproduz aqui o
  // MESMO hojeEpoch (mesma fórmula de render-semanal.js) pra bater byte a
  // byte; como porRegistroEventos está vazio, o valor exato de hojeEpoch não
  // muda nenhum número (tudo fecha em zero), só precisa ser um número.
  const agoraDoTeste = new Date();
  const hojeEpochDoTeste = diaEpoch(new Date(Date.UTC(agoraDoTeste.getFullYear(), agoraDoTeste.getMonth(), agoraDoTeste.getDate())));
  const esperado = renderAbaSemanal(registros, indicesTodos, ['financeiro'], vigenteIdx, 2026, { demandas: DEMANDAS_VAZIAS, hojeEpoch: hojeEpochDoTeste });

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.notEqual(htmlMontado, '', '#secao-semanal continua vazia depois da senha certa -- reproduziria exatamente o bug relatado pelo coordenador');
  assert.equal(
    htmlMontado, esperado,
    'o HTML injetado em #secao-semanal precisa ser exatamente o que renderAbaSemanal(registros decifrados, TODOS os índices, ["financeiro"], vigenteIdx) produz -- prova que os argumentos passados batem, não só que ALGUM HTML foi injetado'
  );

  // Prova de conteúdo, não só de igualdade de string: soma dos 2 registros
  // no mês vigente (4000+2000=6000), repartida proporcionalmente aos DIAS
  // de cada semana de julho de 2026 (5 semanas reais: 5+7+7+7+5=31 dias --
  // S2/S3/S4 são semana cheia, 6000x7/31=1.354,84, que o arredondamento
  // inteiro de 2026-08-03 fecha em 1.355) -- formatada em pt-BR -- os mesmos
  // números que um humano abrindo a página veria na tela.
  assert.match(htmlMontado, /S1/);
  assert.match(htmlMontado, />1\.355</, 'S2/S3/S4 (semana cheia de 7 dias) fecham em 1.355 furos previstos');
  assert.match(htmlMontado, />6\.000</, 'a coluna Total fecha exatamente nos 6.000 do mês vigente');
});

test('com a senha errada, a aba Semanal continua vazia -- nunca monta antes de decifrar de verdade', async () => {
  const registros = [registroSintetico('SUP-0003-24', 'Tomador-Sintetico-Delta', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = 'senha-errada-de-teste-tambem-fake';
  await sandbox.tentarDesbloquear();

  assert.equal(documentoFalso.getElementById('gate-senha-erro').style.display, 'block');
  assert.equal(documentoFalso.getElementById('secao-semanal').innerHTML, '', 'com senha errada a tabela não pode ter sido montada em nenhum momento');
});

test('a chamada a RenderAbaSemanal.renderAbaSemanal, com injeção em #secao-semanal, está no código-fonte de recalcularSemanal (prova estática, complementar à prova dinâmica acima)', () => {
  const registros = [registroSintetico('SUP-0005-24', 'Tomador-Sintetico-Zeta', 1000)];
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[5][1]; // 6º <script>: SCRIPT_CLIENTE_SEMANAL
  assert.match(
    scriptCliente,
    /document\.getElementById\('secao-semanal'\)\.innerHTML = RenderAbaSemanal\.renderAbaSemanal\(/
  );
});

test('o HTML cru (antes de rodar qualquer script) nunca contém os identificadores dos registros em texto puro -- só o blob cifrado os carrega', () => {
  const registros = [registroSintetico('SUP-0004-24', 'Tomador-Sintetico-Epsilon', 9999)];
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.doesNotMatch(html, /Tomador-Sintetico-Epsilon/);
  assert.doesNotMatch(html, /Grupo-Sintetico-Beta/);
});

test('com três abas, abrir Demandas esconde as outras duas seções -- alternarAba continua exclusiva', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('aba-demandas').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-demandas').style.display, '');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-balanco').style.display, 'none');

  documentoFalso.getElementById('aba-semanal').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-demandas').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, '');
});

test('filtrar por SUP na barra compartilhada recalcula a aba Semanal só com os registros daquele SUP', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Simula marcar o checkbox de SUP-0001-24 no painel de filtro-sup --
  // painel já populado (opções vêm dos 2 registros), então o checkbox
  // sintético existe; disparar seu 'change' é o mesmo caminho que um clique
  // real percorreria dentro de montarFiltroMulti.
  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxes = painelSup.querySelectorAll('input[type="checkbox"]');
  const checkboxAlfa = checkboxes.filter((c) => c.value === 'SUP-0001-24')[0];
  assert.ok(checkboxAlfa, 'esperava um checkbox pro SUP-0001-24 no painel montado');
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const vigenteIdx = geradoEm.getUTCMonth();
  // Ver comentário equivalente no teste acima -- Financeiro agora ativa
  // Realizado/Tendência com demandas presente, mesmo vazia (porRegistroEventos:{}
  // fecha em zero, mas precisa do MESMO hojeEpoch que o lado real calcula).
  const agoraDoTeste2 = new Date();
  const hojeEpochDoTeste2 = diaEpoch(new Date(Date.UTC(agoraDoTeste2.getFullYear(), agoraDoTeste2.getMonth(), agoraDoTeste2.getDate())));
  const esperado = renderAbaSemanal(registros, [0], ['financeiro'], vigenteIdx, 2026, { demandas: DEMANDAS_VAZIAS, hojeEpoch: hojeEpochDoTeste2 }); // só o índice 0 (SUP-0001-24)
  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.equal(htmlMontado, esperado, 'depois de filtrar por SUP-0001-24, a Tabela semanal deve recalcular só com esse registro, não os 2');

  // Prova de conteúdo: 4000 repartido proporcionalmente aos dias de cada
  // semana de julho (só o SUP-0001-24, 5 semanas reais, 31 dias) --
  // 4000x7/31 = 903,23 -> 903 nas semanas cheias (S3/S4, depois do
  // arredondamento inteiro de 2026-08-03), não 1.355 (que seria 6000x7/31, a
  // soma dos 2 registros sem filtro).
  assert.match(htmlMontado, />903</);
  assert.doesNotMatch(htmlMontado, />1\.355</, 'o registro filtrado fora não pode continuar somando na tabela');
});

test('a soma de todas as semanas do Previsto continua batendo com o mês vigente mesmo com um filtro de recorte ativo, não só sem filtro', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxAlfa = painelSup.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'SUP-0001-24')[0];
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  const numeros = (htmlMontado.match(/<td class="num">([\d.,]+)<\/td>/g) || [])
    .map((td) => td.match(/>([\d.,]+)</)[1])
    .map((n) => Number(n.replace(/\./g, '').replace(',', '.')));
  // As 5 primeiras células numéricas da linha Previsto: S1..S5 (julho de
  // 2026 tem 5 semanas ISO reais, dias [5,7,7,7,5] de 31 no total). 4000
  // (só o SUP-0001-24 depois do filtro) reparte proporcionalmente aos dias
  // de cada semana -- S1/S5 (5 dias) = 4000x5/31 = 645,16, S2/S3/S4 (7 dias)
  // = 4000x7/31 = 903,23 -- e desde 2026-08-03 cada fatia é arredondada pro
  // inteiro pelo maior resto, somando 4000 EXATOS (não "dentro da deriva de
  // arredondamento": a soma agora é exata por construção). O que importa aqui
  // é que a soma bate com o 4000 do mês vigente filtrado, não com os 6000 de
  // antes do filtro.
  const semanasPrevisto = numeros.slice(0, 5);
  assert.deepStrictEqual(semanasPrevisto, [645, 904, 903, 903, 645]);
  const soma = semanasPrevisto.reduce((a, b) => a + b, 0);
  assert.strictEqual(soma, 4000, `soma das semanas (${soma}) precisa fechar exatamente nos 4000 do mês vigente filtrado`);
});

test('Realizado/Tendência aparecem de ponta a ponta quando a dimensão Volume está marcada e demandas.porRegistroEventos tem dado real', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  // tipologias/totais: renderSemanal exige o formato {tipologias, totais}
  // de compute-demandas.js (ver DEMANDAS_VAZIAS acima) -- vazios aqui
  // porque este teste não olha a aba Demandas, só o wire-up de
  // Realizado/Tendência via porRegistroEventos em window.__DEMANDAS__.
  // Datas em julho de 2026 (mês vigente deste teste) -- qualquer dia real
  // desse mês serve, já que o cliente calcula hojeEpoch com o relógio real
  // de quem roda o teste (recalcularSemanal), não com geradoEm.
  const demandas = {
    tipologias: [], totais: {},
    porRegistroEventos: {
      'SUP-0001-24||ST': {
        chegada: [],
        sondagemRealizada: [diaEpoch(new Date(Date.UTC(2026, 6, 5))), diaEpoch(new Date(Date.UTC(2026, 6, 5)))],
        saidaEstoque: [],
      },
    },
  };
  const html = renderSemanal({ registros, baseline: [], demandas, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Marca a dimensão Volume no seletor (Financeiro continua marcado também --
  // seletor-dimensao é multi-select, minimoUm:true, não substitui).
  const painelDimensao = documentoFalso.getElementById('seletor-dimensao-painel');
  const checkboxVolume = painelDimensao.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'volume')[0];
  assert.ok(checkboxVolume, 'esperava um checkbox "volume" no seletor de dimensão');
  checkboxVolume.checked = true;
  checkboxVolume.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.match(htmlMontado, /Demandas Pendentes/, 'a linha nova precisa aparecer no bloco Volume depois de marcar a dimensão');
  assert.doesNotMatch(htmlMontado.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0], /sem-dado/, 'Realizado (Volume) precisa vir preenchido, não sem-dado, com demandas.porRegistroEventos real');
});

test('o HTML da semanal tem o botão "Atualizar dados" e o span de status, com os MESMOS ids que o CSS compartilhado (cssBase) estiliza', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<button id="atualizar-dashboard" type="button">/);
  assert.match(html, /<span id="status-atualizacao" class="status-atualizacao"><\/span>/);
});

test('o HTML da semanal tem o seletor de mês com as 12 opções (Jan..Dez, valores "0".."11")', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<select id="seletor-mes-semanal">/);
  const marcadorAbertura = '<select id="seletor-mes-semanal">';
  const inicioSelect = html.indexOf(marcadorAbertura) + marcadorAbertura.length;
  const fimSelect = html.indexOf('</select>', inicioSelect);
  assert.notStrictEqual(fimSelect, -1, 'esperava um </select> fechando o <select id="seletor-mes-semanal">');
  const trechoSelect = html.slice(inicioSelect, fimSelect);
  const opcoes = [...trechoSelect.matchAll(/<option value="(\d+)">(\w+)<\/option>/g)];
  assert.deepStrictEqual(opcoes.map((m) => m[1]), ['0','1','2','3','4','5','6','7','8','9','10','11']);
  assert.deepStrictEqual(opcoes.map((m) => m[2]), ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']);
});

test('mesSelecionadoIdx nasce clampado em 11 quando window.__VIGENTE_IDX__ vem 12 (ano inteiro no passado)', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2027-01-15T00:00:00Z'); // periodos são de 2026 inteiro -- vigenteIdx = 12
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.strictEqual(sandbox.mesSelecionadoIdx, 11, 'clamp precisa levar 12 pra 11 (Dez), não deixar vigenteIdx inválido passar direto');
  assert.strictEqual(documentoFalso.getElementById('seletor-mes-semanal').value, '11', 'o <select> precisa concordar com mesSelecionadoIdx no primeiro render');
});

test('mesSelecionadoIdx nasce clampado em 0 quando window.__VIGENTE_IDX__ vem -1 (ano inteiro no futuro)', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2025-12-15T00:00:00Z'); // periodos são de 2026 inteiro -- vigenteIdx = -1
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.strictEqual(sandbox.mesSelecionadoIdx, 0, 'clamp precisa levar -1 pra 0 (Jan), não deixar vigenteIdx inválido passar direto');
  assert.strictEqual(documentoFalso.getElementById('seletor-mes-semanal').value, '0', 'o <select> precisa concordar com mesSelecionadoIdx no primeiro render');
});

// Task 12 -- wire-up ponta-a-ponta de atualizarDadosAoVivoSemanal()
// (render-semanal.js, ~linha 576): roda o botão "Atualizar dados" de
// verdade dentro do MESMO vm.Context que os testes acima, com fetch()
// mockado (montarSandbox agora aceita um 2º argumento, ver acima).
//
// atualizarDadosAoVivoSemanal() NÃO devolve a Promise.all() interna (o
// listener de clique não precisa dela) -- não dá pra `await
// sandbox.atualizarDadosAoVivoSemanal()` diretamente, esse await resolveria
// no próximo microtask e a cadeia fetch->text()->parse ainda não teria
// terminado (comprovado à parte: um `await` sobre uma função que dispara
// uma Promise sem devolvê-la adianta o continuation da função-mãe antes do
// .then() interno rodar). Como o fetchMock abaixo resolve tudo de forma
// síncrona (sem I/O real, sem setTimeout), um único boundary de macrotask
// (setImmediate) garante que toda a cadeia de microtasks já esvaziou antes
// de checarmos o resultado.
function chamarEsperarAtualizacao(sandbox) {
  sandbox.atualizarDadosAoVivoSemanal();
  return new Promise((resolve) => setImmediate(resolve));
}

// ATUALIZADO em 2026-08-03: as duas URLs saíram do placeholder (o Apps
// Script do Avanço Sond foi publicado), então este teste passou a FORÇAR o
// estado degradado no sandbox em vez de herdá-lo do código. O caminho
// continua valendo: se a Sheet espelho for despublicada, ou a publicação de
// uma das abas for desfeita, é assim que a página tem que se comportar --
// atualiza o que dá e diz o que ficou de fora, em vez de falhar inteira.
test('atualizarDadosAoVivoSemanal: com URL_ESPELHO_AVANCOS_SEMANAL/LAB no placeholder, atualiza só a MATRIZ e deixa window.__DEMANDAS__ intocado', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [{ chave: 'SUP-0001-24||ST', previstoInicial: {} }], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const csvMatriz = 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + 'Origem-B,Grupo-B,Tomador-Novo,SUP-0002-25,Escopo,Apoio,01/2026,12/2026,ST,P,'
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,9999,'
    + Array(12).fill('0').join(',') + ',100,100,\n'
    + ',,,,,,,,,T,'
    + Array(12).fill('0').join(',') + ',0,0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,\n';

  // fetchMock só precisa responder à MATRIZ -- se atualizarDadosAoVivoSemanal
  // tentar buscar as URLs placeholder (bug que esta task corrige), este mock
  // rejeitaria com 'fetch não mockado' e o teste falharia de propósito.
  const fetchMock = (url) => url.indexOf('pub?gid=609773455') !== -1
    ? Promise.resolve({ ok: true, text: () => Promise.resolve(csvMatriz) })
    : Promise.reject(new Error('não deveria buscar Avanços/Lab com as URLs ainda placeholder: ' + url));

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Volta as duas ao placeholder -- mesmo mecanismo (e mesma justificativa)
  // que o teste do caminho completo usa para o contrário: `var URL_ESPELHO_...`
  // vira propriedade do global do vm.Context, então sobrescrever aqui é o que
  // atualizarDadosAoVivoSemanal() lê ao checar RE_URL_PENDENTE.
  sandbox.URL_ESPELHO_AVANCOS_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-AVANCOS';
  sandbox.URL_ESPELHO_LAB_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-LAB';

  const baselineAntes = sandbox.window.__BASELINE__;
  const demandasAntes = sandbox.window.__DEMANDAS__;
  await chamarEsperarAtualizacao(sandbox);

  assert.strictEqual(sandbox.window.__REGISTROS__.length, 1, 'registros novos vieram só do CSV da MATRIZ mockado');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].sup, 'SUP-0002-25');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].previsto.volumeResumo.ticket, 9999, 'TICKET novo precisa aparecer -- é a motivação original desta feature, e continua funcionando mesmo com Avanços/Lab pendentes');
  assert.strictEqual(sandbox.window.__BASELINE__, baselineAntes, 'baseline não pode ser tocado pelo refresh');
  assert.strictEqual(sandbox.window.__DEMANDAS__, demandasAntes, 'sem Avanços/Lab configurados, __DEMANDAS__ tem que ficar exatamente como estava -- nunca zerado nem recalculado com dado incompleto');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Atualizado \(só MATRIZ\) às \d{2}:\d{2} -- Avanços\/Lab pendente de configuração do Apps Script$/);
});

test('atualizarDadosAoVivoSemanal: com URL_ESPELHO_AVANCOS_SEMANAL/LAB já configuradas (não mais placeholder), busca os 3 CSVs, substitui window.__REGISTROS__/window.__DEMANDAS__ (sem tocar window.__BASELINE__), remonta filtros e re-renderiza a aba ativa', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [{ chave: 'SUP-0001-24||ST', previstoInicial: {} }], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const csvMatriz = 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + 'Origem-B,Grupo-B,Tomador-Novo,SUP-0002-25,Escopo,Apoio,01/2026,12/2026,ST,P,'
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,9999,'
    + Array(12).fill('0').join(',') + ',100,100,\n'
    // parseMatrizCliente (tools/semanal/parse-matriz-cliente.js) só empurra
    // um registro pra fora no BASE 'T' -- uma linha 'P' sozinha fica presa
    // em `atual` e nunca chega a `registros` (comprovado à parte). A MATRIZ
    // real sempre tem as 3 linhas físicas (P/R/T); aqui bastam P+T (R é
    // opcional no parser).
    + ',,,,,,,,,T,'
    + Array(12).fill('0').join(',') + ',0,0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,\n';
  // parseAvancos/parseLab (tools/semanal/parse-avancos.js, parse-lab.js)
  // leem o cabeçalho em grid[1], não grid[0] -- quem faz esse deslocamento
  // agora é gridCsvComoXlsx() (render-semanal.js), não um '\n' sintético no
  // começo do CSV mockado. Estes dois CSVs trazem UMA linha de dado real cada
  // (as 9 colunas obrigatórias de Avanços, as 3 de Lab), pra este teste de
  // sucesso exercitar os dois parsers com dado de verdade em vez de só
  // cabeçalho -- sem isso, um desalinhamento de índice passaria despercebido.
  // Datas em serial Excel (46091 = 2026-03-10, 46093 = 2026-03-12,
  // 46114 = 2026-04-02, 46117 = 2026-04-05): o fallback pra texto dd/MM/yyyy
  // de dataSaneada é coberto pelos testes unitários de cada parser.
  // "Inicio Sondagem" e "Sondador" entraram em 2026-08-03 (equipes
  // mobilizadas, ver compute-equipes-mobilizadas.js) -- são obrigatórias no
  // parser, então precisam existir aqui ou locateColunasAvancos lança.
  const csvAvancos = 'Contrato,Criação da OS,Tipo,Status,Termino Sondagem,Conclusão,Cancelamento,Atualizado,Observações de Campo,Inicio Sondagem,Sondador,OS\n'
    + 'SUP-0002-25,46091,SP,CONCLUIDO,46093,46114,,46117,,46091,Sondador Sintético,17851-26\n';
  const csvLab = 'ID Contrato,Concluído Dia,Tipo de Ensaio\n'
    + 'SUP-0002-25,46091,LL\n';

  // URLs fictícias, só pra deixarem de bater no padrão RE_URL_PENDENTE
  // (render-semanal.js) -- é isso que liga o caminho completo de 3 fontes.
  const fetchMock = (url) => {
    const texto = url.indexOf('pub?gid=609773455') !== -1 ? csvMatriz
      : url.indexOf('avancos-configurado-teste') !== -1 ? csvAvancos
      : csvLab;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(texto) });
  };

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  // Mesmo padrão do teste de wireup original (linha ~78 acima): digita a
  // senha certa em #campo-senha e chama tentarDesbloquear() diretamente --
  // não existe #senha-input nem #form-desbloqueio/evento 'submit' neste
  // HTML (scriptDesbloqueio() em tools/comum/render-shell.js usa um botão
  // com addEventListener('click', tentarDesbloquear), não um <form>).
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Simula o dia em que o dono do projeto já publicou o Apps Script e trocou
  // os dois placeholders pelas URLs reais -- `var URL_ESPELHO_...` no topo do
  // script vira propriedade do objeto global do vm.Context (sandbox.window
  // === sandbox), então sobrescrever aqui muda o valor que
  // atualizarDadosAoVivoSemanal() lê na hora de checar RE_URL_PENDENTE.
  sandbox.URL_ESPELHO_AVANCOS_SEMANAL = 'https://exemplo.com/avancos-configurado-teste.csv';
  sandbox.URL_ESPELHO_LAB_SEMANAL = 'https://exemplo.com/lab-configurado-teste.csv';

  const baselineAntes = sandbox.window.__BASELINE__;
  await chamarEsperarAtualizacao(sandbox);

  assert.strictEqual(sandbox.window.__REGISTROS__.length, 1, 'registros novos vieram só do CSV da MATRIZ mockado');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].sup, 'SUP-0002-25');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].previsto.volumeResumo.ticket, 9999, 'TICKET novo precisa aparecer -- é a motivação original desta feature');
  assert.strictEqual(sandbox.window.__BASELINE__, baselineAntes, 'baseline não pode ser tocado pelo refresh');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Atualizado às \d{2}:\d{2}$/);

  // O agregado tem que refletir o dado dos CSVs de Avanços/Lab, não ficar
  // vazio: tipologias/totais provam que parseAvancos rodou alinhado (uma
  // grade desalinhada daria zeros em tudo, com o status ainda dizendo
  // "Atualizado"), e porRegistroEventos prova que o ensaio de Lab chegou.
  const demandas = sandbox.window.__DEMANDAS__;
  assert.ok(demandas.tipologias.length > 0, '__DEMANDAS__ precisa ter tipologias');
  assert.strictEqual(demandas.totais.chegadas.reduce((a, b) => a + b, 0), 1, 'a única linha de Avanços tem que virar 1 chegada no ano');
  assert.strictEqual(demandas.totais.sondagemRealizada.reduce((a, b) => a + b, 0), 1, 'a linha CONCLUIDO com Termino Sondagem tem que virar 1 sondagem realizada');
  assert.ok(Object.keys(demandas.porRegistroEventos).length > 0, 'porRegistroEventos precisa ter entrada -- é o que alimenta Realizado/Tendência da Tabela Semanal (furos + ensaios de Lab)');
});

test('atualizarDadosAoVivoSemanal: se qualquer um dos 3 fetches falhar, window.__REGISTROS__ NÃO muda e o status mostra o erro', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const fetchMock = (url) => url.indexOf('pub?gid=609773455') !== -1
    ? Promise.resolve({ ok: false, status: 500 })
    : Promise.resolve({ ok: true, text: () => Promise.resolve('') });

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const registrosAntes = sandbox.window.__REGISTROS__;
  await chamarEsperarAtualizacao(sandbox);

  assert.strictEqual(sandbox.window.__REGISTROS__, registrosAntes, 'uma falha em QUALQUER fetch não pode trocar os registros -- tudo ou nada');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Falha ao atualizar: /);
  assert.ok(documentoFalso.getElementById('status-atualizacao').classList.contains('status-erro'));
});

test('atualizarDadosAoVivoSemanal NÃO reseta o mês selecionado pro vigente -- se o usuário estava olhando outro mês, o refresh preserva a escolha', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const csvMatriz = 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + 'Origem-C,Grupo-C,Tomador-Teste,SUP-0003-26,Escopo,Apoio,01/2026,12/2026,ST,P,'
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,5000,'
    + Array(12).fill('0').join(',') + ',100,100,\n'
    + ',,,,,,,,,T,'
    + Array(12).fill('0').join(',') + ',0,0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,\n';

  const fetchMock = (url) => url.indexOf('pub?gid=609773455') !== -1
    ? Promise.resolve({ ok: true, text: () => Promise.resolve(csvMatriz) })
    : Promise.reject(new Error('não deveria buscar Avanços/Lab com as URLs ainda placeholder: ' + url));

  const { sandbox, documentoFalso } = montarSandbox(html, fetchMock);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Placeholder forçado: este teste é sobre mesSelecionadoIdx, não sobre as
  // fontes -- com só a MATRIZ mockada, o caminho degradado mantém o cenário
  // mínimo (ver o teste do modo degradado acima, mesma técnica).
  sandbox.URL_ESPELHO_AVANCOS_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-AVANCOS';
  sandbox.URL_ESPELHO_LAB_SEMANAL = 'PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-LAB';

  // Usuário troca pra março (índice 2) ANTES de clicar em Atualizar dados.
  sandbox.mesSelecionadoIdx = 2;

  // O refresh atualiza os registros da MATRIZ e recalcula a aba ativa.
  // Este teste prova que mesSelecionadoIdx não é tocado neste fluxo --
  // se fosse resetado pro vigente (regressão), o usuário perderia a escolha
  // de mês que fez antes de clicar em "Atualizar dados".
  await chamarEsperarAtualizacao(sandbox);

  // Confirma que o refresh de fato completou pelo caminho de sucesso (só
  // MATRIZ) -- sem isto, se o mock saísse de sincronia e o refresh caísse
  // no .catch de erro, mesSelecionadoIdx continuaria 2 (nunca tocado) e o
  // teste passaria verde sem ter exercitado o fluxo que diz proteger.
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Atualizado \(só MATRIZ\) às /);
  assert.strictEqual(sandbox.mesSelecionadoIdx, 2, 'mesSelecionadoIdx não pode ser resetado pelo refresh de dados');
});

test('trocar o <select> de mês recalcula a Tabela Semanal com as semanas do mês escolhido, não mais o vigente', async () => {
  // Julho e Agosto de 2026 têm quebras de semana DIFERENTES (números de
  // semana distintos) -- comparar o número de semanas renderizadas entre os
  // dois é prova suficiente de que o mês realmente mudou, sem precisar
  // recalcular a mão o Previsto esperado de cada um.
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const semanalAntes = documentoFalso.getElementById('secao-semanal').innerHTML;
  // renderCabecalho (tools/semanal/render-aba-semanal.js) emite um <th> por
  // semana com o rótulo "S<n> (dd/mm a dd/mm)", sem classe nenhuma -- contar
  // quantos <th>S\d aparecem é uma prova mais direta de que o número real de
  // semanas mudou (julho e agosto de 2026 não têm a mesma quantidade) do que
  // inventar uma classe CSS que o HTML real não tem.
  const semanasNoHtml = (html) => (html.match(/<th>S\d+ /g) || []).length;
  const colunasJulho = semanasNoHtml(semanalAntes);

  // test/helpers/dom-falso-semanal.js não implementa dispatchEvent -- o
  // padrão já estabelecido no repositório (ver test/comum-filtros-wireup.test.js,
  // test/semanal-render-aba-demandas-wireup.test.js) é chamar o listener
  // guardado em `.listeners.change` direto, com um evento sintético mínimo.
  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } }); // Agosto

  assert.strictEqual(sandbox.mesSelecionadoIdx, 7, 'mesSelecionadoIdx precisa refletir a escolha do usuário');
  const semanalDepois = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.notStrictEqual(semanalDepois, semanalAntes, 'a Tabela Semanal precisa ter sido redesenhada de verdade, não só o estado interno mudado');
  assert.notStrictEqual(semanasNoHtml(semanalDepois), colunasJulho, 'julho e agosto de 2026 têm quantidades de semana diferentes -- se o número bater, o mês não mudou de verdade');
});

test('trocar o mês no seletor redesenha TAMBÉM a aba Balanço de massa, não só a Tabela e os Gráficos', async () => {
  // Até 2026-08-03 a aba Balanço ficava presa a window.__VIGENTE_IDX__: trocar
  // o mês mudava três abas e deixava a quarta descrevendo outro período, sem
  // nada na tela dizendo isso. Duas coisas provam que ela seguiu o seletor:
  // o número muda, e as semanas do recorte passam a ser as do mês escolhido.
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const geradoEm = new Date('2026-07-15T00:00:00Z'); // vigenteIdx = 6 (julho, 5 semanas)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const caixasDe = () => (documentoFalso.getElementById('secao-balanco').innerHTML.match(/class="balanco-semana"/g) || []).length;
  assert.strictEqual(caixasDe(), 5, 'pré-condição: julho/2026 tem 5 semanas');

  // Agosto/2026 tem 6 semanas (S1 com 2 dias, S6 com 1) -- é justamente esse
  // calendário irregular que denuncia se a aba tivesse ficado no mês antigo.
  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } });

  assert.strictEqual(sandbox.mesSelecionadoIdx, 7);
  assert.strictEqual(caixasDe(), 6, 'o recorte semanal precisa passar a descrever agosto, com 6 semanas');
});

// --- Botão "Limpar filtros" (2026-08-03) ---------------------------------
// A semanal não tinha o botão que o orçamento já tinha; quem estreitava o
// recorte em 5 painéis diferentes precisava desmarcar tudo à mão.

test('o HTML da semanal tem o botão "Limpar filtros" com o MESMO id que o CSS compartilhado (cssBase) já estiliza', () => {
  const html = renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.match(html, /<button id="limpar-filtros" type="button">/);
  assert.match(html, /Limpar filtros<\/button>/);
});

test('clicar em "Limpar filtros" desmarca os recortes da barra, volta a dimensão pra Financeiro e redesenha a Tabela Semanal com todos os registros', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const semanalCompleta = documentoFalso.getElementById('secao-semanal').innerHTML;

  // Estreita por SUP E troca a dimensão -- os dois tipos de filtro da barra
  // (recorte e minimoUm) precisam voltar, não só um deles.
  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxAlfa = painelSup.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'SUP-0001-24')[0];
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();
  const painelDimensao = documentoFalso.getElementById('seletor-dimensao-painel');
  const checkboxVolume = painelDimensao.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'volume')[0];
  checkboxVolume.checked = true;
  checkboxVolume.listeners.change();

  assert.strictEqual(sandbox.filtrosSelecionadosSemanal.sup.size, 1, 'pré-condição: o filtro de SUP está estreitado');
  assert.ok(sandbox.filtrosSelecionadosSemanal.dimensao.has('volume'), 'pré-condição: Volume entrou na dimensão');
  assert.notStrictEqual(documentoFalso.getElementById('secao-semanal').innerHTML, semanalCompleta);

  documentoFalso.getElementById('limpar-filtros').listeners.click();

  assert.strictEqual(sandbox.filtrosSelecionadosSemanal.sup.size, 0, 'o recorte de SUP tem que voltar a vazio ("nada marcado = tudo")');
  assert.deepStrictEqual(Array.from(sandbox.filtrosSelecionadosSemanal.dimensao), ['financeiro'],
    'a dimensão é minimoUm:true -- não pode ficar vazia, volta pro padrão Financeiro');
  assert.strictEqual(documentoFalso.getElementById('secao-semanal').innerHTML, semanalCompleta,
    'depois de limpar, a Tabela Semanal precisa voltar a ser exatamente a de antes do filtro -- não basta zerar o estado interno');
});

test('"Limpar filtros" NÃO mexe no mês selecionado -- é navegação, não recorte', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } });
  documentoFalso.getElementById('limpar-filtros').listeners.click();

  assert.strictEqual(sandbox.mesSelecionadoIdx, 7, 'quem estava olhando agosto continua em agosto depois de limpar os filtros');
});

// --- Aba Alertas (2026-08-03) --------------------------------------------
// Porte da aba Alertas do orçamento, com os períodos trocados por semanas.
// Estes testes provam o WIRE-UP (o módulo existe no bundle, é chamado, e a
// tabela sai preenchida); a lógica em si está em
// test/semanal-render-aba-alertas.test.js.

test('o HTML tem a aba Alertas, a seção escondida, os 5 filtros próprios e a tabela vazia -- nada montado antes da senha', () => {
  const html = renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.match(html, /<button id="aba-alertas" type="button">/);
  assert.match(html, /Alertas<\/button>/);
  assert.match(html, /<div id="secao-alertas" style="display:none">/);
  ['agrupar-por', 'numerico', 'baseline', 'periodo', 'status'].forEach((chave) => {
    assert.match(html, new RegExp('id="filtro-alertas-' + chave + '"'), 'esperava o filtro ' + chave + ' na aba Alertas');
  });
  assert.match(html, /<input id="busca-alertas"/);
  assert.match(html, /<thead id="cabecalho-alertas"><\/thead>/);
  assert.match(html, /<tbody id="corpo-alertas"><\/tbody>/);
});

test('depois da senha, a aba Alertas é preenchida com o semáforo, e abrir Alertas esconde as outras quatro seções', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const corpo = documentoFalso.getElementById('corpo-alertas').innerHTML;
  assert.notStrictEqual(corpo, '', '#corpo-alertas continua vazio depois da senha -- o módulo está no bundle mas nunca é chamado');
  assert.match(corpo, /status-circulo/, 'cada linha precisa do círculo de status do semáforo');
  assert.match(corpo, /SUP-0001-24/);
  assert.match(corpo, /TOTAL GERAL/);
  assert.match(documentoFalso.getElementById('cabecalho-alertas').innerHTML, /<th>SUP<\/th>/);

  documentoFalso.getElementById('aba-alertas').listeners.click();
  assert.strictEqual(documentoFalso.getElementById('secao-alertas').style.display, '');
  ['secao-semanal', 'secao-grafico-semanal', 'secao-balanco', 'secao-demandas'].forEach((id) => {
    assert.strictEqual(documentoFalso.getElementById(id).style.display, 'none', id + ' devia estar escondida com a aba Alertas ativa');
  });
});

test('as opções de PERÍODO da aba Alertas são as semanas do mês selecionado, e acompanham a troca de mês', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'), // julho: 5 semanas
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const valoresPeriodo = () => documentoFalso.getElementById('filtro-alertas-periodo-painel')
    .querySelectorAll('input[type="checkbox"]').map((c) => c.value);

  assert.deepStrictEqual(valoresPeriodo(), ['s1', 's2', 's3', 's4', 's5', 'acumuladoAteSemanaAtual', 'mesInteiro']);
  const painelJulho = documentoFalso.getElementById('filtro-alertas-periodo-painel').innerHTML;
  assert.match(painelJulho, /S1 \(01\/07 a 05\/07\)/, 'o rótulo carrega as datas reais -- "S1" sozinho não distingue julho de agosto');

  // Agosto/2026 tem 6 semanas -- é o calendário irregular que denuncia se as
  // opções tivessem ficado no mês antigo.
  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } });
  assert.deepStrictEqual(valoresPeriodo(), ['s1', 's2', 's3', 's4', 's5', 's6', 'acumuladoAteSemanaAtual', 'mesInteiro']);
  assert.match(documentoFalso.getElementById('filtro-alertas-periodo-painel').innerHTML, /S1 \(01\/08 a 02\/08\)/);
});

test('um "S6" marcado em agosto não sobrevive à volta pra julho, e o filtro nunca fica sem período nenhum (minimoUm)', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } }); // agosto, 6 semanas

  // Marca S6 e desmarca os dois padrões -- deixa o Set SÓ com um período que
  // não existe em julho, que é o caso que esvaziaria o filtro na volta.
  const painel = documentoFalso.getElementById('filtro-alertas-periodo-painel');
  const caixa = (valor) => painel.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === valor)[0];
  caixa('s6').checked = true;
  caixa('s6').listeners.change();
  ['acumuladoAteSemanaAtual', 'mesInteiro'].forEach((v) => {
    caixa(v).checked = false;
    caixa(v).listeners.change();
  });
  assert.deepStrictEqual(Array.from(sandbox.filtrosAlertasSemanal.periodo), ['s6']);

  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '6' } }); // julho, 5 semanas

  const restantes = Array.from(sandbox.filtrosAlertasSemanal.periodo);
  assert.ok(!restantes.includes('s6'), 'S6 não existe em julho -- não pode continuar marcado');
  assert.deepStrictEqual(restantes, ['acumuladoAteSemanaAtual', 'mesInteiro'],
    'esvaziar um filtro minimoUm deixaria a aba sem coluna nenhuma e sem como voltar -- os padrões têm que ser readicionados');
  assert.notStrictEqual(documentoFalso.getElementById('corpo-alertas').innerHTML, '');
});

test('filtrar por SUP na barra compartilhada TAMBÉM recalcula a aba Alertas -- é o bug que o orçamento já teve', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.match(documentoFalso.getElementById('corpo-alertas').innerHTML, /SUP-0002-24/);

  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxAlfa = painelSup.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'SUP-0001-24')[0];
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const corpo = documentoFalso.getElementById('corpo-alertas').innerHTML;
  assert.match(corpo, /SUP-0001-24/);
  assert.doesNotMatch(corpo, /SUP-0002-24/, 'o SUP filtrado fora não pode continuar aparecendo nos Alertas');
});

test('a busca da aba Alertas esconde as linhas que não combinam, sem refazer o cálculo', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const busca = documentoFalso.getElementById('busca-alertas');
  busca.value = 'SUP-0002';
  busca.listeners.input();

  const linhas = documentoFalso.querySelectorAll('#tabela-alertas tbody tr');
  assert.ok(linhas.length > 0, 'pré-condição: a tabela tem linhas renderizadas');
  linhas.forEach((tr) => {
    const combina = (tr.dataset.search || '').indexOf('sup-0002') !== -1;
    assert.strictEqual(tr.style.display, combina ? '' : 'none');
  });
});

// --- Aba CONSOLIDADO (2026-08-03) ----------------------------------------
// A abertura de linhas da Tabela do orçamento, mas com os números de UMA
// semana. A lógica está em test/semanal-render-aba-consolidado.test.js; aqui
// se prova o wire-up e o estado dos 2 controles próprios da aba.

test('o HTML tem a aba Consolidado e a seção escondida, vazia antes da senha', () => {
  const html = renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
  assert.match(html, /<button id="aba-consolidado" type="button">/);
  assert.match(html, /Consolidado<\/button>/);
  assert.match(html, /<div id="secao-consolidado" style="display:none"><\/div>/);
});

test('depois da senha a aba Consolidado é montada, abre em Volume e esconde as outras cinco seções quando ativada', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const secao = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.notStrictEqual(secao, '', '#secao-consolidado continua vazia depois da senha -- o módulo está no bundle mas nunca é chamado');
  assert.match(secao, /<table id="tabela-consolidado">/);
  assert.match(secao, /TOTAL GERAL/);
  assert.match(secao, /Equipes previstas/, 'abre em Volume, então as colunas físicas aparecem');
  assert.doesNotMatch(secao, /Ticket médio/);

  documentoFalso.getElementById('aba-consolidado').listeners.click();
  assert.strictEqual(documentoFalso.getElementById('secao-consolidado').style.display, '');
  ['secao-semanal', 'secao-grafico-semanal', 'secao-balanco', 'secao-demandas', 'secao-alertas'].forEach((id) => {
    assert.strictEqual(documentoFalso.getElementById(id).style.display, 'none', id + ' devia estar escondida com a aba Consolidado ativa');
  });
});

test('trocar a dimensão do Consolidado pra Financeiro troca as colunas de premissa, sem misturar físico e financeiro', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('consolidado-dimensao').listeners.change({ target: { value: 'financeiro' } });

  const secao = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.match(secao, /Ticket médio previsto/);
  assert.doesNotMatch(secao, /Equipes previstas/);
  assert.doesNotMatch(secao, /Produtividade/);
  assert.strictEqual(sandbox.ESTADO_CONSOLIDADO.dimensao, 'financeiro');
});

test('a aba Consolidado abre na semana EM CURSO do mês selecionado, não em S1', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // "Hoje" é o relógio de quem roda o teste, então o índice esperado é
  // derivado da mesma regra (última semana que já começou), não fixado num
  // número -- fixar quebraria o teste em toda semana que passasse.
  const semanas = semanasDoMes(2026, sandbox.mesSelecionadoIdx);
  const agora = new Date();
  const hoje = diaEpoch(new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())));
  let elapsadas = 0;
  semanas.forEach((s) => { if (s.inicio <= hoje) elapsadas++; });
  const esperado = elapsadas > 0 ? elapsadas - 1 : 0;

  const secao = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.match(secao, new RegExp('<option value="' + esperado + '" selected>'));
});

test('uma semana escolhida à mão volta ao automático se o mês novo não tiver aquela semana -- nunca aponta pra uma que não existe', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '7' } }); // agosto, 6 semanas
  documentoFalso.getElementById('consolidado-semana').listeners.change({ target: { value: '5' } }); // S6
  assert.strictEqual(sandbox.ESTADO_CONSOLIDADO.semana, 5);
  assert.match(documentoFalso.getElementById('secao-consolidado').innerHTML, /<option value="5" selected>/);

  documentoFalso.getElementById('seletor-mes-semanal').listeners.change({ target: { value: '6' } }); // julho, 5 semanas

  assert.strictEqual(sandbox.ESTADO_CONSOLIDADO.semana, null, 'S6 não existe em julho -- volta ao automático em vez de clampar em S5 como se tivesse sido escolhida');
  const opcoesSelecionadas = documentoFalso.getElementById('secao-consolidado').innerHTML.match(/<option value="(\d)" selected>/g) || [];
  assert.strictEqual(opcoesSelecionadas.length, 1, 'o <select> de semana precisa ter exatamente uma opção marcada');
});

test('filtrar por SUP na barra compartilhada TAMBÉM recalcula o Consolidado', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000),
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Gama', 2000),
  ];
  const html = renderSemanal({
    registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  });
  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.match(documentoFalso.getElementById('secao-consolidado').innerHTML, /SUP-0002-24/);

  const painelSup = documentoFalso.getElementById('filtro-sup-painel');
  const checkboxAlfa = painelSup.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'SUP-0001-24')[0];
  checkboxAlfa.checked = true;
  checkboxAlfa.listeners.change();

  const secao = documentoFalso.getElementById('secao-consolidado').innerHTML;
  assert.match(secao, /SUP-0001-24/);
  assert.doesNotMatch(secao, /SUP-0002-24/, 'o SUP filtrado fora não pode continuar aparecendo no Consolidado');
});

// --- Bloco "Alertas de tendência" (2026-08-04) ---------------------------
// Liga render-alertas-tendencia.js (Task 5, já testado sozinho) na aba
// Alertas: markup, bundle e o recálculo que preenche o bloco. A lógica dos
// dois diagnósticos está coberta à parte
// (test/semanal-render-alertas-tendencia.test.js); aqui só o wire-up.

// O HTML cru basta aqui: estes três testes olham markup e ordem de bundle,
// não precisam do vm.Context que montarSandbox arma para os testes de
// wire-up.
function paginaCrua() {
  return renderSemanal({
    registros: [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)],
    baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
  });
}

test('a aba Alertas tem o bloco de tendencia, com cabecalho e corpo proprios', () => {
  const html = paginaCrua();
  assert.ok(html.indexOf('id="cabecalho-alertas-tendencia"') !== -1);
  assert.ok(html.indexOf('id="corpo-alertas-tendencia"') !== -1);
  assert.ok(html.indexOf('Alertas de tendência') !== -1);
});

test('render-alertas-tendencia.js entra no bundle DEPOIS de tudo que ele consome', () => {
  const html = paginaCrua();
  const pos = (nome) => html.indexOf("MODULOS['" + nome + "']");
  ['compute-tendencia-semanal.js', 'compute-alertas-tendencia.js', 'render-aba-semanal.js',
   'render-aba-alertas.js', 'render-aba-consolidado.js', 'compute-semanal.js'].forEach((dep) => {
    assert.ok(pos(dep) !== -1, dep + ' precisa estar no bundle');
    assert.ok(pos(dep) < pos('render-alertas-tendencia.js'), dep + ' tem de vir antes de render-alertas-tendencia.js');
  });
});

test('o recalculo da aba Alertas preenche o bloco novo', () => {
  assert.ok(/getElementById\('corpo-alertas-tendencia'\)\.innerHTML/.test(paginaCrua()));
});
