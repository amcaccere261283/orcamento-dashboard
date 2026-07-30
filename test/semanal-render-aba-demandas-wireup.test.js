'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaDemandas } = require('../tools/semanal/render-aba-demandas.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

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
  // Revisão final da branch: renderSemanal agora exige demandas.porRegistro
  // (mesmo padrão de demandas.tipologias) -- este arquivo testa só a aba
  // Demandas, não Realizado/Tendência, então vazio já satisfaz o guard.
  porRegistro: {},
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

// DOM falso: test/helpers/dom-falso-semanal.js (compartilhado com os outros
// arquivos de wire-up da semanal). Precisou virar o helper compartilhado, e
// não mais uma cópia local minimalista, porque montarDashboard agora TAMBÉM
// monta a barra de filtros compartilhada (montarTodosFiltrosMultiSemanal +
// configurarAberturaFiltrosMulti, da Fase 2) antes de montarAbaDemandas --
// um DOM falso sem querySelector/querySelectorAll faz essas duas chamadas
// lançarem, o erro é engolido pelo try/catch de tentarDesbloquear, e a aba
// Demandas nunca chega a montar (sintoma: "senha incorreta" com a senha
// certa). `window` É o objeto global do sandbox, como no navegador -- e o
// gate (scriptDesbloqueio, da casca) define `tentarDesbloquear` nesse global.
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
  assert.strictEqual(semBlob.includes('"chegadas":[10,20,30'), false, 'série real vazando no markup');
});

// Achado do review de Task 5: render-aba-demandas.js entra INTEIRO no bundle
// (código E comentários -- buildBrowserBundle não separa os dois), e um
// comentário chegou a citar cifras REAIS da planilha (7.154/5.546, medidas em
// janeiro/2026) para explicar por que o estoque de Pendentes não é um pico no
// primeiro mês. `>\s*7154\s*</` (a asserção antiga) nunca pegaria isso: o
// número real está em pt-BR, com ponto de milhar, dentro de um COMENTÁRIO de
// JS, não entre tags HTML -- a regex procurava a forma errada, no lugar
// errado. Este teste procura as duas formas (pt-BR e dígitos crus) na página
// inteira fora do blob, exatamente onde um comentário do bundle apareceria.
test('nenhuma cifra real da planilha (nem em comentário do bundle, nem em qualquer outro lugar) aparece fora do blob cifrado', () => {
  const html = paginaComDemandas();
  const semBlob = html.replace(/window\.__DADOS_CIFRADOS__ = [\s\S]*?;/, '');
  const cifrasReais = ['7.154', '5.546', '7154', '5546'];
  for (const cifra of cifrasReais) {
    assert.strictEqual(
      semBlob.includes(cifra), false,
      `cifra real da planilha "${cifra}" vazando fora do blob cifrado -- provavelmente veio de um comentário em algum módulo do bundle (render-aba-demandas.js já teve exatamente este vazamento)`
    );
  }
});

test('renderSemanal sem demandas LANÇA em vez de publicar uma aba vazia em silêncio', () => {
  assert.throws(() => renderSemanal({
    registros: [registroSintetico()], baseline: [],
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date(Date.UTC(2026, 6, 15)),
  }), /demandas/);
});

test('trocar o seletor para acumulado redesenha a seção, e a segunda troca também redesenha', async () => {
  const { sandbox, documentoFalso } = montarSandbox(paginaComDemandas());
  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'acumulado' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'acumulado'));

  // O <select> é recriado a cada innerHTML, então o listener PRECISARIA ser
  // religado depois de cada montagem -- mesmo motivo já documentado em
  // montarAbaBalanco. Este teste exercita a segunda troca, mas NÃO prova
  // sozinho que a religação é necessária: o DOM falso (criarDocumentoFalso)
  // guarda o elemento por id e nunca o destrói, então o listener antigo
  // sobrevive mesmo se a religação sumir do código -- comprovado pelo review
  // de Task 5, que hoistou o addEventListener para fora de montarAbaDemandas
  // e viu este teste continuar verde. A prova real de que a religação existe
  // é estática, no teste seguinte (que lê o código-fonte em vez de rodá-lo).
  documentoFalso.getElementById('demandas-modo').listeners.change({ target: { value: 'mensal' } });
  assert.equal(documentoFalso.getElementById('secao-demandas').innerHTML, renderAbaDemandas(DEMANDAS, 'mensal'));
});

// Prova estática (mesmo padrão de test/semanal-render-semanal-wireup.test.js,
// o teste que prova a chamada a RenderAbaSemanal.renderAbaSemanal dentro de
// montarDashboard): o teste dinâmico acima RODA o listener duas vezes, mas o
// DOM falso não consegue provar que ele foi RELIGADO -- só que ainda existe
// (ver o comentário lá em cima). Este teste lê o código-fonte do <script> de
// cliente e confirma que addEventListener('change', ...) do <select
// id="demandas-modo"> está DENTRO do corpo de montarAbaDemandas, não fora
// dela (por exemplo, içado para montarDashboard e chamado só uma vez) -- se
// alguém fizer esse refatoro, este teste quebra mesmo que o dinâmico acima
// continue verde.
test('o addEventListener("change") de #demandas-modo está DENTRO de montarAbaDemandas -- prova estática de que a religação sobrevive a um refatoro', () => {
  const html = paginaComDemandas();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[5][1]; // 6º <script>: SCRIPT_CLIENTE_SEMANAL
  const corpoFuncao = scriptCliente.match(/function montarAbaDemandas\(\) \{([\s\S]*?)\n\}/);
  assert.ok(corpoFuncao, 'função montarAbaDemandas não encontrada no script de cliente');
  assert.match(
    corpoFuncao[1],
    /document\.getElementById\('demandas-modo'\)\.addEventListener\('change'/,
    'addEventListener(\'change\', ...) precisa estar DENTRO de montarAbaDemandas -- é isso que garante que o listener é religado a cada innerHTML, já que o <select> é recriado toda vez'
  );
});

test('a aba Demandas aparece no seletor de abas, sem quebrar as duas existentes', () => {
  const html = paginaComDemandas();
  for (const id of ['aba-semanal', 'aba-balanco', 'aba-demandas']) {
    assert.ok(html.includes('id="' + id + '"'), `falta o botão ${id}`);
  }
  assert.ok(html.includes('>Demandas<'));
});
