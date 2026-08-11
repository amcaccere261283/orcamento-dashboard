'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

// Task 9 liga a interação de arrasto (Pointer Events) e as funções de estado
// da aba Alocação Equipes -- ESTADO_ALOCACAO, aplicarMovimento,
// semearDoRealizado, selecionarSemanaAlocacao, montarAbaAlocacao. Mesmo
// molde de test/semanal-render-aba-balanco-wireup.test.js (o precedente
// real -- o nome citado no brief, "semanal-render-semanal-cliente.test.js",
// não existe): extrai os <script> do HTML gerado por renderSemanal() e roda
// dentro de um vm.Context com o DOM falso, provando que o SCRIPT DE CLIENTE
// de verdade (não uma cópia isolada da lógica) se comporta como o spec pede.
// Porque o script declara tudo com 'var'/'function', essas declarações
// pousam no objeto do Realm (sandbox.window === sandbox), e o teste chama
// aplicarMovimento/ESTADO_ALOCACAO/etc. direto nele.
//
// Diferente do teste do Balanço, este NÃO passa pelo gate de senha: as
// funções desta task só precisam de window.__REGISTROS__/__DEMANDAS__ -- os
// mesmos dois globais que tentarDesbloquear() atribuiria depois de decifrar
// (ver fecharTendenciaVigente). Atribuí-los direto evita depender da página
// inteira (Alertas, Consolidado, Gráficos, Balanço) renderizar sem erro só
// para testar a aba nova, que ainda nem está pendurada no ciclo de
// montarDashboard (isso é Task 10). window.__ANO__/__VIGENTE_IDX__ continuam
// vindo do PRIMEIRO <script> do HTML (texto puro, nunca cifrado) -- é dele
// que mesSelecionadoIdx tira o valor inicial no load do script de cliente.

const SENHA_FAKE = 'senha-fake-de-teste-alocacao-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

// mesIdx 7 = agosto -- mesmo mês do geradoEm abaixo, então vigenteIdx = 7 e
// mesSelecionadoIdx (o índice que semanasDoMesSelecionado() usa) nasce nele.
const SEMANAS_AGOSTO = semanasDoMes(2026, 7);

function formatarDataBr(epoch) {
  const d = new Date(epoch * 86400000);
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

// Os dias cobertos por S2 (índice 1) e S3 (índice 2) -- contíguos (o fim de
// uma é o início-1 da próxima), então um intervalo simples cobre as duas. É
// entre elas que o teste de troca de semana alterna.
const DIAS_TESTE = [];
for (let e = SEMANAS_AGOSTO[1].inicio; e <= SEMANAS_AGOSTO[2].fim; e++) DIAS_TESTE.push(e);

function linhaDias(preencher) {
  return DIAS_TESTE.map(preencher).join(',');
}

// CSV sintético da aba EQ, mesmo formato medido em 2026-08-10 (ver
// test/semanal-equipes-alocaveis.test.js): ID | Equipe | Habilitação |
// Serviços | Líderes | Veículo | Proprietário | Equipamento x5 | Tenda |
// Tomador | sinalização 3P | <uma coluna por dia, formato dd/mm/yyyy -- o
// que a Sheet espelho publica de verdade>. Equipe 4 é SP, com uma OS só no
// 1º dia coberto (RE_OS extrai "11111-26" de dentro dos parênteses) --
// osParaSup mapeia essa OS para SUP-A, e o vínculo não se rompe nos dias OK
// seguintes (mesma regra de agregarEquipesAtivas/equipesDoQuadro). Equipe 59
// também é SP, mas de férias o período inteiro -- não arrastável nem por
// clique, mesmo pedindo a mesma coluna.
const OS_SUP_A = '11111-26';
const CSV_EQ_TESTE = [
  'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,'
    + 'Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda,Tomador,sinalização 3P,'
    + DIAS_TESTE.map(formatarDataBr).join(','),
  ',,do condutor,-,-,-,-,-,-,-,-,-,-,-,,' + linhaDias(() => '-'),
  '4,Equipe 4,D,SP,Amaral,VEIC-4,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias((_e, i) => (i === 0 ? `RioSP (${OS_SUP_A})` : 'OK')),
  '59,Equipe 59,D,SP,Paulo,VEIC-59,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias(() => 'Férias'),
].join('\n');

// registro mínimo comprovado suficiente para renderAbaAlocacao não quebrar
// (mesma forma de test/semanal-render-aba-alocacao.test.js -- só
// previsto.volume + previsto.equipesResumo.prod, sem realizado/total).
function registroSintetico(sup, tipologia, previstoAgosto) {
  const volume = new Array(12).fill(0);
  volume[7] = previstoAgosto;
  return { sup, tomador: 'Tomador Teste', tipologia, previsto: { volume, equipesResumo: { prod: 2 } } };
}

function demandasTeste() {
  return {
    tipologias: [], totais: {},
    porRegistroEventos: { 'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] } },
    equipesCsv: CSV_EQ_TESTE,
    equipesAtivasPeriodo: { ano: 2026, mes: 8 },
    // osParaSup ainda não viaja pelo build/live-refresh real (ver o
    // comentário de pendência em montarAbaAlocacao, render-semanal.js) --
    // aqui o teste o injeta direto, porque ele controla o payload inteiro.
    osParaSup: { [OS_SUP_A]: 'SUP-A' },
  };
}

// Objetos que atravessam o vm.Context têm um Object.prototype DIFERENTE do
// realm principal -- deepStrictEqual falha comparando protótipo mesmo com a
// mesma estrutura ("same structure but are not reference-equal"). Normaliza
// pro protótipo do realm atual antes de comparar -- mesmo achado registrado
// em test/orcamento-render-dashboard.test.js.
function normalizar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function extrairBlocos(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function armazenamentoFalso() {
  const dados = {};
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
  };
}

// Rodada de correção pós-verificação em navegador real (2026-08-10): abrir uma
// semana sem alocação salva agora SEMEIA sozinha a partir do realizado
// (Decisão 9 do spec) -- ver o marcador 'alocacao-equipes:vista:<chave>' em
// render-semanal.js. Os testes ABAIXO que não são sobre semeadura pré-marcam a
// semana como "já vista" nesta mesma chave, no MESMO armazenamento falso que o
// cliente usa -- assim eles continuam testando só o que testavam antes (o
// movimento manual, o isolamento entre semanas), sem o efeito colateral da
// semeadura automática se misturando no meio. A semeadura em si é testada à
// parte, em test/semanal-render-semanal-wireup.test.js.
function marcarSemanasVistas(cliente, ...indices) {
  indices.forEach((idx) => {
    const chave = cliente.AlocacaoSheet.chaveSemana(2026, SEMANAS_AGOSTO[idx].inicio);
    cliente.localStorage.setItem('alocacao-equipes:vista:' + chave, '1');
  });
}

// Monta um cliente novo (sandbox isolado) a cada chamada -- cada teste parte
// do zero, sem estado vazando de um para o outro. Pula o gate de senha de
// propósito (ver o comentário grande no topo do arquivo).
function montarClienteAlocacao() {
  const registros = [registroSintetico('SUP-A', 'SP', 120)];
  const html = renderSemanal({
    registros, baseline: [], demandas: demandasTeste(), periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z'),
  });

  const blocos = extrairBlocos(html);
  assert.equal(blocos.length, 6, 'esperava 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');

  const documentoFalso = criarDocumentoFalso();
  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    localStorage: armazenamentoFalso(),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocos.join('\n;\n'), sandbox, { filename: 'planejamento-semanal-alocacao.js' });

  // window.__VIGENTE_IDX__/__ANO__ já foram atribuídos pelo 1º <script>
  // (texto puro, roda sempre). __REGISTROS__/__DEMANDAS__ normalmente vêm do
  // gate depois de decifrar (fecharTendenciaVigente) -- atribuídos aqui
  // direto, no MESMO formato que o gate produziria.
  sandbox.window.__REGISTROS__ = registros;
  sandbox.window.__DEMANDAS__ = demandasTeste();

  return sandbox;
}

test('soltar uma equipe na coluna dela aplica o movimento', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const ok = cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-A', coluna: 'SP' });
});

test('soltar fora do conjunto de colunas da equipe é RECUSADO', async () => {
  const cliente = montarClienteAlocacao();
  marcarSemanasVistas(cliente, 1); // sem isto a semeadura automática já teria preenchido a equipe 4 antes da tentativa
  await cliente.selecionarSemanaAlocacao(1);
  const ok = cliente.aplicarMovimento('4', 'SUP-A', 'ST');
  assert.strictEqual(ok, false);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
});

test('soltar numa célula sem tendência, dentro do conjunto, é ACEITO -- é o caso de antecipar', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // SUP-B não tem registro nenhum na MATRIZ (nem tendência, nem carteira) --
  // aplicarMovimento não consulta a grade, só o conjunto de colunas da
  // equipe, então isso não impede a soltura (Decisão 6 do spec).
  const ok = cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-B', coluna: 'SP' });
});

test('equipe indisponível não pode ser movida nem por clique', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const equipe59 = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '59');
  assert.ok(equipe59, 'a equipe 59 precisa estar no roster para o teste provar algo');
  assert.strictEqual(equipe59.disponivel, false, 'pré-condição: de férias a semana inteira');

  const ok = cliente.aplicarMovimento('59', 'SUP-A', 'SP');
  assert.strictEqual(ok, false);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['59'], undefined);
});

test('semear do realizado preenche a partir da última OS da semana', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const equipe4 = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  assert.strictEqual(equipe4.supRealizado, 'SUP-A', 'pré-condição: a OS do 1º dia resolveu para SUP-A');

  cliente.semearDoRealizado();
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].coluna, 'SP');
});

test('trocar de semana recarrega a alocação daquela semana, sem misturar', async () => {
  const cliente = montarClienteAlocacao();
  // As três semanas visitadas neste teste são pré-marcadas como "já vistas":
  // o que ele prova é que aplicarMovimento numa semana não vaza pra outra,
  // não o comportamento de semeadura automática (coberto à parte).
  marcarSemanasVistas(cliente, 1, 2);
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');

  await cliente.selecionarSemanaAlocacao(2);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined, 'S3 não tem nada gravado -- não pode herdar o que foi feito na S2');

  await cliente.selecionarSemanaAlocacao(1);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A', 'voltar pra S2 reencontra o que foi gravado lá');
});

test('aplicarMovimento redesenha #secao-alocacao com o cartão no destino', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  const html = cliente.document.getElementById('secao-alocacao').innerHTML;
  assert.match(html, /data-sup="SUP-A"[^>]*data-coluna="SP"/);
  assert.match(html, /data-equipe="4"/);
});
