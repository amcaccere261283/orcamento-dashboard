'use strict';
// Gera o relatório em Word "Premissas Orçamento Forecast 6+6" a partir das
// linhas de PREVISTO (BASE = "P") da MATRIZ do modelo Frcst 6+6 -- as mesmas
// linhas que alimentam a série "Previsto" do dashboard de orçamento, lidas
// pelo mesmo parser, para os dois nunca discordarem.
//
//   node tools/relatorio/gerar-premissas-docx.js ["caminho/de/saida.docx"]
//
// Sem senha e sem rede: só precisa do G:\ montado (ver tools/orcamento/config.js).
// Nada de Realizado ou Total/Tendência entra aqui -- é um documento de
// premissas, e premissa é o que foi planejado.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readXlsxSheet } = require('../comum/xlsx-reader.js');
const { parseMatriz } = require('../orcamento/parse-matriz.js');
const config = require('../orcamento/config.js');
const { zipar, run, paragrafo, celula, esc } = require('./docx.js');

// ---------------------------------------------------------------- premissas
// DIAS vem da própria MATRIZ (coluna "DIAS", 25 em todas as linhas): é o
// número de dias produtivos por equipe-mês que a planilha usou para fechar
// volume a partir de equipes × produtividade. NÃO é o DIAS_PREMISSA_MES
// (15/30/.../15) do dashboard -- aquele serve para acumular vários meses numa
// média ponderada, e misturar os dois daria duas produtividades diferentes
// para o mesmo Previsto. Aqui manda a planilha.
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const TIPOLOGIAS_LAB = new Set(['LAB.C', 'LAB.E']);

// Pessoas por equipe mobilizada e equipes por líder, medidos no registro
// operacional de equipes (Equipes.xlsx, abas de dez/2025 e jan/2026) e
// aplicados à CURVA DE EQUIPES DO PREVISTO. A MATRIZ prevê equipes, não
// cabeças: sem esta razão não há como responder "quantas pessoas" a partir
// dela. Está declarado como premissa derivada no próprio relatório.
const PESSOAS_POR_EQUIPE = {
  'SP': 2.7, 'SM / SM.F / SR': 2.5, 'ST': 1.5, 'PI': 1.5,
  'BL': 1.5, 'CPTu': 2.0, 'SH': 2.0, 'VT': 1.5,
};
const EQUIPES_POR_LIDER = 2.9;
const VEICULOS_POR_EQUIPE = 0.76;
// Valor de mobilização de UM conjunto novo por tipologia (kit + sonda +
// ferramental), da aba EQUIPAMENTOS (2) do estudo de remobilização.
const VALOR_MOBILIZACAO = {
  'SP': 27165.63, 'SM / SM.F / SR': 106444.20, 'ST': 3722.00, 'PI': 20900.00,
  'CPTu': 529814.00, 'SH': 70267.07, 'VT': 70267.07, 'BL': 70267.07,
};

const MARCA = { escuro: '141412', ouro: 'F6B53F', texto: '1A1A19', suave: 'F2F0EA', linha: 'D8D5CB', apagado: '6E6B63' };
const FONTE = 'Aptos';
const LARGURA_UTIL = 9072; // A4 retrato com margens de 2,5 cm, em twips

// ---------------------------------------------------------------- formatação
const nf = (v, casas = 0) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const reais = (v, casas = 0) => 'R$ ' + nf(v, casas);
const milhoes = v => 'R$ ' + nf((v || 0) / 1e6, 1) + ' MM';
const pct = (v, total, casas = 1) => total ? nf((100 * v) / total, casas) + '%' : '—';

// ---------------------------------------------------------------- agregação
function somar(arr) { return arr.reduce((s, v) => s + (v || 0), 0); }

function agregar(registros, dias) {
  const eq = Array(12).fill(0), vol = Array(12).fill(0), fin = Array(12).fill(0);
  let prodPonderada = 0, volParaPeso = 0;
  for (const r of registros) {
    for (let i = 0; i < 12; i++) {
      eq[i] += r.previsto.equipes[i] || 0;
      vol[i] += r.previsto.volume[i] || 0;
      fin[i] += r.previsto.financeiro[i] || 0;
    }
    const v = somar(r.previsto.volume);
    prodPonderada += (r.previsto.equipesResumo.prod || 0) * v;
    volParaPeso += v;
  }
  const volume = somar(vol), financeiro = somar(fin);
  // Equipes é foto mensal, não fluxo: a média do ano é a média simples dos 12
  // meses, e somar os meses produziria um "equipe-mês" sem sentido físico.
  const eqMedia = eq.reduce((s, v) => s + v, 0) / 12;
  const equipeDias = eq.reduce((s, v) => s + v * dias, 0);
  return {
    registros: registros.length, eq, vol, fin, volume, financeiro,
    eqMedia, eqPico: Math.max(...eq), eqMinimo: Math.min(...eq),
    ticket: volume ? financeiro / volume : 0,
    prodPlanilha: volParaPeso ? prodPonderada / volParaPeso : 0,
    prodImplicita: equipeDias ? volume / equipeDias : 0,
  };
}

function agruparPor(registros, chaveDe, dias) {
  const mapa = new Map();
  for (const r of registros) {
    const k = chaveDe(r);
    if (k == null || k === '') continue;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(r);
  }
  return [...mapa.entries()]
    .map(([chave, rs]) => ({ chave, exemplo: rs[0], ...agregar(rs, dias) }))
    .sort((a, b) => b.financeiro - a.financeiro);
}

// ---------------------------------------------------------------- blocos
function titulo(texto, nivel = 1) {
  const cfg = nivel === 1
    ? { tamanho: 15, cor: MARCA.escuro, antes: 360, depois: 140, borda: true }
    : { tamanho: 11.5, cor: MARCA.escuro, antes: 260, depois: 100, borda: false };
  return paragrafo(run(texto, { fonte: FONTE, negrito: true, tamanho: cfg.tamanho, cor: cfg.cor }), {
    antes: cfg.antes, depois: cfg.depois, manterProxima: true,
    bordaInferior: cfg.borda ? { cor: MARCA.ouro, espessura: 12 } : undefined,
  });
}

function texto(conteudo, o = {}) {
  return paragrafo(run(conteudo, { fonte: FONTE, tamanho: o.tamanho || 10, cor: o.cor || MARCA.texto, italico: o.italico }), {
    alinhamento: o.alinhamento || 'both', depois: o.depois != null ? o.depois : 120, entreLinhas: 264, ...o,
  });
}

function marcador(rotulo, conteudo) {
  const runs = [
    run('•', { fonte: FONTE, tamanho: 10, cor: MARCA.ouro, negrito: true }),
    '<w:r><w:tab/></w:r>',
  ];
  if (rotulo) runs.push(run(rotulo + ' ', { fonte: FONTE, tamanho: 10, negrito: true, cor: MARCA.texto }));
  runs.push(run(conteudo, { fonte: FONTE, tamanho: 10, cor: MARCA.texto }));
  return paragrafo(runs, { recuo: 284, recuoPrimeira: 284, tabulacoes: [284], depois: 80, entreLinhas: 264, alinhamento: 'both' });
}

function nota(conteudo) {
  return paragrafo(run(conteudo, { fonte: FONTE, tamanho: 8.5, cor: MARCA.apagado, italico: true }), { depois: 200, entreLinhas: 240 });
}

// Tabela com cabeçalho escuro e zebra clara. `colunas` traz rótulo, largura
// relativa e alinhamento; `linhas` é uma matriz de strings já formatadas.
function tabela(colunas, linhas, o = {}) {
  const somaPesos = colunas.reduce((s, c) => s + c.peso, 0);
  const larguras = colunas.map(c => Math.round((LARGURA_UTIL * c.peso) / somaPesos));

  const celulaTexto = (valor, col, opcoes) => celula(
    paragrafo(run(valor, {
      fonte: FONTE, tamanho: opcoes.tamanho || 9,
      cor: opcoes.cor || MARCA.texto, negrito: opcoes.negrito,
    }), { alinhamento: col.alinhamento || 'left', depois: 0, entreLinhas: 240 }),
    { largura: opcoes.largura, fundo: opcoes.fundo }
  );

  const cabecalho = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${colunas.map((c, i) =>
    celulaTexto(c.rotulo, c, { largura: larguras[i], fundo: MARCA.escuro, cor: 'FFFFFF', negrito: true, tamanho: 8.5 })
  ).join('')}</w:tr>`;

  const corpo = linhas.map((linha, idx) => {
    const ehTotal = o.ultimaLinhaTotal && idx === linhas.length - 1;
    const fundo = ehTotal ? MARCA.ouro : (idx % 2 ? MARCA.suave : undefined);
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${colunas.map((c, i) =>
      celulaTexto(linha[i], c, { largura: larguras[i], fundo, negrito: ehTotal })
    ).join('')}</w:tr>`;
  }).join('');

  const bordas = `<w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="${MARCA.linha}"/>
    <w:left w:val="none" w:sz="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:color="${MARCA.linha}"/>
    <w:right w:val="none" w:sz="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="2" w:color="${MARCA.linha}"/>
    <w:insideV w:val="none" w:sz="0" w:color="auto"/>
  </w:tblBorders>`;

  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/>${bordas}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${larguras.map(l => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>` +
    cabecalho + corpo + '</w:tbl>' +
    paragrafo('', { depois: 0, tamanho: 4 });
}

// Faixa de destaque com os números de capa.
function faixaIndicadores(itens) {
  const largura = Math.round(LARGURA_UTIL / itens.length);
  const celulas = itens.map(it => celula(
    paragrafo(run(it.valor, { fonte: FONTE, tamanho: 16, negrito: true, cor: MARCA.escuro }), { alinhamento: 'center', depois: 20 }) +
    paragrafo(run(it.rotulo, { fonte: FONTE, tamanho: 8, cor: MARCA.apagado, caixaAlta: true, espacamento: 20 }), { alinhamento: 'center', depois: 0 }),
    { largura, fundo: MARCA.suave, margemV: 140 }
  )).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/>` +
    `<w:tblBorders><w:insideV w:val="single" w:sz="4" w:color="FFFFFF"/></w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${itens.map(() => `<w:gridCol w:w="${largura}"/>`).join('')}</w:tblGrid>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${celulas}</w:tr></w:tbl>` +
    paragrafo('', { depois: 0, tamanho: 6 });
}

// ---------------------------------------------------------------- documento
function montarDocumento(d) {
  const partes = [];
  const p = x => partes.push(x);

  // ------------------------------------------------------------------ capa
  const logoEmu = { largura: 2520000, altura: 663158 }; // 7 cm, proporção preservada
  const desenhoLogo =
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${logoEmu.largura}" cy="${logoEmu.altura}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1" name="Logo Suporte Infra"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="1" name="Logo Suporte Infra"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${logoEmu.largura}" cy="${logoEmu.altura}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

  // O logotipo da Suporte é negativo (letreiro branco): sobre papel branco
  // metade dele some. Por isso a capa é uma faixa escura -- é também a
  // identidade do dashboard (#141412 com destaque #f6b53f).
  p(`<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${LARGURA_UTIL}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    celula(
      paragrafo(`<w:r>${desenhoLogo}</w:r>`, { depois: 260 }) +
      paragrafo(run('Premissas', { fonte: FONTE, tamanho: 30, negrito: true, cor: 'FFFFFF' }), { depois: 0 }) +
      paragrafo(run('Orçamento Forecast 6+6', { fonte: FONTE, tamanho: 30, negrito: true, cor: MARCA.ouro }), { depois: 220 }) +
      paragrafo(run('Exercício 2026  ·  base Previsto', { fonte: FONTE, tamanho: 12, cor: 'C3C2B7' }), { depois: 0 }),
      { largura: LARGURA_UTIL, fundo: MARCA.escuro, margemV: 560 }
    ) + '</w:tr></w:tbl>');
  p(paragrafo('', { depois: 200, tamanho: 6 }));

  p(faixaIndicadores([
    { valor: milhoes(d.total.financeiro), rotulo: 'Receita prevista' },
    { valor: nf(d.total.eqMedia, 1), rotulo: 'Equipes (média/mês)' },
    { valor: nf(d.sondagem.volume), rotulo: 'Furos previstos' },
    { valor: nf(d.lab.volume), rotulo: 'Ensaios previstos' },
  ]));

  p(paragrafo([
    run('Documento: ', { fonte: FONTE, tamanho: 9, negrito: true, cor: MARCA.apagado }),
    run('consolidação das premissas físicas e financeiras adotadas no Forecast 6+6 do orçamento de 2026. ', { fonte: FONTE, tamanho: 9, cor: MARCA.apagado }),
    run('Emitido em ', { fonte: FONTE, tamanho: 9, negrito: true, cor: MARCA.apagado }),
    run(d.emitidoEm + '.', { fonte: FONTE, tamanho: 9, cor: MARCA.apagado }),
  ], { alinhamento: 'both', depois: 60, entreLinhas: 240 }));

  // -------------------------------------------------------------- 1. escopo
  p(titulo('1. Objetivo e escopo'));
  p(texto('Este relatório reúne, num documento só, as premissas que sustentam o Forecast 6+6 do orçamento de 2026: quantas equipes se planejou mobilizar, com que produtividade, gerando quanto volume e quanta receita, e de que estrutura de pessoas, veículos e equipamentos essa operação depende.'));
  p(texto('Todos os números vêm exclusivamente da série PREVISTO. As séries de Realizado e de Tendência existem na mesma planilha e foram deliberadamente deixadas de fora: o objetivo aqui é registrar o que foi planejado, não medir o que aconteceu. Comparações entre planejado e executado são feitas no dashboard de orçamento e na página de planejamento semanal, que leem a mesma fonte.'));

  // -------------------------------------------------------------- 2. fontes
  p(titulo('2. Fonte dos dados e critério de leitura'));
  p(marcador('Arquivo:', path.basename(config.caminhoArquivo) + ', aba "' + config.nomeAba + '".'));
  p(marcador('Recorte:', 'somente as linhas em que a coluna BASE é "P" (Previsto). Cada combinação de contrato e tipologia ocupa três linhas físicas na planilha — P (Previsto), R (Realizado) e T (Total) — e apenas a primeira entra neste documento.'));
  p(marcador('Exclusões:', 'as linhas de resumo pré-calculadas pelo Excel (o bloco com GRUPO "Todos" no topo da aba e os totalizadores MENSAL e ACUMULADO ao fim de cada contrato) são descartadas. Os totais deste relatório são recalculados a partir das linhas reais.'));
  p(marcador('Base resultante:', `${nf(d.meta.registros)} registros de Previsto, cobrindo ${nf(d.meta.sups)} contratos (SUP), ${nf(d.meta.tomadores)} tomadores, ${nf(d.meta.escopos)} escopos e ${nf(d.meta.tipologias)} tipologias de serviço, ao longo dos 12 meses de 2026.`));
  p(nota('A leitura usa o mesmo parser do dashboard de orçamento (tools/orcamento/parse-matriz.js), que localiza cada coluna pelo rótulo da linha de cabeçalho e falha em vez de ler dado errado caso o layout do modelo mude.'));

  // -------------------------------------------------------------- 3. gerais
  p(titulo('3. Premissas gerais'));
  p(marcador('Horizonte:', 'ano civil de 2026, aberto nos 12 meses. O rótulo "6+6" indica a revisão do orçamento feita com seis meses realizados e seis meses projetados, mas a série de Previsto aqui apresentada cobre o ano inteiro.'));
  p(marcador('Dias produtivos:', `${d.meta.dias} dias por equipe-mês, uniforme em todas as linhas da MATRIZ (coluna DIAS). É esse o divisor que transforma produtividade mensal em produtividade diária por equipe.`));
  p(marcador('Equipes:', 'a quantidade mensal é uma fotografia do efetivo mobilizado naquele mês, não um fluxo acumulável. Somar os doze meses produziria um "equipe-mês" sem significado físico; por isso o indicador anual é a média dos meses, acompanhada do pico.'));
  p(marcador('Volume:', 'unidade física do serviço — furos, no caso de sondagem, e ensaios, no caso de laboratório. As duas grandezas não se somam de forma interpretável e aparecem separadas em todo o relatório.'));
  p(marcador('Ticket médio:', 'receita dividida por volume, na mesma tipologia. Como o preço unitário varia mais de uma ordem de grandeza entre tipologias (de pouco mais de R$ 100 num ensaio a mais de R$ 17 mil num furo de sondagem mista), o ticket só é comparável dentro da tipologia.'));
  p(marcador('Produtividade:', 'volume por equipe-dia. A premissa adotada por contrato consta da coluna PROD. da MATRIZ; a produtividade implícita é a que resulta de dividir o volume previsto pelo total de equipe-dias previstos.'));
  p(marcador('Receita:', 'valores nominais de 2026, sem correção monetária ao longo do ano e sem impostos destacados. O total do Previsto fecha em ' + reais(d.total.financeiro, 2) + '.'));

  // ------------------------------------------------------------ 4. resumo
  p(titulo('4. Quadro-resumo do Previsto'));
  p(tabela(
    [
      { rotulo: 'Indicador', peso: 34 },
      { rotulo: 'Sondagem (campo)', peso: 22, alinhamento: 'right' },
      { rotulo: 'Laboratório', peso: 22, alinhamento: 'right' },
      { rotulo: 'Total', peso: 22, alinhamento: 'right' },
    ],
    [
      ['Receita prevista no ano', reais(d.sondagem.financeiro), reais(d.lab.financeiro), reais(d.total.financeiro)],
      ['Participação na receita', pct(d.sondagem.financeiro, d.total.financeiro), pct(d.lab.financeiro, d.total.financeiro), '100,0%'],
      ['Volume previsto no ano', nf(d.sondagem.volume) + ' furos', nf(d.lab.volume) + ' ensaios', '—'],
      ['Ticket médio', reais(d.sondagem.ticket, 2) + ' / furo', reais(d.lab.ticket, 2) + ' / ensaio', '—'],
      ['Equipes — média mensal', nf(d.sondagem.eqMedia, 2), '—', nf(d.total.eqMedia, 2)],
      ['Equipes — pico mensal', nf(d.sondagem.eqPico, 0), '—', nf(d.total.eqPico, 0)],
      ['Equipes — mínimo mensal', nf(d.sondagem.eqMinimo, 0), '—', nf(d.total.eqMinimo, 0)],
      ['Equipe-dias no ano', nf(d.sondagem.eqMedia * 12 * d.meta.dias, 0), '—', nf(d.total.eqMedia * 12 * d.meta.dias, 0)],
      ['Produtividade implícita', nf(d.sondagem.prodImplicita, 2) + ' furos/equipe-dia', '—', '—'],
      ['Receita média por mês', reais(d.sondagem.financeiro / 12), reais(d.lab.financeiro / 12), reais(d.total.financeiro / 12)],
    ],
    {}
  ));
  p(nota('O laboratório não tem equipes de campo na MATRIZ: sua capacidade é dimensionada por posto de ensaio, não por equipe mobilizada, e por isso as linhas de equipes aparecem vazias nessa coluna. A estrutura do laboratório está na seção 10.'));

  // ------------------------------------------------------------ 5. mensal
  p(titulo('5. Distribuição mensal'));
  p(texto('A curva do ano não é plana. As equipes partem de ' + nf(d.total.eq[0], 0) + ' em janeiro, recuam ao mínimo de ' +
    nf(d.total.eqMinimo, 0) + ' em ' + MESES[d.mesDoMinimo].toLowerCase() + ' e sobem ao patamar de ' + nf(d.total.eqPico, 0) +
    ' em ' + MESES[d.mesDoPico].toLowerCase() + d.fraseDoPatamar + '. A receita acompanha esse degrau: ' +
    d.mesesMaioresReceitas + '.'));
  p(tabela(
    [
      { rotulo: 'Mês', peso: 18 },
      { rotulo: 'Equipes', peso: 12, alinhamento: 'right' },
      { rotulo: 'Furos', peso: 14, alinhamento: 'right' },
      { rotulo: 'Ensaios', peso: 14, alinhamento: 'right' },
      { rotulo: 'Receita prevista', peso: 24, alinhamento: 'right' },
      { rotulo: '% do ano', peso: 18, alinhamento: 'right' },
    ],
    [
      ...MESES.map((mes, i) => [
        mes,
        nf(d.total.eq[i], 0),
        nf(d.sondagem.vol[i], 0),
        nf(d.lab.vol[i], 0),
        reais(d.total.fin[i]),
        pct(d.total.fin[i], d.total.financeiro),
      ]),
      ['TOTAL / MÉDIA', nf(d.total.eqMedia, 1), nf(d.sondagem.volume, 0), nf(d.lab.volume, 0), reais(d.total.financeiro), '100,0%'],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(nota('Na linha de total, a coluna Equipes traz a média dos doze meses (foto mensal, não acumulável); as demais colunas trazem a soma do ano.'));

  // ------------------------------------------------------------ 6. equipes
  p(titulo('6. Equipes previstas', 1));
  p(texto('A operação prevista se apoia em uma média de ' + nf(d.total.eqMedia, 2) + ' equipes mobilizadas por mês, chegando a ' + nf(d.total.eqPico, 0) + ' no pico. Duas tipologias respondem por quase toda a mobilização: sondagem mista (SM / SM.F / SR) e sondagem a percussão (SP) somam ' + nf(d.equipesDuasMaiores, 1) + ' equipes na média, ou ' + pct(d.equipesDuasMaiores, d.total.eqMedia) + ' do efetivo de campo.'));
  p(tabela(
    [
      { rotulo: 'Tipologia', peso: 26 },
      { rotulo: 'Média/mês', peso: 14, alinhamento: 'right' },
      { rotulo: 'Pico', peso: 11, alinhamento: 'right' },
      { rotulo: 'Mínimo', peso: 12, alinhamento: 'right' },
      { rotulo: '% do efetivo', peso: 16, alinhamento: 'right' },
      { rotulo: 'Produtividade premissa', peso: 21, alinhamento: 'right' },
    ],
    [
      ...d.porTipologiaCampo.map(t => [
        t.chave,
        nf(t.eqMedia, 2),
        nf(t.eqPico, 0),
        nf(t.eqMinimo, 0),
        pct(t.eqMedia, d.total.eqMedia),
        nf(t.prodPlanilha, 2) + ' /eq-dia',
      ]),
      ['TOTAL', nf(d.total.eqMedia, 2), nf(d.total.eqPico, 0), nf(d.total.eqMinimo, 0), '100,0%', '—'],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(nota('A soma dos picos por tipologia (' + nf(d.somaPicosTipologia, 0) + ') é maior que o pico do total (' + nf(d.total.eqPico, 0) + ') porque cada tipologia atinge seu máximo em mês diferente. O pico do total é o maior mês da curva agregada, não a soma dos máximos individuais.'));

  p(titulo('6.1. Curva mensal de equipes por tipologia', 2));
  p(tabela(
    [{ rotulo: 'Tipologia', peso: 22 }, ...MESES_CURTOS.map(m => ({ rotulo: m, peso: 6.5, alinhamento: 'right' }))],
    [
      ...d.porTipologiaCampo.map(t => [t.chave, ...t.eq.map(v => nf(v, 0))]),
      ['TOTAL', ...d.total.eq.map(v => nf(v, 0))],
    ],
    { ultimaLinhaTotal: true }
  ));

  // ------------------------------------------------------------- 7. volume
  p(titulo('7. Volume previsto'));
  p(texto('O volume do ano soma ' + nf(d.sondagem.volume) + ' furos de sondagem e ' + nf(d.lab.volume) + ' ensaios de laboratório. A distribuição entre as duas famílias é muito diferente da distribuição de receita: o laboratório concentra ' + pct(d.lab.volume, d.total.volume) + ' das unidades produzidas, mas apenas ' + pct(d.lab.financeiro, d.total.financeiro) + ' do faturamento previsto, porque o ticket unitário do ensaio é uma ordem de grandeza menor.'));
  p(tabela(
    [
      { rotulo: 'Tipologia', peso: 24 },
      { rotulo: 'Unidade', peso: 14 },
      { rotulo: 'Volume no ano', peso: 17, alinhamento: 'right' },
      { rotulo: '% do volume', peso: 15, alinhamento: 'right' },
      { rotulo: 'Receita prevista', peso: 18, alinhamento: 'right' },
      { rotulo: '% receita', peso: 12, alinhamento: 'right' },
    ],
    [
      ...d.porTipologia.map(t => [
        t.chave,
        TIPOLOGIAS_LAB.has(t.chave) ? 'ensaio' : 'furo',
        nf(t.volume, 0),
        pct(t.volume, d.total.volume),
        reais(t.financeiro),
        pct(t.financeiro, d.total.financeiro),
      ]),
      ['TOTAL', '—', nf(d.total.volume, 0), '100,0%', reais(d.total.financeiro), '100,0%'],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(nota('A coluna "% do volume" mistura furos e ensaios num mesmo denominador e serve só para mostrar a proporção de unidades produzidas — não é uma medida de esforço nem de receita.'));

  // ------------------------------------------------------------ 8. receita
  p(titulo('8. Receita prevista'));
  p(texto('A receita prevista de ' + reais(d.total.financeiro) + ' se distribui de forma bastante concentrada. Os cinco maiores contratos respondem por ' + pct(d.topCincoContratos, d.total.financeiro) + ' do total, e o maior grupo econômico sozinho responde por ' + pct(d.porGrupo[0].financeiro, d.total.financeiro) + '.'));

  p(titulo('8.1. Por origem do contrato', 2));
  p(tabela(
    [
      { rotulo: 'Origem', peso: 30 },
      { rotulo: 'Contratos', peso: 13, alinhamento: 'right' },
      { rotulo: 'Equipes (média)', peso: 17, alinhamento: 'right' },
      { rotulo: 'Receita prevista', peso: 24, alinhamento: 'right' },
      { rotulo: '% do total', peso: 16, alinhamento: 'right' },
    ],
    [
      ...d.porOrigem.map(o => [o.chave, nf(o.contratos, 0), nf(o.eqMedia, 2), reais(o.financeiro), pct(o.financeiro, d.total.financeiro)]),
      ['TOTAL', nf(d.meta.sups, 0), nf(d.total.eqMedia, 2), reais(d.total.financeiro), '100,0%'],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(nota('"Novos negócios" reúne o que ainda não era contrato assinado quando o forecast foi fechado — é a parcela da receita prevista que depende de conversão comercial, e por isso a de maior risco de não se realizar.'));

  p(titulo('8.2. Por grupo econômico', 2));
  p(tabela(
    [
      { rotulo: 'Grupo', peso: 26 },
      { rotulo: 'Equipes (média)', peso: 16, alinhamento: 'right' },
      { rotulo: 'Furos', peso: 13, alinhamento: 'right' },
      { rotulo: 'Ensaios', peso: 13, alinhamento: 'right' },
      { rotulo: 'Receita prevista', peso: 20, alinhamento: 'right' },
      { rotulo: '%', peso: 12, alinhamento: 'right' },
    ],
    [
      ...d.porGrupo.map(g => [g.chave, nf(g.eqMedia, 2), nf(g.volumeSondagem, 0), nf(g.volumeLab, 0), reais(g.financeiro), pct(g.financeiro, d.total.financeiro)]),
      ['TOTAL', nf(d.total.eqMedia, 2), nf(d.sondagem.volume, 0), nf(d.lab.volume, 0), reais(d.total.financeiro), '100,0%'],
    ],
    { ultimaLinhaTotal: true }
  ));

  p(titulo('8.3. Maiores contratos', 2));
  p(tabela(
    [
      { rotulo: 'Contrato (SUP)', peso: 17 },
      { rotulo: 'Tomador', peso: 22 },
      { rotulo: 'Escopo', peso: 22 },
      { rotulo: 'Equipes', peso: 11, alinhamento: 'right' },
      { rotulo: 'Receita prevista', peso: 18, alinhamento: 'right' },
      { rotulo: '%', peso: 10, alinhamento: 'right' },
    ],
    d.topContratos.map(c => [
      c.chave, c.exemplo.tomador, c.exemplo.escopo,
      nf(c.eqMedia, 2), reais(c.financeiro), pct(c.financeiro, d.total.financeiro),
    ]),
    {}
  ));
  p(nota(`Os ${d.topContratos.length} contratos acima concentram ${pct(d.topContratosSoma, d.total.financeiro)} da receita prevista. A carteira completa tem ${nf(d.meta.supsComValor)} contratos com valor previsto para 2026.`));

  // ------------------------------------------------------------- 9. ticket
  p(titulo('9. Ticket médio e produtividade por tipologia'));
  p(texto('As duas premissas comerciais e operacionais que fecham a conta do orçamento são o preço unitário e o ritmo de execução. Elas variam muito entre tipologias: uma equipe de trado (ST) entrega oito furos por dia a pouco mais de R$ 300 cada, enquanto uma equipe de sondagem mista entrega um furo a cada três ou quatro dias, a mais de R$ 17 mil.'));
  p(tabela(
    [
      { rotulo: 'Tipologia', peso: 20 },
      { rotulo: 'Ticket médio', peso: 18, alinhamento: 'right' },
      { rotulo: 'Produtividade premissa', peso: 20, alinhamento: 'right' },
      { rotulo: 'Produtividade implícita', peso: 20, alinhamento: 'right' },
      { rotulo: 'Receita/equipe-mês', peso: 22, alinhamento: 'right' },
    ],
    d.porTipologia.map(t => [
      t.chave,
      reais(t.ticket, 2),
      t.prodPlanilha ? nf(t.prodPlanilha, 2) : '—',
      t.eqMedia ? nf(t.prodImplicita, 2) : '—',
      t.eqMedia ? reais(t.financeiro / (t.eqMedia * 12)) : '—',
    ]),
    {}
  ));
  p(nota('A produtividade premissa é a média das taxas informadas na coluna PROD. da MATRIZ, ponderada pelo volume de cada contrato. A implícita divide o volume previsto pelos equipe-dias previstos (equipes × ' + d.meta.dias + ' dias × 12 meses). As duas divergem onde a planilha planejou volume acima ou abaixo da capacidade nominal das equipes alocadas; a diferença é folga de planejamento, não erro de cálculo. Laboratório não tem equipe de campo e por isso não tem produtividade por equipe-dia.'));

  // ----------------------------------------------------------- 10. recursos
  p(titulo('10. Estrutura de recursos'));
  p(texto('A MATRIZ prevê equipes, não cabeças, veículos ou equipamentos. Os quantitativos desta seção são derivados: aplicam à curva de equipes do Previsto as razões de composição medidas no registro operacional de equipes (Equipes.xlsx, abas de dezembro de 2025 e janeiro de 2026) e os valores unitários de mobilização do estudo de remobilização de equipes. São, portanto, premissas de dimensionamento — não linhas orçadas.'));

  p(titulo('10.1. Pessoas', 2));
  p(tabela(
    [
      { rotulo: 'Tipologia', peso: 26 },
      { rotulo: 'Pessoas por equipe', peso: 20, alinhamento: 'right' },
      { rotulo: 'Equipes (média)', peso: 17, alinhamento: 'right' },
      { rotulo: 'Pessoas (média)', peso: 18, alinhamento: 'right' },
      { rotulo: 'Pessoas (pico)', peso: 19, alinhamento: 'right' },
    ],
    [
      ...d.pessoas.linhas.map(l => [l.tipologia, nf(l.porEquipe, 1), nf(l.eqMedia, 2), nf(l.pessoasMedia, 0), nf(l.pessoasPico, 0)]),
      ['TOTAL DE CAMPO', '—', nf(d.total.eqMedia, 2), nf(d.pessoas.media, 0), nf(d.pessoas.pico, 0)],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(marcador('Composição da equipe:', 'um sondador responde pela equipe e responde pelo equipamento; os demais integrantes são auxiliares de sondagem. Equipes de sondagem mista e a percussão operam com dois a três integrantes; trado, poço de inspeção e bloco operam com um a dois.'));
  p(marcador('Laboratório:', 'dimensionado por posto de ensaio e não por equipe de campo. A estrutura de referência tem ' + nf(d.laboratorioPessoas) + ' pessoas distribuídas entre preparação, estufa, massa e limites, sedimentação, compactação e CBR, ensaios especiais e relatórios.'));
  p(marcador('Apoio e administração:', 'aproximadamente ' + nf(d.apoioPessoas) + ' pessoas em funções administrativas, RH, segurança do trabalho, manutenção e limpeza, não vinculadas a equipe de campo específica.'));
  p(nota('Total de referência da operação no pico: ' + nf(d.pessoas.pico + d.laboratorioPessoas + d.apoioPessoas, 0) + ' pessoas (' + nf(d.pessoas.pico, 0) + ' de campo, ' + nf(d.laboratorioPessoas) + ' de laboratório e ' + nf(d.apoioPessoas) + ' de apoio).'));

  p(titulo('10.2. Liderança', 2));
  p(marcador('Razão adotada:', 'um líder de equipe para cada ' + nf(EQUIPES_POR_LIDER, 1) + ' equipes mobilizadas, medida no registro operacional de janeiro de 2026.'));
  p(marcador('Quantitativo previsto:', nf(d.lideres.media, 0) + ' líderes na média do ano e ' + nf(d.lideres.pico, 0) + ' no pico de mobilização.'));
  p(marcador('Papel:', 'o líder acompanha as equipes em campo, responde pela produção do grupo e é o ponto de contato com o tomador. Não é um posto de custo por equipe: cresce em degraus, conforme a mobilização avança.'));

  p(titulo('10.3. Veículos', 2));
  p(marcador('Razão adotada:', nf(VEICULOS_POR_EQUIPE, 2) + ' veículo por equipe mobilizada. A razão é menor que um porque parte das equipes se desloca em carona com equipe vizinha na mesma frente — prática corrente e já refletida no registro operacional.'));
  p(marcador('Quantitativo previsto:', nf(d.veiculos.media, 0) + ' veículos na média do ano e ' + nf(d.veiculos.pico, 0) + ' no pico, incluindo os veículos de apoio.'));
  p(marcador('Perfil da frota:', 'caminhonetes e utilitários com tração, munck para transporte de sonda nas frentes de sondagem mista, e veículos leves de apoio e supervisão. A frota atual, de referência, tem 54 veículos, dos quais 12 são de apoio.'));

  p(titulo('10.4. Equipamentos', 2));
  p(texto('Cada equipe mobilizada opera um conjunto próprio — sonda ou kit de ferramental, conforme a tipologia. A tabela abaixo traz o valor unitário de mobilização de um conjunto novo e o investimento implicado pelo crescimento previsto do efetivo entre janeiro e o pico do ano.'));
  p(tabela(
    [
      { rotulo: 'Tipologia', peso: 24 },
      { rotulo: 'Conjunto', peso: 22 },
      { rotulo: 'Valor unitário', peso: 18, alinhamento: 'right' },
      { rotulo: 'Equipes a mobilizar', peso: 18, alinhamento: 'right' },
      { rotulo: 'Investimento', peso: 18, alinhamento: 'right' },
    ],
    [
      ...d.equipamentos.linhas.map(l => [l.tipologia, l.conjunto, reais(l.valorUnitario, 2), nf(l.delta, 0), l.delta ? reais(l.investimento, 2) : '—']),
      ['TOTAL', '—', '—', nf(d.equipamentos.deltaTotal, 0), reais(d.equipamentos.investimentoTotal, 2)],
    ],
    { ultimaLinhaTotal: true }
  ));
  p(nota('"Equipes a mobilizar" é a diferença entre o pico do ano e o efetivo de janeiro, por tipologia. Valores unitários da aba EQUIPAMENTOS (2) do estudo de remobilização de equipes, a preços do estudo. O investimento não inclui reserva técnica nem a reposição de equipamento existente.'));

  // -------------------------------------------------------------- 11. notas
  p(titulo('11. Notas metodológicas e limitações'));
  p(marcador('Apenas Previsto.', 'Nenhum número deste documento foi confrontado com execução. Um contrato que já vinha atrasado em junho aparece aqui com o volume que se planejou para ele, não com o que ele tende a entregar.'));
  p(marcador('Arredondamento.', 'Os totais são calculados sobre os valores cheios e só depois arredondados para exibição. Somar as colunas arredondadas de uma tabela pode divergir do total mostrado em uma ou duas unidades.'));
  p(marcador('Equipes fracionárias.', 'Valores como 0,5 equipe são reais e não são erro de leitura: representam equipe compartilhada entre contratos ou mobilizada por parte do mês.'));
  p(marcador('Pessoas, líderes, veículos e equipamentos são derivados.', 'A MATRIZ não os orça. Os quantitativos da seção 10 aplicam razões de composição medidas no registro operacional à curva de equipes do Previsto — servem para dimensionar e discutir, não para substituir o orçamento de custo de pessoal ou de frota.'));
  p(marcador('Grupos sem valor previsto.', `Dos ${nf(d.meta.grupos)} grupos econômicos presentes na MATRIZ, ${nf(d.meta.grupos - d.meta.gruposComValor)} não têm valor previsto para 2026 e por isso não aparecem nas tabelas de receita.`));
  p(marcador('Vigência da fonte.', 'A MATRIZ é uma planilha viva. Este relatório é uma fotografia dela na data de emissão indicada na capa; reexecutar o gerador em outra data pode produzir números diferentes.'));

  return partes.join('');
}

// ---------------------------------------------------------------- montagem
function calcular() {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const registros = parseMatriz(grid);
  if (!registros.length) throw new Error('Nenhum registro lido da MATRIZ -- confira o caminho e a aba em tools/orcamento/config.js');

  // A coluna DIAS é uniforme em toda a MATRIZ; se um dia deixar de ser, o
  // relatório precisa dizer qual dia usou em vez de escolher um em silêncio.
  const diasDistintos = [...new Set(registros.map(r => r.previsto.equipesResumo.dias).filter(Boolean))];
  if (diasDistintos.length !== 1) {
    throw new Error(`A coluna DIAS da MATRIZ deixou de ser uniforme (valores: ${diasDistintos.join(', ')}). Reveja a premissa de dias produtivos antes de gerar o relatório.`);
  }
  const dias = diasDistintos[0];

  const ehLab = r => TIPOLOGIAS_LAB.has(r.tipologia);
  const total = agregar(registros, dias);
  const sondagem = agregar(registros.filter(r => !ehLab(r)), dias);
  const lab = agregar(registros.filter(r => ehLab(r)), dias);

  const porTipologia = agruparPor(registros, r => r.tipologia, dias);
  const porTipologiaCampo = porTipologia.filter(t => t.eqMedia > 0).sort((a, b) => b.eqMedia - a.eqMedia);

  const porGrupo = agruparPor(registros, r => r.grupo, dias)
    .filter(g => g.financeiro > 0)
    .map(g => {
      const rs = registros.filter(r => r.grupo === g.chave);
      return {
        ...g,
        volumeSondagem: somar(rs.filter(r => !ehLab(r)).map(r => somar(r.previsto.volume))),
        volumeLab: somar(rs.filter(r => ehLab(r)).map(r => somar(r.previsto.volume))),
      };
    });

  const porOrigem = agruparPor(registros, r => r.origem, dias).map(o => ({
    ...o,
    contratos: new Set(registros.filter(r => r.origem === o.chave).map(r => r.sup)).size,
  }));

  const porContrato = agruparPor(registros, r => r.sup, dias).filter(c => c.financeiro > 0);
  const topContratos = porContrato.slice(0, 12);

  // Pessoas: razão de composição × curva de equipes do Previsto.
  const linhasPessoas = porTipologiaCampo
    .filter(t => PESSOAS_POR_EQUIPE[t.chave])
    .map(t => ({
      tipologia: t.chave,
      porEquipe: PESSOAS_POR_EQUIPE[t.chave],
      eqMedia: t.eqMedia,
      eqPico: t.eqPico,
      pessoasMedia: t.eqMedia * PESSOAS_POR_EQUIPE[t.chave],
      pessoasPico: t.eqPico * PESSOAS_POR_EQUIPE[t.chave],
    }));

  // Equipamentos: o que falta mobilizar entre janeiro e o pico de cada
  // tipologia. Fica em zero onde a tipologia já parte do próprio pico.
  const linhasEquipamentos = porTipologiaCampo
    .filter(t => VALOR_MOBILIZACAO[t.chave])
    .map(t => {
      const delta = Math.max(0, Math.ceil(t.eqPico - t.eq[0]));
      return {
        tipologia: t.chave,
        conjunto: t.chave === 'SM / SM.F / SR' ? 'Sonda rotativa + ferramental'
          : t.chave === 'SP' ? 'Kit de percussão'
          : t.chave === 'CPTu' ? 'Conjunto CPTu'
          : t.chave === 'ST' ? 'Kit de trado'
          : t.chave === 'PI' ? 'Kit de poço de inspeção'
          : 'Kit especial',
        valorUnitario: VALOR_MOBILIZACAO[t.chave],
        delta,
        investimento: delta * VALOR_MOBILIZACAO[t.chave],
      };
    });

  const duasMaiores = porTipologiaCampo.slice(0, 2).reduce((s, t) => s + t.eqMedia, 0);

  // A prosa da seção 5 descreve a forma da curva; se ela sair da planilha
  // pronta, o texto tem de sair junto. Nada de mês escrito à mão.
  const mesDoMinimo = total.eq.indexOf(total.eqMinimo);
  const mesDoPico = total.eq.indexOf(total.eqPico);
  const patamarSeSustenta = total.eq.slice(mesDoPico).every(v => v === total.eqPico);
  const fraseDoPatamar = patamarSeSustenta && mesDoPico < 11
    ? ', que se sustenta até dezembro'
    : '';
  const ranking = total.fin.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 4);
  const noSegundoSemestre = ranking.filter(r => r.i >= 6).length;
  const mesesMaioresReceitas = noSegundoSemestre === 4
    ? 'os quatro maiores meses estão todos no segundo semestre'
    : `os quatro maiores meses são ${ranking.map(r => MESES[r.i].toLowerCase()).join(', ')}`;

  return {
    emitidoEm: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    meta: {
      dias,
      registros: registros.length,
      sups: new Set(registros.map(r => r.sup)).size,
      tomadores: new Set(registros.map(r => r.tomador)).size,
      escopos: new Set(registros.map(r => r.escopo)).size,
      grupos: new Set(registros.map(r => r.grupo)).size,
      tipologias: new Set(registros.map(r => r.tipologia)).size,
      supsComValor: porContrato.length,
      gruposComValor: porGrupo.length,
    },
    total, sondagem, lab,
    porTipologia, porTipologiaCampo, porGrupo, porOrigem, topContratos,
    topContratosSoma: somar(topContratos.map(c => c.financeiro)),
    topCincoContratos: somar(porContrato.slice(0, 5).map(c => c.financeiro)),
    somaPicosTipologia: somar(porTipologiaCampo.map(t => t.eqPico)),
    equipesDuasMaiores: duasMaiores,
    mesDoMinimo, mesDoPico, mesesMaioresReceitas, fraseDoPatamar,
    pessoas: {
      linhas: linhasPessoas,
      media: somar(linhasPessoas.map(l => l.pessoasMedia)),
      pico: somar(linhasPessoas.map(l => l.pessoasPico)),
    },
    lideres: { media: total.eqMedia / EQUIPES_POR_LIDER, pico: total.eqPico / EQUIPES_POR_LIDER },
    veiculos: { media: total.eqMedia * VEICULOS_POR_EQUIPE, pico: total.eqPico * VEICULOS_POR_EQUIPE },
    laboratorioPessoas: 42,
    apoioPessoas: 19,
    equipamentos: {
      linhas: linhasEquipamentos,
      deltaTotal: somar(linhasEquipamentos.map(l => l.delta)),
      investimentoTotal: somar(linhasEquipamentos.map(l => l.investimento)),
    },
  };
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
<w:t xml:space="preserve">Premissas Orçamento Forecast 6+6  ·  Suporte Infra  ·  </w:t></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:rPr><w:rFonts w:ascii="${FONTE}" w:hAnsi="${FONTE}"/><w:sz w:val="15"/><w:color w:val="${MARCA.apagado}"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:ftr>`;
}

function gerar(caminhoSaida) {
  const d = calcular();
  const corpo = montarDocumento(d);

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
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
<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
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
<dc:title>Premissas Orçamento Forecast 6+6</dc:title>
<dc:subject>Premissas físicas e financeiras do Previsto — exercício 2026</dc:subject>
<dc:creator>Suporte Infra — PMO</dc:creator>
<cp:lastModifiedBy>Suporte Infra — PMO</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified>
</cp:coreProperties>`;

  const logo = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'logo-suporte-infra-negativo.png'));

  const docx = zipar([
    { nome: '[Content_Types].xml', conteudo: contentTypes },
    { nome: '_rels/.rels', conteudo: relsRaiz },
    { nome: 'docProps/core.xml', conteudo: core },
    { nome: 'word/document.xml', conteudo: documento },
    { nome: 'word/_rels/document.xml.rels', conteudo: rels },
    { nome: 'word/styles.xml', conteudo: estilos() },
    { nome: 'word/footer1.xml', conteudo: rodape() },
    { nome: 'word/media/logo.png', conteudo: logo },
  ]);

  fs.mkdirSync(path.dirname(caminhoSaida), { recursive: true });
  fs.writeFileSync(caminhoSaida, docx);
  return { caminhoSaida, dados: d, bytes: docx.length };
}

if (require.main === module) {
  const padrao = path.join(os.homedir(), 'OneDrive', 'Desktop', 'Premissas Orçamento Forecast 6+6.docx');
  const alvo = process.argv[2] || padrao;
  const { caminhoSaida, dados, bytes } = gerar(alvo);
  console.log(`OK: ${caminhoSaida} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`   ${dados.meta.registros} registros de Previsto | receita ${reais(dados.total.financeiro)} | ${nf(dados.total.eqMedia, 2)} equipes/mês (pico ${nf(dados.total.eqPico, 0)})`);
}

module.exports = { gerar, calcular };
