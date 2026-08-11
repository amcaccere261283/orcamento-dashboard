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
  // indices vazio: nenhum registro cai em 'SUP-A||SP', então a célula só
  // existe porque a equipe '4' está alocada ali (via 'alocacao') -- tendência
  // e carteira ficam em zero, o mesmo estado que compute-alocacao.js
  // (commit de3a715) batizou de 'sem-demanda' em vez de cair, por engano,
  // em 'absorvido' (verde).
  const o = opcoes({ alocacao: { 4: { sup: 'SUP-A', coluna: 'SP' } } });
  const html = renderAbaAlocacao(registros(), [], o);
  assert.match(html, /Sem demanda/);
  assert.match(html, /leitura-neutra/);
  // A falha que este teste travaria: sem rótulo próprio, o lookup cai no
  // fallback `ROTULO_LEITURA[s.leitura] || s.leitura` e imprime o id cru.
  assert.doesNotMatch(html, /sem-demanda/);
});
