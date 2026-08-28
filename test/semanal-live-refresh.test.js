'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { atualizarDadosAoVivo, URLS_PADRAO, RE_URL_PENDENTE } = require('../tools/semanal/live-refresh.js');
// Revisão da Task 1 (Important #2): "nenhum teste exercita caminho positivo
// de campo derivado" -- os módulos reais (não dublês) pra provar que o
// cruzamento REALIZADO e o cálculo de equipesNaoProdutivas de fato rodam
// quando injetados via config.modulos, não só que são pulados quando
// ausentes (o que os outros testes deste arquivo já cobrem).
const ComputeEquipesRealizadoAlocadoReal = require('../tools/semanal/compute-equipes-realizado-alocado.js');
const ComputeEquipesNaoProdutivasReal = require('../tools/semanal/compute-equipes-nao-produtivas.js');

// Task 1 (2026-08-25): live-refresh.js é a fonte única do que hoje existe
// DUPLICADO em render-semanal.js e render-alocacao-pagina.js
// (atualizarDadosAoVivoSemanal, ~300 linhas byte-idênticas exceto duas
// divergências). Esta suíte testa só o MÓDULO, com fetch dublê e
// estadoAtual/aplicar/definirStatus dublês passados via config -- nada aqui
// toca DOM de verdade, porque o módulo em si não toca (definirStatus é
// injetado pela página que o chama).

// --- fixtures mínimas --------------------------------------------------

// Mesmo layout de colunas que test/semanal-alocacao-pagina-wireup.test.js já
// usa e prova funcionar contra parseMatrizCliente/parseCsvGrid de verdade.
function csvMatrizComSup(sup) {
  return 'ORIGEM,GRUPO,TOMADOR,SUP,ESCOPO,APOIO,INICIO,TERMINO,SONDAGEM,BASE,'
    + Array(12).fill('mes').join(',') + ',PICO,MÉDIA,PROD.,DIAS,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,TICKET,'
    + Array(12).fill('mes').join(',') + ',TOTAL,TOTAL INICIAL,OBS\n'
    + `Origem-B,Grupo-B,Tomador-Novo,${sup},Escopo,Apoio,01/2026,12/2026,ST,P,`
    + Array(12).fill('0').join(',') + ',2,2,8,25,'
    + Array(12).fill('0').join(',') + ',100,100,9999,'
    + Array(12).fill('0').join(',') + ',100,100,\n'
    + ',,,,,,,,,T,'
    + Array(12).fill('0').join(',') + ',0,0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,0,'
    + Array(12).fill('0').join(',') + ',0,0,\n';
}
const CSV_AVANCOS_VAZIO = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador\n';
const CSV_LAB_VAZIO = 'ID Contrato,Ensaiado Dia,Tipo de Ensaio,Data Programada\n';

// CSV mínimo da aba EQ com cabeçalho de um único dia (01/08/2026) -- é o que
// mesDaAbaEq reconhece como período {ano:2026, mes:8}. Mesmo formato de
// test/semanal-alocacao-pagina-wireup.test.js (csvEqComOs).
function csvEqComTextoDia(textoDoDia) {
  return [
    'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda,Tomador,sinalização 3P,01/08/2026',
    ',,do condutor,-,-,-,-,-,-,-,-,-,-,-,,SÁBADO',
    '4,José I. Amaral,D,ST,Amaral,-,-,N/A,N/A,N/A,N/A,N/A,,CCR RioSP,,' + textoDoDia,
  ].join('\n');
}
function csvEqComPeriodo() {
  return csvEqComTextoDia('CCR RioSP (16925-25)');
}
// Mesma conta que classificar-dia-equipe.js/compute-equipes-nao-produtivas.js
// usam pra chavear porDiaPorMotivo -- dia local (ano, mesIndice0, dia) -> epoch.
function diaEpochUtc(ano, mesIndice0, dia) {
  return Math.floor(Date.UTC(ano, mesIndice0, dia) / 86400000);
}

// --- fetch dublê ---------------------------------------------------------

// respostasPorUrl: { trechoDaUrl: () => Promise<respostaFetch> }. Qualquer
// URL não reconhecida rejeita alto (mesmo padrão dos outros arquivos de
// teste desta suíte) -- uma fonte pedida sem rota cadastrada é sempre um
// erro de configuração do teste, nunca um "sucesso silencioso".
function criarFetchDouble(respostasPorUrl) {
  const chamadas = [];
  const fn = function (url) {
    chamadas.push(url);
    const chave = Object.keys(respostasPorUrl).find((k) => String(url).indexOf(k) !== -1);
    if (chave) return respostasPorUrl[chave]();
    return Promise.reject(new Error('fetch inesperado neste teste: ' + url));
  };
  fn.chamadas = chamadas;
  return fn;
}
function respostaCsvOk(texto) {
  return () => Promise.resolve({ ok: true, text: () => Promise.resolve(texto) });
}
function respostaJsonOk(valor) {
  return () => Promise.resolve({ ok: true, json: () => Promise.resolve(valor) });
}
function respostaErroHttp(status) {
  return () => Promise.resolve({ ok: false, status: status || 500 });
}
function respostaRedeFoiRejeitada(mensagem) {
  return () => Promise.reject(new Error(mensagem || 'rede fora do ar (simulado)'));
}

// Troca global.fetch pelo dublê só durante fn(), e restaura depois -- os
// testes deste arquivo rodam no mesmo processo (node --test), então sem isso
// um dublê vazaria para o teste seguinte.
async function comFetch(fetchDouble, fn) {
  const original = global.fetch;
  global.fetch = fetchDouble;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

// --- config dublê ----------------------------------------------------------

const URL_MATRIZ = 'https://fake.exemplo/matriz-csv';
const URL_AVANCOS = 'avancos-fake.csv';
const URL_LAB = 'lab-fake.csv';
const URL_EQ = 'https://fake.exemplo/eq-csv';
const URL_PRODUCAO = 'producao-fake.csv';
const URL_ROSTER = 'roster-fake.csv';
const URL_PESSOAS = 'https://fake.exemplo/pessoas-csv';

// demandasBase: o "estado anterior" que estadoAtual() devolve -- cada campo
// tem um valor SENTINELA fácil de distinguir do que o refresh calcularia de
// novo, para provar preservação vs. sobrescrita sem ambiguidade.
function demandasBase(overrides) {
  return Object.assign({
    equipesPorDia: { SENTINELA: { 100: 1 } },
    equipesPeriodo: { ano: 2020, mes: 1 },
    equipesCsv: 'CSV-ANTIGO-SENTINELA',
    osParaSup: { OS_ANTIGA: 'SUP-ANTIGA' },
    equipesRosterPeriodo: { ano: 2020, mes: 1 },
    pessoasCsv: 'PESSOAS-CSV-ANTIGO-SENTINELA',
  }, overrides || {});
}

// Monta uma config completa com defaults sãos, sobrescrita por `overrides`
// (merge raso em fontes/modulos, o resto substituído direto). Devolve
// também os "espiões" (aplicarChamado/resultado/status) para os testes
// inspecionarem depois de await.
function configDublada(overrides) {
  const o = overrides || {};
  const estado = { registros: [], demandas: demandasBase(o.demandasAnteriores) };
  const espiao = { aplicarChamado: false, registrosAplicados: null, demandasAplicadas: null, statusChamadas: [] };

  const cfg = {
    fontes: Object.assign({
      matriz: URL_MATRIZ, avancos: null, lab: null, eq: null,
      producao: null, roster: null, demandasSondagem: null, demandasLab: null, pessoas: null,
    }, o.fontes || {}),
    modulos: Object.assign({}, o.modulos || {}),
    ano: 2026,
    rosterAlocacao: o.rosterAlocacao,
    estadoAtual: () => estado,
    aplicar: (registrosNovos, demandasNovas) => {
      espiao.aplicarChamado = true;
      espiao.registrosAplicados = registrosNovos;
      espiao.demandasAplicadas = demandasNovas;
    },
    definirStatus: (texto, ehErro) => { espiao.statusChamadas.push({ texto, ehErro }); },
  };
  return { cfg, espiao, estado };
}

// --- Cenário 1: matriz falhando rejeita e NÃO chama aplicar (atomicidade) --

test('fontes.matriz falhando rejeita o refresh inteiro -- aplicar NUNCA é chamado', async () => {
  const { cfg, espiao } = configDublada({ fontes: { matriz: URL_MATRIZ } });
  const fetchDouble = criarFetchDouble({ [URL_MATRIZ]: respostaErroHttp(500) });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, false, 'MATRIZ é a única fonte sem .catch -- sua falha tem que derrubar o refresh inteiro');
  const ultimoStatus = espiao.statusChamadas[espiao.statusChamadas.length - 1];
  assert.strictEqual(ultimoStatus.ehErro, true);
  assert.match(ultimoStatus.texto, /Falha ao atualizar/);
});

// --- Cenário 2: fontes.eq falhando NÃO derruba o refresh -------------------

test('fontes.eq falhando NÃO derruba o refresh -- aplicar é chamado mesmo assim', async () => {
  const { cfg, espiao } = configDublada({ fontes: { matriz: URL_MATRIZ, eq: URL_EQ } });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_EQ]: respostaRedeFoiRejeitada('Sheet EQ fora do ar (simulado)'),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true, 'eq tem .catch(() => null) -- sua falha não pode derrubar as outras fontes');
  assert.strictEqual(espiao.registrosAplicados.length, 1);
});

// --- Cenário 3 (prova do M-5): fonte omitida não é buscada -----------------

test('fonte omitida (producao: null) NÃO é buscada -- o dublê de fetch nunca recebe aquela URL', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, producao: null },
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    // Nenhuma rota para URL_PRODUCAO -- se o gate `fontes.producao &&`
    // faltasse, buscarCsv(null) chamaria fetch com uma URL que começa com
    // "null" (null + '?_=...'), e o catch-all acima rejeitaria alto.
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true, 'pré-condição: o refresh tem que ter concluído com sucesso');
  assert.strictEqual(fetchDouble.chamadas.length, 3, 'só matriz+avancos+lab podem ter sido buscados -- producao/eq/roster/demandasSondagem/demandasLab estão todos omitidos');
  assert.ok(!fetchDouble.chamadas.some((u) => String(u).indexOf('null') !== -1), 'nenhuma URL derivada de null pode ter sido pedida');
  assert.ok(!fetchDouble.chamadas.some((u) => String(u).indexOf('producao') !== -1), 'a URL de produção nunca foi buscada');
});

// --- Cenário 4: sem ComputeEquipesRealizadoAlocado, equipesPorDia preserva --

test('sem modulos.ComputeEquipesRealizadoAlocado, equipesPorDia preserva o valor anterior e nenhum cruzamento é tentado', async () => {
  const sentinelaAntiga = { SUP_X: { 12345: 3 } };
  const { cfg, espiao } = configDublada({
    fontes: {
      matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB,
      producao: URL_PRODUCAO, roster: URL_ROSTER,
    },
    modulos: {}, // ComputeEquipesRealizadoAlocado ausente de propósito
    demandasAnteriores: { equipesPorDia: sentinelaAntiga },
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    // Roster/produção RESPONDEM (com CSVs mínimos válidos) -- a prova real
    // é que mesmo com os dois textos presentes, sem o módulo o cruzamento
    // não é tentado (que lançaria TypeError e derrubaria o refresh inteiro,
    // já que modulos.ComputeEquipesRealizadoAlocado é undefined).
    [URL_PRODUCAO]: respostaCsvOk('IdEquipe,SUP,Tipo,DiaEpoch\nE1,SUP-0001-24,ST,19000\n'),
    [URL_ROSTER]: respostaCsvOk('IdEquipe,DiaEpoch,Estado\nE1,19000,ativa\n'),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true, 'sem o módulo, o refresh não pode lançar -- só pular o cruzamento');
  assert.deepStrictEqual(espiao.demandasAplicadas.equipesPorDia, sentinelaAntiga, 'equipesPorDia tem que ficar EXATAMENTE como estava, nenhum cruzamento tentado');
});

// --- Cenário 5: sem ComputeEquipesNaoProdutivas, equipesNaoProdutivas some --

test('sem modulos.ComputeEquipesNaoProdutivas, equipesNaoProdutivas não é calculado', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ },
    modulos: {}, // ComputeEquipesNaoProdutivas ausente de propósito
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    // csvEq responde com um período válido -- se o gate do módulo faltasse,
    // agregarEquipesNaoProdutivas seria chamado em modulos.ComputeEquipesNaoProdutivas
    // undefined e lançaria TypeError, derrubando o refresh inteiro.
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true, 'sem o módulo, o refresh não pode lançar -- só pular o cálculo');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(espiao.demandasAplicadas, 'equipesNaoProdutivas'), false, 'equipesNaoProdutivas não pode aparecer no resultado');
});

// --- Reforço (revisão da Task 1, Important #2): caminho POSITIVO dos dois
// módulos opcionais, com as implementações REAIS injetadas (não dublês) --
// os cenários 4/5 acima só provam que faltando o módulo nada quebra; isto
// prova que, presente, o cruzamento roda de verdade e produz o valor certo,
// incluindo o redirecionamento resolverSupConhecido -> "Diversos" que só
// aparece quando o cruzamento realmente executa.

test('com os módulos reais injetados, equipesPorDia é recomputado via REALIZADO (com redirecionamento pra Diversos) e equipesNaoProdutivas é calculado', async () => {
  const diaEpochProducao = diaEpochUtc(2026, 7, 10); // 10/08/2026, mesIndice0=7 (agosto)
  const csvRoster = 'IdEquipe,DiaEpoch,Estado\nE1,' + diaEpochProducao + ',mobilizada\n';
  // SUP-DESCONHECIDA não existe nos registros da MATRIZ (só SUP-0001-24) --
  // ativaNaDefinicaoNova (compute-equipes-realizado-alocado.js:28-29) exige
  // estado 'mobilizada' ou 'campoSemFuro'; 'ativa' (que não é nenhum dos
  // dois) faria porDia sair vazio e o teste passaria sem exercitar nada --
  // a armadilha que a revisão já sinalizou.
  const csvProducao = 'IdEquipe,SUP,Tipo,DiaEpoch\nE1,SUP-DESCONHECIDA,ST,' + diaEpochProducao + '\n';
  // 'Chuva' casa a exceção catalogada 'campoSemFuro' (classificar-dia-
  // equipe.js) -- não some no default nem vira 'fora'.
  const csvEqComChuva = csvEqComTextoDia('Chuva');

  const { cfg, espiao } = configDublada({
    fontes: {
      matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB,
      eq: URL_EQ, producao: URL_PRODUCAO, roster: URL_ROSTER,
    },
    modulos: {
      ComputeEquipesRealizadoAlocado: ComputeEquipesRealizadoAlocadoReal,
      ComputeEquipesNaoProdutivas: ComputeEquipesNaoProdutivasReal,
    },
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComChuva),
    [URL_PRODUCAO]: respostaCsvOk(csvProducao),
    [URL_ROSTER]: respostaCsvOk(csvRoster),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);

  // equipesPorDia: a equipe E1 ficou mobilizada em SUP-DESCONHECIDA/ST, que
  // a MATRIZ não conhece -- resolverSupConhecido tem que redirecionar pra
  // "Diversos", não deixar a chave crua nem descartar a fração.
  assert.deepStrictEqual(espiao.demandasAplicadas.equipesPorDia, {
    'Diversos||ST': { [diaEpochProducao]: 1 },
  }, 'equipesPorDia precisa vir do cruzamento REALIZADO de verdade, com o par desconhecido redirecionado pra Diversos');
  assert.strictEqual(espiao.demandasAplicadas.equipesPeriodo, null, 'roster cobre múltiplos meses -- equipesPeriodo fica null quando REALIZADO decide');

  // equipesNaoProdutivas: 'Chuva' no dia 01/08/2026 -- 1 campoSemFuro, 0 fora.
  const diaEpochChuva = diaEpochUtc(2026, 7, 1);
  assert.deepStrictEqual(espiao.demandasAplicadas.equipesNaoProdutivas, {
    [diaEpochChuva]: { campoSemFuro: 1, fora: 0 },
  }, 'equipesNaoProdutivas precisa vir do módulo real, calculado a partir do mesmo csvEq');
});

// --- Cenário 6: rosterAlocacao true -- os 3 campos preservam/sobrescrevem --

test('rosterAlocacao: true -- os 3 campos são PRESERVADOS quando eq falha', async () => {
  const anteriores = {
    equipesCsv: 'CSV-ANTIGO-SENTINELA', osParaSup: { OS_ANTIGA: 'SUP-ANTIGA' }, equipesRosterPeriodo: { ano: 2020, mes: 1 },
  };
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaRedeFoiRejeitada('Sheet EQ fora do ar (simulado)'),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.equipesCsv, anteriores.equipesCsv);
  assert.deepStrictEqual(espiao.demandasAplicadas.osParaSup, anteriores.osParaSup);
  assert.deepStrictEqual(espiao.demandasAplicadas.equipesRosterPeriodo, anteriores.equipesRosterPeriodo);
});

test('rosterAlocacao: true -- os 3 campos são SOBRESCRITOS quando eq responde', async () => {
  const anteriores = {
    equipesCsv: 'CSV-ANTIGO-SENTINELA', osParaSup: { OS_ANTIGA: 'SUP-ANTIGA' }, equipesRosterPeriodo: { ano: 2020, mes: 1 },
  };
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const csvEqNovo = csvEqComPeriodo();
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqNovo),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.equipesCsv, csvEqNovo, 'eq respondeu -- equipesCsv tem que ser o CSV NOVO, não o antigo');
  assert.notStrictEqual(espiao.demandasAplicadas.equipesCsv, anteriores.equipesCsv);
  assert.deepStrictEqual(espiao.demandasAplicadas.equipesRosterPeriodo, { ano: 2026, mes: 8 });
  assert.notDeepStrictEqual(espiao.demandasAplicadas.equipesRosterPeriodo, anteriores.equipesRosterPeriodo);
});

// --- Cenário 6b: pessoasCsv (filtro de ativas) -- mesma preserva/sobrescreve
// dos 3 campos acima, testado à parte porque tem fonte própria (pessoas) e
// RE_URL_PENDENTE tem que ser respeitado (ver o comentário do bug 2026-08-28
// em live-refresh.js: sem preservar, o filtro de ATV=FALSE morria a cada
// clique em "Atualizar dados").

test('rosterAlocacao: true -- pessoasCsv é PRESERVADO quando fontes.pessoas é null (fonte ainda não publicada)', async () => {
  const anteriores = demandasBase();
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ, pessoas: null },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.pessoasCsv, anteriores.pessoasCsv);
});

test('rosterAlocacao: true -- pessoasCsv é PRESERVADO quando fontes.pessoas ainda é PENDENTE- (placeholder, sem publicar)', async () => {
  const anteriores = demandasBase();
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ, pessoas: 'PENDENTE-PUBLICAR-PESSOAS' },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.pessoasCsv, anteriores.pessoasCsv);
  assert.strictEqual(fetchDouble.chamadas.some((u) => String(u).indexOf('pessoas-csv') !== -1), false, 'PENDENTE- não pode nem tentar o fetch');
});

test('rosterAlocacao: true -- pessoasCsv é PRESERVADO quando fontes.pessoas responde mas falha (rede fora do ar)', async () => {
  const anteriores = demandasBase();
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ, pessoas: URL_PESSOAS },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
    [URL_PESSOAS]: respostaRedeFoiRejeitada('Sheet PESSOAS fora do ar (simulado)'),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.pessoasCsv, anteriores.pessoasCsv);
});

test('rosterAlocacao: true -- pessoasCsv é SOBRESCRITO quando fontes.pessoas responde com sucesso', async () => {
  const anteriores = demandasBase();
  const csvPessoasNovo = 'ID,Nome,ATV\n4,José I. Amaral,TRUE\n';
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ, pessoas: URL_PESSOAS },
    rosterAlocacao: true,
    demandasAnteriores: anteriores,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
    [URL_PESSOAS]: respostaCsvOk(csvPessoasNovo),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(espiao.demandasAplicadas.pessoasCsv, csvPessoasNovo, 'pessoas respondeu -- pessoasCsv tem que ser o CSV NOVO, não o antigo');
  assert.notStrictEqual(espiao.demandasAplicadas.pessoasCsv, anteriores.pessoasCsv);
});

test('rosterAlocacao ausente -- pessoasCsv não aparece no resultado, mesmo com fontes.pessoas respondendo', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ, pessoas: URL_PESSOAS },
    // rosterAlocacao NÃO passado (undefined)
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
    [URL_PESSOAS]: respostaCsvOk('ID,Nome,ATV\n4,José I. Amaral,TRUE\n'),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual('pessoasCsv' in espiao.demandasAplicadas, false);
});

// --- Cenário 7: rosterAlocacao ausente/false -- os 3 campos NÃO aparecem ---

test('rosterAlocacao ausente -- os 3 campos da Alocação não aparecem no resultado', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ },
    // rosterAlocacao NÃO passado (undefined)
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  ['equipesCsv', 'osParaSup', 'equipesRosterPeriodo'].forEach((campo) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(espiao.demandasAplicadas, campo), false, campo + ' não pode aparecer quando rosterAlocacao não está ligado');
  });
});

test('rosterAlocacao: false (explícito) -- mesmo resultado que ausente', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB, eq: URL_EQ },
    rosterAlocacao: false,
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_EQ]: respostaCsvOk(csvEqComPeriodo()),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  ['equipesCsv', 'osParaSup', 'equipesRosterPeriodo'].forEach((campo) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(espiao.demandasAplicadas, campo), false);
  });
});

// --- Cobertura extra: RE_URL_PENDENTE e URLS_PADRAO -------------------------
// Não pedidos como cenário próprio no brief, mas atualizarDadosAoVivo os
// usa por dentro (avancosLabConfigurados) e o módulo os EXPORTA -- testar a
// forma exportada evita regressão silenciosa se um dia alguém alterar sem
// perceber que quebra o "avancosLabConfigurados" das duas páginas.

test('URLS_PADRAO exporta as 9 fontes com os mesmos nomes que config.fontes espera', () => {
  ['matriz', 'avancos', 'lab', 'eq', 'producao', 'roster', 'demandasSondagem', 'demandasLab', 'pessoas'].forEach((chave) => {
    assert.strictEqual(typeof URLS_PADRAO[chave], 'string', 'URLS_PADRAO.' + chave + ' precisa ser uma URL string');
  });
});

test('URLS_PADRAO.pessoas ainda é o placeholder PENDENTE- -- lembrete pra trocar depois que a aba PESSOAS for publicada', () => {
  assert.strictEqual(RE_URL_PENDENTE.test(URLS_PADRAO.pessoas), true);
});

test('RE_URL_PENDENTE reconhece o placeholder PENDENTE- e nada além dele', () => {
  assert.strictEqual(RE_URL_PENDENTE.test('PENDENTE-lab-nao-publicado'), true);
  assert.strictEqual(RE_URL_PENDENTE.test('lab-online.csv'), false);
  assert.strictEqual(RE_URL_PENDENTE.test('avancos-online.csv'), false);
});

test('avancos/lab pendente (RE_URL_PENDENTE) degrada com graça -- refresh atualiza só a MATRIZ', async () => {
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: 'PENDENTE-avancos', lab: 'PENDENTE-lab' },
  });
  const fetchDouble = criarFetchDouble({ [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')) });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.strictEqual(fetchDouble.chamadas.length, 1, 'com avancos/lab pendentes, nenhuma outra fonte pode ser buscada');
  const ultimoStatus = espiao.statusChamadas[espiao.statusChamadas.length - 1];
  assert.match(ultimoStatus.texto, /só MATRIZ/);
});

// demandasLab é JSON puro (fetch().then(r => r.json())), sem cache-busting
// -- diferente das outras fontes, que passam por buscarCsv (?_=timestamp).
test('demandasLab é buscado como JSON, sem cache-busting, e sem ele nenhum erro é lançado', async () => {
  const URL_DEMANDAS_LAB = 'demandas-lab-fake.json';
  const { cfg, espiao } = configDublada({
    fontes: {
      matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB,
      demandasLab: URL_DEMANDAS_LAB,
    },
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_VAZIO),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
    [URL_DEMANDAS_LAB]: respostaJsonOk([{ sup: 'SUP-0001-24', tipologia: 'ST', criacao: '2026-08-01T00:00:00.000Z' }]),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  const urlDemandasLabChamada = fetchDouble.chamadas.find((u) => String(u).indexOf(URL_DEMANDAS_LAB) !== -1);
  assert.ok(urlDemandasLabChamada, 'demandasLab precisa ter sido buscado');
  assert.strictEqual(urlDemandasLabChamada, URL_DEMANDAS_LAB, 'demandasLab NÃO leva cache-busting (?_=...), ao contrário das fontes CSV');
});

// --- Cenário 9 (Task 6, 2026-08-26): coordenadas por SUP recalculadas ------
// "Atualizar dados" não pode apagar/deixar velho demandas.coordenadasPorSup
// que o build já tinha calculado (Task 5) -- tem que recalcular a partir do
// CSV FRESCO de avanços, mesma leitura (HEADER_SAIDA de 12 colunas, Task 4:
// as 10 de sempre + Latitude/Longitude opcionais) que
// build-dashboard.js usa.

test('atualizarDadosAoVivo recalcula demandas.coordenadasPorSup a partir do CSV fresco de avancos', async () => {
  const CSV_AVANCOS_COM_COORDENADA = 'Contrato,Criação da OS,Tipo,Status,Executado Dia,Deslocamento,Total (m),Observações de Campo,OS,Sondador,Latitude,Longitude\n'
    + 'SUP-0001-24,01/08/2026,ST,CONCLUIDO,01/08/2026,Não,10,,12345,Fulano,-23.55,-46.63\n';
  const { cfg, espiao } = configDublada({
    fontes: { matriz: URL_MATRIZ, avancos: URL_AVANCOS, lab: URL_LAB },
  });
  const fetchDouble = criarFetchDouble({
    [URL_MATRIZ]: respostaCsvOk(csvMatrizComSup('SUP-0001-24')),
    [URL_AVANCOS]: respostaCsvOk(CSV_AVANCOS_COM_COORDENADA),
    [URL_LAB]: respostaCsvOk(CSV_LAB_VAZIO),
  });

  await comFetch(fetchDouble, () => atualizarDadosAoVivo(cfg));

  assert.strictEqual(espiao.aplicarChamado, true);
  assert.deepStrictEqual(espiao.demandasAplicadas.coordenadasPorSup, {
    'SUP-0001-24': { lat: -23.55, lon: -46.63 },
  }, 'coordenadasPorSup precisa vir do resolvedor real, aplicado sobre o grid FRESCO de avanços');
});
