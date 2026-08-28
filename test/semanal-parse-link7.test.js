'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLinhasLink7 } = require('../tools/semanal/atualizar-equipes-online.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

function linhaLink7Cru(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '16744-25',
    Tipo: 'SP',
    'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora Primeira Foto': '08/08/2026 07:54',
    'Data / Hora Última Foto': '08/08/2026 11:30',
    'ID Sondador': '3275',
  }, over);
}

// Equipes PRODUTIVAS (2026-08-09): direto do Link 7, ID Sondador como chave
// -- não precisa mais casar com o roster do Link 6 (o link por nome via
// "Líder" foi um ajuste temporário só cobria ~20%; a discussão de Equipes
// ATIVAS via roster fica pra depois, ver compute-equipes-fracao.js).
test('extrai idEquipe, sup, tipo e diaEpoch da data/hora da primeira foto', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  assert.strictEqual(linha.idEquipe, '3275');
  assert.strictEqual(linha.sup, 'SUP-7722-24');
  assert.strictEqual(linha.tipo, 'SP');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

// --- Última Foto -> ultimaFotoEpoch (2026-08-28) ----------------------------
// Decide, dentro do MESMO dia, qual das sessões (SUPs) de uma equipe foi a
// mais recente -- ver o design de 2026-08-28 e o comentário de
// CABECALHO_PRODUCAO em atualizar-equipes-online.js.

test('extrai ultimaFotoEpoch (minutos) da coluna "Data / Hora Última Foto", com HORÁRIO (não só o dia)', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  const esperado = Math.floor(Date.UTC(2026, 7, 8, 11, 30) / 60000);
  assert.strictEqual(linha.ultimaFotoEpoch, esperado);
});

test('duas linhas do MESMO dia com Última Foto em horários diferentes não empatam', () => {
  const [cedo, tarde] = parseLinhasLink7([
    linhaLink7Cru({ 'Contrato Financeiro': 'SUP-CEDO', 'Data / Hora Última Foto': '08/08/2026 08:00' }),
    linhaLink7Cru({ 'Contrato Financeiro': 'SUP-TARDE', 'Data / Hora Última Foto': '08/08/2026 17:45' }),
  ]);
  assert.strictEqual(cedo.diaEpoch, tarde.diaEpoch, 'pré-condição: os dois caem no mesmo dia');
  assert.ok(tarde.ultimaFotoEpoch > cedo.ultimaFotoEpoch, 'quem tirou foto mais tarde tem que ordenar depois');
});

test('sem "Data / Hora Última Foto" legível, ultimaFotoEpoch degrada pro início do dia da Primeira Foto -- não descarta a linha', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru({ 'Data / Hora Última Foto': '' })]);
  assert.ok(linha, 'a linha não pode ser descartada só por causa da Última Foto');
  assert.strictEqual(linha.ultimaFotoEpoch, linha.diaEpoch * 1440);
});

test('cabeçalho com espaço DUPLO ("Data / Hora  Última Foto") também é tolerado', () => {
  const linha = linhaLink7Cru();
  delete linha['Data / Hora Última Foto'];
  linha['Data / Hora  Última Foto'] = '08/08/2026 11:30';
  const [resultado] = parseLinhasLink7([linha]);
  const esperado = Math.floor(Date.UTC(2026, 7, 8, 11, 30) / 60000);
  assert.strictEqual(resultado.ultimaFotoEpoch, esperado);
});

// Achado ao vivo em 2026-08-28 (equipes 216/337 relatadas pelo dono do
// projeto): o cabeçalho REAL do site é "Data / Hora Ultima Foto" -- SEM
// acento no Ú, diferente da fixture original (com acento) e diferente de
// Primeira Foto (sem acento nenhuma letra, nunca expôs este bug). Sem
// normalizar o acento, a busca nunca batia, ultimaFotoEpoch caía SEMPRE no
// fallback (início do dia da Primeira Foto) em silêncio -- voltando a
// travar OS de sessão longa fora da janela de 3 dias, disfarçado de "sem
// Última Foto legível" quando na verdade a coluna respondia normalmente.
test('cabeçalho SEM acento ("Data / Hora Ultima Foto", como o site publica de verdade) é lido igual ao acentuado', () => {
  const linha = linhaLink7Cru();
  delete linha['Data / Hora Última Foto'];
  linha['Data / Hora Ultima Foto'] = '28/08/2026 10:24';
  const [resultado] = parseLinhasLink7([linha]);
  const esperado = Math.floor(Date.UTC(2026, 7, 28, 10, 24) / 60000);
  assert.strictEqual(resultado.ultimaFotoEpoch, esperado, 'sem a normalização de acento, isto degradaria pro fallback (início do dia) em silêncio');
});

// Achado rodando o pipeline de verdade em 2026-08-08: o cabeçalho REAL desta
// coluna no site tem espaço DUPLO ("Data / Hora  Primeira Foto"), diferente
// da fixture original acima (espaço simples) -- toda linha era descartada em
// silêncio (0 sondagem-dia, sem erro), porque o acesso por chave exata dava
// undefined. colunaTolerante ignora a variação de espaçamento.
test('cabeçalho real com espaço DUPLO ("Data / Hora  Primeira Foto") ainda é lido -- não fica preso ao espaçamento exato do site', () => {
  const linhaEspacoDuplo = {
    'Ordem de Serviço (OS)': '16744-25', Tipo: 'SP', 'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora  Primeira Foto': '08/08/2026 07:54', 'ID Sondador': '3275',
  };
  const [linha] = parseLinhasLink7([linhaEspacoDuplo]);
  assert.ok(linha, 'linha não deveria ter sido descartada');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

test('linha com data ilegível é descartada, não quebra', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru({ 'Data / Hora Primeira Foto': '' })]);
  assert.strictEqual(linhas.length, 0);
});

// Achado da revisão final de branch (2026-08-08): o Tipo do Link 7 é BRUTO
// (alfabeto de 21 rótulos da aba Avanços), não o rótulo de 10 tipologias da
// MATRIZ -- sem traduzir aqui, resolverSupConhecido nunca acha o par na
// MATRIZ e o Realizado de Equipes fica 0,0 pra essas tipologias, em
// silêncio. rotularTipologia (tools/comum/tipologias-avancos.js) é a MESMA
// tradução que parse-avancos.js já aplica.
test('Tipo bruto "SM" é traduzido pro rótulo da MATRIZ "SM / SM.F / SR"', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru({ Tipo: 'SM' })]);
  assert.strictEqual(linha.tipo, 'SM / SM.F / SR');
});

test('Tipo bruto "CPTU" é traduzido pro rótulo da MATRIZ "CPTu" (note a troca de maiúscula/minúscula)', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru({ Tipo: 'CPTU' })]);
  assert.strictEqual(linha.tipo, 'CPTu');
});

test('Tipo desconhecido lança erro (fail-loud) em vez de cair calado em algum balde', () => {
  assert.throws(() => parseLinhasLink7([linhaLink7Cru({ Tipo: 'ALGO-NUNCA-VISTO' })]), /Tipologia desconhecida/);
});

test('duas linhas da mesma OS+dia (múltiplas fotos) viram duas entradas -- a deduplicação de combinação acontece em compute-equipes-produtivas-link7.js, não aqui', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru(), linhaLink7Cru()]);
  assert.strictEqual(linhas.length, 2);
});

// --- renomeação de coluna na fonte (2026-08-10) ----------------------------
//
// O sond.com.br renomeou a coluna que identifica a equipe: o spec de
// 2026-08-08 registrou "ID Sondador", e dois dias depois a tabela veio com
// "Nº Equipe". O modo de falha foi o pior possível -- silencioso: toda linha
// saía com id vazio, agregarEquipesProdutivas descartava as 8.618 linhas por
// "sem id", o CSV era gravado só com cabeçalho, o fetcher relatava "119 dias
// novos" e o build caía na fonte de reserva sem avisar ninguém.

test('aceita a grafia NOVA "Nº Equipe"', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'Nº Equipe': '441', 'ID Sondador': undefined })])[0];
  assert.strictEqual(l.idEquipe, '441');
});

test('aceita a grafia ANTIGA "ID Sondador" -- a fonte pode voltar atrás', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '3275' })])[0];
  assert.strictEqual(l.idEquipe, '3275');
});

test('sem NENHUMA das grafias, LANÇA citando as colunas recebidas -- nunca devolve lista vazia em silêncio', () => {
  const semColuna = linhaLink7Cru();
  delete semColuna['ID Sondador'];
  assert.throws(() => parseLinhasLink7([semColuna]), /Nenhuma coluna de identificação de equipe/);
  assert.throws(() => parseLinhasLink7([semColuna]), /Contrato Financeiro/, 'a mensagem lista o que chegou, pra dar o nome novo de graça');
});

test('a checagem de coluna não confunde valor VAZIO com coluna AUSENTE', () => {
  // Coluna presente e vazia é dado ruim de uma linha só -- a linha é
  // ignorada pelo agregador, mas não derruba o fetch inteiro.
  const vazia = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '' })]);
  assert.strictEqual(vazia.length, 1);
  assert.strictEqual(vazia[0].idEquipe, '');
});

// --- fallback por nome quando não há Nº Equipe (2026-08-10) ----------------
//
// Medido em 3 meses do Link 7: de 10 a 48 linhas por mês têm "Nº Equipe"
// vazio e "Sondador" preenchido, e eram descartadas em silêncio pelo
// agregador. Verificado em julho e maio/2026 que nenhum desses sondadores
// aparece TAMBÉM com número no mesmo dia (0 de 25 e 0 de 48), então agrupar
// pelo nome recupera o dado sem contar ninguém duas vezes.

test('sem Nº Equipe, agrupa pelo NOME do sondador (com prefixo, pra não colidir com número)', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '', Sondador: 'Ana Silva' })])[0];
  assert.strictEqual(l.idEquipe, 'nome:Ana Silva');
});

test('com Nº Equipe, o número ganha do nome -- o nome é só fallback', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '441', Sondador: 'Ana Silva' })])[0];
  assert.strictEqual(l.idEquipe, '441');
});

test('o prefixo impede que um sondador chamado "441" se confunda com a equipe 441', () => {
  const porNome = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '', Sondador: '441' })])[0];
  const porNumero = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '441' })])[0];
  assert.notStrictEqual(porNome.idEquipe, porNumero.idEquipe);
});

test('sem Nº Equipe E sem Sondador, a chave fica vazia -- o agregador descarta, e o fetcher avisa', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '', Sondador: '' })])[0];
  assert.strictEqual(l.idEquipe, '');
});
