'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderAbaConsolidado, renderControles, renderCabecalho, colunasExtras,
  produtividadeEsperada, ticketMedioPrevisto, somarPrevistoMes,
  blocosPorSup, tipologiasPresentes,
} = require('../tools/semanal/render-aba-consolidado.js');
const { semanasDoMes, diaEpoch, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
const { DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');

const ANO = 2026;
const JULHO = 6; // 5 semanas reais, [5,7,7,7,5] dias de 31
const SEMANAS = semanasDoMes(ANO, JULHO);

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(ANO, JULHO, dia))); }

function registro({ sup, tipologia = 'ST', grupo = 'Grupo-A', tomador = 'Tomador-A', volume = 0, financeiro = 0, equipes = 0, prod = null, ticket = null }) {
  const zeros = () => new Array(12).fill(0);
  const mk = (v) => { const a = zeros(); a[JULHO] = v; return a; };
  return {
    sup, tipologia, grupo, tomador, origem: 'CONTRATO VIGENTE',
    previsto: {
      volume: mk(volume), financeiro: mk(financeiro), equipes: mk(equipes),
      equipesResumo: { prod }, volumeResumo: { ticket },
    },
    realizado: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
    total: { volume: zeros(), financeiro: zeros(), equipes: zeros(), equipesResumo: {}, volumeResumo: {} },
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

test('a coluna Previsto sumiu do Consolidado', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 1, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15),
  }));
  const cabecalho = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.strictEqual(cabecalho.indexOf('>Previsto'), -1, 'Previsto nao pode mais ser coluna');
  assert.ok(cabecalho.indexOf('>Realizado') !== -1);
  assert.ok(cabecalho.indexOf('Tend') !== -1);
});

test('semana encerrada: a Tendencia e a CONGELADA no 1o dia dela, nao a projecao de hoje', () => {
  const demandas = demandasEspalhadas();
  const hoje = diaJul(15);
  const inicioS2 = SEMANAS[1].inicio;
  const serie = (epoch) => calcularSeriesSemanaisDimensao(
    REGISTROS_A, [0], 'volume', JULHO, SEMANAS, SEMANAS.length, true,
    indiceSemanaAtual(SEMANAS, epoch), demandas, epoch
  ).semanasTendenciaCompleta[1];
  const congelada = serie(inicioS2);
  const aoVivo = serie(hoje);
  assert.notStrictEqual(inteiro(congelada), inteiro(aoVivo),
    'a fixture precisa produzir valores DIFERENTES, senao o teste nao prova nada');

  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 1, demandas, hojeEpoch: hoje,
  }));
  const celulas = celulasDe(linhasDe(html).filter((l) => l.indexOf('linha-consolidado') !== -1)[0]);
  assert.strictEqual(celulas[5], inteiro(congelada), 'a celula de Tendencia traz a congelada');
});

test('o Realizado exibido continua sendo o de HOJE, nao o congelado', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 1, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15),
  }));
  const celulas = celulasDe(linhasDe(html).filter((l) => l.indexOf('linha-consolidado') !== -1)[0]);
  assert.strictEqual(celulas[4], '20',
    'a S2 teve 20 furos; congelar o Realizado no 1o dia dela daria 0');
});

test('semana futura usa a projecao de hoje, e o cabecalho diz isso', () => {
  const html = renderAbaConsolidado(REGISTROS_A, [0], opcoes({
    semanaIdx: 4, demandas: demandasEspalhadas(), hojeEpoch: diaJul(15),
  }));
  const cabecalho = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.ok(cabecalho.indexOf('projeção de hoje') !== -1);
  assert.strictEqual(cabecalho.indexOf('congelada'), -1);
});

test('semana encerrada e semana em curso trazem a data-ancora no cabecalho', () => {
  const demandas = demandasEspalhadas();
  const encerrada = renderAbaConsolidado(REGISTROS_A, [0], opcoes({ semanaIdx: 1, demandas, hojeEpoch: diaJul(15) }));
  assert.ok(encerrada.indexOf('congelada em 06/07') !== -1, 'a S2 comeca em 06/07');
  const emCurso = renderAbaConsolidado(REGISTROS_A, [0], opcoes({ semanaIdx: 2, demandas, hojeEpoch: diaJul(15) }));
  assert.ok(emCurso.indexOf('congelada em 13/07') !== -1, 'a S3 comeca em 13/07');
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
  const realizadoDe = (h) => celulasDe(linhasDe(h)[0])[4];
  assert.strictEqual(realizadoDe(html(0)), '3');
  assert.strictEqual(realizadoDe(html(1)), '5');
});

test('o Realizado da semana conta só os furos concluídos DENTRO dela', () => {
  const registros = [registro({ sup: 'SUP-A', tipologia: 'ST', volume: 310 })];
  const eventos = [diaJul(2), diaJul(3), diaJul(4), diaJul(20)]; // 3 em S1, 1 em S3
  const html = renderAbaConsolidado(registros, [0], opcoes({
    semanaIdx: 0, demandas: demandasCom({ 'SUP-A||ST': eventos }),
  }));
  // Previsto saiu da tabela: Realizado agora é a 5ª célula ([4], zero-based).
  assert.strictEqual(celulasDe(linhasDe(html)[0])[4], '3');
});

test('o seletor de semana lista S1..Sn com as datas reais e marca a escolhida', () => {
  const html = renderControles({ semanas: SEMANAS, semanaIdx: 2, dimensao: 'volume' });
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
  assert.strictEqual(celulasDe(linhasDe(html)[0])[4], '3', 'clampa na última semana (S5) e conta os 3 furos dela');
});

// --- Volume x Financeiro: nunca misturados ---------------------------------

test('em Volume as colunas extras são Equipes previstas e Produtividade média esperada -- ticket não aparece', () => {
  assert.deepStrictEqual(colunasExtras('volume').map((c) => c.chave), ['equipes', 'produtividade']);
  const html = renderCabecalho('volume', SEMANAS[0]);
  assert.match(html, /<th class="num cabecalho-premissa cabecalho-premissa-inicio">Equipes previstas<\/th>/);
  assert.match(html, /<th class="num cabecalho-premissa">Produtividade média esperada<\/th>/);
  assert.doesNotMatch(html, /Ticket/);
});

test('em Financeiro a única coluna extra é o Ticket médio -- equipes e produtividade não aparecem', () => {
  assert.deepStrictEqual(colunasExtras('financeiro').map((c) => c.chave), ['ticket']);
  const html = renderCabecalho('financeiro', SEMANAS[0]);
  assert.match(html, /<th class="num cabecalho-premissa cabecalho-premissa-inicio">Ticket médio previsto \(R\$\/furo\)<\/th>/);
  assert.doesNotMatch(html, /Equipes previstas/);
  assert.doesNotMatch(html, /Produtividade/);
});

test('o cabeçalho carrega o intervalo de datas da semana nas 2 colunas de série', () => {
  // Previsto saiu; a Tendência sem congelamento (3º argumento omitido) rende
  // com o rótulo "(projeção de hoje)" ANTES do intervalo da semana.
  const html = renderCabecalho('volume', SEMANAS[0]);
  assert.match(html, /Realizado \(01\/07 a 05\/07\)/);
  assert.match(html, /Tendência \(projeção de hoje\) \(01\/07 a 05\/07\)/);
});

test('a nota da aba diz, na tela, que as premissas são do mês e as séries são da semana', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310 })];
  assert.match(renderAbaConsolidado(registros, [0], opcoes()), /Equipes previstas são a foto do mês|equipes previstas são a foto do mês/i);
  assert.match(renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'financeiro' })), /ticket médio previsto é a premissa TICKET/i);
});

// --- As premissas: mesma regra de dois ramos do orçamento ------------------

test('equipes previstas somam através dos registros do grupo (times simultâneos se somam) e não se repartem por semana', () => {
  const registros = [registro({ sup: 'SUP-A', equipes: 2 }), registro({ sup: 'SUP-B', equipes: 3 })];
  assert.strictEqual(somarPrevistoMes(registros, [0, 1], 'equipes', JULHO), 5);
  const html = (semanaIdx) => renderAbaConsolidado(registros, [0, 1], opcoes({ semanaIdx }));
  // Previsto saiu da tabela: Equipes previstas passou de [7] pra [6].
  const equipesDe = (h) => celulasDe(linhasDe(h)[0])[6];
  assert.strictEqual(equipesDe(html(0)), '5,00');
  assert.strictEqual(equipesDe(html(3)), '5,00', 'a foto do mês é a mesma em qualquer semana');
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

test('premissa ausente vira "—", nunca zero -- sem PROD./TICKET cadastrado não há premissa a mostrar', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2 })]; // prod/ticket null
  assert.strictEqual(produtividadeEsperada(registros, [0], JULHO), null);
  assert.strictEqual(ticketMedioPrevisto(registros, [0], JULHO), null);
  assert.match(renderAbaConsolidado(registros, [0], opcoes()), /<td class="num celula-premissa">—<\/td>/);
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
// A faixa que separa "colunas da semana" de "colunas do mês" é desenhada por
// CLASSE, não por posição: a versão sugerida na revisão usava
// :nth-child(n+8), que quebra em silêncio no dia em que uma coluna entrar ou
// sair. Estes testes prendem as classes que o CSS depende.

test('as colunas de premissa carregam .celula-premissa no corpo e .cabecalho-premissa no cabeçalho -- a faixa começa no rótulo, não uma linha abaixo dele', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2, prod: 5 })];
  const html = renderAbaConsolidado(registros, [0], opcoes());
  // Volume tem 2 premissas (equipes + produtividade); o cabeçalho tem uma
  // marcação por coluna, e o corpo uma por coluna POR LINHA.
  assert.strictEqual((html.match(/class="num cabecalho-premissa/g) || []).length, 2);
  assert.ok((html.match(/class="num celula-premissa/g) || []).length >= 2);
});

test('só a PRIMEIRA coluna de premissa marca o início da faixa -- uma divisória por coluna viraria compartimento, não bloco', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, equipes: 2, prod: 5 })];
  const html = renderAbaConsolidado(registros, [0], opcoes());
  assert.strictEqual((html.match(/cabecalho-premissa-inicio/g) || []).length, 1);
  // Uma linha de corpo por abertura (total geral + tipologia + registro + total do SUP)
  const linhas = linhasDe(html).length;
  assert.strictEqual((html.match(/celula-premissa-inicio/g) || []).length, linhas);
});

test('em Financeiro, a única premissa é também o início da faixa', () => {
  const registros = [registro({ sup: 'SUP-A', volume: 310, financeiro: 500000, ticket: 1600 })];
  const html = renderAbaConsolidado(registros, [0], opcoes({ dimensao: 'financeiro' }));
  assert.strictEqual((html.match(/class="num cabecalho-premissa cabecalho-premissa-inicio"/g) || []).length, 1);
  assert.strictEqual((html.match(/class="num cabecalho-premissa"/g) || []).length, 0, 'não há segunda premissa em Financeiro');
});

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
  // Previsto saiu da tabela: Realizado agora é a 5ª célula ([4], zero-based).
  assert.strictEqual(celulasDe(linhasDe(html)[0])[4], '3', 'só os 3 furos da S5 de julho');
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

test('a dimensao recebida ainda troca as colunas de premissa', () => {
  const extra = { demandas: demandasEspalhadas(), hojeEpoch: diaJul(15) };
  const volume = renderAbaConsolidado(REGISTROS_A, [0], opcoes(Object.assign({ dimensao: 'volume' }, extra)));
  assert.ok(volume.indexOf('Equipes previstas') !== -1);
  assert.strictEqual(volume.indexOf('Ticket médio'), -1);
  const financeiro = renderAbaConsolidado(REGISTROS_A, [0], opcoes(Object.assign({ dimensao: 'financeiro' }, extra)));
  assert.ok(financeiro.indexOf('Ticket médio') !== -1);
  assert.strictEqual(financeiro.indexOf('Equipes previstas'), -1);
});
