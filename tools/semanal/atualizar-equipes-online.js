'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { agregarEquipesProdutivas } = require('./compute-equipes-produtivas-link7.js');
const { diaEpoch } = require('./compute-semanal.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const { linhaExcluida } = require('../comum/exclusoes.js');
const { hojeNoFusoProjeto, diaEpochDeOntem } = require('../comum/datas.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');

// Acha o valor de uma coluna comparando o rótulo ignorando variação de
// espaçamento (a planilha real usa espaço duplo em algumas colunas, ex.
// "Data / Hora  Primeira Foto" -- não confiável usar a chave exata).
function colunaTolerante(linha, rotulo) {
  const alvo = rotulo.replace(/\s+/g, ' ').trim();
  for (const chave of Object.keys(linha || {})) {
    if (chave.replace(/\s+/g, ' ').trim() === alvo) return linha[chave];
  }
  return undefined;
}

const RE_DATA_HORA = /^(\d{2})\/(\d{2})\/(\d{4})/;
// O Link 7 traz o Tipo BRUTO (ex.: "SM", "SM.F", "SR", "CPTU", "SP.F", "BQ",
// "DN", "SN"...), o mesmo alfabeto de 21 rótulos que a aba Avanços do
// Avanço Sond.xlsx sempre usou -- não o rótulo de 10 tipologias que a
// MATRIZ conhece. Sem traduzir aqui, resolverSupConhecido(registros)(sup,
// tipo) (em build-dashboard.js/render-semanal.js) nunca acha o par na
// MATRIZ pra "SM"/"CPTU"/etc., redireciona pra "Diversos", e a chave final
// (ex. "Diversos||SM") nunca é lida por compute-balanco.js -- o Realizado de
// Equipes fica 0,0 pra essas tipologias em silêncio (achado da revisão final
// de branch, 2026-08-08). rotularTipologia (tools/comum/tipologias-avancos.js)
// é a MESMA tradução que parse-avancos.js já aplica pra Sondagem -- reaplicada
// aqui pra que equipes-online.csv já saia com o rótulo certo, igual todo o
// resto do projeto. Tipo desconhecido LANÇA (fail-loud, mesmo comportamento
// de rotularTipologia) -- não há "cair em Especiais por omissão" tolerável.
// A coluna que identifica a EQUIPE no Link 7 já mudou de nome uma vez: o
// spec de 2026-08-08 registrou "ID Sondador", e em 2026-08-10 a tabela veio
// com "Nº Equipe" no lugar (mesma posição, mesmo papel -- um número por
// equipe). Aceitar as duas evita quebrar de novo na próxima renomeação, e
// "Nº Equipe" é até mais honesto: o que se conta aqui é equipe, não pessoa.
const ROTULOS_ID_EQUIPE = ['Nº Equipe', 'N° Equipe', 'ID Sondador'];

function acharIdEquipe(linha) {
  for (const rotulo of ROTULOS_ID_EQUIPE) {
    const valor = colunaTolerante(linha, rotulo);
    if (valor !== undefined) return String(valor || '').trim();
  }
  return undefined;
}

function parseLinhasLink7(linhasCru) {
  const saida = [];
  let excluidos = 0;
  // Falha ALTO se nenhuma das grafias existir. Sem isto, a renomeação de
  // 2026-08-10 se comportou exatamente como o pior modo de falha deste
  // projeto: acharIdEquipe devolvia undefined em toda linha, o agregador
  // descartava as 8.618 linhas por "sem id" e gravava um CSV só de
  // cabeçalho -- com o fetcher relatando "119 dias novos" e o build caindo
  // na fonte de reserva sem ninguém perceber.
  const primeira = (linhasCru || [])[0];
  if (primeira && acharIdEquipe(primeira) === undefined) {
    throw new Error(
      `Nenhuma coluna de identificação de equipe encontrada no Link 7 (procurei ${ROTULOS_ID_EQUIPE.join(', ')}). `
      + `Colunas recebidas: ${Object.keys(primeira).join(', ')}. `
      + `A tabela do sond.com.br mudou de layout -- acrescente a grafia nova em ROTULOS_ID_EQUIPE.`
    );
  }
  for (const l of linhasCru || []) {
    // Exclusão de auto-consumo interno, que passou a valer aqui em
    // 2026-08-10 ("aplica a exclusão em todas as fontes"). Esta era a outra
    // fonte sem filtro nenhum, e dava pra ver no dado publicado:
    // equipes-online.csv trazia SEG.A e o contrato "SUP- CT TREIN EQ SOND"
    // (centro de treinamento), ambos já descartados pelas demais fontes.
    // O Link 7 chama o tomador de "Tomadora" -- linhaExcluida() cobre as
    // duas grafias.
    if (linhaExcluida(l, colunaTolerante(l, 'Tipo'))) { excluidos++; continue; }
    // Achado ao vivo em 2026-08-08: o cabeçalho real desta coluna tem
    // espaço DUPLO ("Data / Hora  Primeira Foto"), diferente da fixture de
    // teste original (espaço simples) -- o acesso direto por chave ficava
    // sempre undefined, e TODA linha era descartada em silêncio (0
    // sondagem-dia, sem erro nenhum). colunaTolerante ignora a variação de
    // espaçamento em vez de depender do nome exato vindo do DataTable.
    const bruto = String(colunaTolerante(l, 'Data / Hora Primeira Foto') || '').trim();
    const m = RE_DATA_HORA.exec(bruto);
    if (!m) continue;
    const dia = diaEpoch(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
    // O id da EQUIPE (não o nome do sondador nem o do líder): equipes
    // PRODUTIVAS não precisa casar com nenhum roster externo (ver
    // compute-equipes-produtivas-link7.js) -- só precisa ser consistente
    // DENTRO do próprio Link 7, e este número já é.
    saida.push({
      idEquipe: acharIdEquipe(l) || '',
      sup: String(colunaTolerante(l, 'Contrato Financeiro') || '').trim(),
      tipo: rotularTipologia(colunaTolerante(l, 'Tipo')),
      diaEpoch: dia,
    });
  }
  if (excluidos > 0) {
    console.log(`  ${excluidos} linha(s) excluída(s) (Suporte Sondagens/SEG/SN).`);
  }
  return saida;
}

const fmtData = (d) => d.toISOString().slice(0, 10);
const dataDoDiaEpoch = (dia) => new Date(dia * 86400000);

// As linhas já gravadas, como { dia -> [linhaCsv...] }. O CSV de saída é
// pré-agregado por (SUP, tipologia, dia), então um dia já buscado nunca
// precisa ser rebuscado: a produção daquele dia não muda depois que ele
// fecha. É o que torna o backfill incremental barato.
function lerCsvExistente(caminho) {
  if (!fs.existsSync(caminho)) return { porDia: {}, ultimoDia: null };
  const linhas = fs.readFileSync(caminho, 'utf8').trim().split('\n').slice(1);
  const porDia = {};
  let ultimoDia = null;
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const dia = Number(linha.split(',')[2]);
    if (!Number.isFinite(dia)) continue;
    (porDia[dia] = porDia[dia] || []).push(linha);
    if (ultimoDia === null || dia > ultimoDia) ultimoDia = dia;
  }
  return { porDia, ultimoDia };
}

// Chave 'AAAA-MM' de um dia-desde-época.
function mesDoDia(dia) {
  const d = new Date(dia * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Quais MESES do ano corrente ainda precisam ser buscados.
//
// A primeira versão desta função (2026-08-10) perguntava só "qual foi o
// último dia gravado?" e buscava dali pra frente. Errado quando o CSV já
// existe mas cobre só um pedaço: o arquivo tinha 01 a 08/08 e o fetcher
// pediu apenas 09/08, nunca fazendo o backfill de janeiro a julho -- o que
// era exatamente o objetivo do pedido. Cobertura tem que ser medida por
// MÊS, não pela ponta.
//
// O mês CORRENTE é sempre rebuscado (ainda está recebendo produção); os
// demais só entram se não tiverem nenhum dia gravado. Mês sem nenhuma
// sondagem no ano é rebuscado toda vez -- é barato (uma janela) e mais
// seguro que gravar uma marca de "mês vazio" que ninguém saberia invalidar.
function mesesPendentes(porDia, ano, mesCorrente) {
  const comDado = new Set(Object.keys(porDia).map((d) => mesDoDia(Number(d))));
  const pendentes = [];
  for (let mes = 1; mes <= mesCorrente; mes++) {
    const chave = `${ano}-${String(mes).padStart(2, '0')}`;
    if (mes === mesCorrente || !comDado.has(chave)) pendentes.push(mes);
  }
  return pendentes;
}

// Fatia o intervalo pedido em meses -- o Link 7 aceita qualquer intervalo num
// fetch só, mas um ano inteiro numa requisição é uma tabela grande demais
// para raspar de uma vez com segurança. Mês a mês mantém cada resposta no
// tamanho que já se sabe que funciona.
function janelasMensais(diaInicio, diaFim) {
  const janelas = [];
  let cursor = dataDoDiaEpoch(diaInicio);
  const limite = dataDoDiaEpoch(diaFim);
  while (cursor <= limite) {
    const fimDoMes = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const fim = fimDoMes < limite ? fimDoMes : limite;
    janelas.push({ de: new Date(cursor), ate: fim });
    cursor = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate() + 1));
  }
  return janelas;
}

async function buscarJanela(de, ate) {
  const { session, target } = await cdp.abrirSessao(
    `${SITE_ORIGIN}/campo/sondagens/de/${fmtData(de)}/ate/${fmtData(ate)}/tabela/1/`
  );
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 60000 });
    return parseLinhasLink7(cdp.linhasComoObjetos({ headers, rows }));
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

// Backfill incremental, decidido pelo dono do projeto em 2026-08-10: "você
// precisa baixar os extratos de dias anteriores que você não tem no
// histórico. Da primeira vez considere baixar ref ao ano atual, depois baixa
// apenas os dias que não temos considerando d-1".
//
// Antes disto o fetcher buscava SÓ o mês corrente, e o Δ equipes ficava sem
// dado em qualquer mês passado -- 8 dias de cobertura contra 20 meses de
// Sondagem (medido em 2026-08-10).
async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  // UTC-3, igual às demais fontes -- ver hojeNoFusoProjeto.
  const { ano, mes: mesCorrente } = hojeNoFusoProjeto();
  const diaFim = diaEpochDeOntem();
  const { porDia: jaTemos } = lerCsvExistente(OUT_PATH);

  const pendentes = mesesPendentes(jaTemos, ano, mesCorrente);
  if (!pendentes.length) {
    console.log('Nada a buscar: todos os meses do ano corrente já têm dado, e o mês corrente já foi buscado.');
    return;
  }

  console.log(`Buscando produção (Link 7 -- campo/sondagens): ${pendentes.length} mês(es) de ${ano} -- ${pendentes.map((m) => String(m).padStart(2, '0')).join(', ')} (corte em d-1: ${fmtData(dataDoDiaEpoch(diaFim))})...`);

  const linhasLink7Brutas = [];
  const mesesBuscados = new Set();
  const falhas = [];
  for (const mes of pendentes) {
    const de = new Date(Date.UTC(ano, mes - 1, 1));
    const ateMes = new Date(Date.UTC(ano, mes, 0));
    // Nunca além de d-1: o dia corrente está incompleto no Link 7.
    const ate = diaEpoch(ateMes) > diaFim ? dataDoDiaEpoch(diaFim) : ateMes;
    if (diaEpoch(de) > diaFim) continue;
    try {
      const lidas = await buscarJanela(de, ate);
      console.log(`  ${fmtData(de)} a ${fmtData(ate)}: ${lidas.length} sondagem-dia (bruto)`);
      linhasLink7Brutas.push(...lidas);
      mesesBuscados.add(`${ano}-${String(mes).padStart(2, '0')}`);
    } catch (err) {
      // Um mês que falha não pode derrubar os outros nem apagar o que já
      // estava gravado -- o merge abaixo preserva os meses não buscados.
      console.warn(`  ${fmtData(de)} a ${fmtData(ate)}: FALHOU -- ${err.message}`);
      falhas.push(`${ano}-${String(mes).padStart(2, '0')}`);
    }
  }

  if (!linhasLink7Brutas.length) {
    throw new Error('Nenhuma linha encontrada no Link 7 -- abortando sem gravar (sessao expirada, ou período sem nenhuma sondagem -- confira antes de aceitar um CSV vazio).');
  }

  // O filtro de/ate do site NÃO restringe "Data / Hora Primeira Foto" ao
  // intervalo pedido -- achado ao vivo em 2026-08-09: uma busca de
  // 01/08-31/08 devolveu sessões de foto genuínas desde 25/06 (OS aberta há
  // semanas, ainda ativa em agosto, mas com sessões antigas incluídas na
  // resposta). Cada linha tem data PRÓPRIA e correta (confirmado: a mesma OS
  // aparece várias vezes, cada uma com timestamp distinto -- não é um resumo
  // por OS) -- o problema é só que a resposta não fica contida no mês
  // pedido. Sem este filtro, equipesPeriodo (calculado a partir do dia MAIS
  // ANTIGO no CSV, ver parseEquipesFracaoCsv em build-dashboard.js) sairia
  // com o mês errado (ex.: junho em vez de agosto), e o mês REAL (agosto)
  // seria tratado como "fora da cobertura" pelo Balanço -- silenciosamente
  // sem dado, mesmo o CSV tendo dado bom pra agosto.
  // Recorta aos meses REALMENTE buscados, e nunca além de d-1: o filtro
  // de/ate do site não restringe "Data / Hora Primeira Foto" ao intervalo
  // pedido (achado em 2026-08-09), então sessões de OS antigas e o dia
  // corrente parcial entrariam no agregado sem isto.
  const linhasLink7 = linhasLink7Brutas.filter((l) => mesesBuscados.has(mesDoDia(l.diaEpoch)) && l.diaEpoch <= diaFim);
  const foraDoIntervalo = linhasLink7Brutas.length - linhasLink7.length;
  if (foraDoIntervalo > 0) {
    console.log(`  ${foraDoIntervalo} linha(s) fora do intervalo pedido (sessão de foto de OS antiga ainda ativa, ou o dia de hoje) -- descartadas, ficam ${linhasLink7.length}.`);
  }
  if (!linhasLink7.length) {
    throw new Error('Todas as linhas do Link 7 ficaram fora do intervalo depois do filtro -- abortando sem gravar (não é o caso normal, confira antes de aceitar um CSV vazio).');
  }

  const { porDia } = agregarEquipesProdutivas(linhasLink7);
  console.log(`  ${Object.keys(porDia).length} par(es) (SUP, tipologia) com equipe produtiva no período buscado.`);

  // Junta o que já estava gravado (dias anteriores a diaInicio) com o que
  // acabou de ser agregado. Os dois conjuntos são disjuntos por construção --
  // diaInicio é ultimoDia + 1 -- então não há risco de contar duas vezes.
  const linhasSaida = [];
  for (const [chave, porDiaChave] of Object.entries(porDia)) {
    const [sup, tipo] = chave.split('||');
    for (const [dia, fracao] of Object.entries(porDiaChave)) {
      linhasSaida.push(`${sup},${tipo},${dia},${fracao}`);
    }
  }
  // Preserva os dias dos meses que NÃO foram rebuscados agora. Os meses
  // buscados são substituídos inteiros pela versão nova -- é o que torna a
  // execução idempotente: rodar duas vezes seguidas dá o mesmo arquivo, em
  // vez de duplicar linhas.
  let diasPreservados = 0;
  for (const [dia, linhas] of Object.entries(jaTemos)) {
    if (mesesBuscados.has(mesDoDia(Number(dia)))) continue;
    linhasSaida.push(...linhas);
    diasPreservados++;
  }

  // Ordena por dia pra que parseEquipesFracaoCsv (build-dashboard.js) derive
  // equipesPeriodo do dia mais antigo sem depender da ordem de escrita.
  linhasSaida.sort((a, b) => Number(a.split(',')[2]) - Number(b.split(',')[2]));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, ['SUP,Tipo,DiaEpoch,Fracao', ...linhasSaida].join('\n') + '\n', 'utf8');
  const diasNovos = new Set(linhasLink7.map((l) => l.diaEpoch)).size;
  if (falhas.length) console.warn(`${falhas.length} mês(es) falharam e ficaram como estavam: ${falhas.join(', ')}`);
  console.log(`Pronto: ${diasNovos} dia(s) novo(s) + ${diasPreservados} dia(s) preservado(s) do CSV anterior, gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { parseLinhasLink7, lerCsvExistente, janelasMensais, mesesPendentes, mesDoDia, main };
