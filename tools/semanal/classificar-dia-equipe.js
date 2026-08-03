'use strict';

// Este módulo roda tanto no Node (build/testes) quanto embrulhado no navegador
// via buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow.
//
// CLASSIFICAÇÃO DO DIA DE UMA EQUIPE (aba EQ da planilha de equipes)
// ============================================================================
// A aba EQ tem uma linha por equipe e uma coluna por dia do mês. A célula do
// dia é TEXTO LIVRE, e é dela que sai o estado da equipe naquele dia. Medido em
// julho/2026 (3.006 equipe-dia ativos): 189 textos distintos, com a mesma ideia
// escrita de três jeitos ("Veículo quebrou", "Carro quebrado", "Carro quebrou").
//
// Quatro estados, e a decisão de qual conta como ATIVA é do dono do projeto
// (2026-08-03): "as que não estão em campo não são ativas, então desconsiderar;
// vamos tratar apenas as ativas".
//
//   'mobilizada'   -- OS entre parênteses, ou "OK". Está produzindo, e a OS diz
//                     em qual contrato. CONTA como ativa.
//   'campoSemFuro' -- equipe de campo existente, sem furo naquele dia:
//                     mobilização, veículo quebrado, chuva, parada de
//                     segurança, treinamento, carregando equipamento. CONTA
//                     como ativa (a equipe existe e está alocada).
//   'fora'         -- baixada, férias, folga, falta, atestado, afastamento.
//                     NÃO conta: decisão explícita de excluir férias e baixada.
//   'naoEquipe'    -- não é uma equipe de campo: em contratação, em admissão/
//                     integração, virou auxiliar de outra equipe, encarregado,
//                     pediu desligamento. NÃO conta.
//
// TEXTO NOVO FALHA ALTO, não cai calado em nenhum balde -- mesmo contrato de
// tipologias-avancos.js. Um texto não reconhecido significa que a planilha
// passou a descrever um estado que ninguém classificou, e engoli-lo mudaria o
// total de equipes ativas sem ninguém perceber. Quem chama decide o que fazer
// com o erro (o build para; o live-refresh mostra no status).

// OS entre parênteses. O \s* dos dois lados existe porque a planilha digita
// espaço sobrando: "CCR RioSP (17851-26 )-101". Mesmo achado que gerou a
// correção equivalente em tools/matriz/parse-eq.js (2026-08-03).
var RE_OS = /\(\s*(\d{3,6}-\d{2})\s*\)/;

// A LÓGICA É POR EXCEÇÃO, e isso foi medido, não escolhido por gosto.
//
// A primeira versão tentava enumerar as formas de dizer "está em campo" e
// falhar alto no resto. Rodada contra julho+agosto, sobraram 572 equipe-dia em
// 70 textos distintos que ela não reconhecia -- e quase todos eram equipe
// trabalhando: "CCR RioSP" (125), "RioSP (BR-101)" (108), "Via Mineira" (89),
// "com Geraldo" (17), "Em outra frente de serviço", "Inspeção RioSP", "Em São
// Pedro". Ou seja: o jeito de escrever "trabalhando" é cauda infinita (nome do
// tomador, do trecho, do colega, do lugar), enquanto o jeito de escrever
// AUSÊNCIA é finito e repetido -- baixada, férias, folga, falta, atestado,
// afastamento, licença.
//
// Então só as duas listas de exceção são enumeradas, e o DEFAULT é "equipe em
// campo". Um texto novo descrevendo trabalho entra certo sozinho; um texto
// novo de ausência é o único risco, e é por isso que quem chama recebe a lista
// dos textos que caíram no default (textosNoDefault) para revisão -- em vez de
// quebrar o build por causa de um nome de rodovia que ninguém tinha visto.
//
// Ordem importa: 'naoEquipe' vem ANTES do default porque "Auxiliar Flavio --
// carregar equipamento" é sobre alguém que virou auxiliar, não uma equipe
// carregando equipamento.
var REGRAS = [
  { estado: 'fora', re: /baixada|f[ée]rias|folga|falta|atestado|afasta|licen[çc]a|inss|acidente|desmobiliz|n[ãa]o atuou|sem atua[çc]/i },
  { estado: 'naoEquipe', re: /contrata|admiss|integra[çc]|\baso\b|auxiliar|encarregado|assumir equipe|pediu desligamento|desligad|sem previs|indicar|tratativa|verificando nomes/i },
  // Formas JÁ CATALOGADAS de "equipe em campo sem furo". Não mudam o
  // resultado (o default classifica igual), mas tiram esses textos do
  // relatório de revisão: sem isso, "Mobilização" e "Veículo quebrou"
  // apareceriam como novidade em todo build, e o relatório -- que existe para
  // destacar o que ninguém viu ainda -- viraria ruído.
  // Radicais, não palavras inteiras: a planilha escreve "Embargados",
  // "Embargo" e "Embargada" para a mesma coisa (foi assim que "Embargados"
  // escapou de /embargo/ na primeira escrita desta linha).
  { estado: 'campoSemFuro', re: /mobiliza|ve[íi]culo|carro|chuva|parada de seguran|treinamento|treinando|apoio|acompanhamento|carregar|carregando|suporte|retorn|embarg|inspe[çc][ãa]o|outra frente/i },
];

// texto -> { estado, os, noDefault } | null quando a célula está vazia (dia que
// a planilha ainda não preencheu -- não é estado nenhum, e quem chama ignora).
//
// noDefault:true marca que o texto não casou exceção nenhuma e foi tratado como
// equipe em campo pelo default. Quem chama acumula esses para relatório.
function classificarDiaEquipe(texto) {
  var t = String(texto === null || texto === undefined ? '' : texto).trim();
  if (!t) return null;

  var achouOs = RE_OS.exec(t);
  if (achouOs) return { estado: 'mobilizada', os: achouOs[1], noDefault: false };
  if (/^OK\b/i.test(t)) return { estado: 'mobilizada', os: null, noDefault: false };

  for (var i = 0; i < REGRAS.length; i++) {
    if (REGRAS[i].re.test(t)) return { estado: REGRAS[i].estado, os: null, noDefault: false };
  }

  return { estado: 'campoSemFuro', os: null, noDefault: true };
}

// Os dois estados que contam como equipe ATIVA, na definição do dono do
// projeto: está em campo (produzindo ou não), e não está de férias/baixada.
function contaComoAtiva(estado) {
  return estado === 'mobilizada' || estado === 'campoSemFuro';
}

module.exports = { classificarDiaEquipe, contaComoAtiva, RE_OS };
