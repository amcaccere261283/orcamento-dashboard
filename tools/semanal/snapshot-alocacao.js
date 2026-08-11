'use strict';
// Gera um SNAPSHOT ESTÁTICO da aba Alocação Equipes para revisão de design.
//
//   node tools/semanal/snapshot-alocacao.js [saida.html]
//   (default: dist/cache/snapshot-alocacao.html -- dist/ é versionado, mas
//    dist/cache/ está no .gitignore: o snapshot é artefato de sessão, não build)
//
// POR QUE ESTE ARQUIVO EXISTE
// ===========================================================================
// A página publicada é um gate de senha + um blob cifrado: apontar um revisor
// de design para ela faz revisar a caixa de senha, não o quadro. E o dado real
// não pode sair daqui em texto puro -- o snapshot é HTML legível, fora do blob.
//
// Então: dados 100% SINTÉTICOS, e o CSS de VERDADE (cssBase() + CSS_SEMANAL,
// os mesmos que o build injeta). O que se revisa aqui é exatamente o que a
// página desenha.
//
// A grade é montada À MÃO e entregue direto a resumirAlocacao/renderMatriz --
// não passa por montarGradeAlocacao. De propósito: o pipeline de dados exige
// MATRIZ + demandas + roster reais e devolve os estados que o mês de hoje
// calhar de ter. Aqui a grade é calibrada para os estados visuais aparecerem
// TODOS de uma vez; uma revisão que não viu 2 das 6 leituras julgou meio
// semáforo (foi o que aconteceu na primeira tentativa, em 2026-08-03).
//
// Se um estado NOVO nascer na aba, ele tem que nascer aqui junto -- a lista
// ESTADOS_COBERTOS abaixo é a checagem, e o script FALHA se algum não aparecer
// no HTML gerado. Snapshot que perde um estado em silêncio é pior que nenhum.

const fs = require('fs');
const path = require('path');
const {
  renderControles, renderFaixaAlocacao, renderPool, renderMatriz,
  renderResumoSup, renderResumoEquipe, renderGuardaSemRoster, renderAvisoSomenteLeitura,
} = require('./render-aba-alocacao.js');
const { resumirAlocacao } = require('./compute-alocacao.js');
const { COLUNAS_ALOCACAO } = require('./equipes-alocaveis.js');
const { cssBase } = require('../comum/render-shell.js');
const { CSS_SEMANAL } = require('./render-semanal.js');

const MES_IDX = 7;        // agosto
const DIAS_DO_MES = 30;   // soma de diasNaSemana no mês, não dias de calendário

// Epoch em DIAS -- a unidade que compute-semanal.js/render-aba-semanal.js usam
// para inicio/fim de semana.
function dia(ano, mesIdx, diaDoMes) {
  return Date.UTC(ano, mesIdx, diaDoMes) / 86400000;
}

// --- Equipes sintéticas -------------------------------------------------------
// Nomes de fantasia. NUNCA copiar líder, equipe ou tomador da planilha real.

function equipe(id, lider, nome, colunas, extras) {
  const e = Object.assign({
    id, lider, nome, colunas,
    polivalente: colunas.length > 1,
    disponivel: true,
    diasDisponiveis: 5,
    diasDaSemana: 7,
    popup: {
      habilitacao: 'Sondagem', veiculo: 'VE-000', proprietario: 'Frota própria',
      equipamentos: ['Perfuratriz', 'Bomba'], tomador: 'Contratante Alfa',
    },
  }, extras || {});
  return e;
}

const EQUIPES = [
  equipe('EQ-01', 'Andrade', 'Carlos Andrade Ribeiro', ['SP']),
  equipe('EQ-02', 'Bittencourt', 'Marina Bittencourt', ['SP']),
  equipe('EQ-03', 'Colares', 'Rui Colares', ['SM / SM.F / SR']),
  // Polivalente: aparece em ST, PI e BL ao mesmo tempo (selo ⇄ no cartão).
  equipe('EQ-04', 'Dourado', 'Ana Dourado Lima', ['ST', 'PI', 'BL']),
  equipe('EQ-05', 'Esteves', 'Paulo Esteves', ['ST', 'PI', 'BL']),
  equipe('EQ-06', 'Fontenele', 'Íris Fontenele', ['Especiais']),
  equipe('EQ-07', 'Guimarães', 'Tadeu Guimarães', ['SP']),
  // Sem dia disponível: cartão apagado, com motivo, e situação 'fora'.
  equipe('EQ-08', 'Horta', 'Zilda Horta', ['SP'], { disponivel: false, diasDisponiveis: 0 }),
  // Meio período: capacidade menor que a das outras da MESMA tipologia --
  // é o caso que a linha "Disponível: N de 7 dias" do popup existe para explicar.
  equipe('EQ-09', 'Irineu', 'Marcos Irineu', ['Especiais'], { diasDisponiveis: 2 }),
];

const FORA_DO_QUADRO = [
  { id: 'EQ-90', lider: 'Lacerda', servicos: 'Lab', motivo: 'Laboratório tem fonte própria e não é equipe de campo de sondagem' },
  { id: 'EQ-91', lider: 'Moreira', servicos: 'TST', motivo: 'Serviço de teste, sem demanda correspondente na MATRIZ' },
];

const EQUIPES_POR_ID = {};
EQUIPES.forEach((e) => { EQUIPES_POR_ID[e.id] = e; });

// --- Grade sintética ----------------------------------------------------------
// capacidades[] é o que resumirAlocacao usa para ratear a carga; capacidadeAlocada
// é a soma. premissaProd null = célula sem registro na MATRIZ (a hachurada).

function celula(sup, coluna, tendencia, carteira, equipes, capacidades, premissaProd) {
  const capacidadeAlocada = capacidades.reduce((a, b) => a + b, 0);
  return {
    sup, coluna, indices: [0],
    tendencia, carteira,
    equipes, capacidades, capacidadeAlocada,
    saldo: capacidadeAlocada - tendencia,
    premissaProd: premissaProd === undefined ? 1 : premissaProd,
  };
}

function linha(sup, tomador, ramo, celulas) {
  const mapa = {};
  let tendencia = 0;
  celulas.forEach((c) => { mapa[c.coluna] = c; tendencia += c.tendencia; });
  return { sup, tomador, ramo, diagnostico: { saldo: 0 }, tendencia, celulas: mapa };
}

// Uma linha por LEITURA de SUP (leituraDoSup, compute-alocacao.js), e as
// situações de célula (classificarCelula) distribuídas entre elas.
const LINHAS = [
  // falta-equipe: saldo < 0. Célula ST sobrecarregada (t/c = 40/24 = 1,67).
  linha('SUP-1001', 'Contratante Alfa', 'abaixo', [
    celula('SUP-1001', 'SP', 12, 4, ['EQ-01'], [5], 1),
    celula('SUP-1001', 'ST', 40, 0, ['EQ-04'], [24], 8),
  ]),
  // sem-equipe: tendência > 0 e nenhuma equipe na linha inteira. A célula SP
  // fica em 'Sem equipe' (âmbar) -- o estado mais descoberto que existe.
  linha('SUP-1002', 'Contratante Beta', 'abaixo', [
    celula('SUP-1002', 'SP', 9, 6, [], [], 1),
  ]),
  // antecipar: saldo > 0 com carteira > 0. Gera o aviso ACESO na coluna SP
  // (há equipe de SP livre no pool) e o MUDO em Especiais (não há).
  linha('SUP-1003', 'Contratante Gama', 'igual', [
    celula('SUP-1003', 'SP', 4, 18, ['EQ-02'], [5], 1),
    celula('SUP-1003', 'Especiais', 3, 11, ['EQ-06', 'EQ-09'], [5, 2], 1),
  ]),
  // absorvido: capacidade == tendência, então saldo 0 (não entra em
  // 'antecipar', que exige saldo > 0). Célula 'Equilibrada'. A carteira aqui
  // é o que produz o aviso MUDO: há carteira para antecipar, mas a única
  // equipe de SM está com ocupação 1,0 -- informa sem convocar.
  linha('SUP-1004', 'Contratante Delta', 'igual', [
    celula('SUP-1004', 'SM / SM.F / SR', 1.5, 7, ['EQ-03'], [1.5], 0.3),
  ]),
  // parado-com-carteira: tendência 0 e carteira > 0 -- a linha que o filtro
  // de ativos esconderia, e o motivo da aba existir. Célula hachurada
  // (premissaProd null = sem registro na MATRIZ) e situação 'Livre'.
  linha('SUP-1005', 'Contratante Épsilon', 'sem-dado', [
    celula('SUP-1005', 'PI', 0, 22, [], [], null),
  ]),
  // sem-demanda: tendência 0, carteira 0, mas com equipe alocada ali -- a
  // sexta leitura, alcançável desde que a semana nasce semeada do realizado.
  linha('SUP-1006', 'Contratante Zeta', 'sem-dado', [
    celula('SUP-1006', 'SP', 0, 0, ['EQ-07'], [5], 1),
  ]),
];
LINHAS.forEach((l, i) => { l.ordem = i + 1; });

const GRADE = {
  colunas: COLUNAS_ALOCACAO.filter((c) => LINHAS.some((l) => l.celulas[c.id])),
  linhas: LINHAS,
  ancoraEpoch: dia(2026, 7, 12),
  diasDoMes: DIAS_DO_MES,
};

// A alocação CRUA (equipe -> destino). O pool decide por ela, nunca pelo
// resumo da grade -- ver o comentário em renderPool.
const ALOCACAO = {};
LINHAS.forEach((l) => {
  Object.keys(l.celulas).forEach((k) => {
    l.celulas[k].equipes.forEach((id) => { ALOCACAO[id] = { sup: l.sup, coluna: k }; });
  });
});

// --- Estados que o snapshot TEM que conter -----------------------------------
// Marcador no HTML -> o que ele prova. Um estado que sumir daqui some da
// revisão sem ninguém notar; por isso a verificação é dura.
const ESTADOS_COBERTOS = {
  'leitura-parado': 'leitura SUP "Parado c/ carteira"',
  'leitura-falta': 'leitura SUP "Falta equipe"/"Sem equipe"',
  'leitura-antecipar': 'leitura SUP "Antecipar"',
  'leitura-ok': 'leitura SUP "Absorvido"',
  'leitura-neutra': 'leitura SUP "Sem demanda"',
  'situacao-livre': 'célula sem demanda a cobrir',
  'situacao-sem-equipe': 'célula com demanda e nenhuma equipe',
  'situacao-folga': 'célula com folga',
  'situacao-equilibrada': 'célula equilibrada',
  'situacao-sobrecarregada': 'célula sobrecarregada',
  'situacao-fora': 'equipe fora da semana (resumo por equipe)',
  'celula-hachurada': 'célula sem registro na MATRIZ',
  'celula-falta': 'célula com saldo negativo',
  'aviso-aceso': 'aviso "dá pra antecipar" convocando',
  'aviso-mudo': 'aviso informando sem convocar',
  'cartao-polivalente': 'cartão de equipe polivalente',
  'cartao-indisponivel': 'cartão de equipe sem dia disponível',
  'cartao-selo-poli': 'selo ⇄ da repetição no pool',
  'pool-grupo': 'pool agrupado por tipologia',
  'fora-do-quadro': 'lista recolhida "fora do quadro"',
  'popup-equipe': 'popup de detalhe da equipe',
  'cobertura-barra': 'barra de cobertura da célula',
  'alocacao-aviso-somente-leitura': 'faixa de somente leitura',
  'alocacao-guarda-erro': 'guarda "sem roster"',
  'metrica-alocacao': 'faixa de métricas do topo',
  'resumo-sup-alocacao': 'tabela resumo por SUP',
  'resumo-equipe-alocacao': 'tabela resumo por equipe',
};

// --- Montagem -----------------------------------------------------------------

function bloco(titulo, nota, html) {
  return '<section class="snapshot-bloco">'
    + '<h2 class="snapshot-titulo">' + titulo + '</h2>'
    + (nota ? '<p class="snapshot-nota">' + nota + '</p>' : '')
    + html
    + '</section>';
}

function gerar() {
  const resumo = resumirAlocacao(GRADE, { equipes: EQUIPES, mesIdx: MES_IDX });
  const porEquipeMap = {};
  resumo.porEquipe.forEach((e) => { porEquipeMap[e.id] = e; });

  // inicio/fim são epoch em DIAS (formatarIntervaloSemana multiplica por
  // 86400000), não strings ISO nem epoch em segundos -- com string sai
  // "S1 (NaN/NaN a NaN/NaN)" nos botões, silenciosamente.
  const semanas = [
    { inicio: dia(2026, 7, 3), fim: dia(2026, 7, 9) },
    { inicio: dia(2026, 7, 10), fim: dia(2026, 7, 16) },
    { inicio: dia(2026, 7, 17), fim: dia(2026, 7, 23) },
  ];
  const opcoesControles = {
    semanas, semana: semanas[1], modoPersistencia: 'sheet', pendentes: 0,
    buscaEquipe: '', tipologiaAlocacao: '',
  };

  // O estado NORMAL da aba, na ordem em que renderAbaAlocacao a emite.
  let corpo = bloco('Aba Alocação Equipes — estado normal',
    'Dados sintéticos, calibrados para todos os estados visuais aparecerem juntos.',
    renderControles(opcoesControles, null)
    + renderFaixaAlocacao(resumo.totais)
    + renderPool(EQUIPES, FORA_DO_QUADRO, porEquipeMap, null, ALOCACAO, '', null)
    + renderMatriz(GRADE, resumo, EQUIPES_POR_ID, null)
    + renderResumoSup(resumo.porSup)
    + renderResumoEquipe(resumo.porEquipe));

  // O popup vive em :hover/:focus-within. Num snapshot estático ninguém passa
  // o mouse, então este bloco o força aberto -- senão a revisão nunca o vê.
  corpo += bloco('Popup da equipe (forçado aberto)',
    'Na página real aparece em :hover/:focus-within do cartão.',
    '<div class="snapshot-popup-aberto">'
    + renderPool([EQUIPES[3]], [], porEquipeMap, null, {}, '', null)
    + '</div>');

  // Os dois modos degradados, que na página real são exclusivos entre si.
  corpo += bloco('Somente leitura (semana de outro mês)', null,
    renderAvisoSomenteLeitura()
    + renderControles(opcoesControles, 'mes-diferente')
    + renderMatriz(GRADE, resumo, EQUIPES_POR_ID, 'mes-diferente'));

  corpo += bloco('Guarda: a Sheet espelho da aba EQ não respondeu', null,
    renderGuardaSemRoster());

  const cssSnapshot = `
  /* Só do SNAPSHOT -- não existe na página real. Separa os blocos e força o
     popup aberto, que de outro modo só existe em :hover. */
  .snapshot-bloco { margin: 0 0 56px; padding-top: 8px; border-top: 1px solid var(--gridline); }
  .snapshot-titulo { font-size: 16px; margin: 16px 0 4px; }
  .snapshot-nota { font-size: 12px; color: var(--muted); margin: 0 0 16px; }
  .snapshot-popup-aberto .popup-equipe { display: block; position: static; margin-top: 8px; }
  .snapshot-aviso { max-width: 90ch; font-size: 12px; color: var(--muted); margin: 0 0 24px; }
`;

  const markup = '<h1>Planejamento Semanal — Alocação Equipes</h1>'
    + '<p class="snapshot-aviso">Snapshot estático para revisão de design. '
    + 'Todos os números, SUPs, equipes e tomadores são inventados. '
    + 'Gerado por tools/semanal/snapshot-alocacao.js.</p>'
    + corpo;

  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Snapshot — Alocação Equipes</title>'
    + '<style>' + cssBase() + CSS_SEMANAL + cssSnapshot + '</style>'
    + '</head><body>' + markup + '</body></html>';

  return { html, markup };
}

// Confere SÓ o markup, nunca o documento inteiro: todo nome de classe daqui
// também aparece dentro do <style> (é CSS_SEMANAL que os define), e uma busca
// no HTML completo passaria com a grade VAZIA -- um verificador que nunca
// reprova é pior que nenhum, porque dá confiança falsa.
function verificar(markup) {
  const estilo = markup.indexOf('</style>');
  if (estilo !== -1) throw new Error('verificar() recebeu o documento com <style>; passe só o markup');
  const faltando = Object.keys(ESTADOS_COBERTOS).filter((marca) => markup.indexOf(marca) === -1);
  if (faltando.length) {
    console.error('Estados que o snapshot deveria mostrar e NAO mostra:');
    faltando.forEach((m) => console.error('  - ' + m + ' (' + ESTADOS_COBERTOS[m] + ')'));
    console.error('\nCalibre os dados sinteticos ate todos aparecerem. Um snapshot');
    console.error('incompleto faz a revisao julgar metade do semaforo.');
    process.exit(1);
  }
  console.log(Object.keys(ESTADOS_COBERTOS).length + ' estados visuais presentes no markup.');
}

function main() {
  const saida = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'cache', 'snapshot-alocacao.html');
  const { html, markup } = gerar();
  verificar(markup);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, html, 'utf8');
  console.log('Snapshot escrito em ' + saida + ' (' + Math.round(html.length / 1024) + ' KB)');
}

if (require.main === module) main();

module.exports = { gerar, verificar, ESTADOS_COBERTOS, EQUIPES, GRADE };
