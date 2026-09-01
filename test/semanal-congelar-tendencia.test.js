'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calcularSnapshotSemanaAlvo, chaveSemanaSeguinteDeSexta, gravarSnapshotNoArquivo, descartarEscritaNaoCommitada, proximaSegunda, fragmentosDaSemanaAlvo } = require('../tools/semanal/congelar-tendencia-semanal.js');

// Sexta 2026-09-04 -> a semana seguinte começa segunda 2026-09-07.
test('chaveSemanaSeguinteDeSexta acha a segunda seguinte à sexta em epoch de dias', () => {
  const sexta = Date.UTC(2026, 8, 4) / 86400000; // 2026-09-04, epoch de DIAS (UTC)
  const chave = chaveSemanaSeguinteDeSexta(sexta);
  assert.equal(chave, '2026-09-07');
});

test('chaveSemanaSeguinteDeSexta funciona também rodado num sábado/domingo (job atrasado)', () => {
  const sabado = Date.UTC(2026, 8, 5) / 86400000; // 2026-09-05
  assert.equal(chaveSemanaSeguinteDeSexta(sabado), '2026-09-07');
});

// 2026-08-28 é uma SEXTA. A semana seguinte começa em 2026-08-31.
// 2026-08-31 é uma SEGUNDA. A semana seguinte a ela começa em 2026-09-07.
test('proximaSegunda devolve sempre a segunda ESTRITAMENTE depois de hoje', () => {
  const dia = (ano, mes1, d) => Date.UTC(ano, mes1 - 1, d) / 86400000;
  assert.equal(proximaSegunda(dia(2026, 8, 28)), '2026-08-31'); // sexta
  assert.equal(proximaSegunda(dia(2026, 8, 29)), '2026-08-31'); // sábado
  assert.equal(proximaSegunda(dia(2026, 8, 30)), '2026-08-31'); // domingo
  assert.equal(proximaSegunda(dia(2026, 8, 31)), '2026-09-07'); // SEGUNDA -> a seguinte
  assert.equal(proximaSegunda(dia(2026, 9, 1)), '2026-09-07');  // terça
  assert.equal(proximaSegunda(dia(2026, 9, 2)), '2026-09-07');  // quarta
  assert.equal(proximaSegunda(dia(2026, 9, 3)), '2026-09-07');  // quinta
});

test('calcularSnapshotSemanaAlvo emite uma linha por (fragmento x registro), com as 4 tendencias', () => {
  const registros = [
    { sup: 'SUP-1', tipologia: 'SP', tomador: 'X',
      previsto: { volume: Array(12).fill(100) }, total: { equipes: Array(12).fill(2) } },
  ];
  const demandas = { porRegistroEventos: {} };
  const hojeEpoch = Date.UTC(2026, 7, 28) / 86400000; // sexta 28/08
  const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, '2026-08-31');

  assert.equal(snapshot.chaveSegunda, '2026-08-31');
  // 1 registro x 2 fragmentos (31/08 e 01/09) = 2 linhas.
  assert.equal(snapshot.linhas.length, 2);
  assert.deepEqual(snapshot.linhas.map((l) => l.chave).sort(), ['2026-08-31', '2026-09-01']);
  snapshot.linhas.forEach((linha) => {
    assert.equal(linha.chaveMatriz, 'SUP-1||SP');
    assert.equal(typeof linha.volume, 'number');
    assert.equal(typeof linha.equipe, 'number');
    assert.equal(linha.produtividadeMedia, linha.volume / linha.equipe);
  });
});

test('calcularSnapshotSemanaAlvo devolve produtividadeMedia null quando equipe e 0', () => {
  const registros = [
    { sup: 'SUP-2', tipologia: 'ST', tomador: 'Y',
      previsto: { volume: Array(12).fill(50) }, total: { equipes: Array(12).fill(0) } },
  ];
  const hojeEpoch = Date.UTC(2026, 8, 4) / 86400000; // sexta 04/09
  const snapshot = calcularSnapshotSemanaAlvo(registros, { porRegistroEventos: {} }, hojeEpoch, '2026-09-07');
  assert.equal(snapshot.linhas[0].produtividadeMedia, null);
});

test('gravarSnapshotNoArquivo cria o arquivo na 1a chamada e mescla na 2a, sem apagar semanas antigas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');

  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-08-31', geradoEmIso: '2026-08-28T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 10 } } },
  });
  gravarSnapshotNoArquivo(caminho, {
    chaveSemanaAlvo: '2026-09-07', geradoEmIso: '2026-09-04T22:00:00.000Z',
    porRegistro: { 'SUP-1|SP': { volume: { tendencia: 20 } } },
  });

  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.ok(conteudo['2026-08-31'], 'semana anterior preservada');
  assert.ok(conteudo['2026-09-07'], 'semana nova presente');
  assert.equal(conteudo['2026-09-07'].porRegistro['SUP-1|SP'].volume.tendencia, 20);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('gravarSnapshotNoArquivo SOBRESCREVE a mesma semana-alvo (job rodou 2x no mesmo dia)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'tendencia-congelada-semanal.json');
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'a', porRegistro: { X: { volume: { tendencia: 1 } } } });
  gravarSnapshotNoArquivo(caminho, { chaveSemanaAlvo: '2026-09-07', geradoEmIso: 'b', porRegistro: { X: { volume: { tendencia: 2 } } } });
  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  assert.equal(Object.keys(conteudo).length, 1);
  assert.equal(conteudo['2026-09-07'].porRegistro.X.volume.tendencia, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Cobre a corrida perdida: precisaRodarHoje() dá true na 1a checagem
// (então o job escreve snapshot+heartbeat), mas false na 2a (outra máquina
// venceu enquanto isso). O achado da revisão foi que essa escrita não
// committed ficava suja no working tree para o 'stash pop' do finally
// rodar por cima. Aqui isolamos a função de limpeza (não o main() inteiro,
// que precisaria mockar git fetch/stash/commit/push de ponta a ponta) --
// prova que ela restaura CADA um dos dois arquivos ao estado anterior.
test('descartarEscritaNaoCommitada remove o arquivo quando ele NÃO existia antes (fs.rmSync)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-congelada-'));
  const caminho = path.join(dir, 'novo.json');
  fs.writeFileSync(caminho, '{"escrito-nesta-rodada":true}');
  assert.ok(fs.existsSync(caminho));

  descartarEscritaNaoCommitada(caminho, false);

  assert.equal(fs.existsSync(caminho), false, 'arquivo criado nesta rodada perdida deve ser removido');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('descartarEscritaNaoCommitada chama "git checkout -- <arquivo>" quando ele JÁ existia antes (committed)', () => {
  const chamadas = [];
  const execGitFalso = (args) => { chamadas.push(args); };

  descartarEscritaNaoCommitada('/caminho/qualquer/tendencia-congelada-semanal.json', true, execGitFalso);

  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0], ['checkout', '--', '/caminho/qualquer/tendencia-congelada-semanal.json']);
});

// A semana de 31/08 a 06/09 CRUZA a virada do mês. semanasDoMes corta semanas
// dentro do mês, então ela existe como DOIS fragmentos: o toco [31/08, 31/08]
// em agosto e [01/09, 06/09] em setembro. O leitor do Consolidado procura pelo
// INÍCIO do fragmento -- 2026-09-01, uma terça -- então gravar só sob a segunda
// deixaria essa semana sem congelado.
test('fragmentosDaSemanaAlvo devolve os DOIS fragmentos de uma semana que cruza a virada do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-08-31');
  assert.equal(frags.length, 2);
  assert.deepEqual(frags.map((f) => f.chave), ['2026-08-31', '2026-09-01']);
  assert.equal(frags[0].mesIdx, 7); // agosto
  assert.equal(frags[1].mesIdx, 8); // setembro
});

test('fragmentosDaSemanaAlvo devolve UM fragmento para semana inteira dentro do mês', () => {
  const frags = fragmentosDaSemanaAlvo('2026-09-07'); // 07/09 a 13/09, tudo em setembro
  assert.equal(frags.length, 1);
  assert.equal(frags[0].chave, '2026-09-07');
});
