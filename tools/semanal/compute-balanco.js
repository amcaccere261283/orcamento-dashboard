'use strict';
const { mediaEquipesPonderada } = require('../comum/calculo-equipes.js');
const { diaEpoch, dividirEmSemanas } = require('./compute-semanal.js');
const { equipesEquivalentes } = require('./compute-equipes-mobilizadas.js');

// Este módulo roda tanto no Node (testes) quanto embrulhado no navegador via
// buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow (ver o
// mesmo aviso em render-aba-semanal.js).
//
// O require acima é de um arquivo FORA do diretório que buildBrowserBundle
// concatena (tools/comum/, não tools/semanal/) -- a regex de transformaModulo
// em tools/comum/browser-bundle.js foi estendida pra reconhecer esse padrão e
// simplesmente REMOVER a linha no bundle (não vira MODULOS['...']: calculo-
// equipes.js não pode ser bundlado como um MODULOS comum porque importa o
// módulo node:fs no próprio topo, usado só por trechosParaCliente()/
// fonteParaCliente() -- ver o comentário de transformaModulo). Quem monta a
// página (Task 10, em render-semanal.js) precisa injetar fonteParaCliente()
// (mesmo mecanismo que tools/orcamento/render-dashboard.js já usa pra este
// MESMO módulo) num <script> ANTES do bundle que contém compute-balanco.js,
// pra que `mediaEquipesPonderada` já exista como função global quando este
// código rodar. No Node (testes) o require funciona normalmente, sem
// depender de nada disso -- ver a prova em
// test/comum-browser-bundle.test.js ("compute-balanco.js bundlado...").

// Gráfico Balanço de massa: um gráfico por tipologia, uma linha por SUP. A
// base (linha central) é 'previsto' ou 'previstoInicial' -- Tendência NÃO
// entra, foi descartada explicitamente pelo dono do projeto. dimensao é
// 'volume' | 'financeiro' (a dimensão do desvio principal; equipes sempre
// entra à parte, como a barra laranja).

// mesVigente: só o mês vigenteIdx. acumuladoAteMes: de janeiro (0) até
// vigenteIdx, INCLUSIVE -- "acumulado até o mês" inclui o próprio mês
// corrente, mesma leitura que o resto do projeto já usa pra acumulados.
//
// O recorte por SEMANA não passa por aqui: ele não é outro valor de 'periodo',
// é um filtro que se aplica DENTRO de mesVigente (ver selecaoDeSemanas). Isso
// porque as duas coisas respondem a perguntas diferentes -- "que meses?" e
// "que semanas do mês vigente?" -- e o usuário pode querer as duas ao mesmo
// tempo no futuro.
// equipesPeriodo descreve QUAL MÊS o equipesPorDia em uso cobre, ou null quando
// ele não tem restrição de período. Esta função responde se o período pedido
// está fora dele -- e é a MESMA usada pelo cálculo (para devolver sem-dado) e
// pelo desenho (para mostrar o aviso), de propósito: duas cópias da regra
// acabariam discordando, e a tela mostraria barra sem aviso ou aviso sem barra.
//
// O PARÂMETRO É AGNÓSTICO DE FONTE desde 2026-08-05, e o nome antigo
// (equipesAtivasPeriodo) era a causa de um bug: hoje são TRÊS fontes possíveis
// pra equipesPorDia, em ordem de prioridade, e só a última não tem período.
//
//   1. produtivas (campo/fotos online) -- cobre UM mês, o que foi buscado.
//   2. ativas (aba EQ)                 -- cobre UM mês, o da espelho.
//   3. mobilizadas (Avanço Sond)       -- ano inteiro, período null.
//
// Enquanto o campo se chamava "ativas", null significava "mobilizadas, sem
// restrição" e pular a checagem estava certo. Com produtivas na frente, dava
// para ter dado de UM mês com o campo de ativas null (espelho da aba EQ fora do
// ar) -- e aí escolher um mês passado desenhava um Δ equipes quase zero SEM
// aviso: exatamente a "barra zero enganosa" corrigida em 2026-08-01/03. Quem
// decide o valor é quem escolhe a fonte (build-dashboard.js e o live-refresh de
// render-semanal.js), e ele tem de mudar JUNTO com equipesPorDia.
//
// 'acumuladoAteMes' nunca é coberto: ele soma de janeiro até o mês, e um mapa
// de um mês só responderia por uma fatia, dando um número menor sem aviso.
function foraDaCoberturaDeEquipes(periodo, vigenteIdx, ano, equipesPeriodo) {
  if (!equipesPeriodo) return false;
  return periodo !== 'mesVigente'
    || typeof ano !== 'number'
    || ano !== equipesPeriodo.ano
    || vigenteIdx !== (equipesPeriodo.mes - 1);
}

function periodoParaIntervalo(periodo, vigenteIdx) {
  if (periodo === 'mesVigente') return { inicio: vigenteIdx, fim: vigenteIdx + 1 };
  if (periodo === 'acumuladoAteMes') return { inicio: 0, fim: vigenteIdx + 1 };
  return null;
}

// Normaliza a seleção de semanas para o que o resto do módulo consome: uma
// lista de índices válidos, ou null quando o recorte NÃO se aplica.
//
// Cai em null (= mês inteiro, exatamente o caminho de antes, sem nenhuma
// aritmética a mais) em quatro casos: sem calendário de semanas; seleção
// ausente; seleção vazia; e seleção com TODAS as semanas. Os dois últimos são
// o mesmo resultado por caminhos diferentes:
//
//   - nenhuma marcada = todas: mesma convenção "nada marcado mostra tudo" que
//     os filtros da barra compartilhada já usam (ver filtroExclui em
//     scriptFiltros), em vez de esvaziar a aba e parecer defeito.
//   - todas marcadas: a união das semanas É o mês (semanasDoMes corta sempre
//     dentro dele), então devolver null dá o mesmo número sem passar pela
//     repartição por dias -- bit a bit igual, não "igual com tolerância".
function selecaoDeSemanas(semanas, selecionadas) {
  if (!Array.isArray(semanas) || !semanas.length) return null;
  if (!Array.isArray(selecionadas) || !selecionadas.length) return null;
  var validos = selecionadas.filter(function (i) { return typeof i === 'number' && i >= 0 && i < semanas.length; });
  if (!validos.length || validos.length >= semanas.length) return null;
  return validos;
}

// A base é um número MENSAL: para recortá-la numa semana é preciso reparti-la.
// Usa dividirEmSemanas -- a MESMA função que a Tabela Semanal usa, não uma
// segunda cópia da regra -- e soma só as fatias marcadas. Repartir por dia (e
// não em fatias iguais por semana) é o que mantém as semanas de borda curtas
// honestas: julho/2026 tem S1 de 5 dias, agosto tem S6 de 1 dia.
//
// Equipes nunca chega aqui: é FOTO, não fluxo (2 equipes no mês são 2 equipes
// em qualquer semana) -- quem chama trata essa dimensão à parte, igual
// dividirEmSemanas já faz internamente.
function baseNasSemanas(valorMensal, semanas, selecao) {
  if (valorMensal === null || valorMensal === undefined) return null;
  var fatias = dividirEmSemanas(valorMensal, 'volume', semanas.length, semanas);
  var soma = null;
  selecao.forEach(function (i) {
    if (fatias[i] === null || fatias[i] === undefined) return;
    soma = (soma === null ? 0 : soma) + fatias[i];
  });
  return soma;
}

// Soma um array mensal (12 posições, null onde a planilha de origem estava
// em branco) dentro de [intervalo.inicio, intervalo.fim). null quando não há
// intervalo (períodos s1..s4, ver periodoParaIntervalo) ou quando 'mensal'
// não é um array (dimensão ausente na linha de base -- ver achaBaseline).
function somarIntervalo(mensal, intervalo) {
  if (!intervalo || !Array.isArray(mensal)) return null;
  var soma = null;
  var ini = Math.max(0, intervalo.inicio), lim = Math.min(mensal.length, intervalo.fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i];
  }
  return soma;
}

// Equipes é uma foto, não um fluxo -- média ponderada por dias
// (mediaEquipesPonderada, Task 4), nunca soma, mesma premissa em todo o
// projeto. null quando não há intervalo ou o array de equipes não existe.
function equipesNoIntervalo(mensal, intervalo) {
  if (!intervalo || !Array.isArray(mensal)) return null;
  return mediaEquipesPonderada(mensal, intervalo.inicio, intervalo.fim);
}

// Previsto Inicial é uma foto do início do projeto: procura por uma "chave"
// exata (sup + '||' + tipologia), com o SUP e a tipologia CRUS da MATRIZ.
//
// Isto só funciona porque baselineParaCliente (tools/semanal/build-dashboard.js)
// entrega a linha de base JÁ RECHAVEADA pela MATRIZ, via reconciliarLinhaBase
// (tools/comum/linha-base.js): o estudo original usa outros rótulos --
// 'LAB.'/'LAB. ESPECIAL' no lugar de LAB.C/LAB.E, e 7 SUPs com nome antigo
// ou descritivo. Casar a chave crua contra as chaves ORIGINAIS erraria em
// silêncio ~1/3 da grade real, e cada erro sairia como semBase:true,
// indistinguível do caso legítimo abaixo. A tradução NÃO pode acontecer
// aqui: este módulo roda no navegador, dentro do bundle, e carregar os dois
// mapas junto seria uma segunda cópia deles -- exatamente o que faria as
// duas páginas divergirem com o tempo.
//
// Contratos que entraram depois do estudo original genuinamente não têm
// chave aqui (ver a regra de semBase abaixo) -- esse é o único motivo que
// deve sobrar para não achar nada.
function chaveBaseline(sup, tipologia) {
  return sup + '||' + tipologia;
}

function achaBaseline(baseline, sup, tipologia) {
  var chave = chaveBaseline(sup, tipologia);
  var lista = baseline || [];
  for (var i = 0; i < lista.length; i++) {
    var item = lista[i];
    if (item && item.chave === chave) return item;
  }
  return null;
}

function ehPositivo(v) {
  return typeof v === 'number' && v > 0;
}

// Mesma chave de demandas.porRegistroEventos (chaveMatriz, tools/comum/
// linha-base.js) -- MESMA expressão de chaveBaseline acima, duplicada de
// propósito (mesmo motivo já documentado ali: este módulo roda no bundle
// do navegador e '../comum/...' é removido, não resolvido).
function chaveDemandas(sup, tipologia) {
  return sup + '||' + tipologia;
}

// TICKET médio (R$ por furo) do registro -- mesma premissa/mesma leitura
// que ticketMedio em render-aba-semanal.js (a MESMA usada pro Previsto de
// Financeiro no orçamento). Registro sem TICKET cadastrado conta 0.
function ticketMedio(registro) {
  return (registro && registro.previsto && registro.previsto.volumeResumo && registro.previsto.volumeResumo.ticket) || 0;
}

// Converte um intervalo de ÍNDICES de mês (ver periodoParaIntervalo, [inicio,
// fim) meio-aberto) num intervalo em dia-desde-época (mesma unidade dos
// eventos de porRegistroEventos, ver compute-demandas.js) -- 1º dia do mês
// 'inicio' até o último dia do mês 'fim - 1'. `Date.UTC(ano, fim, 0)` é o
// último dia do mês anterior a 'fim' (dia 0 rola pro mês de trás), o mesmo
// truque que fimDoMes usa em compute-demandas.js. null quando não há
// intervalo (ver periodoParaIntervalo) -- nunca reconstrói Date sem UTC
// (mesma convenção do resto do projeto, ver compute-semanal.js).
function intervaloParaEpoch(ano, intervalo) {
  if (!intervalo) return null;
  return {
    inicio: diaEpoch(new Date(Date.UTC(ano, intervalo.inicio, 1))),
    fim: diaEpoch(new Date(Date.UTC(ano, intervalo.fim, 0))),
  };
}

// Realizado calculado a partir dos furos reais do Avanço Sond (mesma fonte
// e mesmo evento -- sondagemRealizada -- que a Tabela Semanal usa), pesado
// por 'peso' (1 pra volume, ticketMedio(registro) pra financeiro -- mesmo
// pesoPorRegistro de contarEventosNoIntervalo em render-aba-semanal.js).
// SEMPRE devolve um número, nunca null: ausência de (sup,tipologia) em
// porRegistroEventos, ou nenhum evento no intervalo, é uma contagem real de
// zero (Avanço Sond é listagem completa -- mesma convenção "ausência =
// zero" de sempre), não "sem dado". É essa garantia que resolve o achado de
// 2026-08-01: a coluna Realizado da MATRIZ só é preenchida depois que o mês
// fecha (confirmado nos dados reais: TODOS os registros com Previsto em
// julho, o mês vigente à época, tinham Realizado da MATRIZ nulo -- nenhuma
// barra aparecia pra ninguém), então Mês Vigente precisa de uma fonte que
// já existe em tempo real -- os furos concluídos, que a Tabela Semanal já
// lê da mesma forma.
// 'intervalosEpoch' é uma LISTA de janelas [inicio, fim] fechadas: uma só (o
// mês inteiro) no caso normal, ou uma por semana marcada quando o recorte
// semanal está ativo. As janelas de semana nunca se sobrepõem (semanasDoMes
// devolve semana a semana, cortadas dentro do mês), então somar as contagens
// não conta furo duas vezes.
// 'serie' (opcional, padrão 'sondagemRealizada') escolhe QUAL evento do furo
// conta -- a dimensão Demandas (2026-08-03) passa 'chegada' pra medir o que
// ENTROU no período em vez do que foi executado nele. É o único parâmetro
// que separa as duas leituras: o resto da conta (janelas, peso, "ausência =
// zero") é idêntico, e duplicar a função por causa de um nome de campo faria
// as duas divergirem na primeira correção que só uma recebesse.
function realizadoDoAvancos(demandas, sup, tipologia, intervalosEpoch, peso, serie) {
  var porRegistroEventos = (demandas && demandas.porRegistroEventos) || {};
  var entrada = porRegistroEventos[chaveDemandas(sup, tipologia)];
  var eventos = (entrada && entrada[serie || 'sondagemRealizada']) || [];
  var contagem = 0;
  for (var i = 0; i < eventos.length; i++) {
    for (var j = 0; j < intervalosEpoch.length; j++) {
      if (eventos[i] >= intervalosEpoch[j].inicio && eventos[i] <= intervalosEpoch[j].fim) { contagem++; break; }
    }
  }
  return contagem * peso;
}

// { registros, indices, tipologia, base, dimensao, periodo, vigenteIdx, baseline,
//   demandas, ano } -> uma linha por SUP presente em 'indices' cuja
// tipologia bate com 'tipologia'. A grade de origem é densa (todo SUP tem
// linha em toda tipologia, a maioria zerada) -- por isso NÃO existe
// agrupamento por SUP aqui: cada (SUP, tipologia) já é um registro só na
// MATRIZ.
//
// 'demandas' (opcional, achado de 2026-08-01) e 'ano' (obrigatório junto
// com 'demandas') ativam o Realizado calculado do Avanço Sond -- SÓ pra
// periodo === 'mesVigente', a pedido explícito do dono do projeto
// ("usar o dado da planilha avanço sond somente para Mês Vigente");
// Acumulado até o mês continua lendo a coluna Realizado da própria MATRIZ,
// sem mudança. Sem 'demandas' (chamador não passou, ou 'ano' ausente),
// cai no comportamento de sempre (coluna da MATRIZ) -- retrocompatível com
// quem ainda não tem 'demandas' à mão.
// 'equipesPorDia' (2026-08-03): { 'sup||tipologia': { dia: nSondadores } },
// vindo de agregarEquipesPorDia (compute-equipes-mobilizadas.js). Quando
// presente, o Realizado de EQUIPES passa a ser as equipes MOBILIZADAS medidas
// no Avanço Sond, em qualquer período -- decisão do dono do projeto em
// 2026-08-03 ("contar sempre pela avanço sond, não pela matriz"), depois de a
// coluna Realizado de equipes da MATRIZ se mostrar inservível nos dois
// sentidos: 0 no mês corrente (déficit falso do previsto inteiro) e vazia no
// mês fechado (350 de 350 registros em julho/2026).
//
// Diferente do Realizado de volume/financeiro, que só usa o Avanço Sond em
// mesVigente: ali a coluna da MATRIZ é confiável depois do fechamento, aqui
// não é.
function calcularLinhas({ registros, indices, tipologia, base, dimensao, periodo, vigenteIdx, baseline, demandas, ano, semanas, semanasSelecionadas, equipesPorDia, hojeEpoch, equipesPeriodo }) {
  // Dimensão "Demandas" (2026-08-03): o que CHEGOU no período (evento
  // 'chegada' do Avanço Sond) contra o mesmo Previsto de VOLUME da MATRIZ.
  // Duas diferenças de comportamento, ambas deliberadas:
  //
  //   - a base sai da coluna de volume (dimensaoBase abaixo): a MATRIZ não tem
  //     previsão de demanda separada, e furo previsto é a grandeza comparável
  //     com furo chegado. Vale igual pra 'previsto' e pra 'previstoInicial';
  //   - o Realizado vem SEMPRE do Avanço Sond, em qualquer período -- volume e
  //     financeiro caem na coluna Realizado da MATRIZ fora de Mês Vigente, mas
  //     não existe coluna de demandas lá pra servir de fallback, e a de volume
  //     responderia outra pergunta. Sem o agregado de demandas, a linha fica
  //     SEM DADO (null), nunca zero: zero seria lido como "nenhuma demanda
  //     chegou", que é uma afirmação, não uma ausência.
  var ehDemandas = dimensao === 'demandas';
  var dimensaoBase = ehDemandas ? 'volume' : dimensao;
  var intervalo = periodoParaIntervalo(periodo, vigenteIdx);
  var intervaloEpoch = periodo === 'mesVigente' && typeof ano === 'number' ? intervaloParaEpoch(ano, intervalo) : null;
  var usarAvancosNoRealizado = periodo === 'mesVigente' && !!demandas && !!intervaloEpoch;
  // O intervalo de equipes cobre o período INTEIRO (mesVigente ou o acumulado
  // de janeiro até o mês), por isso não reaproveita intervaloEpoch acima, que
  // é deliberadamente só do mês vigente.
  var intervaloEpochPeriodo = typeof ano === 'number' ? intervaloParaEpoch(ano, intervalo) : null;

  // Recorte por semana: só dentro de Mês Vigente. Num acumulado de vários
  // meses as semanas do mês corrente não significam nada, então a seleção é
  // ignorada (a UI também desabilita o controle -- aqui é a garantia de que o
  // número não muda nem se alguém chamar direto).
  //
  // Equipes fica de fora do recorte da BASE por ser foto e não fluxo -- o
  // Previsto de 2 equipes no mês são 2 equipes em qualquer semana. Já o
  // REALIZADO de equipes é medido por dia (equipesPorDia), então ele respeita
  // o recorte semanal normalmente: é fluxo de ocupação, não foto.
  var selecao = periodo === 'mesVigente' ? selecaoDeSemanas(semanas, semanasSelecionadas) : null;
  var recortarBase = !!selecao && dimensao !== 'equipes';
  var janelasSemana = selecao
    ? selecao.map(function (i) { return { inicio: semanas[i].inicio, fim: semanas[i].fim }; })
    : null;
  var intervalosEpoch = !intervaloEpoch ? [] : (janelasSemana || [intervaloEpoch]);
  // Janelas em que as CHEGADAS são contadas: as semanas marcadas, ou o período
  // INTEIRO (intervaloEpochPeriodo, não intervaloEpoch -- este último é só do
  // mês vigente de propósito, e demandas vale em qualquer período). Ao
  // contrário das janelas de equipes logo abaixo, NÃO são truncadas em hoje:
  // não é uma média diluída pelos dias que ainda não aconteceram, é uma
  // contagem de eventos, e nenhum evento existe no futuro pra inflar nada.
  var janelasDemandas = janelasSemana || (intervaloEpochPeriodo ? [intervaloEpochPeriodo] : []);
  var usarAvancosNasDemandas = ehDemandas && !!demandas && janelasDemandas.length > 0;
  // Janelas de equipes: as semanas marcadas, ou o período inteiro -- SEMPRE
  // truncadas em hoje.
  //
  // Sem o truncamento a média sai diluída pelos dias que ainda não
  // aconteceram: medido em 03/08/2026, agosto dava 3,5 equipes equivalentes
  // contra 52,8 de julho, não porque a operação parou, mas porque 3 dias de
  // ocupação estavam sendo divididos por 31. A barra mostraria um déficit
  // enorme e falso -- exatamente o defeito que trocar a fonte veio corrigir.
  // Mesmo princípio que a Tabela Semanal já aplica ao contar eventos da
  // semana em curso só até hojeEpoch (ver calcularSeriesSemanaisDimensao).
  //
  // Janela inteiramente no futuro vira vazia e o realizado fica null (sem
  // dado), não zero: mês que ainda não começou não tem o que mostrar.
  var janelasEquipes = (janelasSemana || (intervaloEpochPeriodo ? [intervaloEpochPeriodo] : []))
    .map(function (janela) {
      if (typeof hojeEpoch !== 'number') return janela;
      return { inicio: janela.inicio, fim: Math.min(janela.fim, hojeEpoch) };
    })
    .filter(function (janela) { return janela.fim >= janela.inicio; });
  // Basta ter o mapa: uma janela VAZIA (período inteiro no futuro) tem de
  // virar sem-dado, e não cair no fallback da MATRIZ -- que responderia com o
  // 0 morto da coluna e desenharia déficit num mês que nem começou.
  var usarAvancosNasEquipes = !!equipesPorDia;

  // Cobertura do mapa de equipes ATIVAS (2026-08-03): a Sheet espelho da aba
  // EQ carrega UM mês, e é preciso saber se o período pedido é esse. Fora
  // dele, o Δ equipes fica SEM DADO -- decisão do dono do projeto: "ficar sem
  // dado e avisar", nunca preencher com outra métrica.
  //
  // Sem isso o efeito seria pior que errado: equipesEquivalentes devolveria 0
  // (janela válida, nenhum equipe-dia dentro), e a barra mostraria "zero
  // equipes" -- indistinguível de "a operação parou" -- num mês em que
  // simplesmente não temos o dado.
  //
  // 'acumuladoAteMes' nunca é coberto: ele soma de janeiro até o mês, e um
  // mapa de um mês só responderia por uma fatia, dando um número menor sem
  // nenhum aviso.
  var equipesForaDaCobertura = foraDaCoberturaDeEquipes(periodo, vigenteIdx, ano, equipesPeriodo);
  var linhas = [];

  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro || registro.tipologia !== tipologia) return;

    var mensalPrevisto = registro.previsto && registro.previsto[dimensaoBase];
    var mensalRealizado = registro.realizado && registro.realizado[dimensaoBase];

    var previstoPeriodo = somarIntervalo(mensalPrevisto, intervalo);
    if (recortarBase) previstoPeriodo = baseNasSemanas(previstoPeriodo, semanas, selecao);
    var realizadoPeriodo;
    if (ehDemandas) {
      realizadoPeriodo = usarAvancosNasDemandas
        ? realizadoDoAvancos(demandas, registro.sup, tipologia, janelasDemandas, 1, 'chegada')
        : null;
    } else if (usarAvancosNoRealizado) {
      var peso = dimensao === 'financeiro' ? ticketMedio(registro) : 1;
      realizadoPeriodo = realizadoDoAvancos(demandas, registro.sup, tipologia, intervalosEpoch, peso);
    } else {
      realizadoPeriodo = somarIntervalo(mensalRealizado, intervalo);
      // Realizado da MATRIZ é mensal (só existe em Acumulado até o mês, ou
      // quando não há 'demandas'): recortado pela mesma repartição por dias
      // que a base, senão o desvio compararia uma semana de base contra o mês
      // inteiro de realizado.
      if (recortarBase) realizadoPeriodo = baseNasSemanas(realizadoPeriodo, semanas, selecao);
    }

    // Atividade é por (SUP, tipologia) -- sobre Previsto da MATRIZ sempre, e
    // sobre Realizado da MATRIZ OU do Avanços (o que estiver em uso acima),
    // nunca sobre a base escolhida. É o que faz o gráfico mostrar só as
    // linhas com movimento de verdade, em vez de 34 SUPs com barra de
    // comprimento zero. As colunas inicio/termino do registro (janela
    // contratual) NÃO servem pra isso, não dizem se houve movimento nesta
    // tipologia especificamente.
    var ativo = ehPositivo(previstoPeriodo) || ehPositivo(realizadoPeriodo);

    var valorBase = null, equipesBase = null, semBase = false;

    // Base ausente NUNCA vira desvio zero: "não havia base" e "o realizado
    // bateu exatamente a base" são coisas opostas que apareceriam idênticas
    // se ambas virassem zero. A regra vale para as DUAS bases, não só para
    // 'previstoInicial': a MATRIZ também tem célula em branco (parse-matriz.js
    // emite null, não 0), e um SUP com Realizado e sem Previsto no intervalo
    // fica ativo:true -- ou seja, o filtro padrão NÃO o esconde e ele chegaria
    // ao gráfico com desvio null desenhado como barra de comprimento zero e
    // rótulo '—'. Zero de verdade (previsto lançado como 0) continua sendo
    // base válida: somarIntervalo só devolve null quando NENHUM mês do
    // intervalo tem valor.
    if (base === 'previstoInicial') {
      var entradaBaseline = achaBaseline(baseline, registro.sup, tipologia);
      if (!entradaBaseline) {
        semBase = true;
      } else {
        valorBase = somarIntervalo(entradaBaseline[dimensaoBase], intervalo);
        if (recortarBase) valorBase = baseNasSemanas(valorBase, semanas, selecao);
        equipesBase = equipesNoIntervalo(entradaBaseline.equipes, intervalo);
        if (valorBase === null) semBase = true;
      }
    } else {
      valorBase = previstoPeriodo;
      equipesBase = equipesNoIntervalo(registro.previsto && registro.previsto.equipes, intervalo);
      if (valorBase === null) semBase = true;
    }

    var valorRealizado = realizadoPeriodo;
    // Equipes MOBILIZADAS do Avanço Sond quando disponível; a coluna da MATRIZ
    // fica como fallback só para quem chama sem equipesPorDia (testes antigos,
    // e a página antes de 2026-08-03).
    var equipesRealizado = equipesForaDaCobertura ? null : usarAvancosNasEquipes
      ? equipesEquivalentes(equipesPorDia[chaveDemandas(registro.sup, tipologia)], janelasEquipes)
      : equipesNoIntervalo(registro.realizado && registro.realizado.equipes, intervalo);

    var desvio = (semBase || valorBase === null || valorRealizado === null) ? null : (valorRealizado - valorBase);
    var desvioEquipes = (semBase || equipesBase === null || equipesRealizado === null) ? null : (equipesRealizado - equipesBase);

    linhas.push({
      sup: registro.sup,
      tomador: registro.tomador,
      valorBase: semBase ? null : valorBase,
      valorRealizado: valorRealizado,
      desvio: desvio,
      equipesBase: semBase ? null : equipesBase,
      equipesRealizado: equipesRealizado,
      desvioEquipes: desvioEquipes,
      ativo: ativo,
      semBase: semBase,
    });
  });

  return linhas;
}

// Decrescente pelo desvio COM SINAL: +100, +70, +15, -50, -72.
// Isso satisfaz as duas exigências ao mesmo tempo (do maior para o menor,
// positivos antes dos negativos) sem precisar particionar por sinal. Note
// que entre negativos o menos negativo vem primeiro -- ordenar por módulo
// aqui inverteria essa parte e contrariaria o combinado.
function ordenarPorDesvio(linhas) {
  return linhas.slice().sort(function (a, b) {
    if (a.desvio === null && b.desvio === null) return 0;
    if (a.desvio === null) return 1;   // sem base vai pro fim
    if (b.desvio === null) return -1;
    return b.desvio - a.desvio;
  });
}

module.exports = { calcularLinhas, ordenarPorDesvio, foraDaCoberturaDeEquipes };
