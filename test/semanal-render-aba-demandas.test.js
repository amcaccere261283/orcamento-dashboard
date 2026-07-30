'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  renderAbaDemandas, acumularSerie, rotuloColunaFechamento, fechamento,
} = require('../tools/semanal/render-aba-demandas.js');

const demandasExemplo = {
  tipologias: [
    { tipologia: 'SP', series: {
      chegadas: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pendentes: [5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    } },
    { tipologia: 'ST', series: {
      chegadas: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sondagemRealizada: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      relatorioConcluido: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      canceladas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pendentes: [1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    } },
  ],
  totais: {
    chegadas: [11, 21, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sondagemRealizada: [5, 10, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    relatorioConcluido: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    canceladas: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pendentes: [6, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
  },
};

test('fluxo acumula por soma corrida', () => {
  assert.deepStrictEqual(acumularSerie([10, 20, 30], false), [10, 30, 60]);
});

test('ESTOQUE NÃO acumula: saldos 5/7/6 seguem 5/7/6, nunca 5/12/18', () => {
  assert.deepStrictEqual(acumularSerie([5, 7, 6], true), [5, 7, 6]);
});

test('acumularSerie não muta o array recebido', () => {
  const original = [1, 2, 3];
  acumularSerie(original, false);
  assert.deepStrictEqual(original, [1, 2, 3]);
});

test('o rótulo da coluna de fechamento segue a NATUREZA da série, não o modo', () => {
  assert.strictEqual(rotuloColunaFechamento('chegadas'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('pendentes'), 'Saldo');
});

test('fluxo no modo mensal fecha somando os 12 meses', () => {
  assert.strictEqual(fechamento([10, 20, 30], false, 'mensal'), 60);
});

test('fluxo no modo acumulado fecha no ÚLTIMO valor, nunca somando a série já acumulada', () => {
  // [10,30,60] já é o acumulado de [10,20,30]. Somar daria 100, que não
  // significa nada -- o total do ano é 60.
  assert.strictEqual(fechamento([10, 30, 60], false, 'acumulado'), 60);
});

test('estoque fecha no saldo do último mês nos DOIS modos -- 12 saldos somados não são um total', () => {
  assert.strictEqual(fechamento([5, 7, 6], true, 'mensal'), 6);
  assert.strictEqual(fechamento([5, 7, 6], true, 'acumulado'), 6);
});

test('renderiza um bloco por série, com o rótulo em português', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  for (const rotulo of ['Demandas chegadas', 'Sondagem realizada', 'Relatório concluído', 'Canceladas', 'Pendentes']) {
    assert.ok(html.includes(rotulo), `falta o bloco "${rotulo}"`);
  }
});

test('cada bloco tem uma linha por tipologia e as 12 colunas de mês', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>SP<'));
  assert.ok(html.includes('>ST<'));
  for (const mes of ['Jan', 'Fev', 'Dez']) assert.ok(html.includes('>' + mes + '<'), `falta a coluna ${mes}`);
});

test('no modo mensal os valores são os do mês', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>30<'), 'chegadas de SP em março (30) deve aparecer cru');
});

test('no modo acumulado o fluxo aparece somado', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(html.includes('>60<'), '10+20+30 = 60 em março');
});

test('no modo acumulado o estoque NÃO aparece somado', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(!html.includes('>18<'), '5+7+6=18 não pode existir -- pendentes é saldo');
});

test('o bloco de estoque diz Saldo já no modo mensal, e nunca soma os 12 saldos', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(html.includes('>Saldo<'), 'o bloco de pendentes fecha em Saldo, não em Total');
  // Os 12 saldos de SP somados dariam 5+7+6*10 = 72; o saldo correto é 6.
  assert.ok(!html.includes('>72<'), 'somar saldo mensal é exatamente o número que este bloco evita');
});

test('o seletor Mensal/Acumulado existe e marca o modo atual', () => {
  const html = renderAbaDemandas(demandasExemplo, 'acumulado');
  assert.ok(html.includes('id="demandas-modo"'));
  assert.ok(/<option value="acumulado" selected/.test(html));
});

test('a nota do estoque de abertura aparece no bloco de pendentes', () => {
  const html = renderAbaDemandas(demandasExemplo, 'mensal');
  assert.ok(/saldo|abertura|legado/i.test(html), 'pendentes precisa explicar que carrega furo de anos anteriores');
});

test('rótulo de tipologia com caractere de HTML é escapado', () => {
  const html = renderAbaDemandas({
    tipologias: [{ tipologia: '<script>x</script>', series: demandasExemplo.tipologias[0].series }],
    totais: demandasExemplo.totais,
  }, 'mensal');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('demandas sem nenhuma tipologia rende um aviso, não uma tabela vazia sem explicação', () => {
  const html = renderAbaDemandas({ tipologias: [], totais: demandasExemplo.totais }, 'mensal');
  assert.ok(/sem dado|nenhum/i.test(html));
});

test('o módulo não tem require de fora do próprio diretório -- o bundle removeria a linha', () => {
  const fs = require('node:fs');
  const fonte = fs.readFileSync(require.resolve('../tools/semanal/render-aba-demandas.js'), 'utf8');
  assert.strictEqual(/require\(['"]\.\.\//.test(fonte), false,
    'require("../...") é REMOVIDO por transformaModulo e viraria undefined no navegador');
});
