'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

// Task 9 liga a interação de arrasto (Pointer Events) e as funções de estado
// da aba Alocação Equipes -- ESTADO_ALOCACAO, aplicarMovimento,
// semearDoRealizado, selecionarSemanaAlocacao, montarAbaAlocacao. Extrai os
// <script> do HTML gerado por renderAlocacaoPagina() e roda dentro de um
// vm.Context com o DOM falso, provando que o SCRIPT DE CLIENTE de verdade
// (não uma cópia isolada da lógica) se comporta como o spec pede. Porque o
// script declara tudo com 'var'/'function', essas declarações pousam no
// objeto do Realm (sandbox.window === sandbox), e o teste chama
// aplicarMovimento/ESTADO_ALOCACAO/etc. direto nele.
//
// Migrado de renderSemanal() (planejamento-semanal.html) para
// renderAlocacaoPagina() (a página própria, ver
// docs/superpowers/sdd/2026-08-25-alocacao-equipes-pagina-propria) quando a
// Task 3 daquele plano apagou o bloco de estado/interação da Alocação de
// tools/semanal/render-semanal.js -- ele agora só existe dentro de
// tools/semanal/render-alocacao-pagina.js. Continua NÃO passando pelo gate de
// senha: as funções desta task só precisam de window.__REGISTROS__/
// __DEMANDAS__ -- os mesmos dois globais que tentarDesbloquear() atribuiria
// depois de decifrar (ver fecharTendenciaVigente). Atribuí-los direto evita
// depender do gate/cifragem só para testar a interação de arrasto -- ver
// test/semanal-alocacao-pagina-wireup.test.js para os testes que PASSAM pelo
// gate de verdade (blob cifrado, osParaSup atravessando, semeadura
// automática). window.__ANO__/__VIGENTE_IDX__ continuam vindo do PRIMEIRO
// <script> do HTML (texto puro, nunca cifrado) -- é dele que
// mesSelecionadoIdx tira o valor inicial no load do script de cliente.

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
  '4,Equipe 4,D,SP,Amaral,SUH-6F44,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias((_e, i) => (i === 0 ? `RioSP (${OS_SUP_A})` : 'OK')),
  '59,Equipe 59,D,SP,Paulo,VEIC-59,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias(() => 'Férias'),
  '77,Equipe 77,D,SP,Carona,Carona ID 4,Suporte,N/A,N/A,N/A,N/A,N/A,,Tomador X,,'
    + linhaDias(() => 'OK'),
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
    // comentário de pendência em montarAbaAlocacao, render-alocacao-pagina.js) --
    // aqui o teste o injeta direto, porque ele controla o payload inteiro.
    osParaSup: { [OS_SUP_A]: 'SUP-A' },
    // producaoOnline (2026-08-26) é quem alimenta supRealizado desde a troca
    // de origem -- ver
    // docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md.
    // Mesmo SUP/dia que osParaSup descrevia acima, agora como produção crua
    // do Link 7.
    // diaEpoch = fim de S2 (não o início): a janela do "último realizado" é
    // de só 3 dias -- ver JANELA_ULTIMO_REALIZADO_DIAS em equipes-alocaveis.js.
    producaoOnline: [{ idEquipe: '4', sup: 'SUP-A', tipo: 'SP', diaEpoch: SEMANAS_AGOSTO[1].fim }],
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
// render-alocacao-pagina.js. Os testes ABAIXO que não são sobre semeadura
// pré-marcam a semana como "já vista" nesta mesma chave, no MESMO
// armazenamento falso que o cliente usa -- assim eles continuam testando só o
// que testavam antes (o movimento manual, o isolamento entre semanas), sem o
// efeito colateral da semeadura automática se misturando no meio. A semeadura
// em si é testada à parte, em test/semanal-alocacao-pagina-wireup.test.js.
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
  const html = renderAlocacaoPagina({
    registros, demandas: demandasTeste(), periodos: PERIODOS_2026,
    senha: SENHA_FAKE, geradoEm: new Date('2026-08-01T00:00:00Z'),
  });

  const blocos = extrairBlocos(html);
  assert.equal(blocos.length, 8, 'esperava 8 <script> (vigenteIdx, __ULTIMA_ATUALIZACAO_OK__, aviso de atualização atrasada, dados cifrados, gate, fonteParaCliente, bundle, cliente)');

  const documentoFalso = criarDocumentoFalso();
  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    localStorage: armazenamentoFalso(),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocos.join('\n;\n'), sandbox, { filename: 'alocacao-equipes-cliente.js' });

  // window.__VIGENTE_IDX__/__ANO__ já foram atribuídos pelo 1º <script>
  // (texto puro, roda sempre). __REGISTROS__/__DEMANDAS__ normalmente vêm do
  // gate depois de decifrar (fecharTendenciaVigente) -- atribuídos aqui
  // direto, no MESMO formato que o gate produziria.
  sandbox.window.__REGISTROS__ = registros;
  sandbox.window.__DEMANDAS__ = demandasTeste();

  return sandbox;
}

// Achado do revisor do Task 9: a versão anterior deste teste não provava
// nada -- `prep.o.equipes`/`ESTADO_ALOCACAO.equipes` são a MESMA referência
// por construção (prepararOpcoesAlocacao atribui ESTADO_ALOCACAO.equipes e
// embute essa MESMA referência em `o`), então o deepStrictEqual não tinha
// como falhar; e o `assert.strictEqual(prep.semana.inicio, cond ? X : undefined)`
// comparava X consigo mesmo (o ternário é sempre verdadeiro, porque
// prepararOpcoesAlocacao já clampa semanaIdx >= 0 antes de devolver). Esta
// versão usa só valores conhecidos DE FORA da função (constantes do fixture,
// ou chamadas diretas e independentes aos módulos que ela consome) -- cada
// asserção falharia se prepararOpcoesAlocacao computasse algo diferente do
// que montarAbaAlocacao computava inline antes da extração.
test('prepararOpcoesAlocacao devolve o MESMO roster e as MESMAS opções que montarAbaAlocacao usa pro Kanban', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const prep = cliente.prepararOpcoesAlocacao();

  // prep.o precisa ter EXATAMENTE as chaves que o objeto de opções tinha antes
  // da extração -- nem a mais (campo vazando à toa), nem a menos (um
  // consumidor -- Kanban ou Mapa -- ficaria sem o que precisa).
  //
  // 'producaoOnline' NÃO entra aqui de propósito: o trabalho paralelo de
  // 2026-08-26 (Realizado da Alocação via produção do Link 7, ver
  // docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md)
  // passa esse campo direto pra EquipesAlocaveis.equipesDoQuadro(...), não pelo
  // objeto de opções -- quem consome é o roster, não os renderizadores.
  const CHAVES_ESPERADAS = [
    'mesIdx', 'ano', 'semanas', 'semana', 'demandas', 'semRoster',
    'somenteLeitura', 'equipes', 'foraDoQuadro', 'alocacao', 'buscaEquipe',
    'tipologiaAlocacao', 'hojeEpoch', 'modoPersistencia', 'pendentes',
  ];
  assert.deepStrictEqual(Object.keys(prep.o).sort(), [...CHAVES_ESPERADAS].sort());

  // Valores conhecidos de fora (constantes do fixture, independentes de
  // qualquer cálculo interno de prepararOpcoesAlocacao):
  assert.strictEqual(prep.o.ano, 2026); // PERIODOS_2026
  assert.strictEqual(prep.o.mesIdx, 7); // vigenteIdx de agosto/2026 (geradoEm do fixture)
  assert.strictEqual(prep.o.semRoster, false, 'este fixture TEM roster (equipesCsv preenchido)');
  assert.strictEqual(prep.o.somenteLeitura, null); // equipesRosterPeriodo não vem setado neste fixture
  assert.strictEqual(prep.o.buscaEquipe, '', 'cliente novo, busca nunca digitada');
  assert.strictEqual(prep.o.tipologiaAlocacao, '', 'cliente novo, filtro de tipologia nunca tocado');
  assert.strictEqual(prep.semana.inicio, SEMANAS_AGOSTO[1].inicio, 'a semana 1 de agosto, calculada de forma independente por semanasDoMes()');
  assert.strictEqual(prep.semana.fim, SEMANAS_AGOSTO[1].fim);
  assert.deepStrictEqual(normalizar(prep.semana), normalizar(prep.o.semana), 'prep.semana e prep.o.semana têm que ser a mesma semana');

  // Referência (não cópia) para os dois campos que prepararOpcoesAlocacao só
  // repassa, sem transformar -- provar isso por referência é mais forte que
  // por valor: uma cópia acidental também passaria num deepStrictEqual.
  assert.strictEqual(prep.o.demandas, cliente.window.__DEMANDAS__);
  assert.strictEqual(prep.o.alocacao, cliente.ESTADO_ALOCACAO.alocacao);

  // modoPersistencia/pendentes: comparados contra uma chamada independente
  // à API pública do cliente de persistência (clienteAlocacao() memoiza,
  // então é a MESMA instância -- mas a asserção prova que prep.o reflete o
  // que ela reporta agora, não um valor congelado ou inventado).
  assert.strictEqual(prep.o.modoPersistencia, cliente.clienteAlocacao().modo());
  assert.strictEqual(prep.o.pendentes, cliente.clienteAlocacao().pendentes().length);

  // hojeEpoch: comparado contra uma chamada independente à mesma função pura.
  assert.strictEqual(prep.o.hojeEpoch, cliente.hojeEpochDoNavegador());

  // Roster: recomputado por uma chamada DIRETA e independente a
  // EquipesAlocaveis.equipesDoQuadro, com os parâmetros que o fixture
  // determina de fora (mês 8, semana 1, produção crua do Link 7) -- não os que
  // prepararOpcoesAlocacao resolveu internamente. Se a extração tivesse
  // trocado ano/mês/semana/produção por engano, esta comparação pegaria.
  //
  // 'producaoOnline' (não mais 'osParaSup') desde a troca de 2026-08-26, num
  // trabalho paralelo: supRealizado/colunaRealizada passaram a sair da produção
  // do Link 7 em vez do texto da Sheet EQ. Passar a chave antiga aqui não
  // quebraria a chamada -- ela seria só ignorada, e o roster esperado viria com
  // supRealizado null contra o real preenchido, que foi exatamente como esta
  // divergência apareceu no rebase.
  const rosterEsperado = cliente.EquipesAlocaveis.equipesDoQuadro(cliente.window.__DEMANDAS__.equipesCsv, {
    ano: 2026, mes: 8, semana: SEMANAS_AGOSTO[1], producaoOnline: cliente.window.__DEMANDAS__.producaoOnline,
  });
  assert.ok(rosterEsperado.equipes.length > 0, 'pré-condição: o roster esperado não pode estar vazio, senão a comparação abaixo seria vácua');
  assert.deepStrictEqual(normalizar(prep.o.equipes), normalizar(rosterEsperado.equipes));
  assert.deepStrictEqual(normalizar(prep.o.foraDoQuadro), normalizar(rosterEsperado.foraDoQuadro));
  // E prova que ESTADO_ALOCACAO foi atualizado com o MESMO roster (efeito
  // colateral que montarAbaAlocacao dependia antes da extração).
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.equipes), normalizar(rosterEsperado.equipes));

  // Indices: recomputados por uma chamada DIRETA e independente a
  // indicesFiltrados, com os 5 filtros vazios (nenhum foi tocado neste
  // teste) -- não confiando na leitura interna que prepararOpcoesAlocacao
  // faz de filtrosSelecionadosSemanal.
  const indicesEsperados = cliente.indicesFiltrados(
    cliente.window.__REGISTROS__, new Set(), new Set(), new Set(), new Set(), new Set()
  );
  assert.ok(indicesEsperados.length > 0, 'pré-condição: precisa sobrar pelo menos 1 registro, senão a comparação abaixo seria vácua');
  assert.deepStrictEqual(normalizar(prep.indices), normalizar(indicesEsperados));
});

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
  assert.strictEqual(equipe4.supRealizado, 'SUP-A', 'pré-condição: a OS do fim da semana resolveu para SUP-A');

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

test('aplicarMovimento redesenha #secao-kanban-alocacao com o cartão no destino', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  const html = cliente.document.getElementById('secao-kanban-alocacao').innerHTML;
  assert.match(html, /data-sup="SUP-A"[^>]*data-coluna="SP"/);
  assert.match(html, /data-equipe="4"/);
});

test('a trava leva a companheira de veículo junto', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 e a 77 dividem o veículo. Mover a 4 para SUP-B move a 77 também.
  assert.strictEqual(cliente.aplicarMovimento('4', 'SUP-B', 'SP'), true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-B', coluna: 'SP' });
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['77']), { sup: 'SUP-B', coluna: 'SP' });
});

test('devolver ao pool devolve a companheira também', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  // Achado Minor 1 da revisão final: checar só `=== undefined` no final
  // passaria até com a trava REMOVIDA (companheiros zerado -> a 77 nunca
  // teria ido para SUP-B, e continuaria undefined pelo motivo errado). A
  // asserção de PRESENÇA prova que a 77 estava mesmo lá, alocada, antes de
  // ser devolvida -- é a devolução acontecendo de verdade, não uma ausência
  // que já existia.
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['77']), { sup: 'SUP-B', coluna: 'SP' },
    'pré-condição: a 77 tem que estar mesmo alocada em SUP-B antes da devolução');

  assert.strictEqual(cliente.aplicarMovimento('4', '', ''), true);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['77'], undefined);
});

test('a companheira INDISPONÍVEL não é arrastada pela trava', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 59 está de férias o período inteiro. Forçamos ela para dentro do grupo
  // da 4 no estado já montado -- é o caminho mais curto para provar a regra
  // sem um terceiro CSV.
  const equipes = cliente.ESTADO_ALOCACAO.equipes;
  equipes.find((e) => e.id === '4').companheiros = ['77', '59'];
  equipes.find((e) => e.id === '59').companheiros = ['4', '77'];
  assert.strictEqual(equipes.find((e) => e.id === '59').disponivel, false, 'a 59 está de férias');
  // Pré-aloca a 59 num SUP -- como se a semeadura (que não passa pela trava)
  // já tivesse posto ela ali antes de entrar de férias. Achado Minor 1: só
  // `=== undefined` no final passaria também com companheiros zerado (ela
  // nunca esteve no grupo, então nunca seria tocada de qualquer jeito) --
  // POSITIVO (ela continua EXATAMENTE onde estava) prova que a trava a viu e
  // decidiu não tocar, não que ela nunca apareceu no cálculo.
  cliente.ESTADO_ALOCACAO.alocacao['59'] = { sup: 'SUP-Z', coluna: 'SP' };

  cliente.aplicarMovimento('4', 'SUP-B', 'SP');
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['59']), { sup: 'SUP-Z', coluna: 'SP' },
    'indisponível fica EXATAMENTE onde estava -- a trava não é a porta dos fundos da recusa');
  // A 59 ficar parada também seria verdade com o GRUPO inteiro desativado
  // (sem trava, ninguém além da 4 se move, então a 59 nunca seria tocada de
  // qualquer forma -- exatamente a vacuidade que o achado Minor 1 aponta).
  // A prova real de que a trava está ATIVA é a 77 (disponível, mesmo grupo)
  // TER se movido para SUP-B -- sem isso o teste passaria com a trava
  // inteiramente ausente.
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['77']), { sup: 'SUP-B', coluna: 'SP' },
    'a 77 (disponível, mesmo grupo) tem que ter ido junto -- prova que a trava está de fato ativa');
});

test('gesto recusado não move NINGUÉM do grupo', async () => {
  const cliente = montarClienteAlocacao();
  // Sem isto a semeadura automática já teria preenchido a equipe 4 em SUP-A
  // antes da tentativa (mesmo motivo do teste 'soltar fora do conjunto de
  // colunas da equipe é RECUSADO' acima) -- o que provaria a asserção errada:
  // alocacao['4'] não seria undefined por causa da recusa, seria undefined
  // (ou não) por causa da semeadura, e a recusa em si ficaria sem prova.
  marcarSemanasVistas(cliente, 1);
  await cliente.selecionarSemanaAlocacao(1);
  // Pré-aloca a 77 (companheira) em SUP-A -- achado Minor 1: com companheiros
  // zerado, `alocacao['77'] === undefined` passaria de qualquer forma (ela
  // nunca teria sido tocada, porque nunca esteve no grupo). Pré-alocada,
  // provar que ela CONTINUA em SUP-A depois da recusa é a prova de que a
  // recusa parou o grupo inteiro, não só a arrastada.
  cliente.ESTADO_ALOCACAO.alocacao['77'] = { sup: 'SUP-A', coluna: 'SP' };
  // A 4 é SP: a coluna ST está fora do conjunto dela.
  assert.strictEqual(cliente.aplicarMovimento('4', 'SUP-B', 'ST'), false);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['77']), { sup: 'SUP-A', coluna: 'SP' },
    'a companheira tem que continuar EXATAMENTE onde estava -- a recusa não pode ter mexido nela');
});

// Evento de clique falso pro handler DELEGADO de #secao-kanban-alocacao (clique-clique
// -- o 2º call site de destacarCelulasCompativeis apontado pelo achado
// Important 1). e.target.closest só precisa resolver o seletor do cartão; os
// outros ([data-acao], [data-semana]) devolvem null, como um clique fora
// deles faria de verdade.
function eventoCliqueNoCartao(equipeId) {
  return {
    target: {
      closest(sel) {
        if (sel === '[data-equipe][data-arrastavel="sim"]') {
          return { getAttribute: (attr) => (attr === 'data-equipe' ? equipeId : null) };
        }
        return null;
      },
    },
  };
}

test('o pool acende ao arrastar (clique-clique) uma equipe do POOL que tem companheira de veículo ALOCADA', async () => {
  const cliente = montarClienteAlocacao();
  marcarSemanasVistas(cliente, 1); // sem isto a semeadura automática já alocaria a 4 em SUP-A (ela tem OS na semana)
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 e a 77 dividem o veículo. aplicarMovimento NÃO serve para montar essa
  // pré-condição -- com a trava no ar ele moveria as duas juntas. O jeito de
  // uma ficar alocada e a outra no pool é exatamente como o spec descreve
  // (Decisão 4/5): herdado da semeadura ou de uma gravação anterior a esta
  // versão. Simula isso escrevendo direto no estado, como semearDoRealizado
  // faria. Aloca só a 77 em SUP-A e deixa a 4 no pool -- cenário exato do
  // achado Important 1 da revisão final: `podeDevolver` olhava só a equipe
  // ARRASTADA (!!alocacao['4'] = false), então o pool não acendia -- mas
  // soltar a 4 ainda no pool move o GRUPO (destinoDoGrupo), que TEM efeito
  // porque devolveria a 77. A tela mentia que o gesto era no-op.
  cliente.ESTADO_ALOCACAO.alocacao['77'] = { sup: 'SUP-A', coluna: 'SP' };
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined, 'pré-condição: a 4 está no pool');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['77'].sup, 'SUP-A', 'pré-condição: a 77 está alocada');

  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77']);
  // Dispara o handler de 'click' REAL de #secao-kanban-alocacao (não uma chamada
  // isolada de destacarCelulasCompativeis) -- é o call site onde o achado
  // achou o bug, e é ele que a prova por mutação abaixo precisa pegar.
  cliente.document.getElementById('secao-kanban-alocacao').listeners.click(eventoCliqueNoCartao('4'));

  assert.ok(cliente.document.poolAlocacao().classList.contains('pool-alvo'),
    'a tela tem que dizer que soltar no pool TEM efeito -- devolveria a 77 junto');
});

test('o pool NÃO acende (clique-clique) quando nem a equipe arrastada nem a companheira estão alocadas -- devolver seria no-op de verdade', async () => {
  const cliente = montarClienteAlocacao();
  marcarSemanasVistas(cliente, 1); // sem isto a semeadura automática já alocaria a 4 em SUP-A (ela tem OS na semana)
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 e a 77 no pool, as duas -- ninguém para devolver, então o pool
  // continua apagado. Guarda contra uma correção exagerada do Important 1
  // que acendesse o pool sempre.
  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77']);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined, 'pré-condição: a 4 está no pool');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['77'], undefined, 'pré-condição: a 77 também está no pool');

  cliente.document.getElementById('secao-kanban-alocacao').listeners.click(eventoCliqueNoCartao('4'));

  assert.ok(!cliente.document.poolAlocacao().classList.contains('pool-alvo'));
});

test('o arrasto de uma equipe de grupo grava UM movimento POR equipe do grupo, não só a arrastada', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // A 4 e a 77 dividem o veículo (mesmo par de 'a trava leva a companheira de
  // veículo junto', que já prova a TELA -- ESTADO_ALOCACAO). Este teste prova
  // o ARMAZENAMENTO: aplicarLocal roda SÍNCRONO dentro de gravar, antes de
  // qualquer await (ver o topo de alocacao-sheet.js), então o localStorage já
  // reflete os movimentos assim que aplicarMovimento retorna -- sem precisar
  // esperar a promise. Achado Important 3 da revisão final: trocar
  // movimentos.forEach por [movimentos[0]].forEach em aplicarMovimento
  // deixaria a TELA certa (o forEach de ESTADO_ALOCACAO continuaria intacto)
  // e o ARMAZENAMENTO com o grupo partido -- só a próxima abertura da semana
  // (que recarrega de lá) revelaria o plano impossível.
  cliente.aplicarMovimento('4', 'SUP-B', 'SP');

  const chave = cliente.AlocacaoSheet.chaveSemana(2026, SEMANAS_AGOSTO[1].inicio);
  const salvo = JSON.parse(cliente.localStorage.getItem('alocacao-equipes:' + chave));
  assert.deepStrictEqual(normalizar(salvo['4']), { sup: 'SUP-B', coluna: 'SP' });
  assert.deepStrictEqual(normalizar(salvo['77']), { sup: 'SUP-B', coluna: 'SP' },
    'a companheira de veículo tem que estar gravada, não só na tela');
});

test('ao começar o gesto, os cartões das companheiras de veículo acendem', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77', '59']);

  const equipeQuatro = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  cliente.destacarCelulasCompativeis(equipeQuatro.colunas, false, equipeQuatro.companheiros);

  assert.ok(cliente.document.cartaoAlocacao('77').classList.contains('cartao-companheiro'),
    'a 77 divide o veículo da 4');
  assert.ok(!cliente.document.cartaoAlocacao('59').classList.contains('cartao-companheiro'),
    'a 59 não é do grupo');
});

test('o destaque das companheiras morre em limparDestaquesAlocacao -- o único ponto de saída', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.document.registrarCelulasAlocacao(['SP']);
  cliente.document.registrarCartoesAlocacao(['4', '77']);

  const equipeQuatro = cliente.ESTADO_ALOCACAO.equipes.find((e) => e.id === '4');
  cliente.destacarCelulasCompativeis(equipeQuatro.colunas, false, equipeQuatro.companheiros);
  cliente.limparDestaquesAlocacao();

  assert.ok(!cliente.document.cartaoAlocacao('77').classList.contains('cartao-companheiro'));
});

// --- Regressão CRITICAL (revisão pós-Task 11): o mapa não pode ser destruído
// pelo próprio redesenho -----------------------------------------------------
//
// Achado do revisor: montarMapaAlocacao (render-alocacao-pagina.js) reescrevia
// secao.innerHTML inteiro a cada chamada, mesmo com o MapLibre já ligado a
// #mapa-alocacao-canvas -- e mapa.on('load', function () { montarAbaAlocacao();
// }) (dentro de inicializarMapaAlocacao) dispara essa MESMA cadeia poucos
// instantes depois do clique na aba, trocando o container real por um NOVO e
// vazio. O mapa continua "vivo" (segura um contexto WebGL) mas nada dele
// aparece mais na tela, e só um F5 resolve -- a checagem de idempotência de
// inicializarMapaAlocacao só olha MAPA_ALOCACAO.instancia, que continua um
// objeto válido mesmo com o container órfão.
//
// Este teste não precisa do MapLibre de verdade (não roda em vm.Context) --
// só precisa provar a propriedade de DOM: o NÓ de #mapa-alocacao-canvas que
// existia ANTES de um redesenho continua sendo o MESMO nó depois, uma vez que
// MAPA_ALOCACAO.instancia (aqui, um dublê -- não precisa ser um mapa de
// verdade, só precisa ser truthy) já existe. O DOM falso
// (test/helpers/dom-falso-semanal.js) ganhou suporte a essa identidade
// especificamente pros 4 ids da região do mapa -- ver o comentário lá.
test('CRITICAL: com o mapa já inicializado, redesenhar a aba NÃO recria #mapa-alocacao-canvas', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1); // 1º desenho da aba Mapa -- cria o canvas pela 1ª vez

  const canvasAntes = cliente.document.getElementById('mapa-alocacao-canvas');
  assert.ok(canvasAntes, 'pré-condição: o 1º desenho tem que ter criado o container do mapa');

  // Simula o mapa já ligado ao container (o que inicializarMapaAlocacao
  // faria de verdade depois do clique na aba Mapa) -- um dublê qualquer
  // serve, o teste não precisa do MapLibre de verdade.
  cliente.MAPA_ALOCACAO.instancia = { resize() {} };

  // Qualquer redesenho normal passa por montarAbaAlocacao -> montarMapaAlocacao
  // -- usa aplicarMovimento como gatilho concreto, mas o achado do revisor
  // vale pra QUALQUER caminho que chegue lá (troca de filtro/semana/mês,
  // "Atualizar dados", ou o próprio handler de 'load' do mapa).
  cliente.aplicarMovimento('4', 'SUP-B', 'SP');

  const canvasDepois = cliente.document.getElementById('mapa-alocacao-canvas');
  assert.strictEqual(canvasDepois, canvasAntes,
    'o container do mapa foi RECRIADO por um redesenho -- o MapLibre ficaria preso a um nó órfão, fora do documento');
});

test('com o mapa já inicializado, o pool e os controles da aba Mapa continuam sendo redesenhados normalmente', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.MAPA_ALOCACAO.instancia = { resize() {} };

  // Move a equipe 4 pra fora do pool -- se #mapa-alocacao-pool não fosse mais
  // redesenhado (efeito colateral bobo de "preservar o mapa"), o cartão dela
  // continuaria aparecendo lá como se nada tivesse mudado.
  cliente.aplicarMovimento('4', 'SUP-B', 'SP');

  const poolHtml = cliente.document.getElementById('mapa-alocacao-pool').innerHTML;
  assert.match(poolHtml, /pool-alocacao/, 'o pool continua sendo redesenhado, só o wrap do mapa é que é preservado');
});

// --- Task 12: particionarSupsPorLocalizacao (pino vs. painel "sem localização") ---
//
// Função PURA, separada de desenharPinosMapa (que mexe no MapLibre/DOM) --
// testável sem precisar de um mapa de verdade. O resto de desenharPinosMapa
// (criação de Marker/Popup) só é verificável manualmente, mesma limitação já
// documentada na Task 11 para o resto do mapa.
test('particionarSupsPorLocalizacao separa SUPs com e sem coordenada', () => {
  const cliente = montarClienteAlocacao();
  const porSup = [{ sup: 'SUP-A', leitura: 'absorvido' }, { sup: 'SUP-B', leitura: 'falta-equipe' }];
  const coordenadas = { 'SUP-A': { lat: -25.5, lon: -49.2 } };
  const resultado = cliente.particionarSupsPorLocalizacao(porSup, coordenadas);
  // normalizar() (JSON round-trip, definida no topo deste arquivo): os
  // arrays devolvidos pousam com o Array.prototype do vm.Context, e
  // deepStrictEqual falha por "same structure but are not reference-equal"
  // contra um array literal do realm principal -- mesmo achado já registrado
  // ali para objetos.
  assert.deepStrictEqual(normalizar(resultado.comLocalizacao.map((s) => s.sup)), ['SUP-A']);
  assert.deepStrictEqual(normalizar(resultado.semLocalizacao.map((s) => s.sup)), ['SUP-B']);
});

// --- Task 13: arrasto até o pino -- resolverAlvoAlocacao ganha o tipo 'pino' ---
//
// O pino é um elemento DOM real do MapLibre (um <div class="marcador-alocacao-mapa">
// com data-sup, criado por desenharPinosMapa -- Task 12), que o `document` FALSO
// deste arquivo não simula (não há MapLibre nos testes). Por isso estes dois testes
// não simulam o gesto inteiro (isso é Task 14) -- chamam resolverAlvoAlocacao/
// aplicarMovimentoNoPino direto, com um objeto que IMITA só o contrato de
// `.closest()` que resolverAlvoAlocacao usa, mesma técnica que os testes de
// célula/pool (linha 254 acima) já usam.
function elementoFalsoPino(sup) {
  const el = { getAttribute: (attr) => (attr === 'data-sup' ? sup : null) };
  el.closest = (sel) => (sel === '.marcador-alocacao-mapa' ? el : null);
  return el;
}

test('resolverAlvoAlocacao reconhece um marcador do mapa (.marcador-alocacao-mapa) como alvo tipo pino', async () => {
  const cliente = montarClienteAlocacao();
  const elFalso = elementoFalsoPino('SUP-A');
  // document.elementFromPoint é chamado por resolverAlvoAlocacao -- o
  // documento falso deste arquivo não implementa elementFromPoint, então
  // caímos no fallback e.target (ver o comentário de resolverAlvoAlocacao).
  const alvo = cliente.resolverAlvoAlocacao({ target: elFalso });
  assert.deepStrictEqual({ tipo: alvo.tipo, sup: alvo.el.getAttribute('data-sup') }, { tipo: 'pino', sup: 'SUP-A' });
});

test('soltar equipe polivalente no pino escolhe a coluna com maior déficit', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  // Equipe 4 é SP nesta suíte -- reaproveitar como está prova só o caminho
  // de coluna única (delega pra escolherColunaAutomatica, testada de sobra
  // em test/semanal-compute-alocacao.test.js, Task 3). O caminho ONDE a
  // coluna é escolhida (o handler de solta-no-pino) é o que este teste
  // prova: chamar aplicarMovimentoNoPino('4', 'SUP-A') e checar que a
  // coluna 'SP' (a única de equipe 4) foi resolvida sozinha.
  const ok = cliente.aplicarMovimentoNoPino('4', 'SUP-A');
  assert.strictEqual(ok, true);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].coluna, 'SP');
});

// Trace do self-review: um SUP sem linha na grade (não devia acontecer na
// prática -- o pino só existe para um SUP presente em dados.resumo.porSup, que
// nasce da MESMA grade que ultimaGrade guarda; ver o comentário grande em
// montarMapaAlocacao) não pode fazer aplicarMovimentoNoPino LANÇAR. celulasDaLinha
// cai pra {} (nenhuma célula bate o filtro de escolherColunaAutomatica), que por
// sua vez cai no PRÓPRIO fallback de escolherColunaAutomatica (Task 3): a
// primeira coluna da equipe, não null -- então o movimento é aplicado do mesmo
// jeito, com a coluna de fallback. Degrada sem travar; não é um no-op.
test('aplicarMovimentoNoPino não lança quando o SUP não tem linha na grade -- degrada para a coluna de fallback da equipe', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  const ok = cliente.aplicarMovimentoNoPino('4', 'SUP-INEXISTENTE');
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-INEXISTENTE', coluna: 'SP' });
});

// --- Task 14: o GESTO COMPLETO de arrasto até o pino ------------------------
//
// A Task 13 provou resolverAlvoAlocacao/aplicarMovimentoNoPino chamando as
// duas DIRETO. O que faltava era a ponta: até a Task 14,
// inicializarInteracaoAlocacao só ligava #secao-kanban-alocacao, onde pino
// nenhum aparece -- ou seja, todo o código da Task 13 estava correto e
// INALCANÇÁVEL no app real. Este teste é a prova de que a ponta foi ligada:
// ele dispara os listeners REAIS de #secao-mapa-alocacao (pointerdown ->
// pointermove -> pointerup), nunca aplicarMovimentoNoPino direto.
//
// O DOM falso não implementa elementFromPoint, então resolverAlvoAlocacao cai
// no fallback e.target (comportamento documentado na própria função) -- por
// isso o pointerup carrega o marcador como target.
function eventoPointerNoCartao(equipeId, pointerId) {
  return {
    pointerId: pointerId,
    clientX: 0,
    clientY: 0,
    target: {
      closest(sel) {
        if (sel === '[data-equipe][data-arrastavel="sim"]') {
          return { getAttribute: (attr) => (attr === 'data-equipe' ? equipeId : null) };
        }
        return null;
      },
    },
  };
}

test('GESTO COMPLETO: arrastar o cartão do pool até o pino do mapa aloca a equipe no SUP do pino', async () => {
  const cliente = montarClienteAlocacao();
  marcarSemanasVistas(cliente, 1); // sem isto a semeadura automática já alocaria a 4
  await cliente.selecionarSemanaAlocacao(1);
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'], undefined, 'pré-condição: a 4 está no pool');

  const [pino] = cliente.document.registrarMarcadoresAlocacao(['SUP-A']);
  const secaoMapa = cliente.document.getElementById('secao-mapa-alocacao');
  assert.ok(secaoMapa.listeners.pointerdown,
    'pré-condição: #secao-mapa-alocacao tem que ter listeners -- é o que a Task 14 liga');

  secaoMapa.listeners.pointerdown(eventoPointerNoCartao('4', 1));
  secaoMapa.listeners.pointermove({ pointerId: 1, clientX: 10, clientY: 10 });
  secaoMapa.listeners.pointerup({ pointerId: 1, clientX: 10, clientY: 10, target: pino });

  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].coluna, 'SP');
});

// Guarda contra uma regressão sutil da parametrização: ligar a MESMA função
// duas vezes não pode ter deixado o Kanban sem listener (ex.: uma refatoração
// que trocasse o parâmetro por um id fixo do Mapa).
test('a parametrização de inicializarInteracaoAlocacao ligou as DUAS seções, não só a do Mapa', () => {
  const cliente = montarClienteAlocacao();
  const kanban = cliente.document.getElementById('secao-kanban-alocacao');
  const mapa = cliente.document.getElementById('secao-mapa-alocacao');
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click'].forEach((tipo) => {
    assert.ok(kanban.listeners[tipo], 'Kanban precisa do listener de ' + tipo);
    assert.ok(mapa.listeners[tipo], 'Mapa precisa do listener de ' + tipo);
  });
});

// --- Revisão final (2026-08-26): a seleção clique-clique não pode sobreviver
// à troca de aba ------------------------------------------------------------
//
// Achado Critical 1: '<div class="abas-visualizacao">' (os botões Kanban/Mapa)
// é IRMÃ das duas seções, não descendente de nenhuma delas -- um clique nos
// botões nunca chega aos listeners DELEGADOS de #secao-kanban-alocacao/
// #secao-mapa-alocacao (inicializarInteracaoAlocacao, acima), então
// SELECAO_ALOCACAO.equipeId sobrevivia à troca de aba. O PRIMEIRO clique
// dentro da outra seção -- mesmo um clique qualquer, sem nenhum pino
// envolvido -- era tratado como o 2º passo daquele gesto abandonado: soltar
// no pool da aba Mapa com uma seleção órfã da aba Kanban chamava
// aplicarMovimento(equipeId, '', ''), que DEVOLVE a equipe (e o grupo de
// veículo inteiro) ao pool -- de-alocando em silêncio, sem confirmação, e
// gravando a remoção na Sheet. Nenhum teste cobria os handlers de troca de
// aba até esta correção (RED completo: os dois testes de estado abaixo
// falhavam com "null" esperado contra "4" antes do fix em
// render-alocacao-pagina.js, encerrarGestosAoTrocarDeAba).
test('trocar para a aba Mapa encerra uma seleção clique-clique pendente da aba Kanban', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);

  cliente.SELECAO_ALOCACAO.equipeId = '4';
  cliente.SUPRIMIR_PROXIMO_CLICK_ALOCACAO = true; // o outro estado de gesto que o fix também zera
  // Simula o mapa já ligado -- evita que o clique tente inicializar um
  // MapLibre de verdade (inexistente neste sandbox), mesmo dublê que os
  // testes de Task 11/12 já usam (ver 'CRITICAL: com o mapa já
  // inicializado...' acima).
  cliente.MAPA_ALOCACAO.instancia = { resize() {} };

  cliente.document.getElementById('aba-mapa-alocacao').listeners.click();

  assert.strictEqual(cliente.SELECAO_ALOCACAO.equipeId, null);
  assert.strictEqual(cliente.SUPRIMIR_PROXIMO_CLICK_ALOCACAO, false);
});

test('trocar para a aba Kanban encerra uma seleção clique-clique pendente da aba Mapa', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);

  cliente.SELECAO_ALOCACAO.equipeId = '4';
  cliente.document.getElementById('aba-kanban-alocacao').listeners.click();

  assert.strictEqual(cliente.SELECAO_ALOCACAO.equipeId, null);
});

// Evento de clique falso pro pool -- mesma técnica de eventoCliqueNoCartao
// acima, mas resolvendo '.pool-alocacao' em vez de um cartão. É o alvo que
// aplicarMovimento(equipeId, '', '') usaria para DEVOLVER a equipe.
function eventoCliqueNoPool() {
  return {
    target: {
      closest(sel) {
        if (sel === '.pool-alocacao') return {};
        return null;
      },
    },
  };
}

test('GESTO COMPLETO: selecionar no Kanban, trocar pra aba Mapa e clicar no pool NÃO de-aloca a equipe', async () => {
  const cliente = montarClienteAlocacao();
  await cliente.selecionarSemanaAlocacao(1);
  cliente.aplicarMovimento('4', 'SUP-A', 'SP');
  assert.strictEqual(cliente.ESTADO_ALOCACAO.alocacao['4'].sup, 'SUP-A', 'pré-condição: a 4 está alocada em SUP-A');

  // 1º clique de um gesto clique-clique de verdade, disparado pelo listener
  // REAL de #secao-kanban-alocacao (não setando SELECAO_ALOCACAO à mão) --
  // seleciona a equipe 4 e deixa o gesto pendente.
  cliente.document.getElementById('secao-kanban-alocacao').listeners.click(eventoCliqueNoCartao('4'));
  assert.strictEqual(cliente.SELECAO_ALOCACAO.equipeId, '4', 'pré-condição: o 1º clique deixou a seleção pendente');

  // Troca pra aba Mapa -- com a correção, isto encerra a seleção pendente.
  cliente.MAPA_ALOCACAO.instancia = { resize() {} };
  cliente.document.getElementById('aba-mapa-alocacao').listeners.click();

  // Um clique qualquer no pool da aba Mapa -- SEM a correção, este seria
  // tratado como o 2º passo do gesto abandonado (soltar a 4 no pool),
  // devolvendo-a e apagando a alocação em silêncio.
  cliente.document.getElementById('secao-mapa-alocacao').listeners.click(eventoCliqueNoPool());

  assert.deepStrictEqual(normalizar(cliente.ESTADO_ALOCACAO.alocacao['4']), { sup: 'SUP-A', coluna: 'SP' },
    'a troca de aba tinha que ter descartado a seleção -- o clique no pool da aba errada não pode de-alocar a equipe');
});

// --- Camada de rodovias: atribuirCorRodovia (paleta cíclica por ordem de seleção) ---
// Ver docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md,
// Decisão 8.
test('atribuirCorRodovia dá a 1ª cor da paleta pra 1 seleção só', () => {
  const cliente = montarClienteAlocacao();
  const resultado = cliente.atribuirCorRodovia(['10']);
  assert.deepStrictEqual(normalizar(resultado), { '10': cliente.CORES_RODOVIA[0] });
});

test('atribuirCorRodovia dá cores DISTINTAS em ordem pra seleção múltipla', () => {
  const cliente = montarClienteAlocacao();
  const resultado = cliente.atribuirCorRodovia(['10', '15', '22']);
  const cores = normalizar(resultado);
  assert.strictEqual(cores['10'], cliente.CORES_RODOVIA[0]);
  assert.strictEqual(cores['15'], cliente.CORES_RODOVIA[1]);
  assert.strictEqual(cores['22'], cliente.CORES_RODOVIA[2]);
  // as 3 cores são realmente diferentes entre si -- o ponto central do pedido
  const valores = Object.values(cores);
  assert.strictEqual(new Set(valores).size, 3);
});

test('atribuirCorRodovia cicla ao passar do tamanho da paleta', () => {
  const cliente = montarClienteAlocacao();
  const n = cliente.CORES_RODOVIA.length;
  const ids = Array.from({ length: n + 2 }, (_, i) => 'id-' + i);
  const resultado = cliente.atribuirCorRodovia(ids);
  assert.strictEqual(resultado['id-' + n], cliente.CORES_RODOVIA[0], 'a (n+1)-ésima seleção repete a 1ª cor');
  assert.strictEqual(resultado['id-' + (n + 1)], cliente.CORES_RODOVIA[1]);
});

test('atribuirCorRodovia com lista vazia devolve objeto vazio, nunca lança', () => {
  const cliente = montarClienteAlocacao();
  assert.deepStrictEqual(normalizar(cliente.atribuirCorRodovia([])), {});
});

test('CORES_RODOVIA não repete nenhuma cor de CORES_LEITURA_PINO nem de tipologia', () => {
  const cliente = montarClienteAlocacao();
  const reservadas = Object.values(cliente.CORES_LEITURA_PINO).concat([
    '#3f851a', '#2f6ad0', '#8d6f00', '#606060', '#4a3aa7', '#db244e',
  ]).map((c) => c.toLowerCase());
  cliente.CORES_RODOVIA.forEach((cor) => {
    assert.ok(!reservadas.includes(cor.toLowerCase()), cor + ' colide com uma cor reservada de leitura/tipologia');
  });
});

// --- Camada de rodovias: camadasRodoviasDesejadas (função pura) ---
function concessaoSintetica(id, nome, comTrecho) {
  return {
    id, nome, slug: nome.toLowerCase(), cor: '#000000',
    geojson: comTrecho ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-49, -25]] } }] } : null,
  };
}

test('camadasRodoviasDesejadas devolve só as selecionadas COM geojson, com a cor certa', () => {
  const cliente = montarClienteAlocacao();
  const porId = {
    '10': concessaoSintetica('10', 'Autoban', true),
    '99': concessaoSintetica('99', 'Sem Trecho', false),
  };
  const resultado = cliente.camadasRodoviasDesejadas(['10', '99'], porId);
  const normalizado = normalizar(resultado);
  assert.strictEqual(normalizado.length, 1, 'a concessionária sem geojson não vira camada');
  assert.strictEqual(normalizado[0].id, '10');
  assert.strictEqual(normalizado[0].cor, cliente.CORES_RODOVIA[0]);
});

test('camadasRodoviasDesejadas preserva a ordem de seleção nas cores mesmo com uma sem geojson no meio', () => {
  const cliente = montarClienteAlocacao();
  const porId = {
    '10': concessaoSintetica('10', 'Autoban', true),
    '99': concessaoSintetica('99', 'Sem Trecho', false),
    '15': concessaoSintetica('15', 'Sorocabana', true),
  };
  const resultado = cliente.camadasRodoviasDesejadas(['10', '99', '15'], porId);
  const normalizado = normalizar(resultado);
  // '99' consome a posição 1 da ordem mesmo sem virar camada (a cor é atribuída
  // pela ordem de SELEÇÃO, não pela ordem das camadas resultantes) -- '15' fica
  // com a 3ª cor da paleta, não a 2ª.
  assert.strictEqual(normalizado.find((c) => c.id === '15').cor, cliente.CORES_RODOVIA[2]);
});

test('camadasRodoviasDesejadas com lista vazia devolve array vazio', () => {
  const cliente = montarClienteAlocacao();
  assert.deepStrictEqual(normalizar(cliente.camadasRodoviasDesejadas([], {})), []);
});

// --- Camada de rodovias: aoMudarSeletorRodovias (achado Important 4 da revisão
// final -- era a única lógica stateful da feature sem nenhum teste) ---
//
// aoMudarSeletorRodovias chama sincronizarCamadasRodovias() no fim, que retorna
// cedo (`if (!mapa) return;`) quando MAPA_ALOCACAO.instancia é null -- estes
// quatro testes deixam a instância como está (null, o padrão de
// montarClienteAlocacao) de propósito: eles só provam ESTADO_RODOVIAS.ordem,
// que é mantido por aoMudarSeletorRodovias ANTES dessa chamada, então não
// precisam de um mapa de verdade nem de um dublê.
test('aoMudarSeletorRodovias adiciona ao FIM de ESTADO_RODOVIAS.ordem ao marcar', () => {
  const cliente = montarClienteAlocacao();
  cliente.aoMudarSeletorRodovias('10', true);
  cliente.aoMudarSeletorRodovias('15', true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_RODOVIAS.ordem), ['10', '15']);
});

test('aoMudarSeletorRodovias remove de ESTADO_RODOVIAS.ordem ao desmarcar', () => {
  const cliente = montarClienteAlocacao();
  cliente.aoMudarSeletorRodovias('10', true);
  cliente.aoMudarSeletorRodovias('15', true);
  cliente.aoMudarSeletorRodovias('10', false);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_RODOVIAS.ordem), ['15']);
});

test('aoMudarSeletorRodovias marcar uma concessionária já marcada não duplica', () => {
  const cliente = montarClienteAlocacao();
  cliente.aoMudarSeletorRodovias('10', true);
  cliente.aoMudarSeletorRodovias('10', true);
  assert.deepStrictEqual(normalizar(cliente.ESTADO_RODOVIAS.ordem), ['10']);
});

// INTENCIONAL -- pino de comportamento, não regressão a "corrigir": remover
// uma seleção do MEIO da ordem desloca a cor de toda seleção que vinha
// DEPOIS dela, porque atribuirCorRodovia (e camadasRodoviasDesejadas, que a
// chama dentro de sincronizarCamadasRodovias) sempre deriva a cor da POSIÇÃO
// atual em ESTADO_RODOVIAS.ordem, nunca de uma identidade fixa por
// concessionária -- ver o comentário grande acima de atribuirCorRodovia
// (render-alocacao-pagina.js): "Cor é um DIFERENCIADOR da seleção atual, não
// uma identidade fixa da concessionária". Este teste existe pra travar essa
// escolha -- se ele quebrar porque alguém fez a cor "grudar" na
// concessionária, isso é uma mudança de design que precisa ser deliberada,
// não um efeito colateral silencioso.
test('INTENCIONAL: remover uma seleção do MEIO desloca a cor de todas as posteriores', () => {
  const cliente = montarClienteAlocacao();
  cliente.aoMudarSeletorRodovias('10', true); // posição 0 -> CORES_RODOVIA[0]
  cliente.aoMudarSeletorRodovias('15', true); // posição 1 -> CORES_RODOVIA[1]
  cliente.aoMudarSeletorRodovias('22', true); // posição 2 -> CORES_RODOVIA[2]

  cliente.aoMudarSeletorRodovias('15', false); // remove a do meio

  const cores = normalizar(cliente.atribuirCorRodovia(cliente.ESTADO_RODOVIAS.ordem));
  assert.strictEqual(cores['10'], cliente.CORES_RODOVIA[0], '10 continua na 1ª posição -- cor não muda');
  assert.strictEqual(cores['22'], cliente.CORES_RODOVIA[1],
    'por design: 22 passa da 3ª pra 2ª posição e MUDA de cor (era CORES_RODOVIA[2])');
});

// --- Camada de rodovias: sincronizarCamadasRodovias (achado Important 4) ---
//
// Dublê mínimo do MapLibre -- só o que sincronizarCamadasRodovias de fato
// chama (getLayer/getSource pra decidir se remove, addSource/addLayer/
// removeLayer/removeSource pra desenhar), guardando estado próprio (layers/
// sources) pra que getLayer/getSource reflitam o efeito líquido das chamadas
// anteriores, não um mock "sempre presente" -- é isso que permite os testes
// abaixo verificarem o RESULTADO (o que está no mapa depois da chamada), não
// só a lista de chamadas feitas.
function mapaFalsoRodovias() {
  const layers = {};
  const sources = {};
  const chamadas = { addSource: [], addLayer: [], removeLayer: [], removeSource: [] };
  return {
    chamadas,
    getLayer: (id) => layers[id] || null,
    getSource: (id) => sources[id] || null,
    addSource: (id, opcoes) => { sources[id] = opcoes; chamadas.addSource.push(id); },
    addLayer: (opcoes) => { layers[opcoes.id] = opcoes; chamadas.addLayer.push(opcoes); },
    removeLayer: (id) => { delete layers[id]; chamadas.removeLayer.push(id); },
    removeSource: (id) => { delete sources[id]; chamadas.removeSource.push(id); },
  };
}

test('sincronizarCamadasRodovias adiciona a camada certa (id, source, line-color) ao selecionar', () => {
  const cliente = montarClienteAlocacao();
  const mapa = mapaFalsoRodovias();
  cliente.MAPA_ALOCACAO.instancia = mapa;
  cliente.ESTADO_RODOVIAS.concessoesPorId = { 10: concessaoSintetica('10', 'Autoban', true) };
  cliente.ESTADO_RODOVIAS.ordem = ['10'];

  cliente.sincronizarCamadasRodovias();

  assert.deepStrictEqual(mapa.chamadas.addSource, ['rodovia-10']);
  assert.strictEqual(mapa.chamadas.addLayer.length, 1);
  assert.strictEqual(mapa.chamadas.addLayer[0].id, 'rodovia-10');
  assert.strictEqual(mapa.chamadas.addLayer[0].source, 'rodovia-10');
  assert.strictEqual(mapa.chamadas.addLayer[0].paint['line-color'], cliente.CORES_RODOVIA[0]);
  assert.deepStrictEqual(normalizar(cliente.MAPA_ALOCACAO.camadasRodovia), ['10']);
});

test('sincronizarCamadasRodovias: desmarcar uma concessionária tira só ela do mapa, a outra permanece', () => {
  const cliente = montarClienteAlocacao();
  const mapa = mapaFalsoRodovias();
  cliente.MAPA_ALOCACAO.instancia = mapa;
  cliente.ESTADO_RODOVIAS.concessoesPorId = {
    10: concessaoSintetica('10', 'Autoban', true),
    15: concessaoSintetica('15', 'Sorocabana', true),
  };
  cliente.ESTADO_RODOVIAS.ordem = ['10', '15'];
  cliente.sincronizarCamadasRodovias();
  assert.ok(mapa.getLayer('rodovia-10'), 'pré-condição: as duas foram desenhadas');
  assert.ok(mapa.getLayer('rodovia-15'), 'pré-condição: as duas foram desenhadas');

  cliente.ESTADO_RODOVIAS.ordem = ['15']; // desmarca a 10

  cliente.sincronizarCamadasRodovias();

  // NOTA: sincronizarCamadasRodovias redesenha TUDO do zero a cada chamada
  // (mesma filosofia de desenharPinosMapa, ver o comentário na função) -- por
  // baixo dos panos as DUAS camadas são removidas e só a 15 é recriada, não é
  // uma remoção seletiva. O que este teste trava é o RESULTADO visível: a
  // camada desmarcada some do mapa, a que continua marcada continua nele.
  assert.strictEqual(mapa.getLayer('rodovia-10'), null, 'a camada desmarcada tem que sumir do mapa');
  assert.ok(mapa.getLayer('rodovia-15'), 'a camada que continua marcada tem que continuar no mapa');
  assert.deepStrictEqual(normalizar(cliente.MAPA_ALOCACAO.camadasRodovia), ['15']);
});

test('sincronizarCamadasRodovias escreve a legenda com as concessionárias selecionadas', () => {
  const cliente = montarClienteAlocacao();
  const mapa = mapaFalsoRodovias();
  cliente.MAPA_ALOCACAO.instancia = mapa;
  cliente.ESTADO_RODOVIAS.concessoesPorId = { 10: concessaoSintetica('10', 'Autoban', true) };
  cliente.ESTADO_RODOVIAS.ordem = ['10'];

  cliente.sincronizarCamadasRodovias();

  const legendaHtml = cliente.document.getElementById('mapa-alocacao-rodovias-legenda').innerHTML;
  assert.match(legendaHtml, /Autoban/);
  assert.match(legendaHtml, new RegExp(cliente.CORES_RODOVIA[0]));
});

test('sincronizarCamadasRodovias sem nenhuma seleção deixa a legenda vazia', () => {
  const cliente = montarClienteAlocacao();
  const mapa = mapaFalsoRodovias();
  cliente.MAPA_ALOCACAO.instancia = mapa;
  cliente.ESTADO_RODOVIAS.ordem = [];

  cliente.sincronizarCamadasRodovias();

  const legendaHtml = cliente.document.getElementById('mapa-alocacao-rodovias-legenda').innerHTML;
  assert.strictEqual(legendaHtml, '');
});

test('sincronizarCamadasRodovias sem mapa (MAPA_ALOCACAO.instancia null) não lança', () => {
  const cliente = montarClienteAlocacao();
  cliente.ESTADO_RODOVIAS.ordem = ['10'];
  assert.doesNotThrow(() => cliente.sincronizarCamadasRodovias());
});
