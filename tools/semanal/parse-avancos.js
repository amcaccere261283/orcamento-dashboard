'use strict';
const { excelSerialParaData } = require('../comum/datas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');

// Lê a aba "Avanços" do Avanço Sond.xlsx: 61.927 linhas, uma por furo. Só
// leitura e saneamento -- nenhuma agregação (isso é compute-demandas.js).
//
// Roda tanto no Node (build/testes) quanto no navegador: este arquivo ESTÁ em
// BUNDLE_ARQUIVOS (tools/semanal/render-semanal.js), porque o botão "Atualizar
// dados" reparseia o espelho de Avanços ao vivo. Os dois requires '../comum/'
// acima são de FORA do diretório que buildBrowserBundle concatena, então
// transformaModulo (tools/comum/browser-bundle.js) REMOVE as linhas em vez de
// reescrevê-las pra MODULOS -- assume-se que `excelSerialParaData` e
// `rotularTipologia` já existem como globais quando este código roda. Quem
// garante isso é renderSemanal(), que injeta fonteParaCliente() de
// tools/comum/datas.js e tools/comum/tipologias-avancos.js num <script> ANTES
// do bundle (mesmo mecanismo já documentado em compute-balanco.js e
// compute-demandas.js). No Node o require funciona normalmente, sem depender
// de nada disso -- por isso os testes passariam mesmo se a injeção sumisse:
// quem cobre isso é test/comum-browser-bundle.test.js.
//
// Colunas usadas, com o nome EXATO que mapear-producao-total.js produz a
// partir do Link 1 (sond.com.br/extrato-producao-total):
// Contrato · Criação da OS · Tipo · Status · Executado Dia · Deslocamento ·
// Observações de Campo · OS · Sondador.
//
// REESCRITO EM 2026-08-10 pelas decisões do dono do projeto:
//
// - "Executado Dia" é a ÚNICA data de execução que a fonte tem. As antigas
//   "Inicio Sondagem"/"Termino Sondagem" eram a MESMA data duplicada por
//   mapear-producao-total.js sob dois nomes -- confirmado pelo dono em
//   2026-08-10 ("confirmo que é o mesmo campo"). Uma coluna só, com o nome
//   do link, pela regra "não alterar nenhuma informação que venha dos links".
// - "Conclusão", "Cancelamento" e "Atualizado" não existem no Link 1 e
//   deixaram de ser fabricadas vazias. Os campos correspondentes saem daqui
//   como null: as séries que os liam (relatorioConcluido/canceladas, da aba
//   Demandas) já eram zero em 100% dos meses medidos, então o comportamento
//   delas não muda -- só fica explícito que a fonte não tem o dado.
// - Deslocamento vem da COLUNA própria do Link 1, não de um regex sobre o
//   texto livre de "Observações de Campo" -- ver DESLOCAMENTO_SIM abaixo.

// Janela de sanidade de data. A planilha só tem operação a partir de
// 2023-02; qualquer serial fora daqui é lixo (a coluna Inicio Sondagem tem
// de 1901 a 2078) e é tratado como ausente, nunca como data.
const SERIAL_MIN = 44927; // 2023-01-01
const SERIAL_MAX = 46388; // 2027-01-01

const COLUNAS_OBRIGATORIAS = {
  sup: 'Contrato',
  criacaoOS: 'Criação da OS',
  tipo: 'Tipo',
  status: 'Status',
  // A data de execução do furo: alimenta o evento "sondagem realizada"
  // (Realizado da Tabela Semanal e dos Gráficos) E a saída do estoque de
  // Demandas. É um campo só porque a fonte tem um campo só.
  executadoDia: 'Executado Dia',
  // Coluna própria do Link 1, valores "Sim"/"Não" (medido ao vivo em
  // 2026-08-10: 82 "Sim" e 1.971 "Não" em julho/2026, sem nenhuma vazia).
  deslocamento: 'Deslocamento',
  // Metragem total do furo. 0,01 é o marcador de "não produziu metragem" --
  // ver NAO_PRODUZIU abaixo.
  totalMetros: 'Total (m)',
  observacoesCampo: 'Observações de Campo',
  // A OS é o que liga o furo ao dia da aba EQ: é o código que aparece entre
  // parênteses lá ("CCR RioSP (17851-26)"), e é dele que sai o SUP daquele dia
  // de equipe. Medido em 2026-08-03: 1.960 de 1.960 OS resolvem para UM SUP.
  os: 'OS',
  // 'Sondador' (coluna Y) é quem executou o furo -- a única pista de EQUIPE
  // que existe numa fonte com data e SUP na mesma linha. Entra como
  // obrigatória, e não opcional, pelo mesmo motivo das outras: se a planilha
  // mudar de layout, o build tem que parar alto em vez de silenciosamente
  // zerar a série de equipes (mesmo princípio de tipologias-avancos.js).
  // 'Inicio Sondagem' vem junto porque a ocupação de uma equipe é o INTERVALO
  // do furo, não só o dia em que terminou.
  sondador: 'Sondador',
};

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

// Deslocamento, definido pelo dono do projeto em 2026-08-10: sondagem que
// aparece "Sim" nessa coluna NÃO foi finalizada por causa de alguma situação
// durante a execução, e acabou sendo executada em outra linha -- ou seja,
// originou outra linha de sondagem SEM gerar demanda nova. Por isso não
// conta nem em Sondagens Realizadas nem nas contas de Demandas: é o mesmo
// furo, reposicionado, e contá-lo duplicaria tanto o realizado quanto a
// chegada.
//
// Vinha de um regex sobre "Observações de Campo" até 2026-08-10. Medido ao
// vivo no Link 1 em julho/2026 (2.053 linhas), os dois critérios divergiam
// em 119 linhas (5,8%): a coluna acusa 82, o regex acusava 185; concordavam
// em 74; o regex derrubava 111 furos legítimos (bastava a palavra aparecer
// numa observação) e deixava passar 8 deslocamentos reais que ninguém tinha
// descrito em texto. A coluna é o dado; o texto livre era inferência.
const DESLOCAMENTO_SIM = 'SIM';

function ehDeslocamento(valor) {
  return texto(valor).toUpperCase() === DESLOCAMENTO_SIM;
}

// Metragem 0,01 é o marcador da fonte para furo que NÃO produziu metragem --
// não é um furo de 1 cm. Decisão do dono do projeto em 2026-08-10: sai do
// Realizado. Medido em jun+jul/2026: 92 linhas em 4.103, e só 5 delas também
// são deslocamento -- ou seja, é um corte quase inteiramente adicional.
//
// A fonte escreve com vírgula decimal; normaliza antes de comparar, e usa
// tolerância em vez de igualdade exata (0,01 não tem representação binária
// exata).
const METRAGEM_NAO_PRODUZIU = 0.01;

function naoProduziuMetragem(valor) {
  const n = parseFloat(texto(valor).replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n - METRAGEM_NAO_PRODUZIU) < 1e-9;
}

// Status cancelado. Praticamente inerte no Link 1 -- medido em 2026-08-10:
// ZERO linhas em jun+jul, e 29 em toda a base de 47.852. Fica implementado
// porque o dono do projeto o listou e porque protege se a fonte passar a
// devolver canceladas, mas não espere efeito visível.
function ehCancelado(valor) {
  return /CANCEL/i.test(texto(valor));
}

// Os três critérios são INDEPENDENTES (exclui se QUALQUER um bater), e isso
// não é interpretação: medido em jun+jul/2026, os três JUNTOS dão zero linhas
// -- como conjunção a regra nunca excluiria nada. Em OR são 262 de 4.103
// (6,4%).
function foraDoRealizado(linha, cols) {
  return ehDeslocamento(linha[cols.deslocamento])
    || naoProduziuMetragem(linha[cols.totalMetros])
    || ehCancelado(linha[cols.status]);
}

function locateColunasAvancos(headerRow) {
  const linha = headerRow || [];
  const cols = {};
  for (const [campo, rotulo] of Object.entries(COLUNAS_OBRIGATORIAS)) {
    let achou = -1;
    for (let col = 0; col < linha.length; col++) {
      if (texto(linha[col]) === rotulo) { achou = col; break; }
    }
    if (achou === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho da aba Avanços -- o layout da planilha pode ter mudado.`);
    }
    cols[campo] = achou;
  }
  return cols;
}

// Serial fora da janela, vazio ou não-numérico vira null. Sem isso, célula
// vazia viraria 1899-12-30 e entraria como mês válido em alguma série.
//
// Fallback pra dataDeTexto (dd/MM/yyyy): o .xlsx real entrega estas colunas
// como serial numérico, mas a Sheet ESPELHO que alimenta o botão "Atualizar
// dados" (Apps Script copiando via getValues()/setValues(), depois publicada
// como CSV) pode entregar a MESMA data como texto já formatado. Sem o
// fallback isso virava null em silêncio -- o botão reportaria "Atualizado"
// com Realizado/Tendência/Demandas zerados, sem erro nenhum. Continua
// devolvendo null quando não é nem serial na janela nem dd/MM/yyyy válido.
function dataSaneada(valor) {
  const serial = Number(valor);
  if (Number.isFinite(serial) && serial >= SERIAL_MIN && serial <= SERIAL_MAX) return excelSerialParaData(serial);
  return dataDeTexto(valor);
}

// A coluna Cancelamento é a ÚNICA data desta aba gravada como texto
// (dd/MM/yyyy), não como serial Excel. Medido em 2026-07-30: as 4.331 linhas
// CANCELADO têm valor e todas as 4.331 parseiam. Number() num "27/02/2025"
// devolve NaN -- foi assim que uma sondagem anterior concluiu, errado, que a
// coluna estava vazia, e o spec chegou a declarar Q (Atualizado) como âncora
// proxy das canceladas. Ver o bloco "Correção de 2026-07-30" no spec.
//
// Valida os componentes DEPOIS de montar a data: `new Date(Date.UTC(2025, 30, 31))`
// não é Invalid Date, é uma data deslocada para outro mês. Um Invalid Date
// solto seria pior que null -- ele compara `false` contra qualquer data, então
// o furo sairia da série de canceladas E do estoque, sem erro nenhum.
function dataDeTexto(valor) {
  const bruto = texto(valor);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return data;
}

function parseAvancos(grid) {
  const cols = locateColunasAvancos(grid[1]);
  const furos = [];
  let descartadas = 0;
  let semDataTermino = 0;
  let cancelamentoIlegivel = 0;
  let deslocamentos = 0;

  for (let r = 2; r < grid.length; r++) {
    const linha = grid[r];
    if (!linha) continue;
    const sup = texto(linha[cols.sup]);
    const tipoCru = texto(linha[cols.tipo]);
    // 21 linhas da planilha real não têm SUP, tipo nem profundidade -- são
    // resto de edição. Descartadas e contadas, nunca rotuladas (rotular
    // lançaria por tipologia vazia).
    if (!sup && !tipoCru) { descartadas++; continue; }

    // Descartada ANTES de rotular (não precisa de tipologia válida pra ser
    // excluída) -- ver foraDoRealizado acima. Sai de TODAS as séries: nem
    // Realizado, nem chegada, nem saída de estoque.
    if (foraDoRealizado(linha, cols)) { deslocamentos++; continue; }

    let tipologia;
    try {
      tipologia = rotularTipologia(tipoCru);
    } catch (err) {
      throw new Error(`${err.message} (linha ${r} da aba Avanços)`);
    }

    const status = texto(linha[cols.status]).toUpperCase();
    const executadoDia = dataSaneada(linha[cols.executadoDia]);
    if ((status === 'CONCLUIDO' || status === 'EXECUTADO') && executadoDia === null) {
      semDataTermino++;
    }

    furos.push({
      sup,
      tipologia,
      status,
      criacaoOS: dataSaneada(linha[cols.criacaoOS]),
      // A data de execução, uma só. Alimenta o evento de sondagem realizada
      // e a saída do estoque de demandas -- ver compute-demandas.js.
      executadoDia,
      // O Link 1 não traz estas três. Ficam explicitamente null em vez de
      // ausentes, pra quem consome poder distinguir "a fonte não tem" de
      // "esqueci de mapear". As séries que as leem já eram zero em 100% dos
      // meses medidos.
      conclusao: null,
      cancelamento: null,
      atualizado: null,
      // String vazia, nunca null, pra quem consome poder testar sem se
      // preocupar com o tipo.
      //
      // Vazio em 10.195 dos 51.819 furos úteis (medido em 2026-08-03), e isso
      // NÃO é lacuna de preenchimento: são exatamente os furos que ninguém
      // executou. Por status -- CONCLUIDO 40.749 furos com ZERO vazios,
      // EXECUTADO 859 com zero, PENDENTE 5.910 todos vazios, CANCELADO 4.301
      // com 4.285 vazios. Ou seja, todo furo executado tem sondador, e furo
      // não executado não ocupou equipe. A conta de equipes mobilizadas cobre
      // 100% do que existe para medir.
      sondador: texto(linha[cols.sondador]),
      os: texto(linha[cols.os]),
    });
  }

  return { furos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos };
}

module.exports = {
  parseAvancos, locateColunasAvancos, dataDeTexto, SERIAL_MIN, SERIAL_MAX,
};
