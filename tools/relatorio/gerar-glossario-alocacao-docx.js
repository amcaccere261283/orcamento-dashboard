'use strict';
// Gera o Word "Aba Alocacao Equipes - o que cada numero significa".
//
//   node tools/relatorio/gerar-glossario-alocacao-docx.js ["caminho/saida.docx"]
//
// Sem senha, sem rede e sem G:\ -- e' um documento de definicoes, e cada uma
// delas foi conferida contra a funcao que produz o numero (compute-alocacao.js,
// render-aba-alocacao.js, calculo-equipes.js). Se uma formula mudar la, este
// arquivo fica desatualizado em silencio: e' texto, nao codigo executavel.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { zipar, run, paragrafo, celula, esc } = require('./docx.js');

const FONTE = 'Aptos';
const MARCA = {
  texto: '1F2933',
  apagado: '6B7280',
  linha: 'D1D5DB',
  destaque: '1D4ED8',
  fundoCabecalho: 'EEF2FF',
  fundoExemplo: 'FFF7ED',
};

// O exemplo real que o dono do projeto trouxe em 2026-08-11, e que atravessa o
// documento inteiro: um numero solto nao ensina nada, o mesmo numero explicado
// cinco vezes de angulos diferentes ensina.
const EX = {
  sup: 'SUP-7285-24',
  coluna: 'SP',
  equipe: '276',
  lider: 'Francinaldo Jr.',
  tendencia: '59,7',
  carteira: '245',
  dias: '7',
  // Depois da recalibracao de 11/08 (SP passou de 1,5 pra 1 furo/dia).
  capacidade: '6,8',
  ocupacao: '881%',
  saldo: '-52,9',
  situacao: 'Sobrecarregada',
  // O que a tela mostrava ANTES, e que o dono do projeto anotou.
  capacidadeAntes: '10,2',
  ocupacaoAntes: '588%',
  saldoAntes: '-49,6',
  prodAntes: '1,5',
};

function h1(texto) {
  return paragrafo([run(texto, { negrito: true, tamanho: 16, cor: MARCA.texto })],
    { antes: 0, depois: 80 });
}

function h2(texto) {
  return paragrafo([run(texto, { negrito: true, tamanho: 12, cor: MARCA.destaque })],
    { antes: 260, depois: 80, bordaInferior: { cor: MARCA.linha, espessura: 4 } });
}

function p(texto, o) {
  const op = o || {};
  return paragrafo([run(texto, { tamanho: op.tamanho || 10, cor: op.cor || MARCA.texto, italico: op.italico })],
    { alinhamento: op.alinhamento, depois: op.espacoDepois === undefined ? 100 : op.espacoDepois, recuo: op.recuo });
}

// Um paragrafo com pedacos em negrito, sem precisar de tabela.
function pRico(pedacos, o) {
  const op = o || {};
  return paragrafo(pedacos.map((t) => (typeof t === 'string'
    ? run(t, { tamanho: 10, cor: MARCA.texto })
    : run(t.t, { tamanho: 10, negrito: t.b, italico: t.i, cor: t.cor || MARCA.texto }))),
  { depois: op.espacoDepois === undefined ? 100 : op.espacoDepois, recuo: op.recuo });
}

function formula(texto) {
  return paragrafo([run(texto, { fonte: 'Consolas', tamanho: 9, cor: MARCA.destaque })],
    { recuo: 340, depois: 120 });
}

function linhaTabela(celulas) {
  return `<w:tr>${celulas.join('')}</w:tr>`;
}

function tabela(cabecalhos, linhas, larguras) {
  const bordas = '<w:tblBorders>'
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((l) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="${MARCA.linha}"/>`).join('')
    + '</w:tblBorders>';
  const cab = linhaTabela(cabecalhos.map((t, i) => celula(
    paragrafo([run(t, { negrito: true, tamanho: 9, cor: MARCA.texto })], { depois: 0 }),
    { largura: larguras[i], fundo: MARCA.fundoCabecalho },
  )));
  const corpo = linhas.map((cols) => linhaTabela(cols.map((t, i) => celula(
    paragrafo([run(t, { tamanho: 9, cor: MARCA.texto })], { depois: 0 }),
    { largura: larguras[i] },
  )))).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9070" w:type="dxa"/>${bordas}</w:tblPr>${cab}${corpo}</w:tbl>`
    + paragrafo([run('', {})], { depois: 120 });
}

// Caixa de destaque para o exemplo trabalhado.
function caixa(titulo, linhas) {
  const conteudo = [paragrafo([run(titulo, { negrito: true, tamanho: 10.5, cor: MARCA.texto })], { depois: 60 })]
    .concat(linhas.map((l) => paragrafo([run(l, { tamanho: 9, cor: MARCA.texto })], { depois: 40 })))
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9070" w:type="dxa"/>`
    + `<w:tblBorders><w:left w:val="single" w:sz="18" w:space="0" w:color="${MARCA.destaque}"/></w:tblBorders>`
    + `</w:tblPr>${linhaTabela([celula(conteudo, { largura: 9070, fundo: MARCA.fundoExemplo, margemV: 120 })])}</w:tbl>`
    + paragrafo([run('', {})], { depois: 140 });
}

function montarDocumento() {
  const b = [];

  b.push(h1('Aba Alocação Equipes — o que cada número significa'));
  b.push(p('Planejamento Semanal · Suporte Infra · gerado em '
    + new Date().toLocaleDateString('pt-BR'), { cor: MARCA.apagado, tamanho: 8.5 }));
  b.push(p('Todas as definições abaixo foram conferidas contra as funções que produzem os '
    + 'números na tela. Os valores exibidos são arredondados: contas feitas com os números '
    + 'da tela podem diferir na primeira casa decimal.', { italico: true, cor: MARCA.apagado, tamanho: 8.5 }));

  b.push(caixa('O exemplo que atravessa este documento', [
    `Célula ${EX.sup} × ${EX.coluna} — Tendência ${EX.tendencia} · Carteira ${EX.carteira}`,
    `Equipe ${EX.equipe} (${EX.lider}), com ${EX.dias} dias disponíveis na semana`,
    `Capacidade ${EX.capacidade} · Ocupação ${EX.ocupacao} · Saldo ${EX.saldo} · ${EX.situacao}`,
  ]));

  b.push(h2('O que mudou em 11/08/2026'));
  b.push(p('Duas correções entraram no mesmo dia, e as duas mexem nos números desta aba. '
    + 'Se você anotou valores antes disso, eles não vão bater — e a diferença é esperada.'));
  b.push(tabela(
    ['O quê', 'Antes', 'Agora'],
    [
      ['Tendência da célula', 'Congelada na segunda-feira da semana',
        'Acompanha hoje — passa a bater com a aba Semanal'],
      ['Produtividade da equipe', 'Lida contrato a contrato na MATRIZ',
        'Tabela fixa por tipologia (ver seção 2)'],
      [`Capacidade no exemplo`, EX.capacidadeAntes, EX.capacidade],
      [`Ocupação no exemplo`, EX.ocupacaoAntes, EX.ocupacao],
      [`Saldo no exemplo`, EX.saldoAntes, EX.saldo],
    ],
    [2400, 3200, 3470],
  ));
  b.push(pRico([{ t: 'A célula passou a parecer MAIS sobrecarregada, e isso é o certo. ', b: true },
    'A demanda não mudou; o que mudou foi reconhecer que a equipe entrega menos do que a '
    + 'planilha supunha. Se antes já apontava falta de equipe, agora aponta com mais força.']));

  // ---------------------------------------------------------------- a célula
  b.push(h2('1. Os números da célula'));
  b.push(p('Cada célula do quadro é o cruzamento de um contrato (SUP) com um grupo de '
    + 'tipologia (a coluna). Ela mostra quatro coisas, de cima para baixo: a Tendência, a '
    + 'situação com o saldo, a barra de cobertura e a carteira.'));

  b.push(paragrafo([run('Tendência', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('Quantos furos se espera que aquele contrato produza naquela tipologia, NAQUELA '
    + 'SEMANA. É uma projeção, não uma meta e não uma medição.'));
  b.push(pRico([{ t: 'É o MESMO número que a aba Semanal mostra', b: true },
    ' para aquela semana. Esta aba não faz conta própria: ela lê o que a Tabela Semanal '
    + 'calcula e organiza por contrato e tipologia. Se um dia os dois divergirem, é defeito.']));
  b.push(pRico(['Até 11/08/2026 a Tendência daqui era ', { t: 'congelada na segunda-feira', b: true },
    ' — virava o registro do que se projetava quando a semana abriu. A intenção era boa, mas a '
    + 'aba Semanal sempre calculou com hoje, então as duas telas mostravam números diferentes '
    + 'para a mesma semana, e a diferença crescia a cada dia. O congelamento saiu.']));
  b.push(pRico(['A Tendência ', { t: 'se move ao longo da semana', b: true },
    ': ela reprojeta conforme o realizado entra. Um número anotado na terça não vai bater com '
    + 'o da quinta, e isso não é erro — é a projeção reagindo ao ritmo medido.']));
  b.push(pRico(['No exemplo: ', { t: `Tendência ${EX.tendencia}`, b: true },
    ` significa que se projetavam cerca de 60 furos de ${EX.coluna} naquele contrato, naquela semana.`]));

  b.push(paragrafo([run('Carteira', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('Quantos furos estão PENDENTES naquele contrato e tipologia — demanda que chegou e '
    + 'ainda não foi executada. É um estoque parado, não um fluxo do período.'));
  b.push(pRico(['A carteira usa a ', { t: 'mesma data-âncora da Tendência', b: true },
    ' — as duas medidas em hoje. Isso não é detalhe: se uma fosse medida na segunda-feira e a '
    + 'outra hoje, o saldo entre elas não fecharia com nada, porque estaria somando dois '
    + 'instantes diferentes.']));
  b.push(pRico(['No exemplo: ', { t: `Carteira ${EX.carteira}`, b: true },
    ' são 245 furos esperando execução. Comparando com a Tendência de ~60 por semana, há '
    + 'aproximadamente ', { t: '4 semanas de trabalho parado', b: true }, ' nesse contrato.']));

  // ------------------------------------------------------------- a equipe
  b.push(h2('2. Os números da equipe'));

  b.push(paragrafo([run('Capacidade', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 60, depois: 60 }));
  b.push(p('Quantos furos aquela equipe consegue entregar na semana:'));
  b.push(formula('capacidade = produtividade da tipologia × dias de premissa da semana'));
  b.push(formula('dias de premissa = dias do mês (premissa) × dias disponíveis ÷ dias do mês (calendário)'));
  b.push(pRico(['A premissa de dias é ', { t: '30 por mês', b: true },
    ' (15 em janeiro e dezembro), e não os dias do calendário — é a mesma base que a coluna '
    + '"Produtividade média esperada" do Consolidado usa. Trocar por dias corridos faria os '
    + 'dois quadros discordarem.']));

  b.push(paragrafo([run('Produtividade por tipologia', { negrito: true, tamanho: 11, cor: MARCA.texto })],
    { antes: 140, depois: 60 }));
  b.push(p('Em furos por equipe-dia. Uma tabela fixa, igual para todos os contratos:'));
  b.push(tabela(
    ['Tipologia', 'Furos por equipe-dia', 'Capacidade numa semana cheia'],
    [
      ['SP', '1', '6,8'],
      ['SM / SM.F / SR', '0,3', '2,0'],
      ['ST', '8', '54,2'],
      ['PI', '3', '20,3'],
      ['BL', '1', '6,8'],
      ['Especiais (CPTu, SH, VT)', '1', '6,8'],
    ],
    [3000, 2800, 3270],
  ));
  b.push(pRico(['Até 11/08/2026 a produtividade era lida ', { t: 'contrato a contrato', b: true },
    ' na MATRIZ, e ela varia muito ali: em SP vai de 0,80 a 2,00, com 25 dos 34 contratos em '
    + 'exatamente 1,00. Os poucos acima de 1 inflavam a capacidade de células específicas — no '
    + 'exemplo deste documento, o contrato traz ' + EX.prodAntes + ', metade a mais do que a '
    + 'equipe entrega de verdade.']));
  b.push(pRico([{ t: 'PI é a exceção consciente: ', b: true },
    'a MATRIZ traz 4, e a tabela usa 3 — correção de campo, não erro de digitação.']));
  b.push(pRico(['No exemplo: ', { t: `Capacidade ${EX.capacidade}`, b: true },
    ` = 1 furo/dia × 6,77 dias de premissa (a equipe tinha os ${EX.dias} dias da semana `
    + 'disponíveis). Antes da recalibração eram ' + EX.capacidadeAntes + '.']));
  b.push(pRico([{ t: 'Capacidade "—" (travessão) não é zero.', b: true },
    ' Significa que aquela célula não tem registro na MATRIZ, então não há o que multiplicar. '
    + 'Zero leria como "esta equipe não produz"; travessão lê como "não sei", que é a verdade.']));

  b.push(paragrafo([run('Carga', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('A parte da Tendência da célula que coube àquela equipe. Quando há mais de uma '
    + 'equipe na mesma célula, a demanda é repartida proporcionalmente à capacidade de cada '
    + 'uma — quem tem menos dias disponíveis puxa menos.'));
  b.push(pRico(['No exemplo, a equipe 276 está sozinha na célula, então a carga dela é a '
    + 'Tendência inteira: ', { t: EX.tendencia, b: true }, '.']));

  b.push(paragrafo([run('Ocupação', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(formula('ocupação = carga ÷ capacidade'));
  b.push(pRico(['Quanto da capacidade da equipe está comprometida. 100% é a equipe exatamente '
    + 'cheia; acima disso, está pedindo mais do que ela dá.']));
  b.push(pRico(['No exemplo: ', { t: `Ocupação ${EX.ocupacao}`, b: true },
    ` = ${EX.tendencia} ÷ ${EX.capacidade}. A leitura prática é direta: para dar conta dessa `
    + 'célula seriam necessárias ', { t: 'quase 9 equipes como aquela', b: true },
    ', ou cerca de 9 semanas de uma equipe só.']));

  // ------------------------------------------------------------- saldo
  b.push(h2('3. Saldo, situação e cobertura'));

  b.push(paragrafo([run('Saldo', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 60, depois: 60 }));
  b.push(formula('saldo = capacidade alocada na célula − tendência da célula'));
  b.push(pRico(['Em furos, não em porcentagem. ', { t: 'Negativo = falta capacidade', b: true },
    '; positivo = sobra.']));
  b.push(pRico(['No exemplo: ', { t: `Saldo ${EX.saldo}`, b: true },
    ` = ${EX.capacidade} − ${EX.tendencia}. Faltam cerca de 53 furos de capacidade naquela `
    + 'semana para cobrir o que se projeta.']));

  b.push(paragrafo([run('Situação da célula', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('Classifica quanto da capacidade a demanda ocupa, com uma faixa de tolerância de '
    + '15% para baixo e 5% para cima:'));
  b.push(tabela(
    ['Rótulo', 'Quando aparece', 'Leitura'],
    [
      ['Sem equipe', 'Há Tendência e nenhuma equipe alocada', 'Ninguém designado — é o caso mais descoberto'],
      ['Sobrecarregada', 'A demanda passa de 105% da capacidade', 'Falta gente; o saldo é negativo'],
      ['Equilibrada', 'A demanda fica entre 85% e 105%', 'Casado'],
      ['Com folga', 'A demanda fica abaixo de 85% da capacidade', 'Sobra capacidade; o saldo é positivo'],
      ['Livre', 'Não há Tendência naquela célula', 'Não há o que cobrir ali'],
    ],
    [1700, 4100, 3270],
  ));
  b.push(pRico([{ t: 'O rótulo nunca contradiz o sinal do saldo. ', b: true },
    'Até 11/08/2026 contradizia: uma célula com metade da capacidade necessária exibia '
    + '"Com folga" ao lado de um saldo negativo, porque a classificação recebia a razão '
    + 'invertida. Isso foi corrigido, e há um teste que varre a faixa inteira de valores '
    + 'justamente para impedir que volte.'], { depois: 60 }));
  b.push(pRico(['No exemplo: ', { t: EX.situacao, b: true },
    ', porque a demanda é quase 6 vezes a capacidade alocada.']));

  b.push(paragrafo([run('Situação da equipe', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('Mesmos rótulos e mesmas faixas, mas medindo a OCUPAÇÃO daquela equipe — não a '
    + 'cobertura da célula. Há dois rótulos exclusivos desta tabela:'));
  b.push(tabela(
    ['Rótulo', 'Significado'],
    [
      ['Livre', 'A equipe está no pool, sem nenhuma alocação nesta semana'],
      ['Fora da semana', 'A equipe não tem nenhum dia disponível na semana exibida'],
    ],
    [2200, 6870],
  ));

  b.push(paragrafo([run('Cobertura (a barra)', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(formula('cobertura = capacidade alocada ÷ tendência'));
  b.push(pRico(['É a razão ', { t: 'inversa', b: true },
    ' da ocupação, e é o que a barrinha desenha: ela enche da esquerda para a direita '
    + 'conforme a capacidade cobre a demanda. Barra cheia = 100% coberto. No exemplo a barra '
    + 'aparece quase vazia (~17%), coerente com a sobrecarga.']));

  // ------------------------------------------------------------- leitura SUP
  b.push(h2('4. A leitura do contrato (coluna "Leitura")'));
  b.push(p('Na tabela de resumo por SUP, cada contrato recebe um diagnóstico único, somando '
    + 'todas as colunas dele. A ordem de avaliação importa — vale o primeiro que casar:'));
  b.push(tabela(
    ['Leitura', 'Quando', 'O que fazer'],
    [
      ['Parado c/ carteira', 'Sem Tendência, mas com carteira em aberto', 'Contrato parado com serviço represado — candidato a receber equipe'],
      ['Sem equipe', 'Tem Tendência e nenhuma equipe alocada', 'Alocar alguém'],
      ['Falta equipe', 'Saldo negativo', 'A capacidade alocada não cobre a projeção'],
      ['Antecipar', 'Saldo positivo e ainda há carteira', 'Sobra capacidade e há serviço parado — dá para puxar demanda'],
      ['Absorvido', 'Tem Tendência e o saldo cobre', 'Situação saudável'],
      ['Sem demanda', 'Sem Tendência e sem carteira, mas com equipe alocada', 'Equipe parada onde não há o que fazer'],
    ],
    [1900, 3300, 3870],
  ));

  b.push(paragrafo([run('Semanas de carteira', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(formula('semanas de carteira = carteira ÷ tendência'));
  b.push(pRico(['Quantas semanas o estoque parado renderia no ritmo projetado. No exemplo, '
    + '245 ÷ 59,7 ≈ ', { t: '4,1 semanas', b: true }, '. Um "∞" significa carteira sem '
    + 'nenhuma Tendência para consumi-la; um travessão significa que não há ritmo para '
    + 'calcular.']));

  // ------------------------------------------------------------- faixa topo
  b.push(h2('5. A faixa do topo'));
  b.push(p('Os cinco números do alto somam o quadro inteiro, já respeitando os filtros ativos.'));
  b.push(tabela(
    ['Indicador', 'O que é'],
    [
      ['Tendência da semana', 'Soma das Tendências de todas as células visíveis'],
      ['Capacidade alocada', 'Soma da capacidade das equipes que estão no quadro'],
      ['Saldo', 'Capacidade alocada − Tendência: negativo é déficit de capacidade'],
      ['Carteira em aberto', 'Soma da carteira de todas as células visíveis'],
      ['Capacidade ociosa', 'Soma apenas das FOLGAS. Equipe sobrecarregada contribui zero, nunca negativo'],
    ],
    [2600, 6470],
  ));
  b.push(pRico([{ t: 'Por que a capacidade ociosa não é o oposto do saldo: ', b: true },
    'se uma equipe sobrecarregada entrasse com valor negativo, a folga de umas mascararia o '
    + 'excesso de outras e o número do topo mentiria. Saldo e ociosidade respondem perguntas '
    + 'diferentes — um é o balanço líquido, o outro é quanta capacidade está literalmente '
    + 'sem uso.']));

  // ------------------------------------------------------------- pool
  b.push(h2('6. O pool e os cartões'));
  b.push(pRico([{ t: 'Pool', b: true }, ' é a área de equipes ainda não alocadas na semana, '
    + 'agrupada por tipologia na mesma ordem das colunas do quadro. Grupo sem ninguém não é desenhado.']));
  b.push(pRico(['O selo ', { t: '⇄', b: true }, ' marca a equipe ', { t: 'polivalente', b: true },
    ' — a que atende mais de uma tipologia. Ela aparece em CADA grupo que serve, então o mesmo '
    + 'cartão pode ser visto duas ou três vezes. Não são equipes diferentes: alocar em um lugar '
    + 'some com todas as cópias.']));
  b.push(pRico([{ t: 'Fora do quadro', b: true }, ' recolhe as equipes que não entram na '
    + 'alocação (laboratório, testes), sempre com o motivo escrito — nunca somem caladas.']));
  b.push(pRico([{ t: 'Devolver uma equipe: ', b: true }, 'arraste-a de volta para o pool, ou '
    + 'clique nela e depois no pool. Soltar em qualquer outro lugar da tela não faz nada, de '
    + 'propósito: alocar é trabalho, e um solte impreciso não pode desfazê-lo.']));
  b.push(pRico([{ t: 'Buscar uma equipe: ', b: true }, 'o campo no alto da aba procura por '
    + 'código, por apelido do líder e também pelo nome completo, ignorando acentos e '
    + 'maiúsculas. Se a equipe procurada já estiver alocada, ela aparece como uma linha de '
    + 'texto dizendo em qual contrato está.']));

  b.push(paragrafo([run('Somente leitura', { negrito: true, tamanho: 11, cor: MARCA.texto })], { antes: 140, depois: 60 }));
  b.push(p('Quando a semana exibida é de um mês diferente do que a planilha de equipes cobre, '
    + 'o quadro continua desenhado mas nada pode ser arrastado, com o motivo escrito na tela. '
    + 'Não há roster atualizado daquele outro mês para validar um arraste.'));

  // ------------------------------------------------------------- leitura final
  b.push(h2('7. Lendo o exemplo inteiro'));
  b.push(caixa(`${EX.sup} × ${EX.coluna}, com a equipe ${EX.equipe} (${EX.lider})`, [
    `Projetam-se ${EX.tendencia} furos para a semana, e há ${EX.carteira} furos parados na carteira.`,
    `A única equipe alocada tem os ${EX.dias} dias disponíveis e entrega ${EX.capacidade} furos na semana.`,
    `Resultado: ocupação de ${EX.ocupacao}, saldo de ${EX.saldo} furos, situação ${EX.situacao}.`,
  ]));
  b.push(p('Em uma frase: o contrato precisa de aproximadamente nove vezes a capacidade que '
    + 'tem alocada para acompanhar a projeção da semana, e ainda carrega um estoque de cerca '
    + 'de quatro semanas de serviço parado. É uma célula que pede reforço, não ajuste fino.'));
  b.push(p('Vale a distinção: a Tendência é o que se espera produzir na semana; a carteira é o '
    + 'que já está esperando. Uma equipe sozinha levaria ~9 semanas só para dar conta da '
    + 'projeção desta semana — e nesse tempo a carteira teria crescido com o que chega de novo.',
  { depois: 40 }));

  return b.join('');
}

function estilos() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}" w:cs="${FONTE}"/>
<w:color w:val="${MARCA.texto}"/><w:sz w:val="20"/><w:szCs w:val="20"/>
<w:lang w:val="pt-BR" w:eastAsia="pt-BR" w:bidi="ar-SA"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;
}

function rodape() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="0"/>
<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${MARCA.linha}"/></w:pBdr></w:pPr>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr>
<w:t xml:space="preserve">Aba Alocação Equipes — glossário  ·  Suporte Infra  ·  </w:t></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:ftr>`;
}

function gerar(caminhoSaida) {
  const corpo = montarDocumento();

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${corpo}
<w:sectPr>
<w:footerReference w:type="default" r:id="rIdRodape"/>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="567" w:gutter="0"/>
<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>
</w:sectPr></w:body></w:document>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdRodape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const relsRaiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const agora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
 xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc('Aba Alocação Equipes — o que cada número significa')}</dc:title>
<dc:creator>Suporte Infra</dc:creator>
<cp:lastModifiedBy>Suporte Infra</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified>
</cp:coreProperties>`;

  const docx = zipar([
    { nome: '[Content_Types].xml', conteudo: contentTypes },
    { nome: '_rels/.rels', conteudo: relsRaiz },
    { nome: 'docProps/core.xml', conteudo: core },
    { nome: 'word/document.xml', conteudo: documento },
    { nome: 'word/_rels/document.xml.rels', conteudo: rels },
    { nome: 'word/styles.xml', conteudo: estilos() },
    { nome: 'word/footer1.xml', conteudo: rodape() },
  ]);

  fs.mkdirSync(path.dirname(caminhoSaida), { recursive: true });
  fs.writeFileSync(caminhoSaida, docx);
  return { caminhoSaida, bytes: docx.length };
}

if (require.main === module) {
  const padrao = path.join(os.homedir(), 'OneDrive', 'Desktop',
    'Aba Alocacao Equipes - glossario dos numeros.docx');
  const alvo = process.argv[2] || padrao;
  const { caminhoSaida, bytes } = gerar(alvo);
  console.log(`OK: ${caminhoSaida} (${(bytes / 1024).toFixed(1)} KB)`);
}

module.exports = { gerar };
