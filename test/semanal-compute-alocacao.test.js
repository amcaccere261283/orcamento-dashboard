'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  diasPremissaDaSemana, capacidadeDaEquipe, ratearCarga, classificarOcupacao, classificarCelula,
  montarGradeAlocacao, resumirAlocacao, leituraDoSup,
} = require('../tools/semanal/compute-alocacao.js');
const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');

// Agosto (mesIdx 7): DIAS_PREMISSA_MES = 30. Um mês repartido em semanas reais
// soma 31 dias em agosto/2026 (semanasDoMes corta sempre dentro do mês).

test('dias de premissa da semana saem da PREMISSA, não do calendário', () => {
  // 5 dias disponíveis de um mês de 31 dias, premissa 30 -> 30 * 5/31
  assert.ok(Math.abs(diasPremissaDaSemana(7, 5, 31) - (30 * 5 / 31)) < 1e-9);
});

test('equipe indisponível a semana toda tem 0 dias de premissa', () => {
  assert.strictEqual(diasPremissaDaSemana(7, 0, 31), 0);
});

test('mês sem premissa ou sem dias devolve 0, nunca NaN', () => {
  assert.strictEqual(diasPremissaDaSemana(7, 5, 0), 0);
  assert.strictEqual(diasPremissaDaSemana(-1, 5, 31), 0);
});

test('capacidade = premissa PROD x dias de premissa da semana', () => {
  const equipe = { diasDisponiveis: 5 };
  const c = capacidadeDaEquipe(equipe, 2, 7, 31);
  assert.ok(Math.abs(c - 2 * (30 * 5 / 31)) < 1e-9);
});

test('sem premissa de produtividade, a capacidade é null -- nunca zero', () => {
  // Zero leria como "esta equipe não produz". null leria como "não sei",
  // que é a verdade, e a tela mostra "sem dado".
  assert.strictEqual(capacidadeDaEquipe({ diasDisponiveis: 5 }, null, 7, 31), null);
});

test('rateio ponderado pela capacidade', () => {
  assert.deepStrictEqual(ratearCarga(30, [10, 20]), [10, 20]);
});

test('capacidades iguais degeneram em divisão igual', () => {
  assert.deepStrictEqual(ratearCarga(30, [15, 15]), [15, 15]);
});

test('rateio com capacidade total zero devolve zeros -- nunca divide por zero', () => {
  assert.deepStrictEqual(ratearCarga(30, [0, 0]), [0, 0]);
});

test('rateio sem equipe nenhuma devolve lista vazia', () => {
  assert.deepStrictEqual(ratearCarga(30, []), []);
});

test('a soma do rateio é exatamente a tendência', () => {
  const partes = ratearCarga(37, [11, 7, 3]);
  assert.ok(Math.abs(partes.reduce((a, b) => a + b, 0) - 37) < 1e-9);
});

test('faixas de ocupação', () => {
  assert.strictEqual(classificarOcupacao(0), 'livre');
  assert.strictEqual(classificarOcupacao(0.60), 'folga');
  assert.strictEqual(classificarOcupacao(0.85), 'equilibrada');
  assert.strictEqual(classificarOcupacao(1.05), 'equilibrada');
  assert.strictEqual(classificarOcupacao(1.27), 'sobrecarregada');
  assert.strictEqual(classificarOcupacao(null), 'livre');
});

function dia(ano, mes, d) { return Math.floor(Date.UTC(ano, mes - 1, d) / 86400000); }

// Dois registros da MATRIZ: SP e ST no mesmo SUP, mais um SUP só com carteira.
// total (linha T do orçamento) espelha previsto de propósito -- desde
// 2026-08-20 a Tendência semanal fecha no T, não mais no Previsto/ritmo
// automático (T ausente conta como zero, "não executa nada naquele local");
// sem espelhar aqui, toda tendência desta fixture cairia pra zero e estes
// testes deixariam de exercitar a lógica de alocação que é o assunto deles.
function registrosDeTeste() {
  const zeros = () => new Array(12).fill(0);
  const volumeAgosto = (v) => { const a = zeros(); a[7] = v; return a; };
  return [
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'SP',
      previsto: { volume: volumeAgosto(120), equipesResumo: { prod: 2 } },
      total: { volume: volumeAgosto(120) } },
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'ST',
      previsto: { volume: volumeAgosto(0), equipesResumo: { prod: 3 } },
      total: { volume: volumeAgosto(0) } },
    { sup: 'SUP-B', tomador: 'Tomador B', tipologia: 'SP',
      previsto: { volume: volumeAgosto(0), equipesResumo: { prod: 2 } },
      total: { volume: volumeAgosto(0) } },
  ];
}

// Carteira: 40 furos abertos em SUP-A||ST e 79 em SUP-B||SP, nenhum fechado.
function demandasDeTeste() {
  const abertas = (n, diaChegada) => ({
    chegada: new Array(n).fill(diaChegada), sondagemRealizada: [], saidaEstoque: [],
  });
  return {
    porRegistroEventos: {
      'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-A||ST': abertas(40, dia(2026, 7, 1)),
      'SUP-B||SP': abertas(79, dia(2026, 7, 1)),
    },
  };
}

const SEMANAS_AGOSTO = semanasDoMes(2026, 7);

function opcoesBase(extra) {
  return Object.assign({
    mesIdx: 7, ano: 2026,
    semanas: SEMANAS_AGOSTO,
    semana: SEMANAS_AGOSTO[1],
    demandas: demandasDeTeste(),
    equipes: [],
    alocacao: {},
    hojeEpoch: SEMANAS_AGOSTO[1].inicio + 2,
  }, extra || {});
}

test('a âncora é HOJE, inclusive no meio de uma semana já começada', () => {
  // MUDANÇA DE 2026-08-11: a âncora era o INÍCIO da semana já começada, o que
  // congelava a Tendência da célula na segunda-feira. A Tabela Semanal sempre
  // calculou com hoje, então as duas abas exibiam números diferentes para a
  // mesma semana -- relatado pelo dono do projeto. Esta aba só organiza o que a
  // Tabela Semanal calcula; divergir dela é o defeito, não a feature.
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  assert.strictEqual(g.ancoraEpoch, SEMANAS_AGOSTO[1].inicio + 2,
    'hojeEpoch de opcoesBase() é inicio + 2');
});

test('semana futura ainda não travou: a âncora é hoje', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    semana: SEMANAS_AGOSTO[3], hojeEpoch: SEMANAS_AGOSTO[1].inicio + 2,
  }));
  assert.strictEqual(g.ancoraEpoch, SEMANAS_AGOSTO[1].inicio + 2);
});

test('a célula traz a carteira mesmo sem tendência nenhuma', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const linhaA = g.linhas.find((l) => l.sup === 'SUP-A');
  const celulaST = linhaA.celulas['ST'];
  assert.strictEqual(celulaST.tendencia, 0);
  assert.strictEqual(celulaST.carteira, 40);
});

test('SUP sem tendência nenhuma entra no quadro SÓ por causa da carteira', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const linhaB = g.linhas.find((l) => l.sup === 'SUP-B');
  assert.ok(linhaB, 'SUP-B tem 79 furos parados e precisa aparecer');
  assert.strictEqual(linhaB.celulas['SP'].carteira, 79);
});

test('SUP sem tendência E sem carteira não vira linha', () => {
  const registros = registrosDeTeste();
  const g = montarGradeAlocacao(registros, [0, 1, 2], opcoesBase({
    demandas: { porRegistroEventos: {} },
  }));
  assert.deepStrictEqual(g.linhas.map((l) => l.sup), ['SUP-A']);
});

test('coluna zerada em tendência E carteira é podada', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  assert.deepStrictEqual(g.colunas.map((c) => c.id), ['SP', 'ST']);
});

test('coluna zerada COM equipe alocada NÃO é podada -- o cartão sumiria da tela', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [{ id: '9', colunas: ['PI'], diasDisponiveis: 5, disponivel: true }],
    alocacao: { 9: { sup: 'SUP-A', coluna: 'PI' } },
  }));
  assert.ok(g.colunas.some((c) => c.id === 'PI'));
});

test('capacidade alocada e saldo saem das equipes na célula', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [
      { id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
      { id: '2', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    ],
    alocacao: { 1: { sup: 'SUP-A', coluna: 'SP' }, 2: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  const celula = g.linhas.find((l) => l.sup === 'SUP-A').celulas['SP'];
  assert.deepStrictEqual(celula.equipes, ['1', '2']);
  assert.ok(celula.capacidadeAlocada > 0);
  assert.ok(Math.abs(celula.saldo - (celula.capacidadeAlocada - celula.tendencia)) < 1e-9);
});

test('as linhas saem ordenadas pelo diagnóstico da tendência, com os parados por último', () => {
  const g = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const ultima = g.linhas[g.linhas.length - 1];
  assert.strictEqual(ultima.sup, 'SUP-B', 'SUP sem tendência vai para o fim');
});

test('a ordem NÃO muda quando a alocação muda', () => {
  const antes = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase());
  const depois = montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({
    equipes: [{ id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }],
    alocacao: { 1: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  assert.deepStrictEqual(antes.linhas.map((l) => l.sup), depois.linhas.map((l) => l.sup));
});

// --- resumirAlocacao: os três resumos e o aviso condicional ---

function gradeComEquipes(equipes, alocacao) {
  return montarGradeAlocacao(registrosDeTeste(), [0, 1, 2], opcoesBase({ equipes, alocacao }));
}

test('as cinco leituras por SUP são avaliadas em ordem: parado c/ carteira vence', () => {
  // SUP-B: tendência 0, carteira 79, e uma equipe solta ali. Sem a ordem
  // explícita ele casaria com 'antecipar' também.
  const equipes = [{ id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 1: { sup: 'SUP-B', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const supB = r.porSup.find((s) => s.sup === 'SUP-B');
  assert.strictEqual(supB.leitura, 'parado-com-carteira');
});

test('SUP com tendência e nenhuma equipe lê "sem equipe"', () => {
  const r = resumirAlocacao(gradeComEquipes([], {}), { equipes: [], mesIdx: 7 });
  const supA = r.porSup.find((s) => s.sup === 'SUP-A');
  assert.strictEqual(supA.leitura, 'sem-equipe');
});

test('"semanas de carteira" é carteira ÷ tendência; sem tendência fica null, não zero', () => {
  const r = resumirAlocacao(gradeComEquipes([], {}), { equipes: [], mesIdx: 7 });
  const supB = r.porSup.find((s) => s.sup === 'SUP-B');
  assert.strictEqual(supB.semanasDeCarteira, null, 'sem ritmo não há prazo -- null, nunca 0');
  const supA = r.porSup.find((s) => s.sup === 'SUP-A');
  assert.ok(supA.semanasDeCarteira >= 0);
});

test('o aviso de antecipar ACENDE quando há carteira e equipe livre da coluna', () => {
  const equipes = [{ id: '5', colunas: ['ST'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, {});
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const celula = r.avisos['SUP-A||ST'];
  assert.strictEqual(celula, 'aceso');
});

test('o aviso fica MUDO quando há carteira mas nenhuma equipe livre da coluna', () => {
  const grade = gradeComEquipes([], {});
  const r = resumirAlocacao(grade, { equipes: [], mesIdx: 7 });
  assert.strictEqual(r.avisos['SUP-A||ST'], 'mudo');
});

test('equipe alocada com folga também acende o aviso -- não só as do pool', () => {
  const equipes = [
    { id: '5', colunas: ['ST'], diasDisponiveis: 5, disponivel: true },
  ];
  // Alocada numa célula com tendência 0: ocupação 0, logo tem folga.
  const grade = gradeComEquipes(equipes, { 5: { sup: 'SUP-A', coluna: 'ST' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  assert.strictEqual(r.avisos['SUP-A||ST'], 'aceso');
});

test('resumo por equipe: carga, ocupação e situação', () => {
  const equipes = [
    { id: '1', lider: 'A', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '2', lider: 'B', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '3', lider: 'C', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
  ];
  const grade = gradeComEquipes(equipes, {
    1: { sup: 'SUP-A', coluna: 'SP' }, 2: { sup: 'SUP-A', coluna: 'SP' },
  });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const porId = Object.fromEntries(r.porEquipe.map((e) => [e.id, e]));
  assert.ok(Math.abs(porId['1'].carga - porId['2'].carga) < 1e-9, 'mesma célula, capacidades iguais');
  assert.strictEqual(porId['3'].sup, null);
  assert.strictEqual(porId['3'].carga, 0);
  assert.strictEqual(porId['3'].situacao, 'livre');
});

test('equipe indisponível a semana toda aparece como "fora na semana", sem números', () => {
  const equipes = [{ id: '9', lider: 'Z', colunas: ['SP'], diasDisponiveis: 0, disponivel: false }];
  const r = resumirAlocacao(gradeComEquipes(equipes, {}), { equipes, mesIdx: 7 });
  const eq = r.porEquipe.find((e) => e.id === '9');
  assert.strictEqual(eq.situacao, 'fora');
  assert.strictEqual(eq.carga, null);
  assert.strictEqual(eq.capacidade, null);
});

test('capacidade ociosa: equipe sobrecarregada contribui ZERO, nunca negativo', () => {
  const equipes = [
    { id: '1', colunas: ['SP'], diasDisponiveis: 5, disponivel: true },
    { id: '9', colunas: ['ST'], diasDisponiveis: 5, disponivel: true },
  ];
  // A equipe 1 sozinha numa célula de 120 no mês -> sobrecarregada.
  // A equipe 9 fica livre -> contribui a capacidade inteira.
  const grade = gradeComEquipes(equipes, { 1: { sup: 'SUP-A', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const eq9 = r.porEquipe.find((e) => e.id === '9');
  assert.ok(r.totais.capacidadeOciosa >= eq9.capacidade - 1e-9);
  assert.ok(r.totais.capacidadeOciosa < eq9.capacidade + 1e-9,
    'a sobrecarga da equipe 1 não pode descontar da ociosidade da 9');
});

// --- Correção 1: capacidade não pode ler zero numa célula hatched ---
// Uma célula sem registro na MATRIZ (SUP-C não existe em registrosDeTeste)
// tem premissaProd null, e montarGradeAlocacao já mascara a capacidade da
// equipe alocada ali em 0 (capacidadeDaEquipe(...) || 0). Sem a correção,
// resumirAlocacao herdaria esse 0 como se fosse a capacidade real da equipe.
test('capacidade não lê zero numa célula sem registro na MATRIZ (hatched)', () => {
  const equipes = [{ id: '9', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 9: { sup: 'SUP-C', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const eq9 = r.porEquipe.find((e) => e.id === '9');
  assert.ok(eq9.capacidade > 0,
    'a célula hatched não pode mascarar a capacidade da equipe em zero -- usa a capacidade de referência');
});

// --- Correção 2: equipe alocada nunca reporta "livre" ---
// Na mesma célula hatched a tendência é 0, logo a carga rateada é 0 e a
// ocupação também -- classificarOcupacao(0) devolve 'livre', que é falso
// para uma equipe que TEM destino. O mínimo para quem está alocada é 'folga'.
test('equipe alocada nunca lê "livre", mesmo com ocupação zero (célula hatched)', () => {
  const equipes = [{ id: '9', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 9: { sup: 'SUP-C', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const eq9 = r.porEquipe.find((e) => e.id === '9');
  assert.notStrictEqual(eq9.situacao, 'livre');
  assert.strictEqual(eq9.situacao, 'folga');
});

// --- Revisão final, bloqueante 1 -------------------------------------------
// leituraDoSup caía em 'absorvido' (verde, "tudo bem") sempre que nenhuma das
// quatro primeiras condições casava -- inclusive com tendência = 0. Isso não
// tinha como acontecer numa linha real quando a leitura foi escrita, porque
// tendência = 0 e carteira = 0 juntas significavam "a linha nem existe" (ver
// montarGradeAlocacao: célula sem tendência, sem carteira e sem equipe é
// podada). O auto-seed (tarefa posterior) muda isso: ele pode alocar uma
// equipe numa célula que não tem nenhuma das duas, e aí a linha passa a
// existir só por causa da equipe -- um estado real que não é 'absorvido'.

test('leituraDoSup: tendência 0 e carteira 0 (só a equipe segura a linha) não é "absorvido"', () => {
  // Prova direta na função pura, sem passar pela grade -- é a chamada exata
  // que a revisão final reproduziu.
  assert.strictEqual(leituraDoSup(0, 0, 100, true), 'sem-demanda');
  assert.notStrictEqual(leituraDoSup(0, 0, 100, true), 'absorvido');
});

test('leituraDoSup: "absorvido" continua exigindo tendência > 0 (não regride)', () => {
  assert.strictEqual(leituraDoSup(50, 0, 50, true), 'absorvido');
});

test('SUP que só existe no quadro por causa de uma equipe alocada (tendência e carteira zeradas) lê "sem-demanda", nunca "absorvido"', () => {
  // SUP-C não existe em registrosDeTeste -- SUP-C||SP é uma célula hatched,
  // sem registro na MATRIZ e sem demanda alguma. A única razão da linha
  // aparecer é a equipe 9 estar alocada ali.
  const equipes = [{ id: '9', colunas: ['SP'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 9: { sup: 'SUP-C', coluna: 'SP' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const supC = r.porSup.find((s) => s.sup === 'SUP-C');
  assert.ok(supC, 'a linha existe só por causa da equipe alocada');
  assert.strictEqual(supC.tendencia, 0);
  assert.strictEqual(supC.carteira, 0);
  assert.strictEqual(supC.leitura, 'sem-demanda');
});

// --- Revisão final, bloqueante 2 -------------------------------------------
// totais.equipesAlocadas pulava a equipe inteira (não só a parte de
// capacidadeOciosa) quando a capacidade dela vinha null -- o caso de uma
// equipe alocada numa coluna sem NENHUM registro em lugar nenhum da grade,
// então capacidadeDeReferencia não tem nada pra ponderar e devolve null. A
// equipe TEM sup e coluna (está visivelmente no quadro), só não tem número de
// capacidade -- sumir da contagem do topo é diferente de sumir da soma de
// capacidade ociosa (essa sim precisa pular: não dá pra somar folga
// desconhecida).

test('equipe alocada numa coluna sem registro nenhum na MATRIZ ainda conta em totais.equipesAlocadas', () => {
  // Coluna 'PI' não aparece em nenhum registro de registrosDeTeste (só
  // SP/ST), então não há premissa de referência em lugar nenhum da grade
  // pra essa coluna -- capacidadeDeReferencia devolve null de propósito.
  const equipes = [{ id: '9', colunas: ['PI'], diasDisponiveis: 5, disponivel: true }];
  const grade = gradeComEquipes(equipes, { 9: { sup: 'SUP-A', coluna: 'PI' } });
  const r = resumirAlocacao(grade, { equipes, mesIdx: 7 });
  const eq9 = r.porEquipe.find((e) => e.id === '9');
  assert.strictEqual(eq9.capacidade, null, 'pré-condição: sem referência nenhuma, a capacidade fica null');
  assert.strictEqual(eq9.sup, 'SUP-A', 'a equipe está visivelmente alocada');
  assert.strictEqual(r.totais.equipesAlocadas, 1,
    'uma equipe com destino não pode sumir da contagem só porque a capacidade é desconhecida');
  // capacidadeOciosa continua certa em pular: não dá pra somar folga de uma
  // capacidade que não se conhece.
  assert.strictEqual(r.totais.capacidadeOciosa, 0);
});

// --- Task 10: o invariante que amarra a aba nova ao resto da página --------

test('INVARIANTE: com a alocação vazia, a soma da tendência da grade bate com a Tabela Semanal', () => {
  // Se um dia isto divergir, alguém trocou a fonte de um dos dois. É o único
  // laço que impede a aba nova de virar um segundo cálculo paralelo.
  const registros = registrosDeTeste();
  const indices = [0, 1, 2];
  const o = opcoesBase();
  const grade = montarGradeAlocacao(registros, indices, o);

  let somaGrade = 0;
  grade.linhas.forEach((l) => Object.keys(l.celulas).forEach((k) => { somaGrade += l.celulas[k].tendencia; }));

  const series = calcularSeriesSemanaisDimensao(
    registros, indices, 'volume', o.mesIdx, o.semanas, o.semanas.length,
    true, indiceSemanaAtual(o.semanas, grade.ancoraEpoch), o.demandas, grade.ancoraEpoch
  );
  const daTabela = series.semanasTendenciaCompleta[o.semanas.indexOf(o.semana)] || 0;

  assert.ok(Math.abs(somaGrade - daTabela) < 1e-6,
    `grade ${somaGrade} != tabela ${daTabela}`);
});

// --- Situação da CÉLULA (2026-08-11) -----------------------------------------
//
// O dono do projeto relatou que "folga" e "equilibrada" pareciam invertidas na
// célula. A inversão era real, e o par era outro: folga <-> sobrecarregada.
// Ver a Decisão 9 do spec de 2026-08-11.

test('classificarCelula: capacidade abaixo da tendência é SOBRECARREGADA, não folga', () => {
  // O bug relatado: a célula mostrava "Com folga · saldo -50".
  assert.strictEqual(classificarCelula(100, 50), 'sobrecarregada');
});

test('classificarCelula: capacidade acima da tendência é FOLGA, não sobrecarga', () => {
  assert.strictEqual(classificarCelula(100, 150), 'folga');
});

test('classificarCelula: capacidade igual à tendência é equilibrada', () => {
  assert.strictEqual(classificarCelula(100, 100), 'equilibrada');
  // As bordas da faixa 0,85..1,05, vistas como tendência/capacidade.
  assert.strictEqual(classificarCelula(100, 100 / 0.85), 'equilibrada');
  assert.strictEqual(classificarCelula(100, 100 / 1.05), 'equilibrada');
});

test('classificarCelula: tendência sem nenhuma equipe é "sem-equipe"', () => {
  assert.strictEqual(classificarCelula(100, 0), 'sem-equipe');
  assert.strictEqual(classificarCelula(100, null), 'sem-equipe');
});

test('classificarCelula: sem tendência não há o que cobrir -- neutro', () => {
  assert.strictEqual(classificarCelula(0, 50), 'livre');
  assert.strictEqual(classificarCelula(null, 0), 'livre');
});

// Trava a CLASSE do bug, e não dois exemplos dele.
test('PROPRIEDADE: o status da célula nunca contradiz o sinal do saldo', () => {
  const tendencia = 100;
  for (let cap = 1; cap <= 300; cap++) {
    const s = classificarCelula(tendencia, cap);
    const saldo = cap - tendencia;
    if (saldo < 0) {
      assert.notStrictEqual(s, 'folga', `cap=${cap}: saldo ${saldo} não pode ser "folga"`);
      assert.notStrictEqual(s, 'livre', `cap=${cap}: saldo ${saldo} não pode ser "livre"`);
    }
    if (saldo > 0) {
      assert.notStrictEqual(s, 'sobrecarregada', `cap=${cap}: saldo +${saldo} não pode ser "sobrecarregada"`);
    }
  }
});

// --- O filtro de SUP poda a grade (2026-08-11, Decisão 7 do spec) ------------

function registrosFiltro() {
  const z = () => new Array(12).fill(0);
  const volume100 = () => { const a = z(); a[7] = 100; return a; };
  // total espelha previsto -- mesmo motivo do registrosDeTeste() acima.
  return ['SUP-A', 'SUP-B'].map((sup) => ({
    sup, tomador: 'T', tipologia: 'ST',
    previsto: { volume: volume100(), equipesResumo: { prod: 2 } },
    total: { volume: volume100() },
  }));
}

function opcoesFiltro(alocacao) {
  return {
    mesIdx: 7, ano: 2026, semanas: SEMANAS_AGOSTO, semana: SEMANAS_AGOSTO[1],
    hojeEpoch: SEMANAS_AGOSTO[1].inicio + 2,
    equipes: [{ id: 'EQ-1', lider: 'L', diasDisponiveis: 5, diasDaSemana: 7,
      disponivel: true, colunas: ['ST'] }],
    demandas: { porRegistroEventos: {
      'SUP-A||ST': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-B||ST': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
    } },
    alocacao: alocacao,
  };
}

test('o filtro de SUP poda a grade mesmo com equipe alocada no SUP excluído', () => {
  // O bug relatado em 2026-08-11: filtrar por um SUP devolvia também os SUPs
  // com equipe alocada -- e a semana nasce semeada do realizado, então esse é
  // o caso NORMAL, não uma borda.
  const grade = montarGradeAlocacao(registrosFiltro(), [0],
    opcoesFiltro({ 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } }));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
});

test('controle: sem alocação nenhuma o filtro já funcionava, e continua', () => {
  const grade = montarGradeAlocacao(registrosFiltro(), [0], opcoesFiltro({}));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
});

test('equipe alocada num SUP que PASSA no filtro continua desenhando a célula', () => {
  // A poda não pode jogar fora alocação legítima.
  const grade = montarGradeAlocacao(registrosFiltro(), [0],
    opcoesFiltro({ 'EQ-1': { sup: 'SUP-A', coluna: 'ST' } }));
  assert.deepStrictEqual(grade.linhas.map((l) => l.sup), ['SUP-A']);
  assert.deepStrictEqual(grade.linhas[0].celulas.ST.equipes, ['EQ-1']);
});

test('os totais da faixa excluem as linhas podadas pelo filtro', () => {
  const o = opcoesFiltro({ 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } });
  const grade = montarGradeAlocacao(registrosFiltro(), [0], o);
  const resumo = resumirAlocacao(grade, { equipes: o.equipes, mesIdx: 7 });
  assert.strictEqual(resumo.totais.tendencia, grade.linhas[0].tendencia,
    'a faixa não pode somar um SUP que a grade não mostra');
});

test('limpar o filtro traz a linha de volta -- a poda é de exibição, não de estado', () => {
  const alocacao = { 'EQ-1': { sup: 'SUP-B', coluna: 'ST' } };
  const comFiltro = montarGradeAlocacao(registrosFiltro(), [0], opcoesFiltro(alocacao));
  const semFiltro = montarGradeAlocacao(registrosFiltro(), [0, 1], opcoesFiltro(alocacao));
  assert.deepStrictEqual(comFiltro.linhas.map((l) => l.sup), ['SUP-A']);
  assert.deepStrictEqual(semFiltro.linhas.map((l) => l.sup).sort(), ['SUP-A', 'SUP-B']);
  assert.deepStrictEqual(semFiltro.linhas.find((l) => l.sup === 'SUP-B').celulas.ST.equipes,
    ['EQ-1'], 'a alocação nunca foi apagada, só escondida');
});

// --- As duas abas mostram o MESMO número (2026-08-11) ------------------------

// Fixture com realizado DENTRO da semana: sem isso a projeção não muda com a
// âncora, e o teste passaria sem provar nada.
function fixtureComRitmo() {
  const semana = SEMANAS_AGOSTO[1];
  const z = () => new Array(12).fill(0);
  const vol = z(); vol[7] = 300;
  const registros = [{
    sup: 'SUP-A', tomador: 'T', tipologia: 'SP',
    previsto: { volume: vol, equipesResumo: { prod: 1 } },
  }];
  const cheio = (n, d) => new Array(n).fill(d);
  const demandas = { porRegistroEventos: { 'SUP-A||SP': {
    chegada: cheio(80, semana.inicio - 5),
    sondagemRealizada: cheio(40, semana.inicio).concat(cheio(40, semana.inicio + 1)),
    saidaEstoque: [],
  } } };
  return { registros, demandas, semana };
}

test('INVARIANTE REAL: no MEIO da semana a grade bate com a Tabela Semanal', () => {
  // O teste antigo passava grade.ancoraEpoch para os DOIS lados -- provava que
  // a mesma função com a mesma âncora dá o mesmo número, o que é quase
  // tautológico, e nunca comparou as duas ABAS. Aqui a Tabela Semanal é
  // calculada com HOJE, que é como ela realmente calcula na página.
  const { registros, demandas, semana } = fixtureComRitmo();
  const hoje = semana.inicio + 3; // quinta-feira: o pior caso do bug relatado

  const grade = montarGradeAlocacao(registros, [0], {
    mesIdx: 7, ano: 2026, semanas: SEMANAS_AGOSTO, semana, hojeEpoch: hoje,
    demandas, equipes: [], alocacao: {},
  });
  let somaGrade = 0;
  grade.linhas.forEach((l) => Object.keys(l.celulas).forEach((k) => { somaGrade += l.celulas[k].tendencia; }));

  const serie = calcularSeriesSemanaisDimensao(
    registros, [0], 'volume', 7, SEMANAS_AGOSTO, SEMANAS_AGOSTO.length,
    true, indiceSemanaAtual(SEMANAS_AGOSTO, hoje), demandas, hoje
  );
  const daTabela = serie.semanasTendenciaCompleta[SEMANAS_AGOSTO.indexOf(semana)] || 0;

  assert.ok(daTabela > 0, 'pré-condição: a Tabela Semanal projeta algo nesta semana');
  assert.ok(Math.abs(somaGrade - daTabela) < 1e-6,
    `as duas abas têm que mostrar o mesmo número: grade ${somaGrade} != tabela ${daTabela}`);
});

// --- Produtividade por TIPOLOGIA (2026-08-11) -------------------------------

test('a capacidade usa a produtividade da TIPOLOGIA, não a do contrato', () => {
  // Decisão do dono do projeto: PROD. da MATRIZ varia por contrato (SP vai de
  // 0,80 a 2,00), e a realidade de campo é 1 furo/dia para SP. A capacidade
  // passa a sair de uma tabela por tipologia.
  const { PRODUTIVIDADE_POR_COLUNA } = require('../tools/semanal/compute-alocacao.js');
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA.SP, 1);
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA.PI, 3, 'PI é 3 por decisão do dono do projeto, não os 4 da MATRIZ');
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA.ST, 8);
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA['SM / SM.F / SR'], 0.3);
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA.BL, 1);
  assert.strictEqual(PRODUTIVIDADE_POR_COLUNA.Especiais, 1);
});

test('contrato com PROD inflado na MATRIZ não infla mais a capacidade', () => {
  const z = () => new Array(12).fill(0);
  const vol = z(); vol[7] = 300;
  const registros = [{
    sup: 'SUP-A', tomador: 'T', tipologia: 'SP',
    // A MATRIZ diz 2,0 para este contrato -- o dobro da realidade de campo.
    previsto: { volume: vol, equipesResumo: { prod: 2 } },
  }];
  const semana = SEMANAS_AGOSTO[1];
  const equipes = [{ id: 'EQ-1', lider: 'L', colunas: ['SP'],
    diasDisponiveis: 5, diasDaSemana: 7, disponivel: true }];
  const grade = montarGradeAlocacao(registros, [0], {
    mesIdx: 7, ano: 2026, semanas: SEMANAS_AGOSTO, semana,
    hojeEpoch: semana.inicio + 2,
    demandas: { porRegistroEventos: { 'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] } } },
    equipes, alocacao: { 'EQ-1': { sup: 'SUP-A', coluna: 'SP' } },
  });
  const celula = grade.linhas[0].celulas.SP;
  // 1 furo/dia × dias de premissa da semana -- e não 2.
  const diasPremissa = diasPremissaDaSemana(7, 5, grade.diasDoMes);
  assert.ok(Math.abs(celula.capacidadeAlocada - 1 * diasPremissa) < 1e-9,
    `capacidade ${celula.capacidadeAlocada} devia ser ${diasPremissa} (prod 1), não o dobro`);
});

// --- A Tendência de um grupo é a SOMA das tipologias (2026-08-11) ------------
//
// Relatado pelo dono do projeto: filtrando duas tipologias juntas o total dava
// 121, mas somando uma a uma dava 165 -- o mesmo 165 da aba Alocação. Não era
// erro de aritmética: escolherRamo decide UM ramo por chamada, e com tipologias
// em ramos opostos a projeção do agregado não é a soma das projeções.

function regTip(tipologia, volumeMes) {
  const z = () => new Array(12).fill(0);
  const v = z(); v[7] = volumeMes;
  return { sup: 'SUP-T', tomador: 'T', tipologia, grupo: 'G', origem: 'O',
    previsto: { volume: v, equipesResumo: { prod: 1 } } };
}

test('a Tendência do grupo é a soma das tipologias, não uma projeção do agregado', () => {
  const hoje = SEMANAS_AGOSTO[2].inicio + 2; // S1 e S2 encerradas
  const cheio = (qtds) => {
    const d = [];
    qtds.forEach((n, i) => { for (let k = 0; k < n; k++) d.push(SEMANAS_AGOSTO[i].inicio + 1); });
    return d;
  };
  const registros = [regTip('SP', 200), regTip('CPTu', 200)];
  const demandas = { porRegistroEventos: {
    // SP muito ACIMA do previsto; CPTu bem ABAIXO -- ramos opostos.
    'SUP-T||SP': { chegada: [], sondagemRealizada: cheio([90, 90, 20]), saidaEstoque: [] },
    'SUP-T||CPTu': { chegada: [], sondagemRealizada: cheio([5, 5, 2]), saidaEstoque: [] },
  } };
  const daSemana = (indices) => {
    const s = calcularSeriesSemanaisDimensao(
      registros, indices, 'volume', 7, SEMANAS_AGOSTO, SEMANAS_AGOSTO.length,
      true, indiceSemanaAtual(SEMANAS_AGOSTO, hoje), demandas, hoje
    );
    return s.semanasTendenciaCompleta[2] || 0;
  };

  const so_sp = daSemana([0]);
  const so_cptu = daSemana([1]);
  const junto = daSemana([0, 1]);

  assert.ok(so_sp > 0 && so_cptu > 0, 'pré-condição: as duas projetam algo');
  assert.ok(Math.abs(junto - (so_sp + so_cptu)) < 1e-6,
    `o total (${junto}) tem que ser a soma das tipologias (${so_sp} + ${so_cptu} = ${so_sp + so_cptu})`);
});
