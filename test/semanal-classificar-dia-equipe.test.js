'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classificarDiaEquipe, contaComoAtiva } = require('../tools/semanal/classificar-dia-equipe.js');

// Todos os textos abaixo são REAIS, tirados das abas EQ de julho e agosto/2026.

test('OS entre parênteses é mobilização, e a OS sai junto -- é ela que dá o SUP', () => {
  assert.deepStrictEqual(classificarDiaEquipe('CCR RioSP (16925-25)'),
    { estado: 'mobilizada', os: '16925-25', noDefault: false });
});

test('OS com espaço sobrando dentro do parêntese também conta', () => {
  // "CCR RioSP (17851-26 )-101" e "Sorocabana (17809-26 )" existem na planilha.
  // O mesmo descuido de digitação que já tinha enganado tools/matriz/parse-eq.js.
  assert.strictEqual(classificarDiaEquipe('CCR RioSP (17851-26 )-101').os, '17851-26');
  assert.strictEqual(classificarDiaEquipe('Sorocabana (17809-26 )').os, '17809-26');
});

test('"OK" é mobilização sem OS -- o registro do realizado em D-1', () => {
  const c = classificarDiaEquipe('OK');
  assert.strictEqual(c.estado, 'mobilizada');
  assert.strictEqual(c.os, null);
});

test('ausência não conta como ativa: baixada, férias, folga, falta, atestado', () => {
  ['Baixada', 'baixada', 'Férias', 'Folga', 'FALTA', 'Atestado médico', 'baixada só Flávio']
    .forEach((t) => {
      assert.strictEqual(classificarDiaEquipe(t).estado, 'fora', t);
      assert.strictEqual(contaComoAtiva('fora'), false);
    });
});

test('quem não é equipe de campo não conta: contratação, admissão, auxiliar, encarregado, desligamento', () => {
  ['Em processo de contratação', 'sem previsão de contratação', 'Encarregado equipes',
    'Auxiliar Flavio', 'vai ficar como auxiliar - JC pediu', 'Pediu desligamento',
    'agiardando Aso e integração', 'Assumir equipe pós desligamento Delmiro']
    .forEach((t) => {
      assert.strictEqual(classificarDiaEquipe(t).estado, 'naoEquipe', t);
      assert.strictEqual(contaComoAtiva('naoEquipe'), false);
    });
});

test('"Auxiliar ... carregar equipamento" é auxiliar, não equipe carregando -- a ordem das regras decide', () => {
  // Casa as duas ideias; naoEquipe tem que vencer, senão uma pessoa que virou
  // auxiliar entraria na conta como se fosse uma equipe a mais em campo.
  assert.strictEqual(classificarDiaEquipe('Auxiliar Flavio - carregar equipamento').estado, 'naoEquipe');
});

test('equipe em campo sem furo CONTA como ativa', () => {
  ['Mobilização', 'Veículo quebrou', 'Carro quebrado', 'chuva', 'parada de segurança', 'treinamento']
    .forEach((t) => {
      assert.strictEqual(contaComoAtiva(classificarDiaEquipe(t).estado), true, t);
    });
});

test('o DEFAULT é equipe em campo -- texto de trabalho não enumerado entra certo sozinho', () => {
  // Estes 4 sozinhos são 410 equipe-dia em julho+agosto. Enumerar as formas de
  // dizer "trabalhando" (tomador, trecho, colega, lugar) é cauda infinita --
  // por isso a lógica é por exceção, e o default é estar em campo.
  ['CCR RioSP', 'RioSP (BR-101)', 'Via Mineira', 'RioSP (BR-116)',
    'com Geraldo', 'Em São Pedro', 'Matheus de Queiroz Silva']
    .forEach((t) => {
      const c = classificarDiaEquipe(t);
      assert.strictEqual(c.estado, 'campoSemFuro', t);
      assert.strictEqual(c.noDefault, true, t + ' precisa vir marcado como default, para entrar no relatório');
    });
});

test('formas catalogadas de "em campo sem furo" saem do relatório sem mudar o total', () => {
  // Mesma classificação que o default daria -- o que muda é só não aparecerem
  // como novidade em todo build. Medido: o relatório de julho cai de 143 para
  // 53 textos, e o total de ativas continua 1.845.
  ['Mobilização', 'Veículo quebrou', 'Inspeção RioSP', 'Em outra frente de serviço', 'Embargados']
    .forEach((t) => {
      const c = classificarDiaEquipe(t);
      assert.strictEqual(c.estado, 'campoSemFuro', t);
      assert.strictEqual(c.noDefault, false, t + ' já está catalogado, não deveria entrar no relatório');
    });
});

test('o que casou exceção NÃO vem marcado como default -- só o que passou reto', () => {
  assert.strictEqual(classificarDiaEquipe('Baixada').noDefault, false);
  assert.strictEqual(classificarDiaEquipe('Mobilização').noDefault, false);
  assert.strictEqual(classificarDiaEquipe('CCR RioSP (16925-25)').noDefault, false);
});

test('célula vazia não é estado nenhum', () => {
  assert.strictEqual(classificarDiaEquipe(''), null);
  assert.strictEqual(classificarDiaEquipe('   '), null);
  assert.strictEqual(classificarDiaEquipe(null), null);
  assert.strictEqual(classificarDiaEquipe(undefined), null);
});

test('"Não atuou" e "Sem atuação" são ausência, apesar de não serem férias nem baixada', () => {
  // Ficam FORA da conta de ativas: a equipe existe, mas o dia foi registrado
  // como sem atuação nenhuma.
  assert.strictEqual(classificarDiaEquipe('Não atuou').estado, 'fora');
  assert.strictEqual(classificarDiaEquipe('Sem atuação').estado, 'fora');
});
