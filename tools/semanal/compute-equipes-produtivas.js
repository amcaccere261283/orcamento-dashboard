'use strict';

// EQUIPES PRODUTIVAS a partir de campo/fotos (2026-08-05)
// ============================================================================
// Fonte: sond.com.br/campo/fotos/de/{inicio}/ate/{fim}/tabela/1/ -- uma linha
// por FOTO (não por sondagem: várias fotos por furo por dia são normais).
// "Equipe produtiva num dia" = Sondador distinto naquele dia, por Contrato
// Financeiro. A tabela não tem coluna Tipo -- quem chama injeta
// tipologiaPorSondador (mesmo mapa que build-dashboard.js já calcula pra
// equipes ativas, a partir da tipologia mais frequente nos furos do
// sondador) -- e esse mapa JÁ VEM ROTULADO (parse-avancos.js chama
// rotularTipologia() ao montar cada furo), então este módulo usa o valor
// direto, sem traduzir de novo (ver o comentário no corpo de
// agregarEquipesProdutivas sobre o bug que essa segunda tradução causava).
//
// Mesmo formato de saída (porDia) que compute-equipes-ativas.js já produz,
// pra plugar no mesmo lugar em build-dashboard.js.
//
// DUAS COISAS INJETADAS, nenhuma resolvida aqui dentro (2026-08-05):
//
//   - resolverSup(contrato, tipologia) -> sup: dá a chance de quem chama mandar
//     um par (contrato, tipologia) que a MATRIZ não conhece pro registro
//     "Diversos", em vez de o par sumir do Δ equipes em silêncio. Este módulo
//     NÃO conhece a MATRIZ (nem registros, nem chaveMatriz, nem o literal
//     "Diversos") -- ele só chama o resolvedor e conta quantas vezes a resposta
//     mudou a chave. A fonte da verdade é redirecionarSupsDesconhecidos
//     (compute-demandas.js), a MESMA que furos e ensaios já usam. Sem isso,
//     agora que produtivas é a fonte PRIMÁRIA do Δ equipes, todo contrato fora
//     da MATRIZ derrubaria o número principal sem nenhum aviso.
//     ATENÇÃO À ORDEM: o resolvedor roda ANTES do Set de sondadores, para que
//     dois contratos desconhecidos que caem no mesmo "Diversos" no mesmo dia
//     contem o mesmo sondador UMA vez -- exatamente como
//     compute-equipes-mobilizadas.js, que agrega furos JÁ redirecionados.
//     Redirecionar o porDia depois de agregar não conseguiria isso: os valores
//     já são contagens, a identidade do sondador se perdeu.
//   - (nada mais) -- fs, CDP e leitura de CSV ficam em
//     atualizar-equipes-produtivas-online.js / build-dashboard.js.
//
// 'periodo' na saída ({ano, mes} ou null) descreve QUAL MÊS este porDia cobre
// -- derivado do próprio dado (o mês mais frequente entre os dias contados),
// não de um relógio. Quem consome é foraDaCoberturaDeEquipes
// (compute-balanco.js): a busca cobre UM mês (primeiro..último dia), então
// desenhar essa barra num mês diferente daria a "barra zero enganosa" que este
// projeto já corrigiu em 2026-08-01/03.

const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function diaEpochDeTextoBr(texto) {
  const m = RE_DATA_BR.exec(String(texto || '').trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

// O mês que mais aparece entre os dias contados -- ver o comentário sobre
// 'periodo' no topo. A busca é sempre de primeiro a último dia de UM mês
// (atualizar-equipes-produtivas-online.js), então na prática há um só; o
// "mais frequente" é só o desempate honesto se um dia vizinho escapar.
function periodoDominante(diasEpoch) {
  const contagem = new Map();
  for (const dia of diasEpoch) {
    const d = new Date(dia * 86400000);
    const chave = `${d.getUTCFullYear()}||${d.getUTCMonth() + 1}`;
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  }
  let melhorChave = null;
  let melhorN = 0;
  for (const [chave, n] of contagem) {
    if (n > melhorN) { melhorN = n; melhorChave = chave; }
  }
  if (!melhorChave) return null;
  const partes = melhorChave.split('||');
  return { ano: Number(partes[0]), mes: Number(partes[1]) };
}

function agregarEquipesProdutivas(opcoes) {
  const o = opcoes || {};
  const linhas = o.linhas || [];
  const tipologiaPorSondador = o.tipologiaPorSondador || {};
  const resolverSup = o.resolverSup || ((contrato) => contrato);

  // contrato||tipologia||diaEpoch -> Set(sondador)
  const sondadoresPorContratoDia = new Map();
  // semTipologia conta EQUIPE-DIA distinta (sondador, dia), não linha de CSV:
  // a tabela é uma linha por FOTO (~1.900 fotos/dia), e contar linhas imprimia
  // um número de 5 dígitos num log que diz "equipe-dia" -- o que parece perda
  // catastrófica de dado quando é só artefato da contagem de fotos.
  const semTipologiaDias = new Set();
  // Pares (contrato, tipologia) DISTINTOS que o resolvedor mandou pra outro
  // SUP. Distintos, e não linhas, pela mesma razão de semTipologia acima.
  const paresRedirecionados = new Set();

  for (const linha of linhas) {
    const contrato = String(linha['Contrato Financeiro'] || '').trim();
    const sondador = String(linha['Sondador'] || '').trim();
    const diaEpoch = diaEpochDeTextoBr(linha['Data']);
    if (!contrato || !sondador || diaEpoch === null) continue;

    // tipologiaPorSondador JÁ VEM ROTULADA -- é construída (build-dashboard.js/
    // render-semanal.js) a partir de furos.tipologia, e parse-avancos.js já
    // chama rotularTipologia() internamente ao montar cada furo (linha ~153).
    // Reaplicar rotularTipologia() aqui (bug real, corrigido em 2026-08-06)
    // recebia um rótulo já traduzido tipo "SM / SM.F / SR" e o tratava como
    // crua -- rotularTipologia lança em rótulo desconhecido, o catch virava
    // null, e TODO sondador cuja tipologia mais frequente fosse "SM / SM.F /
    // SR" ou "Especiais" (os únicos rótulos não-idênticos ao próprio nome)
    // sumia silenciosamente pra semTipologia. Só não estourou nos testes
    // porque a fixture usava "SP", que por acaso É idêntico rotulado (SP ->
    // SP), mascarando o bug. Medido ao vivo: 01/08/2026 tinha 53 sondadores
    // produtivos e só 33 equipe-dia sobreviviam à segunda rotulação.
    const tipologia = tipologiaPorSondador[sondador];
    if (!tipologia) { semTipologiaDias.add(`${sondador}||${diaEpoch}`); continue; }

    // ANTES do Set: ver "ATENÇÃO À ORDEM" no topo.
    let sup;
    try { sup = resolverSup(contrato, tipologia); } catch { sup = contrato; }
    if (!sup) sup = contrato;
    if (sup !== contrato) paresRedirecionados.add(`${contrato}||${tipologia}`);

    const chaveContrato = `${sup}||${tipologia}||${diaEpoch}`;
    if (!sondadoresPorContratoDia.has(chaveContrato)) sondadoresPorContratoDia.set(chaveContrato, new Set());
    sondadoresPorContratoDia.get(chaveContrato).add(sondador);
  }

  const porDia = {};
  const diasContados = [];
  for (const [chaveContrato, sondadores] of sondadoresPorContratoDia) {
    // lastIndexOf, não indexOf: a chave é `sup||tipologia||dia` e é o ÚLTIMO
    // separador que delimita o dia -- um SUP com '||' no nome não desalinharia.
    const corte = chaveContrato.lastIndexOf('||');
    const chave = chaveContrato.slice(0, corte);
    const diaEpoch = Number(chaveContrato.slice(corte + 2));
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][diaEpoch] = sondadores.size;
    diasContados.push(diaEpoch);
  }

  return {
    porDia,
    semTipologia: semTipologiaDias.size,
    redirecionados: paresRedirecionados.size,
    periodo: periodoDominante(diasContados),
  };
}

module.exports = { agregarEquipesProdutivas, diaEpochDeTextoBr, periodoDominante };
