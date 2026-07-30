'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaSemanal } = require('../tools/semanal/render-aba-semanal.js');

// Task 8 originalmente deixou o módulo pronto no bundle mas NUNCA chamado --
// a aba Semanal abria vazia no navegador (achado do coordenador). Este
// arquivo prova o wire-up de verdade: gera a página com renderSemanal, RODA
// os <script> de cliente de dentro dela (gate + bundle + SCRIPT_CLIENTE_SEMANAL)
// num vm.Context à parte, simula a senha certa sendo digitada e confirma que
// #secao-semanal acaba com o HTML exato que renderAbaSemanal(registros
// decifrados, todos os índices, 'financeiro', vigenteIdx) produz -- não só
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
const DEMANDAS_VAZIAS = { tipologias: [], totais: {} };

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

// DOM mínimo o bastante pro script de cliente rodar de ponta a ponta:
// getElementById devolve sempre o MESMO objeto por id (memoizado), com só o
// que scriptDesbloqueio()/SCRIPT_CLIENTE_SEMANAL de fato usam --
// addEventListener, classList.toggle, style, value, innerHTML, focus.
function criarDocumentoFalso() {
  const elementos = {};
  function elemento(id) {
    if (!elementos[id]) {
      elementos[id] = {
        id,
        style: {},
        classList: { toggle() {} },
        listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {},
        value: '',
        textContent: '',
        innerHTML: '',
        disabled: false,
      };
    }
    return elementos[id];
  }
  return { elementos, getElementById: elemento };
}

// Extrai e roda, num Realm isolado (vm.Context), TODOS os <script> inline do
// HTML gerado, na mesma ordem em que um navegador executaria (vigenteIdx,
// dados cifrados, gate, fonteParaCliente, bundle, SCRIPT_CLIENTE_SEMANAL) --
// nenhum reescrito, nenhum resumido. A Task 10 acrescentou o <script> de
// fonteParaCliente() (mediaEquipesPonderada como global, consumida por
// compute-balanco.js dentro do bundle) ANTES do bundle -- por isso 6
// blocos agora, não mais 5.
function montarSandbox(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocos.length, 6, 'esperava exatamente 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const codigo = blocos.join('\n;\n');

  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
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
  const esperado = renderAbaSemanal(registros, indicesTodos, 'financeiro', vigenteIdx);

  const htmlMontado = documentoFalso.getElementById('secao-semanal').innerHTML;
  assert.notEqual(htmlMontado, '', '#secao-semanal continua vazia depois da senha certa -- reproduziria exatamente o bug relatado pelo coordenador');
  assert.equal(
    htmlMontado, esperado,
    'o HTML injetado em #secao-semanal precisa ser exatamente o que renderAbaSemanal(registros decifrados, TODOS os índices, "financeiro", vigenteIdx) produz -- prova que os argumentos passados batem, não só que ALGUM HTML foi injetado'
  );

  // Prova de conteúdo, não só de igualdade de string: soma dos 2 registros
  // no mês vigente (4000+2000=6000), dividida em 4 semanas (1500 cada),
  // formatada em pt-BR -- os mesmos números que um humano abrindo a página
  // veria na tela.
  const seiscentos = (6000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const milEQuinhentos = (1500).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(htmlMontado, /S1/);
  assert.match(htmlMontado, new RegExp(milEQuinhentos.replace('.', '\\.')));
  assert.match(htmlMontado, new RegExp(seiscentos.replace('.', '\\.')));
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

test('a chamada a RenderAbaSemanal.renderAbaSemanal, com injeção em #secao-semanal, está no código-fonte de montarDashboard (prova estática, complementar à prova dinâmica acima)', () => {
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
