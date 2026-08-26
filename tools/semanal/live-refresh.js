'use strict';
const { parseCsvGrid, parseMatrizCliente } = require('./parse-matriz-cliente.js');
const { parseAvancos } = require('./parse-avancos.js');
const { parseLab } = require('./parse-lab.js');
const { computeDemandas, redirecionarSupsDesconhecidos, resolverSupConhecido } = require('./compute-demandas.js');
const { mesDaAbaEq, parseAbaEq } = require('./compute-equipes-ativas.js');

// live-refresh.js -- módulo COMPARTILHADO da lógica por trás do botão
// "Atualizar dados" (2026-08-25). Desenho original do recurso inteiro (antes
// de existir cópia nenhuma): ver
// docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md. Até
// aqui a função existia DUPLICADA, byte-idêntica exceto em dois pontos, em
// tools/semanal/render-semanal.js (atualizarDadosAoVivoSemanal, dentro de
// SCRIPT_CLIENTE_SEMANAL) e em tools/semanal/render-alocacao-pagina.js
// (mesma função, dentro de SCRIPT_CLIENTE_ALOCACAO) -- a segunda nasceu como
// cópia da primeira quando a aba Alocação Equipes virou página própria. Este
// módulo é a fonte única: as duas páginas passam a chamar
// atualizarDadosAoVivo(config) daqui (ver Tasks 2/3 do plano), cada uma
// passando sua própria config.
//
// Roda tanto no Node (esta suíte de testes) quanto no navegador -- é por
// isso que NADA aqui toca window/document/fetch no CORPO do módulo, só
// dentro de funções: o bundler do navegador (tools/comum/browser-bundle.js)
// concatena este arquivo cru dentro de uma IIFE, e o `require` acima só
// sobrevive à viagem porque está na forma EXATA
// `const { X } = require('./arquivo.js');` -- é essa forma que
// transformaModulo reescreve para `MODULOS['arquivo.js']`; qualquer outra
// forma (require não desestruturado, ou destruturado mas atribuído a uma
// variável de namespace) atravessa para o navegador sem ser reescrita e
// quebra lá, com os testes deste arquivo continuando verdes (Node resolve o
// require normalmente).
//
// As duas divergências que a cópia tinha viram config:
//   - divergência A: os 3 campos exclusivos da Alocação (equipesCsv/
//     osParaSup/equipesRosterPeriodo) -- gated por config.rosterAlocacao.
//   - divergência B: a chamada de redesenho no fim (recalcularSemanal() +
//     montarAbaDemandas() na Semanal; montarAbaAlocacao() na Alocação) --
//     cada página faz isso dentro do seu próprio config.aplicar(), que
//     também é responsável por escrever os globais (window.__REGISTROS__/
//     window.__DEMANDAS__ em cada página, hoje).
//
// ComputeEquipesRealizadoAlocado/ComputeEquipesNaoProdutivas NÃO entram por
// require aqui, ao contrário dos 5 módulos acima: chegam via
// config.modulos, opcionais. Um require direto viraria
// MODULOS['compute-equipes-realizado-alocado.js'] no bundle -- se alguma
// página que um dia use este módulo não bundlar aquele arquivo (ou bundlar
// numa ordem que ainda não o registrou), a desestruturação lê `undefined` de
// MODULOS e lança TypeError na hora zero da IIFE, derrubando o <script>
// INTEIRO -- não só o cálculo que dependia dele. config.modulos deixa a
// decisão (bundlar ou não, e o que fazer se faltar) com quem monta a config,
// não com este módulo.

// URL_ESPELHO_MATRIZ_SEMANAL: espelho da MATRIZ (Previsto/ticket médio),
// publicado pelo Apps Script que copia a planilha real -- ver
// build-dashboard.js para o caminho completo (planilha -> Apps Script ->
// Sheet publicada como CSV) e
// docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md para o
// desenho original. É a MESMA Sheet publicada que o orçamento já usa
// (tools/orcamento/render-dashboard.js) -- literal duplicado de propósito,
// não há como as duas páginas (dois builds independentes) compartilharem
// uma constante JS. Quem mexer aqui pensando "já existe em algum lugar" tem
// que mexer nos dois.
var URL_ESPELHO_MATRIZ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script copiando o .xlsx do
// Drive) pro CSV combinado publicado junto com a própria página -- gerado
// por tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
// build). Caminho relativo: mesmo domínio do GitHub Pages, sem CORS, e sem
// depender de um Apps Script rodando em outra conta. Ver
// docs/superpowers/specs/2026-08-05-avancos-online-design.md.
var URL_ESPELHO_AVANCOS_SEMANAL = 'avancos-online.csv';
var URL_ESPELHO_EQ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script) pro CSV publicado
// junto com a própria página -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL.
// Ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
var URL_ESPELHO_LAB_SEMANAL = 'lab-online.csv';
// 2026-08-10 (recuperado e reintegrado em 2026-08-11): produção CRUA do
// Link 7 -- "IdEquipe,SUP,Tipo,DiaEpoch", uma linha por (equipe, dia,
// contrato). Substitui o pré-agregado "SUP,Tipo,DiaEpoch,Fracao" de
// 2026-08-08 (Task 12/equipes FRACIONADAS): a fração agora é calculada no
// cruzamento com o roster (ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado),
// MESMA lógica que build-dashboard.js (montarEquipesRealizado) já faz --
// os dois nunca podem divergir. Mesmo nome de arquivo/padrão de publicação
// relativa dos outros dois -- só o formato do conteúdo mudou.
var URL_ESPELHO_EQUIPES_SEMANAL = 'equipes-online.csv';
// Roster (Link 6, multi-mês, já classificado por Estado) -- publicado junto
// com equipes-online.csv por atualizar-equipes-online.js. Ver o comentário
// acima e compute-equipes-realizado-alocado.js.
var URL_ESPELHO_EQUIPES_ROSTER_SEMANAL = 'equipes-roster-online.csv';
// 2026-08-10: os dois arquivos de BACKLOG (furos/ensaios ainda não
// executados), que até então só alimentavam o build a partir de dist/ --
// o botão nunca os buscava, e por isso zerava Demandas Pendentes a cada
// clique (5.493 furos + 12.781 ensaios pendentes, medidos em 2026-08-10,
// desapareciam com o status mostrando "Atualizado" em verde). Publicados
// junto com a própria página, mesmo padrão relativo dos CSVs de cima.
var URL_ESPELHO_DEMANDAS_SONDAGEM_SEMANAL = 'demandas-sondagem-online.csv';
var URL_ESPELHO_DEMANDAS_LAB_SEMANAL = 'demandas-lab-online.json';

// URLS_PADRAO: as 8 URL_ESPELHO_* de cima, num objeto chaveado pelos mesmos
// nomes que atualizarDadosAoVivo espera em config.fontes -- as duas páginas
// passam a ler daqui em vez de duplicar as 8 constantes.
var URLS_PADRAO = {
  matriz: URL_ESPELHO_MATRIZ_SEMANAL,
  avancos: URL_ESPELHO_AVANCOS_SEMANAL,
  lab: URL_ESPELHO_LAB_SEMANAL,
  eq: URL_ESPELHO_EQ_SEMANAL,
  producao: URL_ESPELHO_EQUIPES_SEMANAL,
  roster: URL_ESPELHO_EQUIPES_ROSTER_SEMANAL,
  demandasSondagem: URL_ESPELHO_DEMANDAS_SONDAGEM_SEMANAL,
  demandasLab: URL_ESPELHO_DEMANDAS_LAB_SEMANAL,
};

function periodosDoAno(ano) {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(ano, i, 1)));
  return periodos;
}

function buscarCsv(url) {
  // Guarda contra url vazia ANTES de tocar url.indexOf: as duas páginas
  // sempre passam uma URL de verdade pra 'matriz' (a única fonte sem
  // .catch), então isso é defensivo, não um caminho normal -- mas
  // buscarCsv(fontes.matriz) é avaliado na hora de montar o objeto
  // promessasPorNome, fora de qualquer .then/.catch. Sem esta guarda, uma
  // 'matriz' nula faria url.indexOf lançar SÍNCRONO ali, escapando do
  // .catch no fim da cadeia de promises e deixando o status congelado em
  // "Atualizando…" para sempre, em vez de reportar "Falha ao atualizar".
  if (!url) return Promise.reject(new Error('buscarCsv chamado sem URL'));
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

// parseAvancos/parseLab consomem a grade 1-INDEXADA de readXlsxSheet
// (tools/comum/xlsx-reader.js): grid[0] é sempre um buraco vazio, grid[1] é o
// cabeçalho, o dado começa em grid[2]. parseCsvGrid devolve uma grade
// 0-INDEXADA normal (grid[0] = cabeçalho, já que um CSV publicado não tem a
// linha 0 vazia que o .xlsx real tem). Sem este deslocamento, os dois parsers
// procurariam o cabeçalho na primeira linha de DADO e ou lançariam "Coluna não
// encontrada" ou desalinhariam tudo em silêncio.
//
// parseMatrizCliente NÃO passa por aqui de propósito: ele já foi escrito pra
// consumir a grade 0-indexada de parseCsvGrid direto (ver o comentário sobre
// grid[0] em parse-matriz-cliente.js).
function gridCsvComoXlsx(texto) {
  var g = parseCsvGrid(texto);
  g.unshift(null);
  return g;
}

// RE_URL_PENDENTE reconhece uma fonte ainda no literal placeholder
// "PENDENTE-..." e degrada com graça em vez de falhar tudo: enquanto
// QUALQUER uma das duas (Avanços/Lab) continuar placeholder, o refresh
// atualiza só a MATRIZ (Previsto/ticket médio) e preserva as demandas como
// estavam. URL_ESPELHO_AVANCOS_SEMANAL não bate mais nesse padrão desde
// 2026-08-05 (é sempre um caminho relativo real, 'avancos-online.csv') -- na
// prática só URL_ESPELHO_LAB_SEMANAL ainda pode estar pendente hoje, mas o
// mecanismo continua genérico pras duas.
var RE_URL_PENDENTE = /^PENDENTE-/;

// atualizarDadosAoVivo(config) -> Promise
//
// config:
//   fontes: { matriz, avancos, lab, eq, producao, roster, demandasSondagem,
//             demandasLab } -- cada uma uma URL string, ou null/undefined
//             pra NÃO buscar aquela fonte (nem tentar o fetch).
//   modulos: { ComputeEquipesRealizadoAlocado?, ComputeEquipesNaoProdutivas? }
//             -- opcionais: ausente => a saída que depende dele não é
//             calculada (sem lançar).
//   ano: number -- era window.__ANO__, usado só por periodosDoAno.
//   rosterAlocacao: boolean -- divergência A: liga os 3 campos exclusivos da
//             Alocação (equipesCsv/osParaSup/equipesRosterPeriodo).
//   estadoAtual: () => ({ registros, demandas }) -- era
//             window.__REGISTROS__/window.__DEMANDAS__, lidos uma vez no
//             início (o valor "antes" que os campos preservados usam).
//   aplicar: (registrosNovos, demandasNovas) => void -- escreve os globais
//             da página, remonta os filtros multi-select
//             (montarTodosFiltrosMultiSemanal(registrosNovos) -- comum às
//             DUAS páginas, render-semanal.js:2164 e
//             render-alocacao-pagina.js:1252, NÃO é a divergência B, é
//             OBRIGATÓRIA nas duas) e dispara o redesenho (divergência B,
//             essa sim específica de cada página):
//             recalcularSemanal()+montarAbaDemandas() na Semanal,
//             montarAbaAlocacao() na Alocação. Só é chamado depois que TODOS
//             os fetches tentados e TODO o parsing terminaram com sucesso --
//             nunca antes (atomicidade tudo-ou-nada).
//   definirStatus: (texto, ehErro) => void -- era
//             definirStatusAtualizacaoSemanal (document.getElementById).
//
// Tudo-ou-nada, mas só ENTRE as fontes que este refresh de fato tentou
// buscar: nenhuma escrita acontece (config.aplicar não é chamado) antes de
// todos os fetches tentados E de todo o parsing terminarem com sucesso --
// uma falha parcial (ex.: MATRIZ ok, Avanços fora do ar) não pode deixar
// registros/demandas referindo momentos diferentes. A fonte 'matriz' é a
// ÚNICA sem .catch: sua falha rejeita o refresh inteiro, de propósito --
// sem ela não existe registro nenhum pra atualizar.
function atualizarDadosAoVivo(config) {
  var cfg = config || {};
  var fontes = cfg.fontes || {};
  var modulos = cfg.modulos || {};

  cfg.definirStatus('Atualizando…', false);

  var avancosLabConfigurados = !!(fontes.avancos && fontes.lab)
    && !RE_URL_PENDENTE.test(fontes.avancos)
    && !RE_URL_PENDENTE.test(fontes.lab);

  // Monta o Promise.all a partir de uma LISTA de nomes, e lê o resultado por
  // NOME (nunca por índice posicional) -- essa é a diferença deliberada em
  // relação às duas cópias que este módulo substitui: lá, remover uma fonte
  // do meio da lista deslocava todos os textos[N] depois dela (ver o
  // histórico de comentários "os textos[6]/[7]/[8] de antes viraram
  // [5]/[6]/[7]" nas duas páginas), um jeito fácil de introduzir um bug
  // silencioso. Aqui, adicionar/remover uma fonte nunca desloca as outras --
  // e a lista de nomes é derivada de Object.keys(promessasPorNome) logo
  // abaixo (não duplicada à mão), então um nome presente num objeto e
  // esquecido no outro é IMPOSSÍVEL por construção, em vez de virar um
  // undefined silencioso dentro do Promise.all.
  var promessasPorNome = {
    matriz: buscarCsv(fontes.matriz),
    // avancos/lab NÃO têm .catch -- DELIBERADO, igual ao original (não é a
    // simplificação "todas as fontes menos matriz degradam sozinhas" que o
    // texto do brief desta task sugeria): com avancosLabConfigurados
    // verdadeiro, uma falha de rede em qualquer uma das duas tem que
    // derrubar o refresh inteiro, não só ficar de fora silenciosamente --
    // computeDemandas nunca roda com furos OU ensaios pela metade. Não
    // "consertar" isto pra bater com o brief.
    avancos: avancosLabConfigurados ? buscarCsv(fontes.avancos) : Promise.resolve(null),
    lab: avancosLabConfigurados ? buscarCsv(fontes.lab) : Promise.resolve(null),
    // Espelho da aba EQ (equipes ATIVAS). Falha sozinha: se esta única fonte
    // cair, o refresh continua atualizando MATRIZ/Avanços/Lab e o Δ equipes
    // fica com o dado anterior -- em vez de o refresh inteiro falhar por
    // causa da série secundária. Não depende de avancosLabConfigurados --
    // só de a fonte ter sido configurada.
    eq: fontes.eq ? buscarCsv(fontes.eq).catch(function () { return null; }) : Promise.resolve(null),
    // Produção CRUA (Link 7), cruzada com o roster mais abaixo. Gated pelo
    // MESMO avancosLabConfigurados dos dois de cima: o parse+cruzamento roda
    // depois de furos/ensaios estarem prontos. Falha sozinha, mesmo padrão
    // da aba EQ -- este CSV é publicado à parte, então um 404 por cópia
    // esquecida é o modo de falha ESPERADO.
    producao: (avancosLabConfigurados && fontes.producao)
      ? buscarCsv(fontes.producao).catch(function () { return null; })
      : Promise.resolve(null),
    // Demandas pendentes de sondagem/lab -- OPCIONAIS, mesmo espírito de
    // robustez que equipes/aba EQ: sem elas, Demandas Pendentes volta a
    // ficar sem o backlog, mas o resto do refresh conclui normalmente.
    // Gated por avancosLabConfigurados: fazem sentido só quando
    // furos/ensaios também estão sendo recalculados.
    demandasSondagem: (avancosLabConfigurados && fontes.demandasSondagem)
      ? buscarCsv(fontes.demandasSondagem).catch(function () { return null; })
      : Promise.resolve(null),
    // demandasLab é JSON, buscado direto com fetch (sem cache-busting,
    // diferente das outras fontes CSV) -- mesmo padrão das duas cópias que
    // este módulo substitui.
    demandasLab: (avancosLabConfigurados && fontes.demandasLab)
      ? fetch(fontes.demandasLab).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function () { return null; })
      : Promise.resolve(null),
    // Roster (Link 6) -- cruzado com produção (Link 7) mais abaixo. Gated
    // pelo MESMO avancosLabConfigurados dos demais de equipes. Falha
    // sozinha, mesmo padrão de todos os outros CSVs opcionais -- sem
    // roster, o Δ equipes fica sem dado novo (preserva o anterior), nunca
    // derruba o refresh inteiro.
    roster: (avancosLabConfigurados && fontes.roster)
      ? buscarCsv(fontes.roster).catch(function () { return null; })
      : Promise.resolve(null),
  };
  var nomesFontes = Object.keys(promessasPorNome);

  return Promise.all(nomesFontes.map(function (nome) { return promessasPorNome[nome]; }))
    .then(function (valores) {
      var textos = {};
      nomesFontes.forEach(function (nome, indice) { textos[nome] = valores[indice]; });

      var registrosNovos = parseMatrizCliente(parseCsvGrid(textos.matriz));
      if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho da MATRIZ -- confira se o Apps Script já rodou pelo menos uma vez');

      var estado = cfg.estadoAtual();
      var demandasNovas = estado.demandas;

      if (avancosLabConfigurados) {
        // Demandas pendentes de sondagem (OPCIONAL): mesmo tratamento que
        // build-dashboard.js -- as linhas de dado são anexadas ao grid de
        // Avanços ANTES do parse (mesmo formato de 10 colunas, HEADER_SAIDA),
        // então parseAvancos as lê como furos PENDENTE normais, sem precisar
        // de um caminho de código à parte.
        var gridAvancosCliente = parseCsvGrid(textos.avancos);
        if (textos.demandasSondagem) {
          var gridPendentesCliente = parseCsvGrid(textos.demandasSondagem);
          for (var iP = 1; iP < gridPendentesCliente.length; iP++) gridAvancosCliente.push(gridPendentesCliente[iP]);
        }
        gridAvancosCliente.unshift(null);
        var furosLidos = parseAvancos(gridAvancosCliente).furos;
        var ensaiosLidos = parseLab(gridCsvComoXlsx(textos.lab)).ensaios;
        // Demandas pendentes de lab (OPCIONAL): já chega no shape que
        // parseLab produz ({sup, tipologia, concluido, criacao}) -- só
        // reidrata 'criacao' de ISO string pra Date, mesmo que
        // atualizar-demandas-lab-online.js grava. 'concluido' já vem null.
        if (textos.demandasLab) {
          for (var iL = 0; iL < textos.demandasLab.length; iL++) {
            var pend = textos.demandasLab[iL];
            ensaiosLidos.push({
              sup: pend.sup, tipologia: pend.tipologia, concluido: null,
              criacao: pend.criacao ? new Date(pend.criacao) : null,
            });
          }
        }

        var furos = redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
        var ensaios = redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;

        // Falha alto em vez de reportar sucesso vazio: se vieram furos mas
        // NENHUM deles tem uma única data legível, o formato de data do
        // espelho mudou de um jeito que nem o serial nem o fallback
        // dd/MM/yyyy de dataSaneada reconhecem -- e computeDemandas
        // devolveria zeros em todas as séries com o status dizendo
        // "Atualizado". Erro antes de qualquer atribuição, pra manter a
        // atomicidade tudo-ou-nada.
        var algumaData = furos.some(function (f) { return f.criacaoOS || f.executadoDia; });
        if (furos.length > 0 && !algumaData) {
          throw new Error('nenhuma data legível encontrada nos furos do espelho de Avanços -- confira se o formato de data mudou (serial vs texto)');
        }

        demandasNovas = computeDemandas(furos, periodosDoAno(cfg.ano), ensaios);
        // equipesPorDia (Realizado) só vem do bloco REALIZADO (Link 6+7,
        // logo abaixo) -- sem cascata de mobilizadas/ATIVAS. equipesPeriodo
        // (cobertura do Realizado, lida por compute-balanco.js) fica null
        // até o bloco REALIZADO decidir; sem Link 6+7 utilizável, o refresh
        // preserva o que já estava no estado anterior (mesmo padrão dos
        // outros campos opcionais -- nunca apaga dado bom por falha de uma
        // fonte só).
        demandasNovas.equipesPorDia = estado.demandas.equipesPorDia;
        demandasNovas.equipesPeriodo = estado.demandas.equipesPeriodo;

        var csvEq = textos.eq;
        var periodoEq = csvEq ? mesDaAbaEq(csvEq) : null;

        // Divergência A: os 3 campos exclusivos da aba Alocação Equipes
        // (equipesCsv/osParaSup/equipesRosterPeriodo) -- só existem no
        // resultado quando config.rosterAlocacao === true. Preservados do
        // estado anterior por padrão (esta é a ÚNICA leitora destes 3
        // campos hoje -- escrever null zeraria a grade inteira de Alocação
        // com o status mostrando "Atualizado" em verde caso a Sheet EQ
        // falhe, csvEq null) e sobrescritos só dentro de if (periodoEq)
        // abaixo, exatamente como render-alocacao-pagina.js já fazia.
        //
        // A Sheet EQ (csvEq/periodoEq acima) alimenta SÓ estes 3 campos --
        // NUNCA mais o Realizado da Tabela Semanal (equipesPorDia), que é
        // exclusividade do bloco REALIZADO (Link 6+7) logo abaixo desde
        // 2026-08-21. As duas coisas competiram pela mesma fonte antes
        // disso; hoje são independentes de propósito.
        if (cfg.rosterAlocacao === true) {
          demandasNovas.equipesCsv = estado.demandas.equipesCsv;
          demandasNovas.osParaSup = estado.demandas.osParaSup;
          demandasNovas.equipesRosterPeriodo = estado.demandas.equipesRosterPeriodo;
          demandasNovas.producaoOnline = estado.demandas.producaoOnline;

          // osParaSup: só depende de 'furos', usado pela aba Alocação
          // Equipes (equipesDoQuadro resolve supRealizado/colunaRealizada a
          // partir dele). Declarado e populado FORA do if (periodoEq)
          // abaixo, de propósito (escopo de FUNÇÃO): com periodoEq falso ele
          // ainda precisa existir para a atribuição condicional lá dentro
          // não lançar ReferenceError.
          var osParaSup = {};
          furos.forEach(function (f) {
            if (f.os && f.sup && !osParaSup[f.os]) osParaSup[f.os] = f.sup;
          });

          if (periodoEq) {
            demandasNovas.equipesRosterPeriodo = periodoEq;
            demandasNovas.equipesCsv = csvEq;
            demandasNovas.osParaSup = osParaSup;
          }

          // producaoOnline (2026-08-26): produção crua do Link 7
          // (equipes-online.csv), fonte de supRealizado/colunaRealizada desde
          // a troca de origem (ver
          // docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md)
          // -- osParaSup deixou de ser lido por equipes-alocaveis.js, mas
          // continua populado acima por outros motivos (comentário dele).
          // Reparseado de textos.producao aqui, independente do bloco
          // REALIZADO logo abaixo (que exige TAMBÉM textos.roster e
          // modulos.ComputeEquipesRealizadoAlocado) -- Alocação só precisa da
          // produção crua, nunca do cruzamento com o roster.
          if (textos.producao) {
            var producaoOnlineAlocacao = [];
            textos.producao.trim().split('\n').slice(1).forEach(function (linha) {
              if (!linha) return;
              var pa = linha.split(',');
              var da = Number(pa[3]);
              if (!isFinite(da)) return;
              producaoOnlineAlocacao.push({ idEquipe: pa[0], sup: pa[1], tipo: pa[2], diaEpoch: da });
            });
            demandasNovas.producaoOnline = producaoOnlineAlocacao;
          }
        }

        // Δ equipes REALIZADO (Link 6+7, 2026-08-10) -- ver
        // docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md
        // e docs/superpowers/plans/2026-08-10-equipes-realizado-roster-link6-link7.md.
        // Única fonte de equipesPorDia desde 2026-08-21 -- se roster+produção
        // não responderem, ou o cruzamento não produzir nenhum par
        // utilizável, ou config.modulos.ComputeEquipesRealizadoAlocado não
        // tiver sido passado, equipesPorDia/equipesPeriodo ficam com o valor
        // já preservado acima, nunca uma fonte alternativa.
        if (textos.producao && textos.roster && modulos.ComputeEquipesRealizadoAlocado) {
          var rosterOnlineCliente = [];
          textos.roster.trim().split('\n').slice(1).forEach(function (linha) {
            if (!linha) return;
            var p = linha.split(',');
            var d = Number(p[1]);
            if (!isFinite(d)) return;
            rosterOnlineCliente.push({ idEquipe: p[0], diaEpoch: d, estado: p[2] });
          });
          var producaoOnlineCliente = [];
          textos.producao.trim().split('\n').slice(1).forEach(function (linha) {
            if (!linha) return;
            var p2 = linha.split(',');
            var d2 = Number(p2[3]);
            if (!isFinite(d2)) return;
            producaoOnlineCliente.push({ idEquipe: p2[0], sup: p2[1], tipo: p2[2], diaEpoch: d2 });
          });
          var resultadoRealizadoCliente = modulos.ComputeEquipesRealizadoAlocado.agregarEquipesRealizadoAlocado({
            roster: rosterOnlineCliente, producao: producaoOnlineCliente,
          });
          if (Object.keys(resultadoRealizadoCliente.porDia).length) {
            // MESMO redirecionamento que furos/ensaios levam mais acima:
            // par (contrato, tipologia) que a MATRIZ não conhece vira
            // "Diversos" em vez de sumir do Δ equipes -- e REALIZADO é a
            // fonte PRIMÁRIA dele. Ver o gêmeo em build-dashboard.js
            // (montarEquipesRealizado). resolverSup construída UMA VEZ fora
            // do loop.
            var resolverSupRealizado = resolverSupConhecido(registrosNovos);
            var porDiaRealizadoCliente = {};
            Object.keys(resultadoRealizadoCliente.porDia).forEach(function (chave) {
              var partes = chave.split('||');
              var chaveResolvida = resolverSupRealizado(partes[0], partes[1]) + '||' + partes[1];
              if (!porDiaRealizadoCliente[chaveResolvida]) porDiaRealizadoCliente[chaveResolvida] = {};
              var mapaDia = resultadoRealizadoCliente.porDia[chave];
              Object.keys(mapaDia).forEach(function (dia) {
                porDiaRealizadoCliente[chaveResolvida][dia] = (porDiaRealizadoCliente[chaveResolvida][dia] || 0) + mapaDia[dia];
              });
            });
            demandasNovas.equipesPorDia = porDiaRealizadoCliente;
            // Roster cobre múltiplos meses (backfill anual) -- declarar um
            // mês só aqui apagaria o Δ equipes de todos os outros, mesma
            // regra que build-dashboard.js (montarEquipesRealizado) já
            // documenta.
            demandasNovas.equipesPeriodo = null;
          }
        }

        // Equipes NÃO produtivas: reusa o MESMO csvEq/periodoEq já obtidos
        // acima para ativas -- nenhuma busca nova. Informação separada,
        // nunca somada em equipesPorDia. Só calculada quando
        // config.modulos.ComputeEquipesNaoProdutivas foi passado.
        if (modulos.ComputeEquipesNaoProdutivas && csvEq && periodoEq) {
          demandasNovas.equipesNaoProdutivas = modulos.ComputeEquipesNaoProdutivas.agregarEquipesNaoProdutivas({
            equipes: parseAbaEq(csvEq), ano: periodoEq.ano, mes: periodoEq.mes,
          }).porDiaPorMotivo;
        }
      }

      cfg.aplicar(registrosNovos, demandasNovas);

      var agora = new Date();
      var horario = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      var statusTexto = avancosLabConfigurados
        ? 'Atualizado às ' + horario
        : 'Atualizado (só MATRIZ) às ' + horario + ' -- Avanços/Lab pendente de configuração do Apps Script';
      cfg.definirStatus(statusTexto, false);
    })
    .catch(function (erro) {
      cfg.definirStatus('Falha ao atualizar: ' + erro.message, true);
    });
}

module.exports = { atualizarDadosAoVivo, URLS_PADRAO, RE_URL_PENDENTE };
