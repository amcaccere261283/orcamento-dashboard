'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsvGrid } = require('../tools/semanal/parse-matriz-cliente.js');
const { parseAvancos, locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

// Toda a suíte ao redor roda sobre fixture sintética, o que prova a LÓGICA mas
// não o MAPEAMENTO: um nome de coluna errado, um status escrito de outro jeito,
// um formato de data diferente do esperado -- tudo isso passaria inteiro. Este
// arquivo é a única prova contra a FONTE DE VERDADE, e é por isso que ele
// existe.
//
// REPONTADO EM 2026-08-11. Até aqui ele lia o `Avanço Sond.xlsx` local do
// `G:\Meu Drive\...`, fonte APOSENTADA em 2026-08-10 quando o parser migrou
// para o Link 1 online (ver "Regras de dados da Tabela Semanal e dos Gráficos"
// no CLAUDE.md). O layout dos dois não tem como coincidir -- o .xlsx traz
// `Inicio Sondagem`/`Termino Sondagem`/`Cancelamento`, o Link 1 traz
// `Executado Dia`/`Deslocamento`/`Total (m)` -- então o arquivo ficou vermelho
// com `Coluna "Executado Dia" não encontrada`, testando um mapeamento que o
// projeto não usa mais. Ele estava assim desde a própria migração.
//
// A fonte agora é `dist/avancos-online.csv` (+ `dist/demandas-sondagem-online.csv`),
// lida EXATAMENTE como `build-dashboard.js` a lê, inclusive o `unshift(null)`
// que reproduz o cabeçalho em `grid[1]` do formato .xlsx original. Ganho de
// lado: os dois CSVs são rastreados no git, então este arquivo deixou de
// depender do Drive montado em `G:` e passa a rodar em qualquer máquina --
// antes ele simplesmente PULAVA para quem não tinha o Drive, que é o cenário
// de qualquer colaborador (ver docs/onboarding-colaborador.md).
//
// POR QUE QUASE NENHUM NÚMERO CRU É TRAVADO AQUI. A versão anterior fixava
// contagens exatas (`furos.length === 51819`, `chegadas === 15515`, ...) e
// isso a deixou vermelha por deriva de dado DUAS vezes -- ver os commits
// `d3dafff` ("Remede os testes contra as planilhas reais, vermelhos desde
// 2026-08-01") e `2d11cf6`. O problema piorou com a fonte online: qualquer
// `node tools/semanal/atualizar-avancos-online.js` reescreve o CSV, e
// `atualizar-arquivos.js` ainda commita e dá push sozinho -- ou seja, um teste
// de igualdade exata ficaria vermelho a cada atualização de rotina, e um teste
// que vive vermelho é um teste que ninguém lê. O que se trava aqui são
// invariantes de ESTRUTURA, que não derivam quando o dado anda; as contagens
// medidas ficam nos comentários, como referência datada, não como assert.
//
// Medições de 2026-08-11 sobre o CSV de 2026-08-10 23:23 -- e duas delas
// reproduzem EXATO o que o CLAUDE.md já documentava da auditoria de
// 2026-08-10, que é o que prova que o parser está lendo as colunas certas e
// não só concordando consigo mesmo:
//
//   linhas com sup/tipo ....... 47.898  (CLAUDE.md: base de 47.852, +46 de deriva)
//   Deslocamento = "Sim" ....... 2.950  <- IDÊNTICO ao documentado
//   Status CANCELADO ............. 29   <- IDÊNTICO ao documentado
//   Total (m) = 0,01 .......... 1.498
//   união dos três ............ 4.339  (é ISTO que o contador `deslocamentos` expõe)
//   furos úteis .............. 43.559
//   com os pendentes .......... 49.037  (5.478 PENDENTE)
//   cobertura executadoDia ... 2025-01-06 .. 2026-08-10
const CAMINHO_AVANCOS = path.join(__dirname, '..', 'dist', 'avancos-online.csv');
const CAMINHO_PENDENTES = path.join(__dirname, '..', 'dist', 'demandas-sondagem-online.csv');

// Os dois são rastreados no git, então normalmente estão aqui. O guard existe
// para o caso de alguém limpar `dist/` -- pular é melhor que vermelho falso,
// mesmo espírito do guard de `G:` que este arquivo tinha antes.
const TEM_CSV = fs.existsSync(CAMINHO_AVANCOS) && fs.existsSync(CAMINHO_PENDENTES);
const PULAR = TEM_CSV ? false : `${CAMINHO_AVANCOS} não encontrado -- rode "node tools/semanal/atualizar-avancos-online.js"`;

// O conjunto EXATO de colunas do Link 1. Travado por igualdade de lista, e não
// por "contém": coluna a MAIS também é mudança de layout, e é justamente uma
// mudança silenciosa de layout que este arquivo existe para pegar. Foi uma
// troca de fonte não refletida aqui que deixou o arquivo vermelho por um dia
// inteiro sem ninguém notar.
const COLUNAS_LINK1 = [
  'Contrato', 'Criação da OS', 'Tipo', 'Status', 'Executado Dia',
  'Deslocamento', 'Total (m)', 'Observações de Campo', 'OS', 'Sondador',
];

function lerGrid({ comPendentes }) {
  const grid = parseCsvGrid(fs.readFileSync(CAMINHO_AVANCOS, 'utf8'));
  if (comPendentes) {
    const gp = parseCsvGrid(fs.readFileSync(CAMINHO_PENDENTES, 'utf8'));
    for (let i = 1; i < gp.length; i++) grid.push(gp[i]);
  }
  // Mesmo ajuste de indexação que build-dashboard.js faz: o CSV tem cabeçalho
  // na linha 0, parseAvancos espera em grid[1].
  grid.unshift(null);
  return grid;
}

test('o Link 1 online tem exatamente as colunas que o parser mapeia', { skip: PULAR }, () => {
  const grid = lerGrid({ comPendentes: false });
  assert.deepStrictEqual(grid[1], COLUNAS_LINK1,
    'o layout do Link 1 mudou -- confira a fonte ANTES de mexer no parser ou nesta lista');

  // Não basta o cabeçalho bater: locateColunasAvancos é quem traduz rótulo em
  // índice, e é ele que lança quando falta coluna essencial.
  assert.doesNotThrow(() => locateColunasAvancos(grid[1]));
});

test('o CSV de demandas pendentes tem o MESMO cabeçalho do Link 1', { skip: PULAR }, () => {
  // build-dashboard.js empilha as linhas de um no outro e roda UM parser só
  // sobre o resultado, resolvendo as colunas pelo cabeçalho do PRIMEIRO. Se os
  // dois divergirem, cada campo dos pendentes passa a ser lido da coluna
  // errada, em silêncio -- exatamente o modo de falha que o CLAUDE.md descreve
  // para o cache ("o combinador usa o cabeçalho do PRIMEIRO grid para todos").
  const a = parseCsvGrid(fs.readFileSync(CAMINHO_AVANCOS, 'utf8'))[0];
  const b = parseCsvGrid(fs.readFileSync(CAMINHO_PENDENTES, 'utf8'))[0];
  assert.deepStrictEqual(b, a);
});

test('nenhuma tipologia crua do Link 1 fica fora do mapa', { skip: PULAR }, () => {
  // parseAvancos LANÇA em tipologia desconhecida (com o número da linha) --
  // este teste existe para que essa falha apareça como teste vermelho, e não
  // só quando alguém rodar o build.
  assert.doesNotThrow(() => parseAvancos(lerGrid({ comPendentes: true })));
});

test('o Link 1 não carrega conclusão, cancelamento nem atualizado', { skip: PULAR }, () => {
  // Estes três são `null` explícito no parser, e não ausentes, para quem
  // consome distinguir "a fonte não tem" de "esqueci de mapear". A
  // consequência está no CLAUDE.md (regra 2 de 2026-08-10): cancelamento NÃO
  // participa mais da saída do estoque de demandas. Se um dia a fonte passar a
  // trazer estas colunas, este teste fica vermelho e a decisão volta à mesa em
  // vez de o dado entrar sem ninguém reparar.
  const { furos } = parseAvancos(lerGrid({ comPendentes: true }));
  const comValor = furos.filter(f => f.conclusao !== null || f.cancelamento !== null || f.atualizado !== null);
  assert.strictEqual(comValor.length, 0);
});

test('executado e pendente particionam sondador e data de execução', { skip: PULAR }, () => {
  // Medido em 2026-08-11: a partição é PERFEITA nos dois sentidos -- 100% dos
  // CONCLUIDO/EXECUTADO têm sondador e data, 100% dos PENDENTE não têm nem um
  // nem outro. É o que sustenta duas coisas de uma vez: a conta de equipes
  // mobilizadas cobre tudo que existe para medir (furo sem sondador é furo que
  // ninguém executou, não lacuna de preenchimento), e o estoque de demandas
  // sai pela data de execução.
  //
  // O build já vigia o primeiro sentido com um aviso; aqui ele é assert, e o
  // sentido inverso entra junto -- PENDENTE com sondador significaria que o
  // Link 2/3 passou a devolver furo já executado, e o estoque estaria contando
  // duas vezes.
  const { furos } = parseAvancos(lerGrid({ comPendentes: true }));
  const executados = furos.filter(f => f.status === 'CONCLUIDO' || f.status === 'EXECUTADO');
  const pendentes = furos.filter(f => f.status === 'PENDENTE');

  assert.ok(executados.length > 0 && pendentes.length > 0, 'as duas populações têm que existir');
  assert.strictEqual(executados.filter(f => !f.sondador).length, 0, 'furo executado sem sondador');
  assert.strictEqual(executados.filter(f => f.executadoDia === null).length, 0, 'furo executado sem data');
  assert.strictEqual(pendentes.filter(f => f.sondador).length, 0, 'furo pendente COM sondador');
  assert.strictEqual(pendentes.filter(f => f.executadoDia !== null).length, 0, 'furo pendente COM data de execução');
});

test('a cobertura do Realizado começa em 2025-01 e não passa de hoje', { skip: PULAR }, () => {
  // Regra 1 de 2026-08-10: sondagem cobre "de 2025-01 em diante". O limite de
  // cima é sanidade contra data corrompida entrando como Realizado do futuro
  // (a janela de dataSaneada é larga -- 2023..2027 -- de propósito, então ela
  // sozinha não pegaria um 2027 espúrio).
  const { furos } = parseAvancos(lerGrid({ comPendentes: true }));
  const datas = furos.map(f => f.executadoDia).filter(Boolean);
  assert.ok(datas.length > 0);

  const min = new Date(Math.min(...datas));
  const max = new Date(Math.max(...datas));
  assert.ok(min >= new Date(Date.UTC(2025, 0, 1)), `data mais antiga ${min.toISOString()} é anterior a 2025-01`);
  assert.ok(max <= new Date(), `data mais recente ${max.toISOString()} está no futuro`);
});

test('todo furo tem SUP e OS -- são as duas chaves de junção da página', { skip: PULAR }, () => {
  // `sup` quebra a grade por contrato em todas as abas; `os` é o que liga o
  // furo ao dia da aba EQ (o código entre parênteses, "CCR RioSP (17851-26)").
  // Furo sem um dos dois sumiria de alguma agregação sem erro nenhum.
  const { furos } = parseAvancos(lerGrid({ comPendentes: true }));
  assert.strictEqual(furos.filter(f => !f.sup).length, 0);
  assert.strictEqual(furos.filter(f => !f.os).length, 0);
});

test('as três exclusões do Realizado são independentes e somam pela união', { skip: PULAR }, () => {
  // `foraDoRealizado` exclui por Deslocamento="Sim" OU Total (m)=0,01 OU
  // Status=Cancelado, e o contador devolvido chama-se `deslocamentos` mas
  // expõe a UNIÃO dos três -- confundir os dois foi o que fez os 2.950
  // deslocamentos documentados parecerem divergir dos 4.339 do contador.
  // Este teste prende a relação, não os valores.
  const grid = lerGrid({ comPendentes: false });
  const cols = locateColunasAvancos(grid[1]);
  const { furos, deslocamentos, descartadas } = parseAvancos(grid);

  const txt = v => (v === undefined || v === null ? '' : String(v).trim());
  let total = 0, uniao = 0, apenasDeslocamento = 0;
  for (let r = 2; r < grid.length; r++) {
    const l = grid[r];
    if (!l) continue;
    if (!txt(l[cols.sup]) && !txt(l[cols.tipo])) continue;
    total++;
    const d = /^sim$/i.test(txt(l[cols.deslocamento]));
    const m = Math.abs(parseFloat(txt(l[cols.totalMetros]).replace(',', '.')) - 0.01) < 1e-9;
    const c = /CANCEL/i.test(txt(l[cols.status]));
    if (d) apenasDeslocamento++;
    if (d || m || c) uniao++;
  }

  assert.strictEqual(deslocamentos, uniao, 'o contador tem que ser a UNIÃO dos três critérios');
  assert.strictEqual(furos.length, total - uniao, 'úteis = linhas com sup/tipo menos a união');
  assert.strictEqual(descartadas, 0, 'o CSV online não tem linha de resto de edição, ao contrário do .xlsx');

  // Os três precisam ser realmente independentes: se a união fosse igual a um
  // deles, dois critérios estariam inertes e a regra "OR" seria decorativa.
  assert.ok(apenasDeslocamento > 0 && uniao > apenasDeslocamento,
    'os critérios de metragem/cancelado deixaram de excluir qualquer linha');
});

test('o CSV do Link 1 não está truncado nem vazio', { skip: PULAR }, () => {
  // O modo de falha que os fetchers já se protegem de gravar (ver o guard de
  // "mês corrente falhou -> aborta sem gravar" em atualizar-avancos-online.js),
  // aqui como rede de segurança do lado de quem consome. Limite FROUXO de
  // propósito: é para pegar catástrofe, não deriva -- em 2026-08-11 são 43.559
  // úteis, e a suíte não pode ficar vermelha só porque o número andou.
  const { furos } = parseAvancos(lerGrid({ comPendentes: true }));
  assert.ok(furos.length > 20000, `só ${furos.length} furos úteis -- o CSV parece truncado`);
});
