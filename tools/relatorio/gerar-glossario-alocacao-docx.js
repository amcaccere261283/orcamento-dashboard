'use strict';
// Gera o Word "Aba Alocacao Equipes - como usar e de onde vem os numeros".
//
//   node tools/relatorio/gerar-glossario-alocacao-docx.js ["caminho/saida.docx"]
//
// Sem senha, sem rede e sem G:\ -- e' um documento de texto, escrito para quem
// vai OPERAR a aba, nao para quem programa. Cada definicao foi conferida contra
// a funcao que produz o numero na tela (compute-alocacao.js,
// render-aba-alocacao.js, equipes-alocaveis.js, grupos-veiculo.js,
// render-semanal.js, calculo-equipes.js, compute-demandas.js,
// compute-tendencia-semanal.js). Se uma formula mudar la, este arquivo fica
// desatualizado em silencio: e' texto, nao codigo executavel.
//
// O documento NAO carrega historico de versoes (pedido do dono do projeto em
// 2026-08-12): descreve a ferramenta como ela e' hoje. Ao mudar a aba, mude o
// texto no lugar em vez de acrescentar um "o que mudou".
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

// O exemplo que atravessa a Parte II: um numero solto nao ensina nada, o mesmo
// numero explicado de varios angulos ensina. Sao valores de uma celula real
// (medidos em agosto/2026), usados aqui so para ilustrar as contas -- nao sao
// "o numero de hoje" da tela.
const EX = {
  sup: 'SUP-7285-24',
  coluna: 'SP',
  equipe: '276',
  lider: 'Francinaldo Jr.',
  tendencia: '59,7',
  carteira: '245',
  dias: '7',
  capacidade: '6,8',
  ocupacao: '881%',
  saldo: '-52,9',
  situacao: 'Sobrecarregada',
};

function h1(texto) {
  return paragrafo([run(texto, { negrito: true, tamanho: 16, cor: MARCA.texto })],
    { antes: 0, depois: 80 });
}

// Divisor de PARTE: caixa alta, cor de destaque, sempre em pagina nova a partir
// da segunda -- as duas partes tem publicos de leitura diferentes (usar x
// conferir), e comecar cada uma no alto da pagina ajuda a folhear.
function hParte(texto, quebraAntes) {
  return paragrafo([run(texto, { negrito: true, tamanho: 13, cor: MARCA.destaque, caixaAlta: true, espacamento: 20 })],
    { antes: quebraAntes ? 0 : 320, depois: 60, quebraAntes: !!quebraAntes });
}

function h2(texto) {
  return paragrafo([run(texto, { negrito: true, tamanho: 12, cor: MARCA.destaque })],
    { antes: 260, depois: 80, bordaInferior: { cor: MARCA.linha, espessura: 4 }, manterProxima: true });
}

function h3(texto) {
  return paragrafo([run(texto, { negrito: true, tamanho: 11, cor: MARCA.texto })],
    { antes: 140, depois: 60, manterProxima: true });
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

// Item de lista. A tabulacao (e nao espacos) separa o marcador do texto: com
// espacos, um paragrafo justificado estica cada item de um jeito.
function item(pedacos) {
  const partes = Array.isArray(pedacos) ? pedacos : [pedacos];
  const runs = [run('•\t', { tamanho: 10, cor: MARCA.destaque })].concat(
    partes.map((t) => (typeof t === 'string'
      ? run(t, { tamanho: 10, cor: MARCA.texto })
      : run(t.t, { tamanho: 10, negrito: t.b, italico: t.i, cor: t.cor || MARCA.texto }))));
  return paragrafo(runs, { depois: 50, recuo: 340, recuoPrimeira: 200, tabulacoes: [340] });
}

function passo(numero, pedacos) {
  const partes = Array.isArray(pedacos) ? pedacos : [pedacos];
  const runs = [run(numero + '.\t', { tamanho: 10, negrito: true, cor: MARCA.destaque })].concat(
    partes.map((t) => (typeof t === 'string'
      ? run(t, { tamanho: 10, cor: MARCA.texto })
      : run(t.t, { tamanho: 10, negrito: t.b, italico: t.i, cor: t.cor || MARCA.texto }))));
  return paragrafo(runs, { depois: 60, recuo: 340, recuoPrimeira: 340, tabulacoes: [340] });
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

// Caixa de destaque.
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

  // =========================================================== capa e sumário
  b.push(h1('Aba Alocação Equipes — como usar e de onde vêm os números'));
  b.push(p('Planejamento Semanal · Suporte Infra · gerado em '
    + new Date().toLocaleDateString('pt-BR'), { cor: MARCA.apagado, tamanho: 8.5 }));
  b.push(p('Este documento tem duas partes. A Parte I é o manual da tela: cada área, cada botão, '
    + 'cada número e cada gesto, na ordem em que aparecem. A Parte II diz de onde vem cada dado, '
    + 'como ele é lido e como cada número é calculado. Nenhuma das duas exige saber programar.',
  { italico: true, cor: MARCA.apagado, tamanho: 8.5 }));

  b.push(caixa('A aba em duas frases', [
    'O QUE ELA FAZ: distribui as equipes de campo entre os contratos de UMA semana e mostra, '
      + 'contrato a contrato e tipologia a tipologia, quanto serviço se espera e quanta capacidade '
      + 'de equipe está posta ali.',
    'O QUE ELA NÃO FAZ: não cria demanda, não altera a previsão do contrato e não mexe na '
      + 'composição das equipes. Ela só organiza — a demanda vem dos extratos de campo e a lista '
      + 'de equipes vem da planilha de equipes.',
  ]));

  b.push(h2('Como este documento está organizado'));
  b.push(tabela(
    ['Parte', 'Seções', 'Responde'],
    [
      ['I — A ferramenta', '1 a 16', 'O que é cada coisa na tela e como mexer nela'],
      ['II — Dados e cálculo', '17 a 27', 'De onde vem cada número e por que ele deu aquele valor'],
    ],
    [2200, 1600, 5270],
  ));

  // ======================================================== PARTE I
  b.push(hParte('Parte I — a ferramenta'));

  // ---------------------------------------------------------------- 1
  b.push(h2('1. Para que serve, e o ciclo de uso da semana'));
  b.push(p('A aba responde a uma pergunta prática: nesta semana, cada contrato tem equipe '
    + 'suficiente para o que se espera dele? E, quando não tem, de onde tirar.'));
  b.push(pRico(['O quadro trabalha sempre sobre ', { t: 'uma semana de cada vez', b: true },
    ' — de segunda a domingo, sempre cortada dentro do mês (nenhum dia de um mês entra na semana '
    + 'do mês vizinho). A semana em curso já vem selecionada ao abrir.']));
  b.push(p('O ciclo normal de uso é este:'));
  b.push(passo(1, ['Abrir a aba. O quadro já vem preenchido com onde as equipes ',
    { t: 'estiveram de fato', b: true }, ' na semana (ver seção 12) — é o ponto de partida, não um plano.']));
  b.push(passo(2, 'Olhar a faixa de indicadores no topo: saldo negativo é falta de capacidade no '
    + 'conjunto; capacidade ociosa é o que sobra sem uso.'));
  b.push(passo(3, ['Varrer o quadro de cima para baixo. Ele já vem ordenado com os contratos mais '
    + 'críticos primeiro, e cada linha tem um selo de leitura (', { t: 'Falta equipe', b: true },
  ', ', { t: 'Sem equipe', b: true }, ', ', { t: 'Parado c/ carteira', b: true }, '…).']));
  b.push(passo(4, 'Mover as equipes: arrastar do pool para a célula do contrato, de uma célula '
    + 'para outra, ou de volta para o pool.'));
  b.push(passo(5, 'Conferir de novo a faixa do topo e as duas tabelas de resumo no fim da página — '
    + 'elas acompanham cada movimento.'));
  b.push(passo(6, 'Repetir para as outras semanas do mês, pelos botões S1, S2, S3…'));
  b.push(pRico(['Não existe botão "salvar". ', { t: 'Cada movimento é gravado sozinho', b: true },
    ', assim que você solta a equipe — o status no alto da aba diz onde ele foi parar (seção 13).']));

  // ---------------------------------------------------------------- 2
  b.push(h2('2. O mapa da tela'));
  b.push(p('A aba tem seis áreas, sempre nesta ordem, de cima para baixo:'));
  b.push(tabela(
    ['#', 'Área', 'O que é'],
    [
      ['1', 'Controles', 'Botões de semana, "Repor o realizado", "Limpar alocação", busca de equipe, '
        + 'filtro de tipologia e o status de gravação.'],
      ['2', 'Faixa de indicadores', 'Cinco números que somam o quadro inteiro como ele está na tela.'],
      ['3', 'Pool de equipes', 'As equipes ainda não alocadas nesta semana, agrupadas por tipologia. '
        + 'É de onde se arrasta, e para onde se devolve.'],
      ['4', 'Quadro SUP × tipologia', 'A grade principal: uma linha por contrato, uma coluna por '
        + 'grupo de tipologia, e a equipe alocada dentro da célula.'],
      ['5', 'Resumo por SUP', 'Uma linha por contrato, com os mesmos números da grade somados e o '
        + 'diagnóstico do contrato.'],
      ['6', 'Resumo por equipe', 'Uma linha por equipe, com onde ela está, quanto pegou e o quanto '
        + 'isso ocupa dela.'],
    ],
    [500, 2200, 6370],
  ));
  b.push(pRico(['As três últimas áreas são ', { t: 'a mesma informação em três recortes', b: true },
    ': por célula, por contrato e por equipe. Nenhuma delas faz conta própria — todas saem do mesmo '
    + 'cálculo, então elas nunca podem discordar entre si.']));

  // ---------------------------------------------------------------- 3
  b.push(h2('3. Os controles do topo'));
  b.push(tabela(
    ['Controle', 'O que faz'],
    [
      ['S1, S2, S3… (botões de semana)', 'Troca a semana exibida. Cada semana tem a sua própria '
        + 'alocação, guardada em separado: trocar de semana nunca leva junto o que foi feito na '
        + 'anterior. O botão da semana exibida fica destacado, e a data do intervalo vem escrita nele.'],
      ['Repor o realizado', 'Descarta a alocação atual da semana e reconstrói o quadro a partir de '
        + 'onde as equipes realmente trabalharam. Pede confirmação. É "repor", não "completar": '
        + 'substitui tudo.'],
      ['Limpar alocação', 'Esvazia a semana inteira — todas as equipes voltam ao pool. Pede '
        + 'confirmação. Depois disso o quadro não se preenche sozinho de novo.'],
      ['Buscar equipe', 'Filtra por código da equipe, apelido do líder ou nome completo, ignorando '
        + 'acentos e maiúsculas. Poda o pool E o quadro (ver seção 6).'],
      ['Todas as tipologias (lista)', 'Mostra só uma coluna do quadro, e só o grupo correspondente '
        + 'do pool. As duas metades da tela sempre falam do mesmo recorte.'],
      ['Status (à direita)', 'Diz se o que você está vendo já foi gravado, e onde. Ver seção 13.'],
    ],
    [2500, 6570],
  ));

  b.push(h3('Os filtros que vêm da página, não da aba'));
  b.push(pRico(['A barra de filtros do alto da página (origem, categoria, tipologia, grupo e SUP) '
    + 'também vale aqui: ela ', { t: 'poda as linhas do quadro', b: true },
  '. Filtrar um SUP deixa só ele. O seletor de mês, igualmente, muda o conjunto de semanas '
  + 'oferecido pelos botões S1, S2…']));
  b.push(pRico(['Uma exceção importante: a opção ', { t: '"Somente SUPs ativos"', b: true },
    ' NÃO é aplicada nesta aba, de propósito. Ela esconderia justamente os contratos parados com '
    + 'carteira em aberto — que são o motivo de a aba existir. Um contrato pode estar sem produção '
    + 'nenhuma no mês e ainda ter serviço represado esperando equipe.']));
  b.push(pRico(['Há um contrato especial chamado ', { t: '"Diversos"', b: true },
    '. Ele recolhe o serviço cujo contrato não existe na planilha de previsão — não é um contrato '
    + 'de verdade, é o destino de quem não achou casa.']));

  // ---------------------------------------------------------------- 4
  b.push(h2('4. A faixa de indicadores'));
  b.push(p('Os cinco números do alto somam o quadro inteiro, já respeitando os filtros ativos — '
    + 'se você filtrou um SUP, eles falam só daquele SUP.'));
  b.push(tabela(
    ['Indicador', 'O que é', 'Como ler'],
    [
      ['Tendência da semana', 'Soma das tendências de todas as células visíveis',
        'Quanto serviço se espera para a semana, em furos'],
      ['Capacidade alocada', 'Soma da capacidade das equipes que estão dentro do quadro',
        'Quanto essas equipes conseguem entregar na semana'],
      ['Saldo', 'Capacidade alocada − Tendência',
        'Negativo = falta capacidade; positivo = sobra'],
      ['Carteira em aberto', 'Soma da carteira de todas as células visíveis',
        'Estoque de serviço parado, esperando execução'],
      ['Capacidade ociosa', 'Soma apenas das FOLGAS de cada equipe',
        'Quanta capacidade está literalmente sem uso'],
    ],
    [1900, 3400, 3770],
  ));
  b.push(pRico([{ t: 'Capacidade ociosa não é o oposto do Saldo, e os dois podem ser ruins ao mesmo tempo. ', b: true },
    'Uma equipe sobrecarregada contribui ZERO para a ociosa, nunca um valor negativo — se contribuísse, '
    + 'a folga de umas mascararia o excesso de outras. O Saldo responde "no conjunto, falta ou sobra?"; '
    + 'a Ociosa responde "quanto está parado?". É comum ver saldo negativo e ociosidade positiva juntos: '
    + 'significa que há capacidade sobrando no lugar errado.']));

  // ---------------------------------------------------------------- 5
  b.push(h2('5. As colunas do quadro (grupos de tipologia)'));
  b.push(p('O quadro tem seis colunas possíveis. Elas são grupos de tipologia de EQUIPE, e não a '
    + 'lista crua de tipologias da planilha de previsão:'));
  b.push(tabela(
    ['Coluna', 'Cobre a demanda de', 'Quem atende'],
    [
      ['SP', 'SP', 'Equipes de serviço "SP" e "SP/SM"'],
      ['SM / SM.F / SR', 'SM, SM.F e SR juntas', 'Equipes de serviço "SM" e "SP/SM"'],
      ['ST', 'ST', 'Equipes "ST" e "ST | PI | BL"'],
      ['PI', 'PI', 'Equipes "PI" e "ST | PI | BL"'],
      ['BL', 'BL', 'Equipes "ST | PI | BL"'],
      ['Especiais', 'CPTu, SH e VT juntas', 'Equipes "CPTu | VT | SH"'],
    ],
    [2000, 3200, 3870],
  ));
  b.push(pRico(['BL fica em coluna própria em vez de entrar em Especiais porque ',
    { t: 'quem atende BL são as equipes de ST | PI | BL', b: true },
    ' — juntar BL com CPTu/SH/VT criaria uma coluna que metade das equipes dela não sabe trabalhar. '
    + 'Como BL tem pouquíssimo volume, a coluna normalmente nem aparece.']));
  b.push(pRico([{ t: 'Coluna sem nada não é desenhada, e linha sem nada também não. ', b: true },
    'O quadro só mostra o cruzamento que tem tendência, carteira ou equipe alocada — o resto seria '
    + 'espaço vazio ocupando tela.']));

  // ---------------------------------------------------------------- 6
  b.push(h2('6. O pool de equipes'));
  b.push(pRico(['O ', { t: 'pool', b: true }, ' é a área tracejada logo abaixo dos indicadores: as '
    + 'equipes que ainda não estão alocadas nesta semana. Ele é dividido em blocos por tipologia, na '
    + 'MESMA ordem das colunas do quadro, com a contagem do grupo entre parênteses. Bloco sem '
    + 'ninguém não é desenhado.']));
  b.push(item([{ t: 'Equipes disponíveis vêm primeiro. ', b: true },
    'A equipe sem nenhum dia disponível na semana aparece apagada, no fim do bloco, com o motivo '
    + 'escrito. Ela nunca some da lista — sumir seria mentir sobre o tamanho da frota.']));
  b.push(item([{ t: 'A equipe polivalente aparece em CADA bloco que ela serve. ', b: true },
    'O mesmo cartão pode ser visto duas ou três vezes; o selo ⇄ avisa isso. Não são equipes '
    + 'diferentes — alocar em um lugar some com todas as cópias de uma vez.']));
  b.push(item([{ t: '"Fora do quadro (N)" ', b: true },
    'é a lista recolhida das equipes que não entram na alocação: laboratório, serviços de teste, '
    + 'equipes sem serviço preenchido e qualquer serviço novo que a planilha traga e que ninguém '
    + 'catalogou ainda. Cada uma vem com o motivo escrito — nunca somem caladas.']));
  b.push(item([{ t: 'Busca por equipe já alocada: ', b: true },
    'se a equipe procurada estiver dentro do quadro, ela aparece no pool como uma LINHA DE TEXTO '
    + 'dizendo em qual contrato está, não como cartão. É de propósito: um segundo cartão arrastável '
    + 'permitiria alocá-la em dois contratos ao mesmo tempo.']));

  // ---------------------------------------------------------------- 7
  b.push(h2('7. O cartão da equipe e a ficha dela'));
  b.push(p('O cartão é a peça que se arrasta. Ele carrega, da esquerda para a direita:'));
  b.push(tabela(
    ['Elemento', 'Significado'],
    [
      ['Número em destaque', 'O código da equipe'],
      ['⇄', 'Equipe polivalente — atende mais de uma tipologia e aparece em mais de um bloco do pool'],
      ['🚐 com um número', 'Quantas equipes dividem aquele veículo (contando ela). Só aparece quando '
        + 'há de fato outra equipe no mesmo carro'],
      ['Bolinha colorida', 'A cor da tipologia em que ela está trabalhando naquele lugar — a mesma '
        + 'paleta do dashboard Matriz de Equipes'],
      ['Nome', 'O apelido do líder. O nome completo só aparece quando foi ele que casou a sua busca'],
      ['Borda tracejada', 'Equipe polivalente'],
      ['Cartão apagado', 'Equipe sem dia disponível na semana — não pode ser arrastada'],
      ['Contorno vermelho', 'Conflito de veículo: uma companheira de carro está em outro contrato '
        + '(ver seção 11)'],
    ],
    [2300, 6770],
  ));
  b.push(pRico(['Parando o mouse sobre o cartão (ou chegando nele pelo teclado) abre a ',
    { t: 'ficha da equipe', b: true }, ', com: habilitação, tipologia que ela atende, veículo e '
    + 'proprietário, quem divide o veículo com ela, equipamentos, tomador atual, quantos dias ela '
    + 'tem disponíveis na semana e a capacidade/ocupação atual.']));
  b.push(pRico([{ t: 'A ficha nunca mostra o efetivo nem nomes de pessoas. ', b: true },
    'Quem compõe cada equipe está em outra aba da planilha de equipes, que este painel não lê — '
    + 'decisão explícita, não limitação técnica.']));
  b.push(pRico(['A linha "Disponível: N de M dias da semana" é a que explica por que duas equipes '
    + 'da MESMA tipologia têm capacidades diferentes: a produtividade é igual, o que muda é ',
  { t: 'quantos dias a equipe está ativa naquela semana', b: true }, '.']));

  // ---------------------------------------------------------------- 8
  b.push(h2('8. O quadro: a linha do contrato'));
  b.push(p('Cada linha é um contrato (SUP). Na primeira coluna vêm, nesta ordem: o número de ordem, '
    + 'o código do contrato, o tomador e um selo colorido com a leitura do contrato.'));
  b.push(h3('O selo de leitura'));
  b.push(p('É o diagnóstico do contrato INTEIRO, somando todas as colunas dele. Só um selo por '
    + 'linha, e vale o primeiro caso que se aplicar, nesta ordem:'));
  b.push(tabela(
    ['Selo', 'Quando aparece', 'O que fazer'],
    [
      ['Parado c/ carteira', 'Sem tendência para a semana, mas com carteira em aberto',
        'Contrato parado com serviço represado — candidato a receber equipe'],
      ['Sem equipe', 'Tem tendência e nenhuma equipe alocada', 'Alocar alguém'],
      ['Falta equipe', 'Saldo negativo', 'A capacidade alocada não cobre a projeção — reforçar'],
      ['Antecipar', 'Saldo positivo e ainda há carteira',
        'Sobra capacidade e há serviço parado — dá para puxar demanda'],
      ['Absorvido', 'Tem tendência e o saldo cobre', 'Situação saudável, nada a fazer'],
      ['Sem demanda', 'Sem tendência e sem carteira, mas com equipe alocada',
        'Equipe parada onde não há o que fazer — realocar'],
    ],
    [1800, 3400, 3870],
  ));
  b.push(h3('A ordem das linhas'));
  b.push(p('O quadro se ordena sozinho, e a regra é: primeiro o que precisa de decisão.'));
  b.push(item('Contratos COM tendência na semana vêm antes dos sem tendência.'));
  b.push(item('Entre eles, primeiro os que estão ATRASADOS em relação ao previsto, depois os em '
    + 'dia, depois os adiantados.'));
  b.push(item('Empates são desfeitos pelo tamanho do atraso e, por fim, pelo código do contrato.'));
  b.push(pRico([{ t: 'A ordem não depende da alocação. ', b: true }, 'É por isso que as linhas não '
    + 'pulam de lugar enquanto você arrasta uma equipe — o quadro fica estável durante o trabalho.']));

  // ---------------------------------------------------------------- 9
  b.push(h2('9. O quadro: a célula'));
  b.push(p('Cada célula é o cruzamento de um contrato com um grupo de tipologia. Ela mostra cinco '
    + 'coisas, de cima para baixo:'));
  b.push(tabela(
    ['Na célula', 'O que é'],
    [
      ['tendência 59,7', 'Quantos furos se espera daquele contrato, naquela tipologia, NAQUELA '
        + 'semana. É projeção, não meta e não medição'],
      ['Sobrecarregada · saldo -52,9', 'A situação da célula e o saldo em furos (capacidade alocada '
        + 'menos tendência)'],
      ['A barrinha', 'Cobertura: o quanto da demanda a capacidade alocada cobre. Cheia = 100% coberto'],
      ['Os cartões', 'As equipes alocadas nessa célula'],
      ['carteira 245', 'Furos pendentes daquele contrato e tipologia — estoque parado, não fluxo da semana'],
    ],
    [2600, 6470],
  ));
  b.push(h3('As cinco situações da célula'));
  b.push(tabela(
    ['Situação', 'Quando', 'Leitura'],
    [
      ['Sem equipe', 'Há tendência e nenhuma equipe alocada', 'O caso mais descoberto que existe'],
      ['Sobrecarregada', 'A demanda passa de 105% da capacidade alocada', 'Falta gente; o saldo é negativo'],
      ['Equilibrada', 'A demanda fica entre 85% e 105% da capacidade', 'Casado'],
      ['Com folga', 'A demanda fica abaixo de 85% da capacidade', 'Sobra capacidade; o saldo é positivo'],
      ['Livre', 'Não há tendência naquela célula', 'Não há o que cobrir ali'],
    ],
    [1800, 3600, 3670],
  ));
  b.push(pRico(['O rótulo e o sinal do saldo ', { t: 'nunca se contradizem', b: true },
    ': "Sobrecarregada" sempre vem com saldo negativo, "Com folga" sempre com saldo positivo.']));
  b.push(h3('Os sinais visuais da célula'));
  b.push(tabela(
    ['Sinal', 'Significado'],
    [
      ['Fundo listrado (hachurado)', 'A célula não tem tendência nesta semana. Continua aceitando '
        + 'equipe — é assim que se antecipa carteira'],
      ['Faixa vermelha à esquerda', 'Saldo negativo: a capacidade ali não cobre a projeção'],
      ['Contorno azul', 'Há carteira em aberto, o saldo já está coberto E existe equipe livre daquela '
        + 'tipologia — dá para puxar serviço para cá agora'],
      ['Contorno neutro (fino)', 'Mesma situação, mas não há equipe livre da tipologia — é informação, '
        + 'não convite'],
      ['Célula acesa em âmbar', 'Só durante um arrasto: aquela célula aceita a equipe que você está '
        + 'segurando'],
      ['Células esmaecidas', 'Só durante um arrasto: não aceitam aquela equipe (tipologia diferente)'],
    ],
    [2500, 6570],
  ));

  // ---------------------------------------------------------------- 10
  b.push(h2('10. Movendo equipes: os dois gestos'));
  b.push(h3('Arrastar'));
  b.push(p('Pressione o cartão e arraste. Funciona com mouse e com o dedo, em tablet. Enquanto você '
    + 'arrasta: uma etiqueta acompanha o ponteiro, as células compatíveis acendem, as demais '
    + 'esmaecem, e as companheiras de veículo daquela equipe ganham um contorno tracejado (elas vão '
    + 'junto — seção 11). Solte sobre a célula de destino.'));
  b.push(h3('Clicar duas vezes (sem arrastar)'));
  b.push(p('Um clique curto no cartão SELECIONA a equipe e mantém os destaques acesos. O clique '
    + 'seguinte, numa célula, solta a equipe ali. É o caminho de precisão, útil quando o quadro está '
    + 'largo e arrastar é incômodo.'));
  b.push(h3('Devolver ao pool'));
  b.push(p('Arraste a equipe de volta para a área do pool, ou selecione-a e clique no pool. O pool '
    + 'acende quando a devolução tem efeito.'));
  b.push(h3('Soltar no vazio'));
  b.push(pRico(['Soltar em qualquer outro lugar da tela ', { t: 'não faz nada', b: true },
    ', de propósito. Alocar é trabalho; um solte impreciso não pode desfazê-lo.']));
  b.push(h3('Quando o quadro recusa o movimento'));
  b.push(p('Duas recusas, e em ambas NADA se move — nem a equipe arrastada:'));
  b.push(item('A equipe não tem nenhum dia disponível na semana (cartão apagado).'));
  b.push(item('A célula é de uma tipologia que aquela equipe não atende.'));
  b.push(pRico(['Repare que o quadro ', { t: 'não recusa por falta de demanda', b: true },
    ': soltar uma equipe numa célula listrada (sem tendência) é permitido, e é exatamente assim que '
    + 'se antecipa carteira parada.']));
  b.push(p('Uma equipe por vez: um segundo dedo no tablet não sequestra um arrasto já em andamento.'));

  // ---------------------------------------------------------------- 11
  b.push(h2('11. A trava de veículo — equipes que andam juntas'));
  b.push(pRico(['Equipes que dividem o mesmo veículo não podem ficar em contratos diferentes: elas '
    + 'se deslocam juntas. Por isso o destino do seu gesto ', { t: 'vale para o grupo inteiro', b: true },
  '. Arrastou uma, foram todas.']));
  b.push(item([{ t: 'Vale também para a devolução: ', b: true },
    'mandar uma equipe do grupo para o pool traz as companheiras junto — senão o gesto recriaria, '
    + 'ao contrário, o mesmo plano impossível.']));
  b.push(item([{ t: 'A tipologia de cada companheira é preservada. ', b: true },
    'A trava é sobre o CONTRATO. Quem vai de carona continua na coluna em que já estava, se ela '
    + 'servir; a coluna do gesto é a segunda opção.']));
  b.push(item([{ t: 'Companheira indisponível nunca é movida. ', b: true },
    'Não há deslocamento a coordenar com quem não vai a campo naquela semana.']));
  b.push(item([{ t: 'O vínculo vem da planilha de equipes: ', b: true },
    'a mesma placa escrita em duas linhas, ou uma linha dizendo "Carona ID N" apontando para outra '
    + 'equipe. Textos como "Próprio", "Suporte" ou célula vazia não vinculam nada.']));
  b.push(h3('Conflito de veículo (contorno vermelho no cartão)'));
  b.push(pRico(['Como a trava só age nos SEUS movimentos, um grupo pode aparecer já espalhado em '
    + 'contratos diferentes — vindo do retrato do realizado (seção 12) ou de uma alocação antiga. '
    + 'Nesse caso o quadro ', { t: 'marca e não corrige', b: true },
  ': o cartão ganha contorno vermelho e a ficha diz quem está onde. Mover qualquer uma das equipes '
  + 'do grupo resolve.']));

  // ---------------------------------------------------------------- 12
  b.push(h2('12. Por que o quadro já abre preenchido'));
  b.push(pRico(['Ao abrir uma semana que ', { t: 'nunca teve alocação salva', b: true },
    ', o quadro se preenche sozinho com o retrato do realizado: cada equipe aparece no contrato em '
    + 'que ela de fato trabalhou naquela semana, segundo a última OS registrada na planilha de '
    + 'equipes. Equipe sem OS na semana, ou indisponível, nasce no pool — nunca é chutada para '
    + 'lugar nenhum.']));
  b.push(item([{ t: 'É ponto de partida, não plano. ', b: true },
    'Por ser um retrato do que aconteceu, ele pode conter situações que a trava de veículo não '
    + 'permitiria — e é por isso que o conflito é marcado em vez de corrigido.']));
  b.push(item([{ t: 'Uma semana esvaziada de propósito não se reenche. ', b: true },
    'Depois de "Limpar alocação", o quadro fica vazio; ele só semeia de novo se você pedir por '
    + '"Repor o realizado".']));
  b.push(item([{ t: '"Repor o realizado" substitui tudo. ', b: true },
    'É o botão para recomeçar do retrato quando o plano da semana ficou confuso demais para ajustar.']));

  // ---------------------------------------------------------------- 13
  b.push(h2('13. Onde a sua alocação é gravada'));
  b.push(p('Não há botão "salvar": cada movimento é gravado sozinho logo depois de a tela ser '
    + 'atualizada. A tela nunca espera a gravação — se a rede falhar, o que você fez continua na '
    + 'sua frente e entra numa fila de reenvio.'));
  b.push(tabela(
    ['O status diz', 'Significa'],
    [
      ['alocação em dia com a planilha', 'Tudo o que você fez já está gravado onde deve'],
      ['gravando só neste navegador — a planilha de alocação ainda não foi publicada',
        'A alocação está sendo guardada apenas nesta máquina/navegador. Ninguém mais enxerga o que '
        + 'você planejou, e limpar os dados do navegador apaga o trabalho'],
      ['N movimento(s) não gravado(s)  [Tentar de novo]',
        'A gravação falhou (rede, planilha fora do ar). O que está na tela é o que você fez; clique '
        + 'em "Tentar de novo" para reenviar a fila'],
    ],
    [3200, 5870],
  ));
  b.push(pRico(['Cada semana tem a sua própria gaveta, identificada pelo primeiro dia dela. Por isso '
    + 'trocar de semana ', { t: 'nunca mistura', b: true }, ' o planejamento de uma com o da outra.']));

  // ---------------------------------------------------------------- 14
  b.push(h2('14. A tabela "resumo por SUP"'));
  b.push(p('Uma linha por contrato do quadro, com as colunas somadas. É a visão para conversar sobre '
    + 'contratos, não sobre células.'));
  b.push(tabela(
    ['Coluna', 'O que é'],
    [
      ['#', 'O mesmo número de ordem da linha no quadro'],
      ['SUP / Tomador', 'O contrato e o cliente'],
      ['Tendência', 'Soma das tendências de todas as colunas do contrato, na semana'],
      ['Capacidade alocada', 'Soma da capacidade das equipes postas nesse contrato'],
      ['Saldo', 'Capacidade alocada − Tendência, em furos'],
      ['Cobertura', 'Capacidade alocada ÷ Tendência, em porcentagem'],
      ['Carteira', 'Furos pendentes do contrato'],
      ['Semanas de carteira', 'Carteira ÷ Tendência: quantas semanas o estoque renderia no ritmo '
        + 'projetado. "∞" = há carteira e nenhuma tendência para consumi-la; "—" = não há ritmo para calcular'],
      ['Leitura', 'O mesmo diagnóstico do selo da linha (seção 8)'],
    ],
    [2300, 6770],
  ));

  // ---------------------------------------------------------------- 15
  b.push(h2('15. A tabela "resumo por equipe"'));
  b.push(p('Uma linha por equipe do roster da semana — inclusive as que estão no pool e as que estão '
    + 'fora da semana. É a visão para conversar sobre gente e carro, não sobre contrato.'));
  b.push(tabela(
    ['Coluna', 'O que é'],
    [
      ['Equipe / Líder', 'Código e apelido do líder'],
      ['Colunas', 'As tipologias que ela atende (mais de uma = polivalente)'],
      ['SUP / Coluna', 'Onde ela está alocada nesta semana; "—" quando está no pool'],
      ['Carga', 'A parte da tendência da célula que coube a ela, em furos'],
      ['Capacidade', 'Quanto ela entrega na semana. "—" quando não há como estimar'],
      ['Ocupação', 'Carga ÷ Capacidade, em porcentagem'],
      ['Situação', 'Os mesmos rótulos da célula, mais dois exclusivos desta tabela'],
    ],
    [2300, 6770],
  ));
  b.push(p('Os dois rótulos exclusivos:'));
  b.push(item([{ t: 'Livre', b: true }, ' — a equipe está no pool, sem nenhuma alocação nesta semana.']));
  b.push(item([{ t: 'Fora da semana', b: true }, ' — a equipe não tem nenhum dia disponível na semana '
    + 'exibida (férias, baixada, ainda não integrada…).']));
  b.push(pRico(['Aqui a situação mede a ', { t: 'ocupação DAQUELA equipe', b: true },
    ', não a cobertura da célula. Uma célula "Sobrecarregada" com duas equipes pode ter uma delas '
    + '"Equilibrada" e outra "Com folga", se elas tiverem dias disponíveis diferentes.']));

  // ---------------------------------------------------------------- 16
  b.push(h2('16. Mensagens e situações especiais'));
  b.push(tabela(
    ['Na tela', 'O que aconteceu', 'O que fazer'],
    [
      ['"Somente leitura: o espelho da aba EQ só cobre o mês corrente…"',
        'A semana escolhida é de outro mês. O quadro é desenhado, mas nada pode ser arrastado',
        'Volte ao mês vigente para planejar. Para meses passados, a aba serve só de consulta'],
      ['"A Sheet espelho da aba EQ não respondeu."',
        'A lista de equipes não chegou. Sem ela não há quadro — e um quadro vazio leria como '
        + '"ninguém alocado", que é falso',
        'Clique em "Atualizar dados" no alto da página; se persistir, avise quem cuida da planilha de equipes'],
      ['"Nenhum SUP com tendência, carteira ou equipe alocada nesta semana."',
        'O recorte atual não tem nada a mostrar', 'Confira os filtros da página, a busca de equipe e '
        + 'o filtro de tipologia da aba'],
      ['"nenhuma equipe livre"', 'Todas as equipes estão alocadas', 'Normal quando o quadro acabou de '
        + 'ser semeado do realizado'],
    ],
    [2600, 3400, 3070],
  ));

  // ======================================================== PARTE II
  b.push(hParte('Parte II — referências, base de dados e metodologia', true));
  b.push(p('Esta parte responde a duas perguntas que aparecem sempre que um número surpreende: '
    + '"de onde saiu isso?" e "por que deu esse valor?".', { italico: true, cor: MARCA.apagado, tamanho: 9 }));

  // ---------------------------------------------------------------- 17
  b.push(h2('17. Panorama: as quatro fontes'));
  b.push(p('Nenhum número desta aba é digitado por alguém dentro dela. Tudo vem de quatro origens:'));
  b.push(tabela(
    ['Fonte', 'O que ela traz para esta aba', 'Como chega'],
    [
      ['A — MATRIZ (planilha de orçamento)',
        'A previsão de furos de cada contrato × tipologia, mês a mês; o nome do tomador; e quais '
        + 'cruzamentos contrato × tipologia existem',
        'Cópia automática da planilha, publicada como tabela, atualizada a cada 30 minutos'],
      ['B — Extrato de sondagens (sond.com.br)',
        'Uma linha por furo: quando a OS foi criada, quando o furo foi executado, o contrato, a '
        + 'tipologia e a situação. Daí saem o realizado e a carteira',
        'Buscado por um programa que roda no computador de quem atualiza, e publicado junto com a página'],
      ['C — Aba EQ (planilha de equipes)',
        'A lista de equipes, o serviço de cada uma, o dia a dia do mês (quem trabalhou, onde, quem '
        + 'estava de férias), o veículo, o líder e os equipamentos',
        'Cópia automática da aba do mês corrente, publicada como tabela, atualizada a cada 30 minutos'],
      ['D — A sua alocação',
        'Onde cada equipe foi colocada, semana a semana',
        'Gravada pela própria página, no navegador e/ou na planilha de alocação'],
    ],
    [2100, 3600, 3370],
  ));
  b.push(pRico([{ t: 'Regra de ouro da aba: ela não inventa número nenhum. ', b: true },
    'A tendência que você vê aqui é a MESMA que a Tabela Semanal calcula, só reorganizada por '
    + 'contrato e tipologia. Se as duas telas discordarem, é defeito da aba — não uma metodologia '
    + 'diferente.']));

  // ---------------------------------------------------------------- 18
  b.push(h2('18. Fonte A — a MATRIZ'));
  b.push(p('É a planilha de previsão do contrato, a mesma que alimenta o dashboard de Orçamento. '
    + 'Cada linha é um par (contrato, tipologia), com valores mês a mês.'));
  b.push(item([{ t: 'O que esta aba usa: ', b: true }, 'o previsto de VOLUME (quantidade de furos) do '
    + 'mês, que é o ponto de partida da tendência; o nome do tomador; e a própria existência da linha.']));
  b.push(item([{ t: 'O que ela NÃO usa: ', b: true }, 'a coluna de produtividade contrato a contrato. '
    + 'A capacidade da equipe sai de uma tabela fixa por tipologia (seção 23), justamente porque a '
    + 'produtividade cadastrada varia muito de contrato para contrato.']));
  b.push(item([{ t: 'Célula listrada = par sem linha na MATRIZ. ', b: true },
    'Quando um contrato aparece no extrato de campo sem existir na planilha de previsão para aquela '
    + 'tipologia, não há previsão nenhuma para projetar — o quadro mostra a célula listrada, e a '
    + 'capacidade da equipe ali fica sem referência.']));
  b.push(pRico(['A cópia lida pela página é um ', { t: 'espelho', b: true }, ' publicado da planilha, '
    + 'atualizado a cada 30 minutos. Uma edição feita agora na planilha pode levar até meia hora para '
    + 'aparecer — isso não é defeito.']));

  // ---------------------------------------------------------------- 19
  b.push(h2('19. Fonte B — o extrato de sondagens'));
  b.push(p('É a única fonte de EXECUÇÃO do projeto: uma linha por furo, vinda direto do sond.com.br. '
    + 'Cobre de janeiro de 2025 em diante.'));
  b.push(p('Desta fonte saem duas datas, e é sobre elas que quase tudo se apoia:'));
  b.push(tabela(
    ['Campo', 'Papel'],
    [
      ['Criação da OS', 'A data em que a demanda CHEGOU. É a entrada no estoque (carteira)'],
      ['Executado Dia', 'A data em que o furo foi executado. É a saída do estoque, e é o que conta '
        + 'como realizado'],
      ['Contrato e tipologia', 'Onde o furo é somado. Contrato que a MATRIZ não conhece vai para "Diversos"'],
      ['Status, Deslocamento, Total (m)', 'Usados para excluir linhas que não são produção real'],
    ],
    [2400, 6670],
  ));
  b.push(h3('O que fica de fora do realizado'));
  b.push(p('Uma linha é descartada da produção quando qualquer uma destas for verdadeira:'));
  b.push(item([{ t: 'Deslocamento = "Sim"', b: true }, ' — a sondagem não foi finalizada por alguma '
    + 'situação durante a execução e foi refeita em outra linha. Ela origina outra sondagem sem gerar '
    + 'demanda nova, então fica fora tanto do realizado quanto das contas de demanda.']));
  b.push(item([{ t: 'Total (m) = 0,01', b: true }, ' — lançamento de controle, sem metragem real.']));
  b.push(item([{ t: 'Status = Cancelado', b: true }, '.']));
  b.push(h3('Duas regras de tempo que explicam muita coisa'));
  b.push(item([{ t: 'O realizado para sempre em ONTEM. ', b: true },
    'O dia corrente está incompleto por construção — o extrato é alimentado ao longo do dia. Contá-lo '
    + 'faria a semana em curso parecer em queda até virar a meia-noite.']));
  b.push(item([{ t: 'Tudo é medido no fuso de Brasília (UTC−3)', b: true },
    ', inclusive no navegador de quem abre a página em outro fuso.']));
  b.push(pRico(['Os furos ainda ', { t: 'não executados', b: true },
    ' vêm de um segundo extrato, o de demandas pendentes, e entram no mesmo caldo: é o que faz a '
    + 'carteira enxergar o serviço que chegou e ainda não saiu.']));

  // ---------------------------------------------------------------- 20
  b.push(h2('20. Fonte C — a aba EQ da planilha de equipes'));
  b.push(p('É o roster: uma linha por equipe, e uma coluna por dia do mês. Desta aba sai tudo o que '
    + 'a página sabe sobre equipes.'));
  b.push(tabela(
    ['Coluna da planilha', 'Vira, na aba', 'Detalhe'],
    [
      ['Equipe (nome completo)', 'O que a busca casa, além do apelido', 'O cartão mostra só o apelido'],
      ['Habilitação', 'Linha da ficha da equipe', '—'],
      ['Serviços', 'A(s) coluna(s) do quadro que a equipe atende',
        'Texto não catalogado manda a equipe para "fora do quadro", com o texto escrito no motivo'],
      ['Líderes', 'O apelido no cartão', '—'],
      ['Veículo / Proprietário', 'A ficha e a trava de veículo',
        'Só placa e "Carona ID N" criam vínculo entre equipes'],
      ['Equipamentos, Tenda, Sinalização', 'Linhas da ficha', 'Valores "N/A" são omitidos'],
      ['Tomador', 'Linha "Tomador atual" da ficha', '—'],
      ['As colunas de dia (1, 2, 3…)', 'Dias disponíveis na semana e o contrato do dia',
        'Texto livre — ver abaixo'],
    ],
    [2400, 3200, 3470],
  ));
  b.push(h3('Como o texto de cada dia é lido'));
  b.push(p('A célula do dia é texto livre, escrito por quem preenche a planilha. A leitura é por '
    + 'exceção: o padrão é considerar que a equipe está em campo, e só as formas de dizer AUSÊNCIA '
    + 'são enumeradas.'));
  b.push(tabela(
    ['O texto do dia', 'Conta como', 'Efeito na aba'],
    [
      ['Traz uma OS entre parênteses, ou "OK"', 'Equipe mobilizada',
        'Conta como dia disponível E diz em qual contrato ela estava'],
      ['Mobilização, veículo quebrado, chuva, parada de segurança, treinamento, apoio, embargo…',
        'Equipe em campo sem furo', 'Conta como dia disponível'],
      ['Baixada, férias, folga, falta, atestado, afastamento, licença…', 'Fora',
        'NÃO conta como dia disponível'],
      ['Em contratação, admissão/integração, virou auxiliar, encarregado, pediu desligamento…',
        'Não é equipe de campo', 'NÃO conta'],
      ['Célula vazia', 'Dia ainda não preenchido', 'Ignorado'],
    ],
    [3000, 2400, 3670],
  ));
  b.push(pRico([{ t: 'Consequência prática para quem preenche a planilha: ', b: true },
    'escrever a OS entre parênteses no dia é o que permite ao quadro abrir já preenchido com o '
    + 'contrato certo. Sem OS, a equipe é considerada em campo (conta dias) mas nasce no pool.']));
  b.push(pRico([{ t: 'O espelho cobre o MÊS CORRENTE. ', b: true }, 'É por isso que semanas de outro '
    + 'mês abrem em somente leitura: não existe roster daquele mês para validar um arraste.']));

  // ---------------------------------------------------------------- 21
  b.push(h2('21. Fonte D — a alocação, e o caminho do dado até a tela'));
  b.push(p('A alocação que você faz é gravada por semana. Enquanto a planilha de alocação não '
    + 'estiver publicada, ela mora apenas no seu navegador — e o status avisa isso o tempo todo.'));
  b.push(h3('O caminho completo, do campo até o quadro'));
  b.push(passo(1, 'Alguém executa o furo e o registra no sistema de campo; alguém preenche o dia da '
    + 'equipe na planilha de equipes; a MATRIZ é atualizada pelo planejamento.'));
  b.push(passo(2, 'Um programa busca os extratos e grava os arquivos que a página vai ler.'));
  b.push(passo(3, 'A página é reconstruída e publicada com esses dados dentro.'));
  b.push(passo(4, ['No navegador, o botão ', { t: '"Atualizar dados"', b: true },
    ' rebusca os arquivos publicados e recalcula tudo na hora, sem precisar de página nova.']));
  b.push(pRico([{ t: 'Duas defasagens conhecidas, e nenhuma delas é defeito: ', b: true },
    'a MATRIZ e a aba EQ chegam por um espelho que atualiza a cada 30 minutos; e o botão "Atualizar '
    + 'dados" é tão fresco quanto a última busca dos extratos — ele troca dados JÁ publicados, ele '
    + 'não vai ao sistema de campo sozinho.']));

  // ---------------------------------------------------------------- 22
  b.push(h2('22. Metodologia: a Tendência'));
  b.push(pRico([{ t: 'Definição: ', b: true }, 'quantos furos se espera que aquele contrato produza '
    + 'naquela tipologia, naquela semana. É projeção — não é meta e não é medição.']));
  b.push(p('Ela é construída em três passos:'));
  b.push(passo(1, 'O previsto do MÊS, da MATRIZ, é repartido entre as semanas do mês, proporcional '
    + 'aos dias de cada uma.'));
  b.push(passo(2, 'Compara-se o realizado acumulado com o previsto acumulado, considerando apenas as '
    + 'semanas JÁ ENCERRADAS (tolerância de 1%). A semana em curso fica fora dessa comparação — meia '
    + 'semana de realizado contra uma semana inteira de previsto acusaria atraso toda segunda-feira.'));
  b.push(passo(3, 'Conforme o resultado, a projeção das semanas restantes segue um de três caminhos:'));
  b.push(tabela(
    ['Situação do contrato', 'Semana em curso', 'Semanas futuras'],
    [
      ['Em dia (realizado ≈ previsto)', 'O previsto da semana, nunca abaixo do que já é fato',
        'O previsto da semana, inteiro'],
      ['Adiantado (realizado > previsto)', 'O já realizado + o ritmo medido × dias que faltam dela',
        'O ritmo medido × dias da semana'],
      ['Atrasado (realizado < previsto)', 'O já realizado + a fatia do saldo que cabe nela',
        'O saldo do mês repartido pelos dias que faltam'],
    ],
    [2400, 3400, 3270],
  ));
  b.push(pRico(['O "ritmo medido" é o realizado das semanas encerradas dividido pelos dias delas — '
    + 'furos por dia. É por isso que ', { t: 'a tendência se move ao longo da semana', b: true },
  ': ela reprojeta conforme o realizado entra. Um número anotado na terça não vai bater com o da '
  + 'quinta, e isso não é erro.']));
  b.push(item('Um mês inteiramente no passado não tem tendência nenhuma — não há futuro a projetar.'));
  b.push(item('A tendência da célula é medida em HOJE, igual à da Tabela Semanal. As duas telas '
    + 'sempre mostram o mesmo número para a mesma semana.'));

  // ---------------------------------------------------------------- 23
  b.push(h2('23. Metodologia: a Carteira'));
  b.push(pRico([{ t: 'Definição: ', b: true }, 'quantos furos daquele contrato e tipologia estão '
    + 'PENDENTES — chegaram e ainda não foram executados. É um estoque numa data, não um fluxo do período.']));
  b.push(formula('carteira na data D = furos com Criação da OS ≤ D  −  furos com Execução ≤ D'));
  b.push(item('Furo executado exatamente no dia D já não conta como pendente em D.'));
  b.push(item('Furo sem data de execução nunca sai do estoque — tratamento conservador de propósito.'));
  b.push(item('Cancelamento não participa: o extrato usado não traz data de cancelamento.'));
  b.push(pRico(['A carteira usa a ', { t: 'mesma data-âncora da tendência', b: true },
    ' (hoje). Isso não é detalhe: se uma fosse medida na segunda-feira e a outra hoje, o saldo entre '
    + 'as duas estaria somando dois instantes diferentes e não fecharia com nada.']));

  // ---------------------------------------------------------------- 24
  b.push(h2('24. Metodologia: a Capacidade da equipe'));
  b.push(p('Quantos furos aquela equipe consegue entregar naquela semana:'));
  b.push(formula('capacidade = produtividade da tipologia × dias de premissa da semana'));
  b.push(formula('dias de premissa = 30 × (dias disponíveis na semana) ÷ (dias do mês)'));
  b.push(pRico(['A premissa de dias é ', { t: '30 por mês', b: true }, ' (15 em janeiro e dezembro), '
    + 'e não os dias do calendário — é a mesma base que a coluna "Produtividade média esperada" do '
    + 'Consolidado usa. Trocar por dias corridos faria os dois quadros discordarem entre si.']));
  b.push(h3('A produtividade por tipologia'));
  b.push(p('Em furos por equipe-dia. É uma tabela fixa, igual para todos os contratos:'));
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
  b.push(p('A coluna da direita é o valor de uma equipe com os 7 dias disponíveis, num mês de 31 '
    + 'dias (30 × 7 ÷ 31 = 6,77 dias de premissa). Num mês de 30 dias a mesma equipe daria 7,0 — a '
    + 'diferença entre meses é normal.', { tamanho: 9, cor: MARCA.apagado }));
  b.push(pRico(['A produtividade é a mesma para todos os contratos ', { t: 'por decisão', b: true },
    ': a coluna equivalente da MATRIZ varia demais de contrato para contrato (em SP, de 0,80 a 2,00), '
    + 'e os poucos contratos com valor alto inflavam a capacidade de células específicas. PI é uma '
    + 'exceção deliberada — a planilha traz 4 e a tabela usa 3, correção de campo, não erro de digitação.']));
  b.push(pRico(['Capacidade ', { t: '"—" (travessão) não é zero', b: true },
    '. Significa que aquele cruzamento não existe na MATRIZ, então não há premissa para multiplicar. '
    + 'Zero leria como "esta equipe não produz"; travessão lê como "não sei", que é a verdade.']));

  // ---------------------------------------------------------------- 25
  b.push(h2('25. Metodologia: Carga, Ocupação, Saldo e Cobertura'));
  b.push(h3('Carga'));
  b.push(p('A parte da tendência da célula que coube àquela equipe. Com mais de uma equipe na mesma '
    + 'célula, a demanda é repartida proporcionalmente à capacidade de cada uma — quem tem menos dias '
    + 'disponíveis puxa menos. Com todo mundo inteiro na semana, a divisão é igual.'));
  b.push(h3('Ocupação, Saldo e Cobertura'));
  b.push(formula('ocupação da equipe = carga ÷ capacidade'));
  b.push(formula('saldo da célula = capacidade alocada − tendência          (em furos)'));
  b.push(formula('cobertura = capacidade alocada ÷ tendência                (o que a barrinha desenha)'));
  b.push(pRico(['Ocupação e cobertura são ', { t: 'razões inversas uma da outra', b: true },
    ', e respondem a perguntas diferentes: a ocupação olha da equipe para a demanda ("o quanto dela '
    + 'está comprometido"); a cobertura olha da demanda para a equipe ("o quanto dela está atendido"). '
    + 'Ocupação de 200% é a mesma situação que cobertura de 50%.']));
  b.push(p('A barrinha nunca passa de cheia, mesmo quando a cobertura passaria de 100% — quem carrega '
    + 'o excesso é o número ao lado.'));

  // ---------------------------------------------------------------- 26
  b.push(h2('26. Metodologia: as classificações e os totais'));
  b.push(h3('Situação da célula e da equipe'));
  b.push(p('Os dois usam as MESMAS faixas, com uma tolerância de 15% para baixo e 5% para cima em '
    + 'torno do ponto de equilíbrio. O que muda é o que está sendo medido:'));
  b.push(tabela(
    ['Faixa', 'Na célula, mede', 'Na equipe, mede'],
    [
      ['Abaixo de 85% → Com folga', 'Tendência ÷ capacidade alocada', 'Carga ÷ capacidade da equipe'],
      ['85% a 105% → Equilibrada', 'idem', 'idem'],
      ['Acima de 105% → Sobrecarregada', 'idem', 'idem'],
    ],
    [3000, 3100, 2970],
  ));
  b.push(p('Fora das faixas há os casos especiais: célula com demanda e nenhuma equipe é "Sem equipe"; '
    + 'célula sem demanda é "Livre"; equipe sem alocação é "Livre"; equipe sem dia disponível é '
    + '"Fora da semana".'));
  b.push(h3('Leitura do contrato'));
  b.push(p('Avaliada na ordem da tabela da seção 8, e vale a PRIMEIRA que casar. A ordem existe '
    + 'porque um contrato pode satisfazer duas condições ao mesmo tempo — e a primeira é sempre a mais urgente.'));
  b.push(h3('Semanas de carteira'));
  b.push(formula('semanas de carteira = carteira ÷ tendência'));
  b.push(p('Quantas semanas o estoque parado renderia no ritmo projetado. Sem tendência não há ritmo, '
    + 'e sem ritmo não há prazo: o campo mostra "∞" quando há carteira sem nenhuma tendência, e "—" '
    + 'quando não há como calcular.'));
  b.push(h3('Os totais do topo'));
  b.push(p('São somas simples do que está na tela, com uma única exceção — a capacidade ociosa soma '
    + 'apenas as folgas positivas, e ignora as equipes cuja capacidade é desconhecida ("—").'));

  // ---------------------------------------------------------------- 27
  b.push(h2('27. Arredondamento, verificação e limites'));
  b.push(h3('Por que as contas de tela não fecham na última casa'));
  b.push(p('Os números da aba são exibidos com uma casa decimal (a carteira, sem casas), mas o '
    + 'cálculo roda com a precisão cheia. Refazer uma conta com os valores da tela pode divergir na '
    + 'primeira casa decimal — isso é arredondamento de exibição, não erro.'));
  b.push(h3('Quando um número parecer errado'));
  b.push(passo(1, 'Confira a SEMANA e o MÊS selecionados. Boa parte das surpresas é estar olhando '
    + 'outra semana.'));
  b.push(passo(2, 'Confira os filtros: a barra da página, a busca de equipe e o filtro de tipologia '
    + 'da aba podam o quadro E os totais.'));
  b.push(passo(3, ['Compare a tendência com a ', { t: 'Tabela Semanal', b: true },
    ' da mesma semana: as duas têm de bater. Se não baterem, o problema é da aba, e vale reportar.']));
  b.push(passo(4, 'Clique em "Atualizar dados" — o que está na tela pode ser de horas atrás.'));
  b.push(passo(5, ['Se o número depende de equipe (capacidade, dias, contrato do dia), confira a ',
    { t: 'aba EQ', b: true }, ': é ela que manda. Lembre-se do espelho de 30 minutos.']));
  b.push(passo(6, 'Se depende de furo (tendência, carteira), lembre-se de que o realizado para em '
    + 'ONTEM e de que deslocamentos e cancelados não entram.'));
  b.push(h3('Limites conhecidos'));
  b.push(item('A aba planeja o MÊS CORRENTE. Semanas de outros meses abrem em somente leitura.'));
  b.push(item('Ela não conhece o efetivo das equipes nem os nomes das pessoas — só o líder.'));
  b.push(item('Ela não valida equipamento contra tipologia: quem decide se a equipe dá conta '
    + 'daquele serviço é quem aloca.'));
  b.push(item('O retrato do realizado que preenche o quadro pode conter conflitos de veículo; eles '
    + 'são marcados, nunca corrigidos sozinhos.'));
  b.push(item('Enquanto a planilha de alocação não estiver publicada, o planejamento fica só no '
    + 'navegador de quem o fez.'));

  // ---------------------------------------------------------------- glossário
  b.push(h2('Glossário de bolso'));
  b.push(tabela(
    ['Termo', 'Em uma linha'],
    [
      ['Tendência', 'O que se espera produzir naquela célula, naquela semana. Projeção'],
      ['Carteira', 'O que já chegou e ainda não foi executado. Estoque'],
      ['Capacidade', 'O que a equipe entrega na semana, pelos dias que ela tem disponíveis'],
      ['Carga', 'A parte da tendência da célula que coube àquela equipe'],
      ['Ocupação', 'Carga ÷ capacidade. 100% é a equipe exatamente cheia'],
      ['Cobertura', 'Capacidade alocada ÷ tendência. É o que a barrinha desenha'],
      ['Saldo', 'Capacidade alocada − tendência, em furos. Negativo é falta'],
      ['Capacidade ociosa', 'Soma só das folgas. Sobrecarga não desconta'],
      ['Semanas de carteira', 'Carteira ÷ tendência: quanto tempo o estoque renderia no ritmo projetado'],
      ['Pool', 'A área das equipes ainda não alocadas nesta semana'],
      ['Polivalente (⇄)', 'Equipe que atende mais de uma tipologia e aparece em mais de um bloco do pool'],
      ['Célula listrada', 'Cruzamento sem tendência — aceita equipe assim mesmo, para antecipar carteira'],
      ['Roster', 'A lista de equipes do mês, vinda da aba EQ da planilha de equipes'],
      ['Âncora', 'A data em que tendência e carteira são medidas. Sempre hoje, e sempre a mesma para as duas'],
    ],
    [2200, 6870],
  ));

  // ---------------------------------------------------------------- exemplo
  b.push(h2('Um exemplo lido inteiro'));
  b.push(caixa(`${EX.sup} × ${EX.coluna}, com a equipe ${EX.equipe} (${EX.lider})`, [
    `Projetam-se ${EX.tendencia} furos para a semana, e há ${EX.carteira} furos parados na carteira.`,
    `A única equipe alocada tem os ${EX.dias} dias disponíveis e entrega ${EX.capacidade} furos na semana.`,
    `Resultado: ocupação de ${EX.ocupacao}, saldo de ${EX.saldo} furos, situação ${EX.situacao}.`,
  ]));
  b.push(p('Lendo em ordem: a tendência de 59,7 diz que se espera cerca de 60 furos de SP naquele '
    + 'contrato nesta semana. A capacidade de 6,8 sai de 1 furo por equipe-dia × 6,77 dias de '
    + 'premissa (a equipe tinha os 7 dias). A ocupação de 881% é 59,7 ÷ 6,8 — seriam necessárias '
    + 'quase nove equipes como aquela, ou cerca de nove semanas de uma equipe só. O saldo de -52,9 '
    + 'é a mesma falta dita em furos, e a barrinha aparece quase vazia (cobertura de ~11%).'));
  b.push(p('E a carteira de 245 furos, comparada com uma tendência de ~60 por semana, são cerca de '
    + 'quatro semanas de serviço já represado. Vale a distinção: a tendência é o que se espera '
    + 'produzir na semana; a carteira é o que já está esperando. É uma célula que pede reforço, não '
    + 'ajuste fino.', { espacoDepois: 40 }));

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
<w:t xml:space="preserve">Aba Alocação Equipes — manual  ·  Suporte Infra  ·  </w:t></w:r>
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
<dc:title>${esc('Aba Alocação Equipes — como usar e de onde vêm os números')}</dc:title>
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
