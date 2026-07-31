'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaSemanal } = require('../tools/semanal/render-aba-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');
const { diaEpoch } = require('../tools/comum/datas.js');

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
  // no mês vigente (4000+2000=6000), dividida em 5 semanas (1200 cada) --
  // julho de 2026 tem 5 semanas ISO reais, não 4 -- formatada em pt-BR --
  // os mesmos números que um humano abrindo a página veria na tela.
  const seiscentos = (6000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const milEDuzentos = (1200).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(htmlMontado, /S1/);
  assert.match(htmlMontado, new RegExp(milEDuzentos.replace(/\./g, '\\.')));
  assert.match(htmlMontado, new RegExp(seiscentos.replace(/\./g, '\\.')));
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

  // Prova de conteúdo: 4000 ÷ 5 = 800 por semana (só o SUP-0001-24, 5
  // semanas reais de julho), não 1200 (que seria 6000 ÷ 5, a soma dos 2
  // registros sem filtro).
  const oitocentos = (800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(htmlMontado, new RegExp(oitocentos.replace(/\./g, '\\.')));
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
  // 2026 tem 5 semanas ISO reais). Cada uma deve ser 800 (4000 ÷ 5, só o
  // SUP-0001-24 depois do filtro), e a soma das 5 deve bater com o 4000 do
  // mês vigente filtrado -- não com os 6000 de antes do filtro.
  const semanasPrevisto = numeros.slice(0, 5);
  assert.deepStrictEqual(semanasPrevisto, [800, 800, 800, 800, 800]);
  assert.strictEqual(semanasPrevisto.reduce((a, b) => a + b, 0), 4000);
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

test('atualizarDadosAoVivoSemanal: busca os 3 CSVs, substitui window.__REGISTROS__/window.__DEMANDAS__ (sem tocar window.__BASELINE__), remonta filtros e re-renderiza a aba ativa', async () => {
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
  // leem o cabeçalho em grid[1], não grid[0] -- mesmo formato de 2 linhas
  // antes do dado que a planilha real (Avanço Sond.xlsx) tem. Por isso a
  // linha em branco antes do cabeçalho abaixo -- sem ela, locateColunas...
  // lança "Coluna não encontrada" (comprovado à parte) e este teste de
  // SUCESSO cairia no branch de erro.
  const csvVazio = '\n' + 'Contrato,Criação da OS,Tipo,Status,Termino Sondagem,Conclusão,Cancelamento,Atualizado,Observações de Campo\n';
  const csvLabVazio = '\n' + 'ID Contrato,Concluído Dia,Tipo de Ensaio\n';

  const fetchMock = (url) => {
    const texto = url.indexOf('pub?gid=609773455') !== -1 ? csvMatriz
      : url.indexOf('PENDENTE-AGUARDANDO-PUBLICACAO-DO-APPS-SCRIPT-AVANCOS') !== -1 ? csvVazio
      : csvLabVazio;
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

  const baselineAntes = sandbox.window.__BASELINE__;
  await chamarEsperarAtualizacao(sandbox);

  assert.strictEqual(sandbox.window.__REGISTROS__.length, 1, 'registros novos vieram só do CSV da MATRIZ mockado');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].sup, 'SUP-0002-25');
  assert.strictEqual(sandbox.window.__REGISTROS__[0].previsto.volumeResumo.ticket, 9999, 'TICKET novo precisa aparecer -- é a motivação original desta feature');
  assert.strictEqual(sandbox.window.__BASELINE__, baselineAntes, 'baseline não pode ser tocado pelo refresh');
  assert.match(documentoFalso.getElementById('status-atualizacao').textContent, /^Atualizado às \d{2}:\d{2}$/);
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
