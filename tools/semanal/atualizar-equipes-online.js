'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { diaEpoch } = require('./compute-semanal.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const { linhaExcluida } = require('../comum/exclusoes.js');
const { hojeNoFusoProjeto, diaEpochDeHoje } = require('../comum/datas.js');
const cdp = require('./cdp-client.js');
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { classificarDiaEquipe } = require('./classificar-dia-equipe.js');
const { buscarListaDeAbas, mesesEqDoAno } = require('../comum/descobrir-abas-planilha.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
const ID_PLANILHA_EQUIPES = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU';
const OUT_PATH_ROSTER = path.join(__dirname, '..', '..', 'dist', 'equipes-roster-online.csv');

// COLUNAS DO ROSTER (ampliadas em 2026-08-10, rodada de correção da Tarefa 5)
// ============================================================================
// O formato original só levava (IdEquipe, DiaEpoch, Estado) e JOGAVA FORA o
// resto do que classificarDiaEquipe/parseAbaEq já tinham em mãos aqui. Isso
// quebrou os dois consumidores do roster no build, em silêncio:
//
//   1. classe.noDefault descartado -> a ponte em build-dashboard.js sintetizava
//      TODO campoSemFuro como 'Mobilização' (que é CATALOGADO), e
//      agregarEquipesNaoProdutivas -- que descarta de propósito o campoSemFuro
//      que caiu no default -- passava a contar como NÃO PRODUTIVOS os ~572
//      equipe-dia/mês de texto livre que descrevem trabalho REAL ("CCR RioSP",
//      "Via Mineira"). Número errado, sem aviso.
//   2. equipe.nome/equipe.servicos e classe.os descartados -> agregarEquipesAtivas
//      não tinha nem tipologia (vem de Serviços/casarSondador) nem OS do dia
//      (ultimoSup só é setado a partir de uma OS), então NENHUM equipe-dia
//      podia ser apropriado a um par (SUP, tipologia).
//
// A classificação é capturada UMA vez, aqui, sobre o texto ORIGINAL -- nunca
// reconstruída depois a partir de um texto sintético.
//
// IdEquipe,DiaEpoch,Estado ficam nas MESMAS posições (0,1,2) de antes de
// propósito: lerRosterExistente e a ordenação de gravarRoster continuam lendo
// o dia na coluna 1, e parseRosterOnlineCsvBruto (build) segue igual nas três
// primeiras. Nome/Servicos se repetem em toda linha da equipe -- mesma
// convenção dos outros CSVs planos deste projeto (equipes-online.csv).
const CABECALHO_ROSTER = 'IdEquipe,DiaEpoch,Estado,NoDefault,Os,Nome,Servicos';

// Produção crua do Link 7 (dist/equipes-online.csv). Era 'SUP,Tipo,DiaEpoch,
// Fracao' (pré-agregado) até 2026-08-10 -- o dia mudou de posição junto, de
// [2] para [3]. Constante em vez de literal justamente para que o leitor e o
// gravador não possam divergir.
//
// UltimaFotoEpoch (2026-08-28): epoch em MINUTOS (não dias) da coluna "Data /
// Hora Última Foto" -- decide, dentro do MESMO dia, qual das várias sessões
// (SUPs) de uma equipe foi a mais recente, pro critério de "onde ela estava"
// em equipes-alocaveis.js (ultimoRealizadoAte). DiaEpoch continua vindo da
// Primeira Foto e decidindo só o BALDE do dia -- as duas colunas nunca
// competiram pelo mesmo papel; ver o design de 2026-08-28.
const CABECALHO_PRODUCAO = 'IdEquipe,SUP,Tipo,DiaEpoch,UltimaFotoEpoch';

// Trava de versão de formato, compartilhada pelos DOIS CSVs que este fetcher
// publica (roster e produção).
//
// Os dois arquivos são lidos posicionalmente (`split(',')[n]`), então um
// arquivo gravado por uma versão anterior do formato não é "parcialmente
// aproveitável": as colunas simplesmente significam outra coisa. Sem esta
// trava, o CSV velho seria lido como se fosse novo e o resultado voltaria
// gravado no arquivo publicado -- corrupção silenciosa e permanente (dias
// presos num mês bogus tipo '1970-01', que nenhum re-fetch alcança porque
// mesesPendentes/buscarRoster só olham o ano corrente).
//
// Cabeçalho diferente = descarta TUDO e devolve null; quem chama trata como
// arquivo inexistente, e o backfill normal repopula do zero no formato novo.
function lerLinhasComCabecalho(caminho, cabecalhoEsperado, rotulo) {
  if (!fs.existsSync(caminho)) return null;
  const todas = fs.readFileSync(caminho, 'utf8').trim().split('\n');
  if ((todas[0] || '').trim() !== cabecalhoEsperado) {
    console.warn(`${rotulo}: ${caminho} está no formato antigo (${JSON.stringify((todas[0] || '').trim())}) -- descartando e rebuscando no formato novo (${cabecalhoEsperado}).`);
    return null;
  }
  return todas.slice(1);
}

// Nome/Servicos são texto de planilha e vão para um CSV lido por split(',')
// simples nas duas pontas. Uma vírgula em "Serviços" ou no nome do líder
// deslocaria todas as colunas seguintes. Trocar por espaço é seguro para os
// dois usos reais: tipologiaDireta compara valores catalogados (nenhum tem
// vírgula) e casarSondador tokeniza só letras.
function campoCsvSeguro(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[\r\n,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// csvTexto é o export CSV de UMA aba "(EQ)" (mesmo layout que
// compute-equipes-ativas.js's parseAbaEq já lê -- é a MESMA planilha,
// só buscada direto em vez de via espelho Apps Script). ano/mes vêm do
// NOME da aba (descoberto por mesesEqDoAno), não do cabeçalho: o export
// direto do Google não carrega o ano na coluna de dia ("1-Ago", sem
// "/2026"), diferente do que o espelho antigo produzia via getValues().
function linhasRosterDoMes(csvTexto, ano, mes) {
  const equipes = parseAbaEq(csvTexto);
  const saida = [];
  for (const equipe of equipes) {
    if (!equipe.id) continue;
    const nome = campoCsvSeguro(equipe.nome);
    const servicos = campoCsvSeguro(equipe.servicos);
    for (const d of equipe.dias) {
      const classe = classificarDiaEquipe(d.texto);
      if (!classe) continue;
      const dia = diaEpoch(new Date(Date.UTC(ano, mes - 1, d.dia)));
      // 'os' passa pelo mesmo saneamento de nome/servicos: também é texto
      // extraído da célula da planilha (o classificador tira a OS de dentro
      // de "CCR RioSP (17851-26)"), e uma vírgula ali deslocaria as duas
      // colunas seguintes exatamente do mesmo jeito.
      saida.push(`${equipe.id},${dia},${classe.estado},${classe.noDefault ? '1' : '0'},${campoCsvSeguro(classe.os)},${nome},${servicos}`);
    }
  }
  return saida;
}

// Lê o roster já gravado, como { dia -> [linha...] } -- mesmo padrão de
// lerCsvExistente (produção), mas o dia é a coluna 1 (ver CABECALHO_ROSTER).
//
// Cabeçalho de outra versão do formato descarta tudo (ver
// lerLinhasComCabecalho): preservar linhas de 3 colunas ao lado das de 7
// produziria dias sem noDefault/OS/Serviços -- exatamente o silêncio que a
// rodada de 2026-08-10 existe para eliminar.
function lerRosterExistente(caminho) {
  const linhas = lerLinhasComCabecalho(caminho, CABECALHO_ROSTER, 'Roster');
  if (!linhas) return { porDia: {} };
  const porDia = {};
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const dia = Number(linha.split(',')[1]);
    if (!Number.isFinite(dia)) continue;
    (porDia[dia] = porDia[dia] || []).push(linha);
  }
  return { porDia };
}

// Backfill incremental do roster, mesmo espírito do Link 7: mês corrente
// SEMPRE rebuscado (ainda sendo preenchido), meses passados só se faltando.
// Substitui por completo o espelho Apps Script (apps-script-espelho-eq.gs),
// que só publicava o mês corrente -- ver a spec
// docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md.
async function buscarRoster(ano, mesCorrente) {
  const { porDia: jaTemos } = lerRosterExistente(OUT_PATH_ROSTER);
  // Chave 'AAAA-MM' (mesDoDia, mesmo padrão do Link 7 -- ver mais abaixo neste
  // arquivo) -- não bastam meses 1-12 crus: uma vez que o roster acumule mais
  // de um ano, um mês bare colidiria com o mesmo mês de qualquer outro ano.
  const mesesComDado = new Set(Object.keys(jaTemos).map((dia) => mesDoDia(Number(dia))));

  console.log('Roster: descobrindo abas (EQ) da planilha de equipes...');
  const abas = await buscarListaDeAbas(ID_PLANILHA_EQUIPES);
  const mesesDisponiveis = mesesEqDoAno(abas, ano);
  if (!mesesDisponiveis.length) {
    console.warn('Roster: nenhuma aba "(EQ)" encontrada pro ano corrente -- Ativas/Não-produtivas/Realizado ficam sem dado de roster.');
    return { linhasNovas: [], mesesBuscados: new Set() };
  }

  const pendentes = mesesDisponiveis.filter((m) => m.mes === mesCorrente || !mesesComDado.has(`${ano}-${String(m.mes).padStart(2, '0')}`));
  if (!pendentes.length) {
    console.log('Roster: todos os meses do ano já têm dado, e o mês corrente já foi buscado.');
    return { linhasNovas: [], mesesBuscados: new Set() };
  }

  const linhasNovas = [];
  const mesesBuscados = new Set();
  for (const { mes, gid } of pendentes) {
    const url = `https://docs.google.com/spreadsheets/d/${ID_PLANILHA_EQUIPES}/export?format=csv&gid=${gid}`;
    try {
      const resposta = await fetch(url, { redirect: 'follow' });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const csv = await resposta.text();
      const linhas = linhasRosterDoMes(csv, ano, mes);
      console.log(`  Roster ${String(mes).padStart(2, '0')}/${ano}: ${linhas.length} linha(s) de equipe-dia.`);
      linhasNovas.push(...linhas);
      mesesBuscados.add(`${ano}-${String(mes).padStart(2, '0')}`);
    } catch (err) {
      console.warn(`  Roster ${String(mes).padStart(2, '0')}/${ano}: FALHOU -- ${err.message}`);
    }
  }
  return { linhasNovas, mesesBuscados, jaTemos };
}

// Grava dist/equipes-roster-online.csv juntando o novo com o preservado --
// mesma idempotência do Link 7 (meses buscados são substituídos inteiros).
// 'caminho' só é passado pelo teste (destino temporário); a produção usa o
// arquivo publicado de sempre.
function gravarRoster({ linhasNovas, mesesBuscados, jaTemos }, caminho = OUT_PATH_ROSTER) {
  if (!mesesBuscados || !mesesBuscados.size) return;
  const linhasSaida = [...linhasNovas];
  let diasPreservados = 0;
  for (const [dia, linhas] of Object.entries(jaTemos || {})) {
    const mesDoRegistro = mesDoDia(Number(dia));
    if (mesesBuscados.has(mesDoRegistro)) continue;
    linhasSaida.push(...linhas);
    diasPreservados++;
  }
  linhasSaida.sort((a, b) => Number(a.split(',')[1]) - Number(b.split(',')[1]));
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, [CABECALHO_ROSTER, ...linhasSaida].join('\n') + '\n', 'utf8');
  console.log(`Roster: ${linhasNovas.length} linha(s) nova(s) + ${diasPreservados} dia(s) preservado(s), gravado em ${caminho}.`);
}

// Acha o valor de uma coluna comparando o rótulo ignorando variação de
// espaçamento (a planilha real usa espaço duplo em algumas colunas, ex.
// "Data / Hora  Primeira Foto" -- não confiável usar a chave exata).
// Achado ao vivo em 2026-08-28: o cabeçalho real da coluna Última Foto no
// site é "Data / Hora Ultima Foto" -- SEM acento, diferente do que a fixture
// de teste original usava. colunaTolerante ignorava só a variação de
// ESPAÇAMENTO (achado de 2026-08-08 pra Primeira Foto); sem normalizar
// acento também, a busca por "Última Foto" nunca batia, caía em undefined em
// silêncio, e ultimaFotoEpoch degradava pro fallback (início do dia da
// Primeira Foto) SEMPRE -- exatamente o bug que a Última Foto existe pra
// corrigir, voltando disfarçado. normalize('NFD') + strip dos diacríticos
// (U+0300–U+036f) resolve os dois lados da comparação de uma vez.
function normalizarRotulo(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function colunaTolerante(linha, rotulo) {
  const alvo = normalizarRotulo(rotulo);
  for (const chave of Object.keys(linha || {})) {
    if (normalizarRotulo(chave) === alvo) return linha[chave];
  }
  return undefined;
}

const RE_DATA_HORA = /^(\d{2})\/(\d{2})\/(\d{4})/;
// Última Foto (2026-08-28): mesmo formato "dd/mm/aaaa HH:MM" da Primeira
// Foto, mas aqui o HORÁRIO importa -- ver o comentário de CABECALHO_PRODUCAO
// acima. O grupo de hora/minuto é opcional (?:...)? só por robustez: se a
// célula um dia vier sem horário, ultimaFotoEpochMinuto ainda extrai a data e
// cai no início do dia (00:00), em vez de descartar a linha inteira.
const RE_DATA_HORA_COM_MINUTO = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/;

// epoch em MINUTOS (não dias) da Última Foto de uma linha. Sem o minuto, duas
// sessões (SUPs diferentes) da mesma equipe no MESMO dia empatam no diaEpoch,
// e "a última do array" vira arbitrário -- ordem de chegada da tabela do
// site, não horário real de quando a equipe esteve lá. null quando o texto
// não casa com o formato (célula vazia ou ilegível) -- quem chama decide o
// fallback, nunca aqui.
function ultimaFotoEpochMinuto(texto) {
  const m = RE_DATA_HORA_COM_MINUTO.exec(String(texto || '').trim());
  if (!m) return null;
  var dd = m[1], mm = m[2], yyyy = m[3], hh = m[4], min = m[5];
  var ms = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh || 0), Number(min || 0));
  return Math.floor(ms / 60000);
}
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

// A chave de agrupamento: o número da equipe quando existe, o NOME do
// sondador quando não existe.
//
// Medido em 2026-08-10 sobre 3 meses do Link 7: de 10 a 48 linhas por mês têm
// "Nº Equipe" vazio e "Sondador" preenchido. Elas eram descartadas em
// silêncio por agregarEquipesProdutivas ("sem id"), e isso é produção real
// sumindo -- 2 a 4 sondadores espalhados por 16 a 22 dias do mês.
//
// O fallback é seguro porque as duas chaves não podem colidir para a mesma
// pessoa no mesmo dia: verificado em julho e maio/2026, NENHUM sondador sem
// número aparece também com número no mesmo dia (0 de 25 e 0 de 48). O
// prefixo "nome:" mantém os dois espaços de chave separados de qualquer
// forma, para que um sondador chamado "441" jamais se confunda com a equipe
// 441.
function chaveEquipe(linha) {
  const numero = acharIdEquipe(linha);
  if (numero) return numero;
  const sondador = String(colunaTolerante(linha, 'Sondador') || '').trim();
  return sondador ? `nome:${sondador}` : '';
}

function parseLinhasLink7(linhasCru) {
  const saida = [];
  let excluidos = 0;
  let porNome = 0;
  let semChave = 0;
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
    const chave = chaveEquipe(l);
    if (!chave) semChave++;
    else if (!acharIdEquipe(l)) porNome++;
    // Sem Última Foto legível (coluna ausente na tabela, célula vazia numa
    // linha só): degrada pro início do dia da Primeira Foto, em vez de
    // descartar a linha -- mesmo espírito de resiliência do resto deste
    // arquivo (uma célula ruim não pode apagar produção real).
    var ultimaFotoEpoch = ultimaFotoEpochMinuto(colunaTolerante(l, 'Data / Hora Última Foto'));
    if (ultimaFotoEpoch === null) ultimaFotoEpoch = dia * 1440;
    saida.push({
      idEquipe: chave,
      sup: String(colunaTolerante(l, 'Contrato Financeiro') || '').trim(),
      tipo: rotularTipologia(colunaTolerante(l, 'Tipo')),
      diaEpoch: dia,
      ultimaFotoEpoch: ultimaFotoEpoch,
    });
  }
  if (excluidos > 0) {
    console.log(`  ${excluidos} linha(s) excluída(s) (Suporte Sondagens/SEG/SN).`);
  }
  // Visibilidade do que antes sumia calado: quantas linhas dependeram do
  // fallback por nome, e quantas não tinham nem número nem sondador (essas
  // últimas o agregador realmente descarta -- não há como atribuí-las).
  if (porNome > 0) {
    console.log(`  ${porNome} linha(s) sem "Nº Equipe" agrupada(s) pelo NOME do sondador.`);
  }
  if (semChave > 0) {
    console.warn(`  ATENÇÃO: ${semChave} linha(s) sem "Nº Equipe" E sem "Sondador" -- ficam fora da conta de equipes.`);
  }
  return saida;
}

const fmtData = (d) => d.toISOString().slice(0, 10);
const dataDoDiaEpoch = (dia) => new Date(dia * 86400000);

// As linhas já gravadas, como { dia -> [linhaCsv...] }. O CSV de saída é
// cru por (equipe, dia, contrato) desde 2026-08-10 -- uma linha por
// (IdEquipe, SUP, Tipo, DiaEpoch), sem agregação -- então um dia já buscado
// nunca precisa ser rebuscado: a produção daquele dia não muda depois que
// ele fecha. É o que torna o backfill incremental barato.
//
// Mesma trava de formato do roster (ver lerLinhasComCabecalho): os arquivos
// publicados em dist/ e docs/ ainda estavam no formato pré-2026-08-10
// ('SUP,Tipo,DiaEpoch,Fracao'), onde a coluna [3] é a FRAÇÃO, não o dia.
function lerCsvExistente(caminho) {
  const linhas = lerLinhasComCabecalho(caminho, CABECALHO_PRODUCAO, 'Produção');
  if (!linhas) return { porDia: {}, ultimoDia: null };
  const porDia = {};
  let ultimoDia = null;
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const dia = Number(linha.split(',')[3]); // ver CABECALHO_PRODUCAO
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
    // O mês ANTERIOR entra mesmo já tendo dado (2026-08-17): desde que o
    // fetcher passou a gravar o dia corrente, o último dia de cada mês é
    // gravado PARCIAL (retrato das 8h). O mês corrente já era rebuscado
    // sempre, o que completa o dia de ontem todo dia -- mas na virada do mês
    // ele deixa de ser o corrente, e sem isto o dia 30/31 ficaria congelado
    // no parcial para sempre, sem erro nem aviso.
    // Precondição deste conserto: o fetcher tem de rodar pelo menos uma vez
    // DURANTE o mês seguinte. Se ninguém rodar por seis semanas, o último dia
    // capturado continua parcial -- mesmo estado silencioso, por outra rota.
    // Limite conhecido: em 01/01 o mês anterior é dezembro do ano ANTERIOR, e
    // este backfill é escopado ao ano corrente -- 31/12 fica parcial. Ver
    // docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
    if (mes === mesCorrente || mes === mesCorrente - 1 || !comDado.has(chave)) pendentes.push(mes);
  }
  return pendentes;
}

// Núcleo PURO do merge da produção (Link 7): decide quais meses autorizam
// descarte, filtra o que veio e costura com o que já estava gravado. Extraído
// de main() em 2026-08-17, por pedido da revisão final: a regra mais perigosa
// do arquivo morava lá dentro, inalcançável por teste. Mesmo desenho de
// gravarRoster, que já era puro exatamente por esse motivo.
//
// - resultadosPorMes: [{ chave: 'AAAA-MM', lidas: [{idEquipe, sup, tipo, diaEpoch}] }].
//   Mês que FALHOU não entra na lista -- quem chama trata a exceção e o mês
//   simplesmente não é tocado.
// - jaTemos: { diaEpoch: ['linha crua', ...] }, como lerCsvExistente devolve.
// - diaFim: dia-desde-época do corte (HOJE desde 2026-08-17).
function mesclarProducao({ resultadosPorMes, jaTemos, diaFim }) {
  const mesesBuscados = new Set();
  const mesesVazios = [];
  const linhasBrutas = [];
  for (const { chave, lidas } of resultadosPorMes || []) {
    linhasBrutas.push(...lidas);
    // SÓ marca o mês como buscado se veio linha. Estar em 'mesesBuscados'
    // AUTORIZA o laço de preservação abaixo a descartar tudo que já estava
    // gravado daquele mês -- então uma resposta que parseia para ZERO linha,
    // sem lançar, apagaria um mês inteiro de dado bom. Isso não é hipotético
    // neste arquivo: em 2026-08-08 um espaço duplo num cabeçalho fez
    // parseLinhasLink7 descartar TODAS as linhas sem erro nenhum. Virou risco
    // real em 2026-08-17, quando o mês ANTERIOR passou a ser rebuscado toda
    // vez (ver mesesPendentes): antes disso um mês fechado com dado nunca era
    // rebuscado, então não tinha como regredir.
    if (lidas.length) mesesBuscados.add(chave);
    else mesesVazios.push(chave);
  }

  // Recorta aos meses REALMENTE buscados, e nunca além do corte: o filtro
  // de/ate do site não restringe "Data / Hora Primeira Foto" ao intervalo
  // pedido (achado em 2026-08-09), então sessões de OS antigas ainda ativas
  // entrariam no agregado sem isto.
  const linhasNovas = linhasBrutas.filter(
    (l) => mesesBuscados.has(mesDoDia(l.diaEpoch)) && l.diaEpoch <= diaFim,
  );

  // Formato cru desde 2026-08-10 (+ UltimaFotoEpoch em 2026-08-28): IdEquipe,
  // SUP,Tipo,DiaEpoch,UltimaFotoEpoch, uma linha por (equipe, dia, contrato)
  // -- a fração/alocação por roster é calculada no cruzamento (build/
  // refresh), não aqui. Ver compute-equipes-realizado-alocado.js.
  const linhasSaida = linhasNovas.map((l) => `${l.idEquipe},${l.sup},${l.tipo},${l.diaEpoch},${l.ultimaFotoEpoch}`);

  // Preserva os dias dos meses que NÃO foram rebuscados agora. A disjunção
  // entre o que se grava e o que se preserva vem inteiramente de
  // 'mesesBuscados' (chaveado 'AAAA-MM' por mesDoDia) -- não há cursor de dia.
  let diasPreservados = 0;
  for (const [dia, linhas] of Object.entries(jaTemos || {})) {
    if (mesesBuscados.has(mesDoDia(Number(dia)))) continue;
    linhasSaida.push(...linhas);
    diasPreservados++;
  }

  linhasSaida.sort((a, b) => Number(a.split(',')[3]) - Number(b.split(',')[3]));
  return { linhasSaida, linhasNovas, mesesBuscados, mesesVazios, diasPreservados, totalBruto: linhasBrutas.length };
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
// apenas os dias que não temos considerando d-1" (o corte virou HOJE em
// 2026-08-17 -- ver o spec citado em mesesPendentes).
//
// Antes disto o fetcher buscava SÓ o mês corrente, e o Δ equipes ficava sem
// dado em qualquer mês passado -- 8 dias de cobertura contra 20 meses de
// Sondagem (medido em 2026-08-10).
async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  // UTC-3, igual às demais fontes -- ver hojeNoFusoProjeto.
  const { ano, mes: mesCorrente } = hojeNoFusoProjeto();

  // Roster (Link 6) e produção (Link 7) são fontes INDEPENDENTES -- planilha
  // do Google contra tabela do sond.com.br. Uma falha na descoberta de gid ou
  // no download das abas "(EQ)" não pode abortar a busca de produção, mesma
  // regra de resiliência que o laço por mês do Link 7 (abaixo) e
  // atualizar-arquivos.js já seguem.
  try {
    gravarRoster(await buscarRoster(ano, mesCorrente));
  } catch (err) {
    console.warn(`Roster: FALHOU por completo -- ${err.message}. O arquivo anterior fica como estava; seguindo para a produção (Link 7).`);
  }

  const diaFim = diaEpochDeHoje();
  const { porDia: jaTemos } = lerCsvExistente(OUT_PATH);

  const pendentes = mesesPendentes(jaTemos, ano, mesCorrente);
  if (!pendentes.length) {
    console.log('Nada a buscar: todos os meses do ano corrente já têm dado, e o mês corrente já foi buscado.');
    return;
  }

  console.log(`Buscando produção (Link 7 -- campo/sondagens): ${pendentes.length} mês(es) de ${ano} -- ${pendentes.map((m) => String(m).padStart(2, '0')).join(', ')} (corte em hoje: ${fmtData(dataDoDiaEpoch(diaFim))})...`);

  const resultadosPorMes = [];
  const falhas = [];
  // A janela REALMENTE pedida de cada mês, para o aviso de "mês vazio" abaixo
  // poder citá-la: ela não é o mês de calendário quando 'ate' foi grampeado em
  // diaFim (o mês corrente), e essa diferença é justamente o que se quer ver
  // ao investigar um mês que voltou sem nada.
  const janelaPorChave = new Map();
  for (const mes of pendentes) {
    const de = new Date(Date.UTC(ano, mes - 1, 1));
    const ateMes = new Date(Date.UTC(ano, mes, 0));
    // Nunca além de hoje: não há dado de dia futuro no Link 7.
    const ate = diaEpoch(ateMes) > diaFim ? dataDoDiaEpoch(diaFim) : ateMes;
    if (diaEpoch(de) > diaFim) continue;
    const chave = `${ano}-${String(mes).padStart(2, '0')}`;
    janelaPorChave.set(chave, `${fmtData(de)} a ${fmtData(ate)}`);
    try {
      const lidas = await buscarJanela(de, ate);
      console.log(`  ${fmtData(de)} a ${fmtData(ate)}: ${lidas.length} sondagem-dia (bruto)`);
      resultadosPorMes.push({ chave, lidas });
    } catch (err) {
      // Um mês que falha não pode derrubar os outros nem apagar o que já
      // estava gravado -- não entrando em resultadosPorMes, ele nunca é
      // marcado como buscado, e mesclarProducao o preserva.
      console.warn(`  ${fmtData(de)} a ${fmtData(ate)}: FALHOU -- ${err.message}`);
      falhas.push(chave);
    }
  }

  // Todo o merge (quais meses autorizam descarte, o filtro por mês/corte e a
  // costura com o CSV anterior) mora em mesclarProducao, puro e coberto por
  // teste -- ver a nota na definição dela.
  const {
    linhasSaida, linhasNovas, mesesVazios, diasPreservados, totalBruto,
  } = mesclarProducao({ resultadosPorMes, jaTemos, diaFim });

  // ANTES do guard de "nada veio", de propósito: se TODOS os meses voltarem
  // vazios, 'totalBruto' é 0 e o throw abaixo dispara -- e é exatamente aí que
  // saber QUAIS meses vieram vazios mais importa. Emitir depois do throw
  // deixaria o operador só com a mensagem genérica no cenário que este guard
  // existe para proteger (o de 2026-08-08, cabeçalho com espaço duplo).
  for (const chave of mesesVazios) {
    console.warn(`  ${janelaPorChave.get(chave) || chave}: ZERO linha -- o mês NÃO será regravado (o dado anterior dele fica intacto).`);
  }

  if (!totalBruto) {
    throw new Error('Nenhuma linha encontrada no Link 7 -- abortando sem gravar (sessao expirada, ou período sem nenhuma sondagem -- confira antes de aceitar um CSV vazio).');
  }

  // O filtro por mês buscado + corte que mesclarProducao aplica existe porque
  // o de/ate do site NÃO restringe "Data / Hora Primeira Foto" ao intervalo
  // pedido -- achado ao vivo em 2026-08-09: uma busca de 01/08-31/08 devolveu
  // sessões de foto genuínas desde 25/06 (OS aberta há semanas, ainda ativa em
  // agosto, mas com sessões antigas incluídas na resposta). Cada linha tem data
  // PRÓPRIA e correta (confirmado: a mesma OS aparece várias vezes, cada uma
  // com timestamp distinto -- não é um resumo por OS); o problema é só que a
  // resposta não fica contida no mês pedido. Sem o filtro, equipesPeriodo
  // (calculado a partir do dia MAIS ANTIGO no CSV, ver parseEquipesFracaoCsv em
  // build-dashboard.js) sairia com o mês errado (ex.: junho em vez de agosto), e
  // o mês REAL seria tratado como "fora da cobertura" pelo Balanço --
  // silenciosamente sem dado, mesmo o CSV tendo dado bom.
  const foraDoIntervalo = totalBruto - linhasNovas.length;
  if (foraDoIntervalo > 0) {
    console.log(`  ${foraDoIntervalo} linha(s) fora do intervalo pedido (sessão de foto de OS antiga ainda ativa) -- descartadas, ficam ${linhasNovas.length}.`);
  }
  if (!linhasNovas.length) {
    throw new Error('Todas as linhas do Link 7 ficaram fora do intervalo depois do filtro -- abortando sem gravar (não é o caso normal, confira antes de aceitar um CSV vazio).');
  }

  console.log(`  ${linhasNovas.length} linha(s) de produção (equipe, dia, contrato) no período buscado.`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, [CABECALHO_PRODUCAO, ...linhasSaida].join('\n') + '\n', 'utf8');
  const diasNovos = new Set(linhasNovas.map((l) => l.diaEpoch)).size;
  if (falhas.length) console.warn(`${falhas.length} mês(es) falharam e ficaram como estavam: ${falhas.join(', ')}`);
  console.log(`Pronto: ${diasNovos} dia(s) novo(s) + ${diasPreservados} dia(s) preservado(s) do CSV anterior, gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
  parseLinhasLink7, lerCsvExistente, janelasMensais, mesesPendentes, mesclarProducao, mesDoDia, main,
  linhasRosterDoMes, lerRosterExistente, buscarRoster, gravarRoster,
  CABECALHO_ROSTER, CABECALHO_PRODUCAO, ultimaFotoEpochMinuto,
};
