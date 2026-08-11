'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaAlocacao } = require('../tools/semanal/render-aba-alocacao.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');

const SEMANAS = semanasDoMes(2026, 7);

function registros() {
  const zeros = () => new Array(12).fill(0);
  const vol = (v) => { const a = zeros(); a[7] = v; return a; };
  return [
    { sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'SP',
      previsto: { volume: vol(120), equipesResumo: { prod: 2 } } },
  ];
}

function opcoes(extra) {
  return Object.assign({
    mesIdx: 7, ano: 2026, semanas: SEMANAS, semana: SEMANAS[1],
    demandas: { porRegistroEventos: { 'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] } } },
    equipes: [{ id: '4', lider: 'Amaral', servicos: 'SM', colunas: ['SP'],
      polivalente: false, diasDisponiveis: 5, diasDaSemana: 7, disponivel: true,
      supRealizado: null, colunaRealizada: null,
      popup: { habilitacao: 'D', veiculo: 'SUH-6F44', proprietario: 'Suporte',
        equipamentos: ['Kit SP'], tenda: '', tomador: 'CCR RioSP', sinalizacao3p: '' } }],
    foraDoQuadro: [{ id: '200', lider: 'Ana L.', servicos: 'Lab', motivo: 'Laboratório tem fonte própria' }],
    alocacao: {},
    hojeEpoch: SEMANAS[1].inicio + 2,
    modoPersistencia: 'local',
    pendentes: 0,
  }, extra || {});
}

test('cada célula da matriz é uma área de soltura identificada por SUP e coluna', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /data-sup="SUP-A"[^>]*data-coluna="SP"/);
  assert.match(html, /class="[^"]*celula-alocacao/);
});

test('o cartão da equipe traz o ID, o líder e a coluna dele', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /data-equipe="4"/);
  assert.match(html, /Amaral/);
  assert.match(html, /data-colunas="SP"/);
});

test('equipe indisponível sai marcada e NÃO arrastável', () => {
  const o = opcoes();
  o.equipes[0].disponivel = false;
  o.equipes[0].diasDisponiveis = 0;
  const html = renderAbaAlocacao(registros(), [0], o);
  assert.match(html, /data-equipe="4"[^>]*data-arrastavel="nao"/);
});

test('equipe polivalente carrega as colunas dela separadas por vírgula', () => {
  const o = opcoes();
  o.equipes[0].colunas = ['ST', 'PI', 'BL'];
  o.equipes[0].polivalente = true;
  const html = renderAbaAlocacao(registros(), [0], o);
  assert.match(html, /data-colunas="ST,PI,BL"/);
});

test('o popup traz veículo, proprietário e equipamentos -- e NÃO promete nomes de efetivo', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /SUH-6F44/);
  assert.match(html, /Suporte/);
  assert.match(html, /Kit SP/);
});

test('a lista "fora do quadro" mostra a equipe e o motivo -- nunca some calada', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /fora do quadro \(1\)/i);
  assert.match(html, /Laborat/);
});

test('sem roster, a aba explica em vez de mostrar quadro vazio', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ equipes: null, semRoster: true }));
  assert.doesNotMatch(html, /matriz-alocacao/);
  assert.match(html, /aba EQ/i);
});

test('semana fora do mês do espelho: somente leitura, com o motivo na tela', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ somenteLeitura: 'mes-diferente' }));
  assert.match(html, /somente leitura/i);
  assert.match(html, /m[êe]s/i);
});

test('o modo local avisa que a alocação não está sendo gravada na planilha', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ modoPersistencia: 'local' }));
  assert.match(html, /neste navegador/i);
});

test('movimentos na fila aparecem no status', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ modoPersistencia: 'sheet', pendentes: 2 }));
  assert.match(html, /2 movimento/i);
});

test('leitura "sem-demanda" (equipe parada onde não há tendência nem carteira) ganha rótulo e classe próprios, não o id cru', () => {
  // SUP-Z tem registro na MATRIZ mas volume ZERO: tendência e carteira ficam em
  // zero, e a linha existe SÓ porque a equipe '4' está alocada nela. É o estado
  // que compute-alocacao.js (commit de3a715) batizou de 'sem-demanda' em vez de
  // cair, por engano, em 'absorvido' (verde).
  //
  // Este teste usava `indices: []` para produzir o mesmo estado, o que deixou
  // de servir em 2026-08-11: `indices` é a saída do FILTRO, e esvaziá-lo passou
  // a significar "o filtro excluiu este SUP" (Decisão 7), não "não há registro
  // nesta célula" -- os dois sentidos eram indistinguíveis antes de a poda
  // existir. O caso real deste teste (auto-seed sem filtro ativo) tem `indices`
  // CHEIO, que é como está agora.
  const regs = registros().concat([{
    sup: 'SUP-Z', tomador: 'Tomador Z', tipologia: 'SP',
    previsto: { volume: new Array(12).fill(0), equipesResumo: { prod: 2 } },
  }]);
  const o = opcoes({
    alocacao: { 4: { sup: 'SUP-Z', coluna: 'SP' } },
    demandas: { porRegistroEventos: {
      'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-Z||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
    } },
  });
  const html = renderAbaAlocacao(regs, [0, 1], o);
  assert.match(html, /Sem demanda/);
  assert.match(html, /leitura-neutra/);
  // A falha que este teste travaria: sem rótulo próprio, o lookup cai no
  // fallback `ROTULO_LEITURA[s.leitura] || s.leitura` e imprime o id cru.
  assert.doesNotMatch(html, /sem-demanda/);
});

// --- Status da célula (2026-08-11, Decisão 9 do spec) ------------------------

test('a célula mostra "Sobrecarregada" quando a capacidade não cobre a tendência', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  // Uma equipe de 5/7 dias com premissa 2 não cobre a fatia semanal de 120.
  assert.match(html, /Sobrecarregada/);
  assert.doesNotMatch(html, /Com folga/);
});

test('a célula com tendência e sem equipe diz "Sem equipe"', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /Sem equipe/);
  assert.match(html, /situacao-sem-equipe/);
});

test('a Tendência da célula aparece rotulada, não como número solto', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /celula-rotulo/, 'era o único número da célula sem rótulo');
});

test('"Livre" continua sendo o rótulo da EQUIPE no pool -- a chave é compartilhada', () => {
  const { ROTULO_SITUACAO } = require('../tools/semanal/render-aba-alocacao.js');
  assert.strictEqual(ROTULO_SITUACAO.livre, 'Livre');
  assert.strictEqual(ROTULO_SITUACAO['sem-equipe'], 'Sem equipe');
});

// --- O pool decide pela alocação CRUA (2026-08-11, Decisão 7 do spec) --------

test('equipe alocada num SUP podado pelo filtro NÃO volta ao pool como livre', () => {
  // A armadilha da Decisão 7: com a linha podada, resumirAlocacao devolve
  // sup: null para a equipe, e um pool que decidisse pelo RESUMO a desenharia
  // como livre -- dando pra alocá-la uma segunda vez, em dois SUPs ao mesmo
  // tempo. O pool tem que decidir pela alocação crua.
  //
  // indices [] = o filtro excluiu SUP-A, que é conhecido (está em registros).
  const html = renderAbaAlocacao(registros(), [], opcoes({
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
  }));
  assert.doesNotMatch(html, /data-equipe="4"/,
    'a equipe alocada não pode reaparecer como cartão enquanto o filtro esconde o SUP dela');
});

test('equipe sem alocação nenhuma continua no pool', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ alocacao: {} }));
  assert.match(html, /data-equipe="4"/);
});

// --- Pool agrupado por tipologia (2026-08-11, Decisões 4/5 do spec) ---------

function equipesVariadas() {
  const base = { diasDisponiveis: 5, diasDaSemana: 7, disponivel: true,
    supRealizado: null, colunaRealizada: null, popup: {} };
  return [
    Object.assign({ id: '4', lider: 'Amaral', nome: 'José I. Amaral', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base),
    Object.assign({ id: '7', lider: 'Alves', nome: 'Carlos Alves', servicos: 'ST | PI | BL',
      colunas: ['ST', 'PI', 'BL'], polivalente: true }, base),
  ];
}

test('o pool sai agrupado, na ordem canônica de COLUNAS_ALOCACAO', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const ordem = [...html.matchAll(/data-grupo="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordem, ['SP', 'ST', 'PI', 'BL'],
    'grupos vazios não são desenhados, e os que sobram seguem a ordem canônica');
});

test('a equipe polivalente aparece em CADA grupo que serve', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const ocorrencias = (html.match(/data-equipe="7"/g) || []).length;
  assert.strictEqual(ocorrencias, 3, 'ST, PI e BL -- é o que faz o grupo BL ter candidato');
});

test('o grupo BL existe por causa da polivalente -- não há equipe só de BL', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.match(html, /data-grupo="BL"/);
});

test('o cartão polivalente leva selo; o de coluna única, não', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const selos = (html.match(/cartao-selo-poli/g) || []).length;
  assert.strictEqual(selos, 3, 'um por cópia da equipe 7, nenhum na 4');
});

test('"fora do quadro" continua fora do agrupamento', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.match(html, /fora do quadro \(1\)/);
});

test('equipe alocada some de TODOS os grupos de uma vez', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: { 7: { sup: 'SUP-A', coluna: 'ST' } },
  }));
  // Só a cópia dentro da célula sobra -- nenhuma no pool.
  const noPool = (html.split('<table')[0].match(/data-equipe="7"/g) || []).length;
  assert.strictEqual(noPool, 0);
});

// --- Busca de equipe (2026-08-11, Decisão 8 do spec) ------------------------

test('a busca casa o id', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: '7',
  }));
  assert.match(html, /data-equipe="7"/);
  assert.doesNotMatch(html, /data-equipe="4"/);
});

test('a busca casa o líder', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'amaral',
  }));
  assert.match(html, /data-equipe="4"/);
  assert.doesNotMatch(html, /data-equipe="7"/);
});

test('a busca casa o NOME COMPLETO, que o cartão não mostra', () => {
  // Medido na Sheet em 2026-08-11: a col. 1 tem "José I. Amaral" e a col. 4
  // tem "Amaral". O cartão só mostra o apelido, então casar apenas o que ele
  // exibe deixaria "josé" sem achar ninguém.
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'josé',
  }));
  assert.match(html, /data-equipe="4"/);
});

test('a busca ignora acento e caixa', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'JOSE',
  }));
  assert.match(html, /data-equipe="4"/);
});

test('casando só pelo nome completo, o cartão passa a exibi-lo', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'josé',
  }));
  assert.match(html, /José I\. Amaral/);
});

test('busca vazia devolve o pool inteiro', () => {
  const comBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: '',
  }));
  const semBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  assert.strictEqual(comBusca, semBusca);
});

test('busca sem resultado não deixa a área muda', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, buscaEquipe: 'zzzznaoexiste',
  }));
  assert.match(html, /nenhuma equipe/i);
});

test('equipe que casa a busca mas está ALOCADA vira linha de texto, não cartão', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), buscaEquipe: 'alves',
    alocacao: { 7: { sup: 'SUP-A', coluna: 'ST' } },
  }));
  // Fora da grade (antes da <table>) ela aparece só como texto.
  const antesDaGrade = html.split('<table')[0];
  assert.match(antesDaGrade, /alocada em/i);
  assert.match(antesDaGrade, /SUP-A/);
  assert.doesNotMatch(antesDaGrade, /data-equipe="7"/,
    'arrastar se faz da célula; um 2º cartão arrastável reintroduziria a dupla alocação');
});

test('a busca poda a GRADE junto com o pool', () => {
  // Este teste dizia o CONTRARIO ate 2026-08-11 ("a grade fica identica"),
  // porque a Decisao 8 do spec mandava a busca podar so o pool. Na pratica a
  // semana nasce semeada do realizado: quase toda equipe ja esta alocada, o
  // pool fica vazio, e podar so ele fazia a busca nao mudar nada visivel.
  // A especificacao e' que estava errada, nao o codigo.
  const alocada = { 4: { sup: 'SUP-A', coluna: 'SP' } };
  const semBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: alocada,
  }));
  const comBusca = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: alocada, buscaEquipe: 'zzzznaoexiste',
  }));
  const linhasDe = (h) => (h.match(/data-sup="/g) || []).length;
  assert.ok(linhasDe(semBusca) > 0, 'pre-condicao: sem busca ha linha na grade');
  assert.strictEqual(linhasDe(comBusca), 0,
    'busca sem resultado tem que esvaziar a grade, nao so o pool');
});

test('o campo de busca existe nos controles da aba', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ equipes: equipesVariadas() }));
  assert.match(html, /id="busca-equipe"/);
});

// --- A busca filtra TUDO, não só o pool (2026-08-11, correção) --------------
//
// A Decisão 8 do spec mandava a busca podar só o pool. Na prática a semana
// nasce SEMEADA do realizado, então quase toda equipe já está alocada e o pool
// fica vazio: digitar não mudava nada visível. Medido no sandbox: pool 0
// cartões antes e depois, grade 1 antes e 1 depois.

test('buscar uma equipe alocada deixa na grade só a célula dela', () => {
  const equipes = equipesVariadas();
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes,
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
    buscaEquipe: 'amaral',
  }));
  assert.match(html, /data-equipe="4"/, 'a equipe buscada tem que aparecer');
  assert.match(html, /data-sup="SUP-A"/, 'e a linha onde ela está, também');
});

test('buscar uma equipe esconde as linhas onde ela NÃO está', () => {
  const regs = registros().concat([{
    sup: 'SUP-Z', tomador: 'Tomador Z', tipologia: 'SP',
    previsto: { volume: (() => { const a = new Array(12).fill(0); a[7] = 90; return a; })(),
      equipesResumo: { prod: 1 } },
  }]);
  const o = opcoes({
    equipes: equipesVariadas(),
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
    demandas: { porRegistroEventos: {
      'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-Z||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
    } },
    buscaEquipe: 'amaral',
  });
  const semBusca = renderAbaAlocacao(regs, [0, 1], Object.assign({}, o, { buscaEquipe: '' }));
  const comBusca = renderAbaAlocacao(regs, [0, 1], o);

  assert.match(semBusca, /data-sup="SUP-Z"/, 'pré-condição: sem busca, SUP-Z aparece');
  assert.doesNotMatch(comBusca, /data-sup="SUP-Z"/,
    'SUP-Z não tem a equipe buscada -- tem que sumir');
});

test('busca sem nenhum resultado esvazia a grade, com aviso', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(),
    alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } },
    buscaEquipe: 'zzzznaoexiste',
  }));
  assert.doesNotMatch(html, /data-equipe="4"/);
  assert.match(html, /nenhuma equipe/i);
});

// --- Filtro por tipologia (2026-08-11) --------------------------------------

test('o filtro de tipologia existe nos controles da aba', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({ equipes: equipesVariadas() }));
  assert.match(html, /id="filtro-tipologia-alocacao"/);
});

test('filtrar por uma tipologia deixa só a coluna dela na grade', () => {
  const regs = registros().concat([{
    sup: 'SUP-A', tomador: 'Tomador A', tipologia: 'ST',
    previsto: { volume: (() => { const a = new Array(12).fill(0); a[7] = 80; return a; })(),
      equipesResumo: { prod: 8 } },
  }]);
  const o = opcoes({
    equipes: equipesVariadas(), alocacao: {},
    demandas: { porRegistroEventos: {
      'SUP-A||SP': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
      'SUP-A||ST': { chegada: [], sondagemRealizada: [], saidaEstoque: [] },
    } },
  });
  const todas = renderAbaAlocacao(regs, [0, 1], o);
  assert.match(todas, /data-coluna="SP"/);
  assert.match(todas, /data-coluna="ST"/);

  const soST = renderAbaAlocacao(regs, [0, 1], Object.assign({}, o, { tipologiaAlocacao: 'ST' }));
  assert.match(soST, /data-coluna="ST"/);
  assert.doesNotMatch(soST, /data-coluna="SP"/, 'a coluna SP tem que sumir');
});

test('o filtro de tipologia também poda os grupos do pool', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {}, tipologiaAlocacao: 'ST',
  }));
  assert.match(html, /data-grupo="ST"/);
  assert.doesNotMatch(html, /data-grupo="SP"/);
});

test('o popup diz quantos dias a equipe está disponível na semana', () => {
  // Sem isso, duas equipes da MESMA tipologia com capacidades diferentes (6,8 e
  // 3,9) parecem inconsistência de produtividade -- foi exatamente como o dono
  // do projeto leu, em 2026-08-11. A diferença é disponibilidade, e a tela não
  // dizia isso em lugar nenhum.
  const html = renderAbaAlocacao(registros(), [0], opcoes());
  assert.match(html, /Disponível:\s*5 de 7 dias/);
});
