'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaAlocacao, renderCartaoEquipe, corDaColuna } = require('../tools/semanal/render-aba-alocacao.js');
const { tipologiaColor } = require('../tools/semanal/render-aba-consolidado.js');
const { COLUNAS_ALOCACAO } = require('../tools/semanal/equipes-alocaveis.js');
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

// --- Cor da coluna: a paleta do matriz, não uma própria (2026-08-11) --------

// As mesmas tipologias de sondagem aparecem nos dois dashboards. Duas paletas
// para o mesmo vocabulário obrigam quem olha os dois a retraduzir cor toda vez,
// e a paleta que vale é a do matriz -- foi ela que passou por contraste
// (axe-core) e é a que a aba Consolidado desta MESMA página já usa nos chips.
test('cada coluna do quadro usa a cor da tipologia do matriz', () => {
  assert.deepStrictEqual(
    COLUNAS_ALOCACAO.map((c) => corDaColuna(c.id)),
    ['#3f851a', '#2f6ad0', '#8d6f00', '#606060', '#4a3aa7', '#db244e'],
    'SP verde, SM azul, ST amarelo, PI cinza, BL violeta, Especiais vermelho',
  );
});

test('a cor da coluna sai de tipologiaColor, não de uma cópia da paleta', () => {
  // Se alguém acrescentar uma coluna a COLUNAS_ALOCACAO, ela pega a cor certa
  // sozinha -- e nenhuma cópia da paleta pode divergir da do Consolidado.
  COLUNAS_ALOCACAO.forEach((c) => {
    assert.strictEqual(corDaColuna(c.id), tipologiaColor(c.id), c.id);
  });
});

test('nenhuma coluna cai no cinza de fallback de tipologiaColor', () => {
  // '#898781' é o "não sei que tipologia é essa". Uma coluna caindo nele
  // significa que o id dela deixou de casar com a paleta, e o quadro perderia
  // a distinção entre colunas sem nenhum aviso.
  COLUNAS_ALOCACAO.forEach((c) => {
    assert.notStrictEqual(corDaColuna(c.id), '#898781', c.id + ' perdeu a cor');
  });
});

test('o ponto do cartão pega a cor do GRUPO em que ele está, não a da 1ª tipologia', () => {
  // A equipe polivalente aparece em ST, PI e BL. Com a cor saindo de
  // colunas[0] ela levava o amarelo de ST nos três, e o ponto contradizia o
  // título do grupo -- invisível enquanto a paleta era arbitrária, gritante
  // depois que a cor passou a significar tipologia.
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesVariadas(), alocacao: {},
  }));
  const pool = html.split('<table')[0];
  const grupos = pool.split('data-grupo="').slice(1);
  const corPorGrupo = {};
  grupos.forEach((bloco) => {
    const id = bloco.slice(0, bloco.indexOf('"'));
    const m = bloco.match(/cartao-cor" style="background:([^"]+)"/);
    if (m) corPorGrupo[id] = m[1];
  });
  assert.strictEqual(corPorGrupo.ST, tipologiaColor('ST'));
  assert.strictEqual(corPorGrupo.PI, tipologiaColor('PI'));
  assert.strictEqual(corPorGrupo.BL, tipologiaColor('BL'));
});

// --- Disponíveis primeiro dentro do grupo (2026-08-11) ----------------------

// O pool é uma lista de OFERTA: quem está ali é candidato a ser arrastado. A
// equipe sem dia disponível na semana não é candidata -- o cartão dela vem
// apagado e não arrasta -- então deixá-la no meio das outras faz varrer com o
// olho por cima de opção que não é opção. Elas continuam VISÍVEIS (some seria
// mentir sobre o tamanho da frota); só vão para o fim do grupo.
function equipesComIndisponivel() {
  const base = { diasDisponiveis: 5, diasDaSemana: 7, disponivel: true,
    supRealizado: null, colunaRealizada: null, popup: {} };
  return [
    // A ordem de ENTRADA põe a indisponível na frente de propósito: sem o
    // ordenamento o HTML sai nessa mesma ordem, e o teste falha.
    Object.assign({ id: '1', lider: 'Prado', nome: 'Ana Prado', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base, { disponivel: false, diasDisponiveis: 0 }),
    Object.assign({ id: '2', lider: 'Queiroz', nome: 'Bia Queiroz', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base),
    Object.assign({ id: '3', lider: 'Rocha', nome: 'Caio Rocha', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base, { disponivel: false, diasDisponiveis: 0 }),
    Object.assign({ id: '5', lider: 'Sales', nome: 'Duda Sales', servicos: 'SP',
      colunas: ['SP'], polivalente: false }, base),
  ];
}

test('no pool, os disponíveis vêm antes dos indisponíveis dentro do grupo', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesComIndisponivel(), alocacao: {},
  }));
  const grupo = html.split('<table')[0];
  const ordem = [...grupo.matchAll(/data-equipe="(\d+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordem, ['2', '5', '1', '3'],
    'disponíveis primeiro, e a ordem original preservada dentro de cada metade');
});

test('a equipe indisponível continua no pool -- ordenar não é esconder', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesComIndisponivel(), alocacao: {},
  }));
  assert.match(html, /data-equipe="1"/, 'sumir mentiria sobre o tamanho da frota');
  assert.match(html, /cartao-indisponivel/);
});

test('a contagem do grupo continua contando as duas metades', () => {
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipesComIndisponivel(), alocacao: {},
  }));
  assert.match(html, /pool-grupo-contagem">\(4\)/,
    'o grupo SP tem 4 equipes, 2 delas indisponíveis');
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

// --- trava de veículo -------------------------------------------------------

test('o cartão traz o selo do veículo com o tamanho do grupo', () => {
  const equipe = {
    id: '660', lider: 'Fulano', nome: 'Fulano de Tal', colunas: ['ST'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'ELE-8E91 (9 p)' },
    veiculoGrupo: 'PLACA:ELE8E91', veiculoRotulo: 'ELE8E91',
    companheiros: ['644', '651', '656'],
  };
  const html = renderCartaoEquipe(equipe, null, null, false, 'ST');
  assert.match(html, /cartao-selo-veiculo/);
  assert.match(html, /ELE8E91/);
  assert.match(html, /4/, 'o selo diz quantas equipes dividem o veículo');
});

test('equipe sem companheiras NÃO ganha selo de veículo', () => {
  const equipe = {
    id: '92', lider: 'Sozinha', nome: 'Sozinha', colunas: ['SP'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'Próprio' }, veiculoGrupo: 'CARONA:92', veiculoRotulo: 'Carona ID 92',
    companheiros: [],
  };
  assert.doesNotMatch(renderCartaoEquipe(equipe, null, null, false, 'SP'), /cartao-selo-veiculo/);
});

test('conflito herdado marca o cartão e nomeia quem está no outro SUP', () => {
  const equipe = {
    id: '479', lider: 'Beltrano', nome: 'Beltrano', colunas: ['SM / SM.F / SR'],
    polivalente: false, disponivel: true, diasDisponiveis: 5, diasDaSemana: 7,
    popup: { veiculo: 'UDU8J88 (D, 9p)' },
    veiculoGrupo: 'PLACA:UDU8J88', veiculoRotulo: 'UDU8J88', companheiros: ['623'],
    conflitoVeiculo: [{ id: '623', sup: 'SUP-DOIS' }],
  };
  const html = renderCartaoEquipe(equipe, null, null, false, 'SM / SM.F / SR');
  assert.match(html, /cartao-conflito-veiculo/);
  assert.match(html, /623/);
  assert.match(html, /SUP-DOIS/);
});

test('renderAbaAlocacao calcula o conflito e ele chega ao cartão sem o chamador fazer nada', () => {
  // Duas equipes do mesmo veículo alocadas em SUPs diferentes: é o estado
  // herdado que a semeadura produz e que a trava NÃO corrige.
  const equipes = [
    {
      id: '479', lider: 'A', nome: 'A', colunas: ['SP'], polivalente: false, disponivel: true,
      diasDisponiveis: 5, diasDaSemana: 7, popup: {}, veiculoGrupo: 'PLACA:UDU8J88',
      veiculoRotulo: 'UDU8J88', companheiros: ['623'],
    },
    {
      id: '623', lider: 'B', nome: 'B', colunas: ['SP'], polivalente: false, disponivel: true,
      diasDisponiveis: 5, diasDaSemana: 7, popup: {}, veiculoGrupo: 'PLACA:UDU8J88',
      veiculoRotulo: 'UDU8J88', companheiros: ['479'],
    },
  ];
  const html = renderAbaAlocacao(registros(), [0], opcoes({
    equipes: equipes,
    alocacao: { 479: { sup: 'SUP-A', coluna: 'SP' }, 623: { sup: 'SUP-B', coluna: 'SP' } },
  }));
  assert.match(html, /cartao-conflito-veiculo/);
});
