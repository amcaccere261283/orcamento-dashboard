'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaDemandas } = require('../tools/semanal/render-aba-demandas.js');

// Mesma prova que test/semanal-render-aba-balanco-wireup.test.js faz para a
// aba Balanço de massa: gerar a página, rodar os <script> de cliente num
// vm.Context, digitar a senha certa e conferir que #secao-demandas recebe o
// HTML EXATO que renderAbaDemandas produz. Um módulo presente no bundle mas
// nunca chamado já aconteceu neste projeto (a aba Semanal abriu vazia na
// Task 8 da Fase 1) -- este teste é o que impede a repetição.

const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

const DEMANDAS = {
  tipologias: [{ tipologia: 'SP', series: {
    chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  } }],
  totais: {
    chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  },
};

function registroSintetico() {
  const zeros = new Array(12).fill(0);
  const bloco = () => ({
    equipes: zeros.slice(), volume: zeros.slice(), financeiro: zeros.slice(),
    equipesResumo: { pico: 1, media: 1, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
    previsto: bloco(), realizado: bloco(), total: bloco(),
  };
}

// DOM falso e sandbox: MESMA forma de test/semanal-render-semanal-wireup.test.js
// (que é a referência do repositório para isto). Dois detalhes que precisam
// bater com ela, senão o teste não roda:
// - `addEventListener` guarda em `this.listeners[tipo]`, e é assim que o teste
//   dispara o `change` do <select> mais abaixo.
// - `window` É o objeto global do sandbox, como no navegador -- e o gate
//   (scriptDesbloqueio, da casca) define `tentarDesbloquear` nesse global.
function criarDocumentoFalso() {
  const elementos = {};
  function elemento(id) {
    if (!elementos[id]) {
      elementos[id] = {
        id, style: {}, classList: { toggle() {} }, listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {}, value: '', textContent: '', innerHTML: '', disabled: false,
      };
    }
    return elementos[id];
  }
  return { elementos, getElementById: elemento };
}

function montarSandbox(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // Continua 6: a aba Demandas entra no bundle EXISTENTE (BUNDLE_ARQUIVOS) e
  // no SCRIPT_CLIENTE_SEMANAL existente -- não acrescenta <script> nenhum. Se
  // este número mudar, alguém injetou um script novo sem querer.
  assert.equal(blocos.length, 6, 'esperava 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocos.join('\n;\n'), sandbox, { filename: 'planejamento-semanal-cliente.js' });
  return { sandbox, documentoFalso };
}

function paginaComDemandas() {
  return renderSemanal({
    registros: [registroSintetico()], baseline: [], demandas: DEMANDAS,
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date(Date.UTC(2026, 6, 15)),
  });
}

test('#secao-demandas recebe o HTML exato de renderAbaDemandas depois da senha certa', async () => {
  const html = paginaComDemandas();
  // Antes de qualquer script a seção está vazia: nada pode ser montado em
  // build-time, fora do gate -- seria dado de cliente num Pages público.
  assert.match(html, /<div id="secao-demandas" style="display:none"><\/div>/);

  const { sandbox, documentoFalso } = montarSandbox(html);
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  assert.equal(typeof sandbox.tentarDesbloquear, 'function');
  await sandbox.tentarDesbloquear();

  const montado = documentoFalso.getElementById('secao-demandas').innerHTML;
  assert.notEqual(montado, '', '#secao-demandas vazia depois da senha certa reproduz o bug da aba Semanal na Fase 1');
  assert.equal(montado, renderAbaDemandas(DEMANDAS, 'mensal'),
    'precisa ser exatamente o que renderAbaDemandas(demandas decifradas, "mensal") produz -- prova que os argumentos batem, não só que ALGUM HTML foi injetado');
});

test('os NÚMEROS das demandas viajam DENTRO do blob cifrado -- nunca soltos no HTML', () => {
  const html = paginaComDemandas();
  // O rótulo "Demandas chegadas" existe no HTML cru porque render-aba-demandas.js
  // vai inteiro no bundle (é código, não dado) -- o que NÃO pode aparecer é
  // qualquer número real da agregação fora do blob cifrado. A prova é o mesmo
  // tipo que test/semanal-render-semanal-wireup.test.js já faz para os
  // registros: procurar o dado, não o rótulo.
  const semBlob = html.replace(/window\.__DADOS_CIFRADOS__ = [\s\S]*?;/, '');
  assert.strictEqual(/>\s*7154\s*</.test(semBlob), false, 'saldo real vazando no markup');
  assert.strictEqual(semBlob.includes('"chegadas":[10,20,30'), false, 'série real vazando no markup');
});

test('renderSemanal sem demandas LANÇA em vez de publicar uma aba vazia em silêncio', () => {
  assert.throws(() => renderSemanal({
    registros: [registroSintetico()], baseline: [],
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date(Date.UTC(2026, 6, 15)),
  }), /demandas/);
});

test('trocar o seletor para acumulado redesenha a seção, e o listener sobrevive à segunda troca', async () => {
  const { sandbox, documentoFalso } = montarSandbox(paginaComDemandas());
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'acumulado' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'acumulado'));

  // O <select> é recriado a cada innerHTML, então o listener tem que ser
  // religado depois de cada montagem -- mesmo motivo já documentado em
  // montarAbaBalanco. Sem isso, a segunda troca não faz nada e o bug passa
  // desapercebido num teste que só troca uma vez.
  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'mensal' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'mensal'));
});

test('a aba Demandas aparece no seletor de abas, sem quebrar as duas existentes', () => {
  const html = paginaComDemandas();
  for (const id of ['aba-semanal', 'aba-balanco', 'aba-demandas']) {
    assert.ok(html.includes('id="' + id + '"'), `falta o botão ${id}`);
  }
  assert.ok(html.includes('>Demandas<'));
});
