'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderAbaConsolidado, renderControles, renderCabecalho, colunasExtras, dimensaoDaTabela,
  produtividadeEsperada, ticketMedioPrevisto, somarPrevistoMes,
  blocosPorSup, tipologiasPresentes, formatarChaveSemana,
} = require('../tools/semanal/render-aba-consolidado.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');
const { chaveMatriz } = require('../tools/comum/linha-base.js');

const ANO = 2026;
const JULHO = 6; // 5 semanas reais, [5,7,7,7,5] dias de 31
const SEMANAS = semanasDoMes(ANO, JULHO);

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(ANO, JULHO, dia))); }

// totalVolume/totalFinanceiro (linha T do orçamento): 0 por padrão, mesma
// convenção de "T ausente" usada no resto da suíte -- só os testes que
// precisam de uma Tendência não-nula (para distinguir dois cálculos, por
// exemplo) passam um valor.
function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', volume = 0, financeiro = 0, equipes = 0, prod = null, ticket = null, totalVolume = 0, totalFinanceiro = 0 }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo, tomador, origem: 'CONTRATO VIGENTE',
    previsto: {
      volume: mk(volume), financeiro: mk(financeiro), equipes: mk(equipes),
      equipesResumo: { prod }, volumeResumo: { ticket },
    },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: mk(totalVolume), financeiro: mk(totalFinanceiro), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
  };
}

function demandasCom(eventosPorChave) {
  const porRegistroEventos = {};
  Object.keys(eventosPorChave).forEach((chave) => {
    porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: eventosPorChave[chave] };
  });
  return { porRegistroEventos };
}

function opcoes(extra) {
  return Object.assign({
    semanaIdx: 0, dimensao: 'volume', mesIdx: JULHO, semanas: SEMANAS,
    demandas: demandasCom({}), hojeEpoch: diaJul(31),
  }, extra || {});
}

function linhasDe(html) {
  return (html.match(/<tr class="[^"]*">[\s\S]*?<\/tr>/g) || []);
}

function celulasDe(linha) {
  return (linha.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map((td) => td.replace(/<[^>]*>/g, ''));
}

// --- Sai o Previsto, entra a Tendência congelada (2026-08-04) --------------

// 6 furos na S1 (02/07) e 20 na S2 (08/07). Com hoje em 15/07 (dentro da S3),
// a S2 está encerrada e a S3 em curso.
function demandasEspalhadas() {
  const dias = [];
  for (let i = 0; i < 6; i++) dias.push(diaJul(2));
  for (let i = 0; i < 20; i++) dias.push(diaJul(8));
  return demandasCom({ 'SUP-A||ST': dias });
}
const REGISTROS_A = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
const inteiro = (v) => Math.round(v).toLocaleString('pt-BR');

test('o Realizado exibido continua sendo o de HOJE, nao o congelado', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 1, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15),
  }));
  const celulas = celulasDe(linhasDe(html).filter((l) => l.indexOf('linha-consolidado') !== -1)[0]);
  // Layout novo (Task 4): SUP/Grupo/Tomador/Tipologia/Previsto ate a
  // data/Realizado/Desvio ate a data/Semana total -- Realizado e a 6a
  // celula (indice 5, zero-based).
  assert.strictEqual(celulas[5], '20',
    'a S2 teve 20 furos; congelar o Realizado no 1o dia dela daria 0');
});

// HISTÓRICO -- leia antes de "consertar" este teste.
//
// Ele nasceu de uma lacuna achada por mutação em 2026-08-04: trocar
// ctx.indiceAtualEfetivo por ctx.indiceAtual na chamada congelada
// (render-aba-consolidado.js) deixava a bateria INTEIRA verde. A fixture
// original punha 30 furos em 06/07 (1º dia da S2), congelava a S2 e esperava
// 97 -- contra 74 com o índice trocado.
//
// A regra de 2026-08-10 ("realizado sempre considerar até d-1") APAGOU essa
// diferença por um tempo: congelar ancora hojeEfetivo no PRIMEIRO dia da
// semana k, e com o corte em d-1 a janela de Realizado dela ia de
// semanas[k].inicio até semanas[k].inicio - 1 -- vazia por construção.
//
// O corte em HOJE (2026-08-17, ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md) DEVOLVEU a
// diferença: a janela da semana ancorada passa a ser [inicio, inicio], um dia
// -- justamente o dia em que a fixture põe os 30 furos. O esperado voltou a
// ser 97, o mesmo número da fixture original, e o parâmetro
// ctx.indiceAtualEfetivo voltou a ser observável aqui (com ctx.indiceAtual no
// lugar dele, o teste falha de novo).
//
// O que este teste prende agora é o mecanismo que sobrou e importa: a
// Tendência congelada é RECALCULADA na âncora, e por isso a semana ancorada
// não carrega nenhum Realizado dela mesma -- é a projeção que se fazia para
// a semana inteira no dia em que ela começou.
test('a Tendência congelada é recalculada na âncora: a semana ancorada não conta Realizado dela mesma', () => {
  // T = 310 (igual ao Previsto usado no resto da bateria) só pra ter uma
  // Tendência não-nula aqui -- sem T preenchido, a congelada e o Realizado
  // exibido não têm nada a distinguir além de zero, e o teste não provaria nada.
  const registrosComT = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310, totalVolume: 310 })];
  const eventos = [];
  for (let i = 0; i < 30; i++) eventos.push(diaJul(6)); // 06/07 = 1º dia da S2
  const html = renderAbaConsolidado(registrosComT, [0], opcoes({
    semanaIdx: 1, demandas: demandasCom({ 'SUP-A||ST': eventos }), hojeEpoch: diaJul(15),
  }));
  const celulas = celulasDe(linhasDe(html).filter((l) => l.indexOf('linha-consolidado') !== -1)[0]);
  // Layout novo (Task 4): SUP/Grupo/Tomador/Tipologia/Previsto ate a
  // data/Realizado/Desvio ate a data/Semana total -- a congelada aparece
  // agora em "Semana total" (indice 7, zero-based), que e' janela.tendencia.
  assert.strictEqual(celulas[7], '97',
    'os 30 furos de 06/07 ENTRAM: com o corte em HOJE, a janela da S2 ancorada em 06/07 é o próprio dia 06/07');

  // E o Realizado exibido NUNCA congela -- ele sai do hoje real, então os
  // mesmos 30 furos aparecem nele. É o contraste que prova que são duas
  // séries com âncoras diferentes, não uma só.
  assert.strictEqual(celulas[5], '30',
    'o Realizado da S2 vê os 30 furos de 06/07, porque é calculado com o hoje real (15/07)');
});

// --- Resumo por SUP x Tipologia (substitui Realizado/Tendencia/premissas, Task 4) --

test('resumo mostra Previsto ate a data / Realizado / Desvio ate a data / Semana total, por SUP e tipologia', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({ demandas: demandasEspalhadas(), hojeEpoch: diaJul(15) }));
  assert.match(html, /Previsto até a data/);
  assert.match(html, /Realizado/);
  assert.match(html, /Desvio até a data/);
  assert.match(html, /Semana total/);
});

test('com congeladoSemanal presente para a semana em tela, a Tendencia exibida vem do snapshot (nao do recalculo)', () => {
  const opcoesBase = opcoes({ semanaIdx: 1, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15) });
  const chaveSemana = formatarChaveSemana(opcoesBase.semanas[opcoesBase.semanaIdx].inicio);
  const congeladoSemanal = {
    [chaveSemana]: { porRegistro: { [chaveMatriz(REGISTROS_A[0].sup, REGISTROS_A[0].tipologia)]: { volume: { tendencia: 12345 } } } },
  };
  const html = renderAbaConsolidado(REGISTROS_A, [0], Object.assign({}, opcoesBase, { congeladoSemanal }));
  assert.match(html, /12\.345/); // formatarNumero(12345, 0) -> '12.345' em pt-BR
  assert.match(html, /congelada/i);
});

test('sem entrada no snapshot para a semana em tela, cai no recalculo de hoje e rotula "recalculada"', () => {
  const opcoesBase = opcoes({ semanaIdx: 1, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15) });
  const html = renderAbaConsolidado(REGISTROS_A, [0], Object.assign({}, opcoesBase, { congeladoSemanal: {} }));
  assert.match(html, /recalculada/i);
});

// --- Abertura de linhas: a hierarquia da Tabela do orçamento --------------

test('a tabela abre nas mesmas 4 aberturas do orçamento: TOTAL GERAL, total por tipologia, cada registro do SUP e o TOTAL do SUP', () => {
  const registros = [
    registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 }),
    registro({ sup: 'SUP-A', tipologia: 'PI', volume: 62 }),
    registro({ sup: 'SUP-B', tipologia: 'ST', volume: 155 }),
  ];
  const html = renderAbaConsolidado(registros, [0, 1, 2], opcoes());
  const rotulos = linhasDe(html).map((l) => celulasDe(l).slice(0, 4).join('|'));
  assert.deepStrictEqual(rotulos, [
    '—|Todos|Todos|TOTAL GERAL',
    '—|Todos|Todos|PI',            // totais por tipologia, alfabéticos
    '—|Todos|Todos|ST',
    'SUP-A|Grupo-A|Tomador-A|ST',  // registros do SUP-A, na ordem da MATRIZ
    'SUP-A|Grupo-A|Tomador-A|PI',
    'SUP-A|Grupo-A|Tomador-A|TOTAL',
    'SUP-B|Grupo-A|Tomador-A|ST',
    'SUP-B|Grupo-A|Tomador-A|TOTAL',
  ]);
});

test('blocosPorSup preserva a ordem em que os SUPs aparecem na MATRIZ; tipologiasPresentes ordena alfabeticamente', () => {
  const registros = [registro({ sup: 'SUP-Z', tipologia: 'ST' }), registro({ sup: 'SUP-A', tipologia: 'BL' })];
  assert.deepStrictEqual(blocosPorSup(registros, [0, 1]).map((b) => b.sup), ['SUP-Z', 'SUP-A']);
  assert.deepStrictEqual(tipologiasPresentes(registros, [0, 1]).map((b) => b.tipologia), ['BL', 'ST']);
});

test('as linhas de total carregam as MESMAS classes que o CSS compartilhado já estiliza no orçamento', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  const html = renderAbaConsolidado(registros, [0], opcoes());
  assert.match(html, /<tr class="linha-total-geral">/);
  assert.match(html, /<tr class="linha-total-geral linha-total-geral-tipologia">/);
  assert.match(html, /<tr class="linha-total-sup">/);
  assert.match(html, /tipologia-chip-total chip-total-geral/);
});

// --- Só a semana selecionada -----------------------------------------------

// Previsto saiu da tabela (2026-08-04) -- o que restou como colunas de série
// escaláveis por semana é Realizado/Tendência. Adaptado do teste original
// (que media o Previsto por semana) para provar o mesmo ponto com a coluna
// que sobrou: o valor exibido é o da SEMANA escolhida, nunca o do mês
// inteiro. 3 furos na S1 (02/07), 5 na S2 (08/07) -- semanas distintas dão
// números distintos.
test('a coluna Realizado é da SEMANA escolhida, não do mês', () => {
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const eventos = [diaJul(2), diaJul(2), diaJul(2), diaJul(8), diaJul(8), diaJul(8), diaJul(8), diaJul(8)];
  const demandas = demandasCom({ 'SUP-A||ST': eventos });
  const html = (semanaIdx) => renderAbaConsolidado(registros, [0], opcoes({ semanaIdx, demandas, hojeEpoch: diaJul(15) }));
  // Layout novo (Task 4): Realizado é a 6ª célula (índice 5, zero-based) --
  // SUP/Grupo/Tomador/Tipologia/Previsto até a data/Realizado/...
  const realizadoDe = (h) => celulasDe(linhasDe(h)[0])[5];
  assert.strictEqual(realizadoDe(html(0)), '3');
  assert.strictEqual(realizadoDe(html(1)), '5');
});

test('o Realizado da semana conta só os furos concluídos DENTRO dela', () => {
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const eventos = [diaJul(2), diaJul(3), diaJul(4), diaJul(20)]; // 3 em S1, 1 em S3
  const html = renderAbaConsolidado(registros, [0], opcoes({
    semanaIdx: 0, demandas: demandasCom({ 'SUP-A||ST': eventos }),
  }));
  // Layout novo (Task 4): Realizado é a 6ª célula (índice 5, zero-based).
  assert.strictEqual(celulasDe(linhasDe(html)[0])[5], '3');
});

test('o seletor de semana lista S1..Sn com as datas reais e marca a escolhida', () => {
  // Sem 'dimensao': renderControles nunca leu esse campo, e ele saiu da
  // chamada de produção junto com o seletor próprio de dimensão.
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 2 });
  assert.match(html, /<option value="0">S1 \(01\/07 a 05\/07\)<\/option>/);
  assert.match(html, /<option value="2" selected>S3 \(13\/07 a 19\/07\)<\/option>/);
  assert.strictEqual((html.match(/<option value="\d"/g) || []).length, 5);
});

test('semanaIdx fora da faixa é clampado em vez de produzir coluna vazia', () => {
  // Sem Previsto pra ler (saiu da tabela), o clamp é provado pelo Realizado:
  // 3 furos plantados só na S5 (27/07 a 31/07), com hoje já em agosto (S5
  // fechada). semanaIdx:99 tem de clampar em 4 (S5) e mostrar os 3 furos --
  // uma coluna vazia ou outra semana dariam 0 ou outro número.
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const eventos = [diaJul(28), diaJul(29), diaJul(30)];
  const emAgosto = diaEpoch(new Date(Date.UTC(ANO, 7, 3)));
  const html = renderAbaConsolidado(registros, [0], opcoes({
    semanaIdx: 99, demandas: demandasCom({ 'SUP-A||ST': eventos }), hojeEpoch: emAgosto,
  }));
  // Layout novo (Task 4): Realizado é a 6ª célula (índice 5, zero-based).
  assert.strictEqual(celulasDe(linhasDe(html)[0])[5], '3', 'clampa na última semana (S5) e conta os 3 furos dela');
});

// --- Volume x Financeiro: nunca misturados ---------------------------------

// As colunas de premissa (Equipes previstas/Produtividade/Ticket médio)
// saíram da tabela do Consolidado no Task 4 -- o resumo é só Previsto até a
// data/Realizado/Desvio até a data/Semana total. colunasExtras/valorExtra/
// produtividadeEsperada/ticketMedioPrevisto continuam exportadas (podem ter
// outro consumidor) e mantêm cobertura própria, só não aparecem mais no HTML
// de renderCabecalho/renderAbaConsolidado -- por isso os testes abaixo
// verificam só as funções puras, não mais o markup.
test('em Volume as colunas extras são Equipes previstas e Produtividade média esperada -- ticket não aparece', () => {
  assert.deepStrictEqual(colunasExtras('volume').map((c) => c.chave), ['equipes', 'produtividade']);
});

test('em Financeiro a única coluna extra é o Ticket médio -- equipes e produtividade não aparecem', () => {
  assert.deepStrictEqual(colunasExtras('financeiro').map((c) => c.chave), ['ticket']);
});

test('o cabeçalho carrega o intervalo de datas da semana e o rótulo (congelada)/(recalculada)', () => {
  const congelada = renderCabecalho('volume', SEMANAS[0], true);
  assert.match(congelada, /Previsto até a data \(01\/07 a 05\/07\) \(congelada\)/);
  const recalculada = renderCabecalho('volume', SEMANAS[0], false);
  assert.match(recalculada, /Previsto até a data \(01\/07 a 05\/07\) \(recalculada\)/);
  assert.match(recalculada, /<th class="num">Realizado<\/th>/);
  assert.match(recalculada, /<th class="num">Desvio até a data<\/th>/);
  assert.match(recalculada, /<th class="num">Semana total<\/th>/);
});

test('a nota da aba diz, na tela, que Realizado e Tendência são da semana e a Tendência de semana já começada é a congelada', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  assert.match(renderAbaConsolidado(registros, [0], opcoes()), /a Tendência exibida é a CONGELADA no 1º dia dela/i);
});

// --- As premissas: mesma regra de dois ramos do orçamento (funções puras, --
// não aparecem mais na tabela do Consolidado desde o Task 4) ---------------

test('equipes previstas somam através dos registros do grupo (times simultâneos se somam) e não se repartem por semana', () => {
  const registros = [registro({ sup: 'SUP-A', equipes: 2 }), registro({ sup: 'SUP-B', equipes: 3 })];
  assert.strictEqual(somarPrevistoMes(registros, [0, 1], 'equipes', JULHO), 5);
});

test('produtividade de UM registro é a premissa PROD. da planilha, lida direto', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2, prod: 8.5 })];
  assert.strictEqual(produtividadeEsperada(registros, [0], JULHO), 8.5);
});

test('produtividade de um AGREGADO recalcula volume ÷ (equipes x dias-premissa) -- a média das premissas não é a premissa da soma', () => {
  const registros = [
    registro({ sup: 'SUP-A', volume: 600, equipes: 1, prod: 20 }),
    registro({ sup: 'SUP-B', volume: 600, equipes: 3, prod: 6.67 }),
  ];
  const esperado = 1200 / (4 * DIAS_PREMISSA_MES[JULHO]);
  assert.ok(Math.abs(produtividadeEsperada(registros, [0, 1], JULHO) - esperado) < 1e-9);
  assert.strictEqual(DIAS_PREMISSA_MES[JULHO], 30, 'pré-condição: julho usa a premissa de 30 dias, não os 31 do calendário');
});

test('ticket de UM registro é a premissa TICKET; de um agregado, financeiro ÷ volume', () => {
  const registros = [
    registro({ sup: 'SUP-A', volume: 100, financeiro: 50000, ticket: 500 }),
    registro({ sup: 'SUP-B', volume: 100, financeiro: 30000, ticket: 300 }),
  ];
  assert.strictEqual(ticketMedioPrevisto(registros, [0], JULHO), 500);
  assert.strictEqual(ticketMedioPrevisto(registros, [0, 1], JULHO), 400); // 80000 / 200
});

test('premissa ausente vira null, nunca zero -- sem PROD./TICKET cadastrado não há premissa a calcular', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2 })]; // prod/ticket null
  assert.strictEqual(produtividadeEsperada(registros, [0], JULHO), null);
  assert.strictEqual(ticketMedioPrevisto(registros, [0], JULHO), null);
});

test('agregado sem equipes lançadas não vira divisão por zero -- devolve sem dado', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 }), registro({ sup: 'SUP-B', volume: 310 })];
  assert.strictEqual(produtividadeEsperada(registros, [0, 1], JULHO), null);
});

// --- Bordas ----------------------------------------------------------------

test('mês sem semanas devolve os controles e um aviso, em vez de uma tabela vazia sem explicação', () => {
  const html = renderAbaConsolidado([], [], opcoes({ semanas: [] }));
  assert.match(html, /nada a consolidar/);
  assert.doesNotMatch(html, /<table/);
});

test('recorte vazio (todos os registros filtrados fora) rende só o TOTAL GERAL, sem quebrar', () => {
  const html = renderAbaConsolidado([registro({ sup: 'SUP-A', volume: 310 })], [], opcoes());
  assert.strictEqual(linhasDe(html).length, 1);
  assert.match(html, /TOTAL GERAL/);
});

// --- Achados da revisão de design do Open Design (2026-08-03) --------------
// As classes .celula-premissa/.cabecalho-premissa desenhavam a faixa das
// colunas de premissa -- essas colunas saíram da tabela do Consolidado no
// Task 4, então as classes não são mais emitidas por renderCabecalho/
// renderAbaConsolidado. Os três testes que prendiam essa faixa saíram junto;
// colunasExtras continua com cobertura própria acima.

test('ticket medio previsto sai inteiro', () => {
  const colunas = colunasExtras('financeiro');
  assert.strictEqual(colunas.length, 1);
  assert.strictEqual(colunas[0].chave, 'ticket');
  assert.strictEqual(colunas[0].casas, 0);
});

// Mesmo CRITICAL da aba Alertas: a "semana em curso" saía de elapsadas-1 em
// vez de indiceSemanaAtual, e num mês passado isso fazia a última semana ser
// contada de seu início até HOJE, absorvendo os meses seguintes.
test('num mês PASSADO, o Realizado da semana não absorve furos dos meses seguintes', () => {
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const emAgosto = (dia) => diaEpoch(new Date(Date.UTC(ANO, 7, dia)));
  const eventos = [
    diaJul(28), diaJul(29), diaJul(30),                 // 3 na S5 de julho
    emAgosto(1), emAgosto(2), emAgosto(3),              // 3 em agosto
  ];
  const html = renderAbaConsolidado(registros, [0], opcoes({
    semanaIdx: 4, // S5 de julho (27/07 a 31/07)
    demandas: demandasCom({ 'SUP-A||ST': eventos }),
    hojeEpoch: emAgosto(3), // olhando JULHO em 03/08
  }));
  // Layout novo (Task 4): Realizado é a 6ª célula (índice 5, zero-based).
  assert.strictEqual(celulasDe(linhasDe(html)[0])[5], '3', 'só os 3 furos da S5 de julho');
});

test('as linhas de total NÃO emitem a classe .linha-total -- as regras de fechamento desta aba são próprias, e reusar aquela classe herdaria a cor de série Tendência', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  const html = renderAbaConsolidado(registros, [0], opcoes());
  // \b não serve aqui: em "linha-total-geral" o hífen é não-palavra, então
  // \blinha-total\b casaria dentro dela. (?![-\w]) exige que o nome TERMINE.
  assert.doesNotMatch(html, /class="[^"]*linha-total(?![-\w])/);
  assert.match(html, /<tr class="linha-total-geral">/);
  assert.match(html, /<tr class="linha-total-sup">/);
});

// --- Seletor de dimensão PRÓPRIO saiu (2026-08-04) --------------------------
// A aba passou a usar a dimensão da barra compartilhada -- quem chama
// renderAbaConsolidado (render-semanal.js, montarAbaConsolidado) já resolve
// dimensoes[0] e passa em opcoes.dimensao, exatamente como antes; o que muda é
// que renderControles não emite mais um <select> próprio pra escolher isso.

test('o seletor proprio de dimensao nao existe mais nos controles', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({ demandas: demandasEspalhadas(), hojeEpoch: diaJul(15) }));
  assert.strictEqual(html.indexOf('id="consolidado-dimensao"'), -1);
  assert.ok(html.indexOf('id="consolidado-semana"') !== -1, 'o de semana continua -- e proprio da aba');
});

// --- Coerção de dimensão e a nota de tela (revisão final, 2026-08-04) -------
// A barra compartilhada tem TRÊS dimensões e esta tabela só desenha duas.
// A coerção era uma expressão solta dentro de renderAbaConsolidado, e quem
// chamava (montarAbaConsolidado) recortava os índices ativos pela dimensão
// CRUA -- filtrando por equipes uma tabela que exibia Volume. Virou função
// exportada justamente para não haver duas cópias da regra.

test('dimensaoDaTabela coage: so financeiro fica: equipes (e qualquer outra coisa) cai em volume', () => {
  assert.strictEqual(dimensaoDaTabela('financeiro'), 'financeiro');
  assert.strictEqual(dimensaoDaTabela('volume'), 'volume');
  assert.strictEqual(dimensaoDaTabela('equipes'), 'volume');
  assert.strictEqual(dimensaoDaTabela(undefined), 'volume');
});

test('com a barra em Equipes, a aba avisa NA TELA que os numeros exibidos sao de Volume', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2, prod: 5 })];
  const html = renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'equipes' }));
  // Mesma gramática visual da nota do bloco de alertas de tendência
  // (render-alertas-tendencia.js): <tr>/<td colspan> dentro do <tbody>.
  assert.match(html, /<tr class="linha-nota-alertas"><td colspan="8">/);
  assert.match(html, /Equipes<\/strong> não se aplica ao Consolidado/);
  assert.match(html, /são de <strong>Volume<\/strong>/);
});

test('em Volume e em Financeiro nao ha nota de dimensao -- a barra e a tabela concordam', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, financeiro: 50000, ticket: 500 })];
  assert.strictEqual(renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'volume' })).indexOf('linha-nota-alertas'), -1);
  assert.strictEqual(renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'financeiro' })).indexOf('linha-nota-alertas'), -1);
});

test('o colspan da nota cobre a tabela inteira -- uma nota mais curta que o cabecalho deixaria a linha torta', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  // `/<th[ >]/` e não `/<th/`: este último casa também dentro de "<thead>".
  const contarThs = (h) => (h.match(/<th[ >]/g) || []).length;
  // 4 colunas de texto + as 4 do resumo (Previsto até a data/Realizado/
  // Desvio até a data/Semana total) = 8, para qualquer dimensão (as colunas
  // de premissa saíram da tabela no Task 4).
  const emVolume = renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'equipes' }));
  assert.strictEqual(contarThs(emVolume), 8);
  assert.match(emVolume, /<td colspan="8">/);
});

test('renderControles inclui o botão "Gerar relatório Excel" e o span de status, ao lado do seletor de semana', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 0 });
  assert.match(html, /<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel<\/button>/);
  assert.match(html, /<span id="status-relatorio-excel" class="status-atualizacao"><\/span>/);
});
