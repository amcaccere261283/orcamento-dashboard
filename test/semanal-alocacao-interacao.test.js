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

// Evento de clique falso pro handler DELEGADO de #secao-alocacao (clique-clique
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
  // Dispara o handler de 'click' REAL de #secao-alocacao (não uma chamada
  // isolada de destacarCelulasCompativeis) -- é o call site onde o achado
  // achou o bug, e é ele que a prova por mutação abaixo precisa pegar.
  cliente.document.getElementById('secao-alocacao').listeners.click(eventoCliqueNoCartao('4'));

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

  cliente.document.getElementById('secao-alocacao').listeners.click(eventoCliqueNoCartao('4'));

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
