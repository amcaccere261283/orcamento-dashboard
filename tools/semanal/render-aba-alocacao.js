'use strict';
const { montarGradeAlocacao, resumirAlocacao, classificarCelula } = require('./compute-alocacao.js');
const { COLUNAS_ALOCACAO } = require('./equipes-alocaveis.js');
const { formatarIntervaloSemana } = require('./render-aba-semanal.js');
// normalizarBusca NÃO é exportada de tools/comum/render-shell.js -- lá ela vive
// dentro de scriptFiltros(), inalcançável. render-aba-alertas.js tem uma cópia
// própria (documentada lá como cópia deliberada) e a exporta; a ordem de
// BUNDLE_ARQUIVOS já põe alertas antes desta aba, então o require resolve.
// Reimplementar a normalização aqui seria a terceira cópia, e duas
// normalizações divergentes é bug garantido.
const { normalizarBusca } = require('./render-aba-alertas.js');
// Mesma história de normalizarBusca acima: a paleta de tipologia do matriz já
// está neste bundle (render-aba-consolidado.js, que a copiou do orçamento, que
// a copiou do matriz), e BUNDLE_ARQUIVOS já registra o consolidado antes desta
// aba. Ver corDaColuna.
const { tipologiaColor } = require('./render-aba-consolidado.js');
// Trava de veículo (2026-08-12): grupos-veiculo.js não consome nada same-dir e
// já vem ANTES desta aba em BUNDLE_ARQUIVOS (render-semanal.js) -- é a mesma
// razão pela qual normalizarBusca/tipologiaColor acima também resolvem.
const { conflitosDeVeiculo } = require('./grupos-veiculo.js');

// Módulo dual (Node + navegador) -- mesmo padrão de render-aba-balanco.js:
// 'var'/'function', require no formato exato que transformaModulo
// (tools/comum/browser-bundle.js) reconhece (mesmo diretório, './arquivo.js').
// Este arquivo devolve uma STRING de HTML que render-semanal.js injeta em
// #secao-alocacao. Só markup -- o arrasto (Pointer Events) e o CSS entram na
// próxima tarefa do plano; aqui não há <style> nem addEventListener nenhum.
//
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmo formatador de render-aba-balanco.js: '—' pra ausência, N casas
// decimais (default 1 -- capacidade/carga desta aba são furos fracionários,
// não inteiros como o resto da página).
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 1 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function formatarPercentual(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v * 100) + '%';
}

// Os rótulos das 6 leituras, na ordem de LEITURAS_SUP (compute-alocacao.js).
// 'sem-demanda' (commit de3a715) é o sexto estado: SUP sem tendência e sem
// carteira, mas com equipe alocada ali -- alcançável desde que o quadro passa
// a semear sozinho a partir do realizado em toda primeira renderização da
// semana. Não é problema ('falta-equipe'/'sem-equipe') nem conquista
// ('absorvido') -- é uma equipe parada onde não há nada a fazer, e o rótulo
// tem que dizer isso num relance, não repetir o id cru.
var ROTULO_LEITURA = {
  'parado-com-carteira': 'Parado c/ carteira',
  'sem-equipe': 'Sem equipe',
  'falta-equipe': 'Falta equipe',
  antecipar: 'Antecipar',
  absorvido: 'Absorvido',
  'sem-demanda': 'Sem demanda',
};

var CLASSE_LEITURA = {
  'parado-com-carteira': 'leitura-parado',
  'sem-equipe': 'leitura-falta',
  'falta-equipe': 'leitura-falta',
  antecipar: 'leitura-antecipar',
  absorvido: 'leitura-ok',
  'sem-demanda': 'leitura-neutra',
};

// Compartilhado entre a CÉLULA e o resumo por EQUIPE, e os dois significados de
// `livre` são diferentes: na equipe é "está no pool, sem alocação" (e continua
// assim); na célula, "não há demanda a cobrir". Por isso 'sem-equipe' entrou
// como chave NOVA em 2026-08-11, em vez de renomear `livre` -- renomear
// quebraria o resumo por equipe em silêncio.
var ROTULO_SITUACAO = {
  fora: 'Fora da semana',
  livre: 'Livre',
  'sem-equipe': 'Sem equipe',
  folga: 'Com folga',
  equilibrada: 'Equilibrada',
  sobrecarregada: 'Sobrecarregada',
};

var CLASSE_SITUACAO = {
  fora: 'situacao-fora',
  livre: 'situacao-livre',
  'sem-equipe': 'situacao-sem-equipe',
  folga: 'situacao-folga',
  equilibrada: 'situacao-equilibrada',
  sobrecarregada: 'situacao-sobrecarregada',
};

// A cor da coluna é a cor da TIPOLOGIA no dashboard Matriz de Equipes, e não
// uma paleta própria desta aba.
//
// Até 2026-08-11 aqui vivia um array categórico indexado pela ordem de
// COLUNAS_ALOCACAO. Ele tinha dois problemas. O primeiro: as mesmas tipologias
// de sondagem aparecem nos DOIS dashboards, e duas paletas para o mesmo
// vocabulário obrigam quem olha os dois a retraduzir cor toda vez. O segundo,
// dentro desta própria página: ele usava #7fd858 e #e0684f -- exatamente o
// verde e o vermelho que a aba reserva para 'equilibrada' e 'sobrecarregada'.
// Um ponto verde no cartão não podia significar "coluna ST" numa tela onde
// verde significa "está bem".
//
// A paleta não é copiada de novo: `tipologiaColor` já vive neste bundle, em
// render-aba-consolidado.js (que por sua vez a copiou do matriz, via
// orçamento), e a ordem de BUNDLE_ARQUIVOS já põe o consolidado antes desta
// aba -- mesma razão pela qual normalizarBusca vem de render-aba-alertas.js
// logo acima. Uma quarta cópia da paleta é uma divergência esperando
// acontecer.
//
// Os seis ids de COLUNAS_ALOCACAO resolvem sozinhos: 'SP'/'ST'/'PI'/'BL' são
// chaves diretas, 'Especiais' casa ESPECIAIS, e 'SM / SM.F / SR' cai no
// primeiro token ('SM') pela última regra de tipologiaColor. Nenhum vai parar
// no cinza de fallback -- há teste travando isso, porque uma coluna que caísse
// nele perderia a distinção sem nenhum aviso na tela.
function corDaColuna(colunaId) {
  return tipologiaColor(colunaId);
}

// --- Guardas, antes de qualquer grade -------------------------------------

// A Sheet espelho da aba EQ não respondeu (build e live-refresh falharam).
// Sem roster não há como desenhar nada -- um quadro vazio leria como
// "nenhuma equipe alocada", que é uma afirmação diferente e falsa desta.
function renderGuardaSemRoster() {
  return '<div class="alocacao-guarda alocacao-guarda-erro">'
    + '<p>A Sheet espelho da aba EQ não respondeu. Sem o roster de equipes não há '
    + 'quadro para desenhar -- tente atualizar os dados ou volte mais tarde.</p>'
    + '</div>';
}

// O espelho da aba EQ só cobre o mês corrente -- semana de outro mês não tem
// roster fresco. A grade continua desenhada (com o realizado da última vez
// que o mês foi o corrente), mas nenhum cartão é arrastável.
function renderAvisoSomenteLeitura() {
  return '<div class="alocacao-aviso-somente-leitura">Somente leitura: o espelho da '
    + 'aba EQ só cobre o mês corrente, e a semana selecionada é de outro mês. Os '
    + 'cartões abaixo não podem ser arrastados até você voltar ao mês vigente.</div>';
}

// --- Controles --------------------------------------------------------------

function renderBotoesSemana(semanas, semanaAtual, desabilitado) {
  if (!Array.isArray(semanas) || !semanas.length) return '';
  var html = '<span class="alocacao-semanas">';
  semanas.forEach(function (semana, i) {
    var ativa = semanaAtual && semana.inicio === semanaAtual.inicio && semana.fim === semanaAtual.fim;
    html += '<button type="button" class="botao-semana-alocacao' + (ativa ? ' ativo' : '') + '"'
      + ' data-semana="' + i + '"' + (desabilitado ? ' disabled' : '') + '>'
      + 'S' + (i + 1) + ' (' + escapeHtml(formatarIntervaloSemana(semana.inicio, semana.fim)) + ')'
      + '</button>';
  });
  return html + '</span>';
}

// Status: modo de persistência (local/sheet) e a fila de movimentos não
// gravados. Nunca escondido -- é o que diz à pessoa se o que ela está vendo
// já está publicado para todo mundo ou só nesta máquina.
function renderStatus(modoPersistencia, pendentes) {
  var partes = [];
  if (modoPersistencia === 'local') {
    partes.push('gravando só neste navegador — a planilha de alocação ainda não foi publicada');
  }
  var n = pendentes || 0;
  if (n > 0) {
    partes.push(n + ' movimento(s) não gravado(s)'
      + ' <button type="button" data-acao="tentar-de-novo">Tentar de novo</button>');
  }
  if (!partes.length) partes.push('alocação em dia com a planilha');
  return '<span id="status-alocacao">' + partes.join(' · ') + '</span>';
}

function renderControles(o, somenteLeitura) {
  var desabilitado = !!somenteLeitura;
  return '<div class="controles-alocacao">'
    + renderBotoesSemana(o.semanas, o.semana, desabilitado)
    + '<button type="button" data-acao="repor-realizado"' + (desabilitado ? ' disabled' : '') + '>Repor o realizado</button>'
    + '<button type="button" data-acao="limpar-alocacao"' + (desabilitado ? ' disabled' : '') + '>Limpar alocação</button>'
    // Controle PRÓPRIO da aba, e não da barra de filtros compartilhada: aquela
    // opera sobre `registros` (indicesFiltrados), e equipe não é registro --
    // ali este campo não faria nada em cinco das sete abas.
    + '<input id="busca-equipe" type="text" class="busca-equipe"'
    + ' placeholder="Buscar equipe (id ou líder)..." autocomplete="off"'
    + ' value="' + escapeHtml(o.buscaEquipe || '') + '">'
    // Filtro por tipologia PRÓPRIO da aba: as opções são os 6 grupos de
    // COLUNAS_ALOCACAO, não as 10 tipologias cruas da MATRIZ que a barra
    // compartilhada oferece -- aqui o vocabulário é o das colunas do quadro.
    + '<select id="filtro-tipologia-alocacao" class="filtro-tipologia-alocacao">'
    + '<option value="">Todas as tipologias</option>'
    + COLUNAS_ALOCACAO.map(function (c) {
      return '<option value="' + escapeHtml(c.id) + '"'
        + (o.tipologiaAlocacao === c.id ? ' selected' : '') + '>'
        + escapeHtml(c.rotulo) + '</option>';
    }).join('')
    + '</select>'
    + renderStatus(o.modoPersistencia, o.pendentes)
    + '</div>';
}

// --- Nível 1: a faixa do topo ------------------------------------------------

function renderFaixaAlocacao(totais) {
  var t = totais || {};
  function metrica(rotulo, valor, casas) {
    return '<div class="metrica-alocacao"><span class="metrica-valor">'
      + formatarNumero(valor, casas === undefined ? 1 : casas)
      + '</span><span class="metrica-rotulo">' + escapeHtml(rotulo) + '</span></div>';
  }
  return '<div class="faixa-alocacao">'
    + metrica('Tendência da semana', t.tendencia)
    + metrica('Capacidade alocada', t.capacidadeAlocada)
    + metrica('Saldo', t.saldo)
    + metrica('Carteira em aberto', t.carteira, 0)
    + metrica('Capacidade ociosa', t.capacidadeOciosa)
    + '</div>';
}

// --- Busca de equipe ----------------------------------------------------------

// Casa contra os TRÊS campos, e não só contra o que o cartão mostra. Medido na
// Sheet em 2026-08-11: a coluna 1 ("Equipe") traz o nome completo e a 4
// ("Líderes") traz o apelido -- "José I. Amaral" e "Amaral" são a MESMA pessoa,
// e o cartão exibe só o apelido. Casar apenas o visível deixaria "josé" sem
// achar ninguém, e quem digita procura pela pessoa, não pela abreviação que a
// planilha escolheu.
function equipeCasaBusca(equipe, termoNormalizado) {
  if (!termoNormalizado) return true;
  var campos = [equipe.id, equipe.lider, equipe.nome];
  for (var i = 0; i < campos.length; i++) {
    if (normalizarBusca(campos[i] || '').indexOf(termoNormalizado) !== -1) return true;
  }
  return false;
}

// Verdadeiro quando o casamento veio SÓ do nome completo. Aí o cartão passa a
// exibi-lo, senão o resultado parece aleatório: busca "josé", aparece "Amaral".
function casouSoPeloNome(equipe, termoNormalizado) {
  if (!termoNormalizado) return false;
  var visivel = normalizarBusca(equipe.id || '') + ' ' + normalizarBusca(equipe.lider || '');
  if (visivel.indexOf(termoNormalizado) !== -1) return false;
  return normalizarBusca(equipe.nome || '').indexOf(termoNormalizado) !== -1;
}

// --- Cartão + popup da equipe -------------------------------------------------

// resumoEquipe: a linha correspondente de resumirAlocacao().porEquipe (pode
// ser null quando a equipe nem chegou a entrar no resumo -- não deveria
// acontecer no fluxo real, mas o card não pode quebrar por isso).
// colunaContexto: a coluna EM QUE este cartão está sendo desenhado -- o grupo
// do pool ou a coluna da célula. Só importa para a equipe polivalente, que
// aparece em vários lugares: sem ele a cor saía de colunas[0] e a mesma equipe
// levava o amarelo de ST nos grupos PI e BL, com o ponto contradizendo o
// título logo acima. Ausente (chamada fora de um contexto de coluna), cai em
// colunas[0], que para equipe de coluna única é a mesma coisa.
function renderCartaoEquipe(equipe, resumoEquipe, somenteLeitura, mostrarNome, colunaContexto) {
  var colunas = equipe.colunas || [];
  var corPrincipal = corDaColuna(
    colunaContexto && colunas.indexOf(colunaContexto) !== -1 ? colunaContexto : colunas[0]);
  var arrastavel = equipe.disponivel && !somenteLeitura;
  var popup = equipe.popup || {};

  // Trava de veículo (2026-08-12): o selo só aparece quando há companheira de
  // verdade -- grupo de uma equipe só é o caso comum (63 das 117), e um selo
  // ali seria ruído puro.
  var companheiros = equipe.companheiros || [];
  var temGrupo = companheiros.length > 0;
  var conflito = equipe.conflitoVeiculo || null;

  var cartao = '<div class="cartao-equipe' + (equipe.polivalente ? ' cartao-polivalente' : '')
    + (equipe.disponivel ? '' : ' cartao-indisponivel')
    + (conflito ? ' cartao-conflito-veiculo' : '') + '"'
    + ' data-equipe="' + escapeHtml(equipe.id) + '"'
    + ' data-colunas="' + escapeHtml(colunas.join(',')) + '"'
    + ' data-arrastavel="' + (arrastavel ? 'sim' : 'nao') + '"'
    + '>'
    + '<span class="cartao-medalhao">' + escapeHtml(equipe.id) + '</span>'
    // O selo avisa que este MESMO cartão aparece em outros grupos do pool --
    // sem ele, a repetição da Decisão 4 leria como equipes diferentes.
    + (equipe.polivalente ? '<span class="cartao-selo-poli" title="aparece em mais de um grupo">⇄</span>' : '')
    // Selo permanente (não confundir com .cartao-companheiro, o destaque
    // efêmero do gesto): quantas equipes dividem este veículo.
    + (temGrupo
      ? '<span class="cartao-selo-veiculo" title="' + escapeHtml(String(companheiros.length + 1))
        + ' equipes no veículo ' + escapeHtml(equipe.veiculoRotulo || '—') + '">🚐 '
        + escapeHtml(String(companheiros.length + 1)) + '</span>'
      : '')
    + '<span class="cartao-cor" style="background:' + corPrincipal + '"></span>'
    + '<span class="cartao-lider">' + escapeHtml(equipe.lider) + '</span>'
    // Só quando o casamento veio do nome completo -- ver casouSoPeloNome.
    + (mostrarNome && equipe.nome ? '<span class="cartao-nome">' + escapeHtml(equipe.nome) + '</span>' : '')
    + (equipe.disponivel ? '' : '<span class="cartao-motivo">sem dia disponível nesta semana</span>')
    + '</div>';

  // O popup mostra só o que a aba EQ carrega -- ID, líder, habilitação,
  // tipologia, veículo + proprietário, equipamentos, tomador, capacidade e
  // ocupação. NUNCA "efetivo" nem nome de pessoa: o roster de quem compõe a
  // equipe vive na aba PESSOAS, que este projeto não lê (decisão explícita
  // do dono do projeto).
  var equipamentos = (popup.equipamentos || []).map(escapeHtml).join(', ') || '—';
  var capacidade = resumoEquipe ? resumoEquipe.capacidade : null;
  var ocupacao = resumoEquipe ? resumoEquipe.ocupacao : null;
  var popupHtml = '<div class="popup-equipe">'
    + '<p class="popup-titulo">Equipe ' + escapeHtml(equipe.id) + ' — ' + escapeHtml(equipe.lider) + '</p>'
    + '<p>Habilitação: ' + escapeHtml(popup.habilitacao || '—') + '</p>'
    + '<p>Tipologia: ' + escapeHtml(colunas.join(', ') || '—') + '</p>'
    + (equipe.polivalente
      ? '<p class="popup-poli">Aparece nos grupos: ' + escapeHtml(colunas.join(', ')) + '</p>'
      : '')
    + '<p>Veículo: ' + escapeHtml(popup.veiculo || '—') + ' · Proprietário: ' + escapeHtml(popup.proprietario || '—') + '</p>'
    + (temGrupo
      ? '<p class="popup-veiculo-grupo">Mesmo veículo (' + escapeHtml(equipe.veiculoRotulo || '—')
        + '): equipes ' + escapeHtml(companheiros.join(', '))
        + ' — andam juntas: o quadro move o grupo inteiro de uma vez.</p>'
      : '')
    + (conflito
      ? '<p class="popup-conflito-veiculo">Conflito: ' + conflito.map(function (c) {
        return escapeHtml(c.id) + ' em ' + escapeHtml(c.sup);
      }).join(', ') + '. Veio do realizado ou de uma alocação antiga — mova uma delas para resolver.</p>'
      : '')
    + '<p>Equipamentos: ' + equipamentos + '</p>'
    + '<p>Tomador atual: ' + escapeHtml(popup.tomador || '—') + '</p>'
    // Os dias explicam por que duas equipes da MESMA tipologia têm capacidades
    // diferentes -- a produtividade é igual (tabela por tipologia), o que muda
    // é quantos dias a equipe está ativa na semana. Sem esta linha, 6,8 e 3,9
    // em duas equipes de SP leem como inconsistência de produtividade; foi
    // exatamente assim que o dono do projeto leu em 2026-08-11.
    + '<p>Disponível: ' + formatarNumero(equipe.diasDisponiveis, 0) + ' de '
    + formatarNumero(equipe.diasDaSemana, 0) + ' dias da semana</p>'
    + '<p>Capacidade: ' + formatarNumero(capacidade) + ' · Ocupação: ' + formatarPercentual(ocupacao) + '</p>'
    + '</div>';

  return '<div class="cartao-equipe-slot">' + cartao + popupHtml + '</div>';
}

// O pool: cartões das equipes SEM destino nesta semana, mais a lista
// recolhida "fora do quadro (N)" -- Lab/TST/SN, que nunca somem calados.
// `alocacao` é a alocação CRUA, e não o resumo da grade, de propósito
// (Decisão 7 do spec de 2026-08-11). Com o filtro de SUP podando a linha,
// resumirAlocacao devolve sup: null para uma equipe que ESTÁ alocada -- decidir
// por ele a traria de volta ao pool como se estivesse livre, e daria pra
// alocá-la uma segunda vez, em dois SUPs ao mesmo tempo.
function renderPool(equipes, foraDoQuadro, porEquipeMap, somenteLeitura, alocacao, buscaEquipe, tipologia) {
  var lista = equipes || [];
  var aloc = alocacao || {};
  var termo = normalizarBusca(buscaEquipe || '');
  var casam = lista.filter(function (e) { return equipeCasaBusca(e, termo); });
  var noPool = casam.filter(function (e) {
    var destino = aloc[e.id];
    return !(destino && destino.sup);
  });
  // Equipe que casa a busca mas ESTÁ alocada não some calada: a poda sozinha
  // responderia "não achei" para uma equipe que existe. Vira TEXTO, não cartão
  // -- arrastar se faz da célula, e um segundo cartão arrastável reintroduziria
  // o risco de dupla alocação da Decisão 7.
  var alocadasQueCasam = termo ? casam.filter(function (e) {
    var destino = aloc[e.id];
    return !!(destino && destino.sup);
  }) : [];

  // Um bloco por coluna, na ORDEM CANÔNICA de COLUNAS_ALOCACAO -- a mesma da
  // grade, para o olho não ter que traduzir entre as duas metades da tela.
  //
  // A equipe aparece em TODOS os grupos que serve, e não num "Polivalentes"
  // separado. Medido em 2026-08-11: não existe nenhuma equipe com serviço 'BL'
  // sozinho -- as 6 de 'ST | PI | BL' são as únicas candidatas a BL que
  // existem, e num pool que as isolasse o grupo BL nasceria sempre vazio,
  // justamente a pergunta que o agrupamento deveria responder.
  //
  // O preço é a repetição (7 polivalentes viram 20 cartões, num pool de ~127
  // para 114 equipes); o selo no cartão existe para ela não ser lida como
  // equipes diferentes. A duplicação é segura para o arrasto: toda a máquina
  // resolve o cartão por e.target.closest, nunca por querySelector com
  // data-equipe.
  var grupos = COLUNAS_ALOCACAO.map(function (coluna) {
    // O filtro de tipologia poda os grupos do pool junto com as colunas da
    // grade -- as duas metades da tela têm que falar do mesmo recorte.
    if (tipologia && coluna.id !== tipologia) return '';
    var doGrupo = noPool.filter(function (e) {
      return (e.colunas || []).indexOf(coluna.id) !== -1;
    });
    if (!doGrupo.length) return '';
    // Disponíveis PRIMEIRO. O pool é uma lista de oferta: quem está nele é
    // candidato a ser arrastado. A equipe sem dia disponível na semana não é
    // candidata (cartão apagado, data-arrastavel="nao"), e misturada às
    // outras ela faz o olho varrer opção que não é opção.
    //
    // Ordenar, nunca esconder: some do pool seria mentir sobre o tamanho da
    // frota disponível, e a contagem do grupo continua somando as duas
    // metades. O sort é ESTÁVEL (garantido desde a ES2019), então a ordem
    // original sobrevive dentro de cada metade -- e `filter` já devolveu um
    // array novo, então isto não reordena `equipes` para o resto da página.
    doGrupo.sort(function (a, b) {
      return (a.disponivel ? 0 : 1) - (b.disponivel ? 0 : 1);
    });
    var cartoesDoGrupo = doGrupo.map(function (e) {
      return renderCartaoEquipe(e, porEquipeMap[e.id] || null, somenteLeitura,
        casouSoPeloNome(e, termo), coluna.id);
    }).join('');
    return '<div class="pool-grupo" data-grupo="' + escapeHtml(coluna.id) + '">'
      + '<h4 class="pool-grupo-titulo">' + escapeHtml(coluna.rotulo)
      + ' <span class="pool-grupo-contagem">(' + doGrupo.length + ')</span></h4>'
      + '<div class="pool-cartoes">' + cartoesDoGrupo + '</div>'
      + '</div>';
  }).join('');

  var fora = foraDoQuadro || [];
  var itensFora = fora.map(function (f) {
    return '<li><strong>' + escapeHtml(f.id) + '</strong> ' + escapeHtml(f.lider)
      + ' (' + escapeHtml(f.servicos) + ') — ' + escapeHtml(f.motivo) + '</li>';
  }).join('');

  var linhasAlocadas = alocadasQueCasam.map(function (e) {
    var d = aloc[e.id];
    return '<li>' + escapeHtml(e.id) + ' (' + escapeHtml(e.lider) + ')'
      + ' — alocada em ' + escapeHtml(d.sup) + ' · ' + escapeHtml(d.coluna) + '</li>';
  }).join('');

  var corpo = grupos || '<p class="pool-vazio">'
    + (termo ? 'nenhuma equipe livre casa a busca' : 'nenhuma equipe livre') + '</p>';

  return '<div class="pool-alocacao">'
    + corpo
    + (linhasAlocadas ? '<ul class="pool-alocadas">' + linhasAlocadas + '</ul>' : '')
    + '<details class="fora-do-quadro">'
    + '<summary>fora do quadro (' + fora.length + ')</summary>'
    + '<ul>' + itensFora + '</ul>'
    + '</details>'
    + '</div>';
}

// --- A grade -----------------------------------------------------------------

// Barra de cobertura: capacidade alocada / tendência, sem estourar 100% no
// desenho (uma equipe sobrecarregada não pode fazer a barra vazar da célula
// -- o número ao lado é que carrega o excesso).
function renderBarraCobertura(cobertura) {
  if (cobertura === null || cobertura === undefined) return '';
  var largura = Math.max(0, Math.min(100, cobertura * 100));
  return '<div class="cobertura-barra"><div class="cobertura-preenchida" style="width:' + largura.toFixed(0) + '%"></div></div>';
}

function renderCelula(sup, coluna, celula, equipesPorId, resumoPorEquipe, aviso, somenteLeitura) {
  var c = celula || { tendencia: 0, carteira: 0, capacidadeAlocada: 0, saldo: 0, equipes: [] };
  var semTendencia = !c.tendencia;
  var classes = ['celula-alocacao'];
  if (semTendencia) classes.push('celula-hachurada');
  if (c.saldo < 0) classes.push('celula-falta');
  if (aviso === 'aceso') classes.push('aviso-aceso');
  if (aviso === 'mudo') classes.push('aviso-mudo');

  var cartoes = (c.equipes || []).map(function (id) {
    var equipe = equipesPorId[id];
    if (!equipe) return '';
    // A célula É de uma coluna -- o ponto da equipe polivalente aqui dentro
    // tem que dizer a coluna em que ela está trabalhando, não a primeira que
    // ela serve.
    return renderCartaoEquipe(equipe, resumoPorEquipe[id] || null, somenteLeitura, false, coluna);
  }).join('');

  // A BARRA continua sendo cobertura (capacidade ÷ tendência): é o que ela
  // desenha, e cresce para a direita quando sobra capacidade. Já o STATUS sai
  // de classificarCelula, que raciocina na orientação inversa. São coisas
  // diferentes de propósito -- ver o comentário grande em compute-alocacao.js.
  //
  // Até 2026-08-11 as duas eram a MESMA conta, e o status saía invertido:
  // classificarOcupacao recebia a cobertura, quando suas faixas foram escritas
  // para ocupação. Tendência 100 com capacidade 50 exibia "Com folga · saldo
  // -50" -- o rótulo contradizendo o número impresso ao lado dele.
  var cobertura = c.tendencia ? c.capacidadeAlocada / c.tendencia : null;
  var situacaoCelula = classificarCelula(c.tendencia, c.capacidadeAlocada);

  return '<td class="' + classes.join(' ') + '" data-sup="' + escapeHtml(sup) + '" data-coluna="' + escapeHtml(coluna) + '">'
    + '<div class="celula-tendencia"><span class="celula-rotulo">tendência </span>' + formatarNumero(c.tendencia) + '</div>'
    + '<div class="celula-status ' + (CLASSE_SITUACAO[situacaoCelula] || '') + '">'
    + (ROTULO_SITUACAO[situacaoCelula] || situacaoCelula) + ' · saldo ' + formatarNumero(c.saldo) + '</div>'
    + renderBarraCobertura(cobertura)
    + '<div class="celula-cartoes">' + cartoes + '</div>'
    + '<span class="carteira">carteira ' + formatarNumero(c.carteira, 0) + '</span>'
    + '</td>';
}

function renderMatriz(grade, resumo, equipesPorId, somenteLeitura) {
  if (!grade.colunas.length || !grade.linhas.length) {
    return '<p class="alocacao-vazia">Nenhum SUP com tendência, carteira ou equipe alocada nesta semana.</p>';
  }

  var porSupPorChave = {};
  resumo.porSup.forEach(function (s) { porSupPorChave[s.sup] = s; });
  var resumoPorEquipe = {};
  resumo.porEquipe.forEach(function (e) { resumoPorEquipe[e.id] = e; });

  var thead = '<thead><tr><th class="coluna-sup">SUP</th>';
  grade.colunas.forEach(function (c) { thead += '<th>' + escapeHtml(c.rotulo) + '</th>'; });
  thead += '</tr></thead>';

  var corpo = grade.linhas.map(function (linha) {
    var resumoSup = porSupPorChave[linha.sup];
    var rotuloLeitura = resumoSup ? (ROTULO_LEITURA[resumoSup.leitura] || resumoSup.leitura) : '';
    var classeLeitura = resumoSup ? (CLASSE_LEITURA[resumoSup.leitura] || '') : '';
    var linhaHtml = '<tr><td class="coluna-sup">'
      + '<span class="linha-ordem">' + linha.ordem + '</span> '
      + '<strong>' + escapeHtml(linha.sup) + '</strong>'
      + (linha.tomador ? '<span class="linha-tomador"> — ' + escapeHtml(linha.tomador) + '</span>' : '')
      + (rotuloLeitura ? '<span class="linha-leitura ' + classeLeitura + '">' + escapeHtml(rotuloLeitura) + '</span>' : '')
      + '</td>';
    grade.colunas.forEach(function (c) {
      var celula = linha.celulas[c.id] || null;
      var aviso = resumo.avisos[linha.sup + '||' + c.id];
      linhaHtml += renderCelula(linha.sup, c.id, celula, equipesPorId, resumoPorEquipe, aviso, somenteLeitura);
    });
    return linhaHtml + '</tr>';
  }).join('');

  return '<table class="matriz-alocacao">' + thead + '<tbody>' + corpo + '</tbody></table>';
}

// --- As duas tabelas de resumo -----------------------------------------------

function renderResumoSup(porSup) {
  var linhas = (porSup || []).map(function (s) {
    var rotulo = ROTULO_LEITURA[s.leitura] || s.leitura;
    var classe = CLASSE_LEITURA[s.leitura] || '';
    return '<tr>'
      + '<td>' + s.ordem + '</td>'
      + '<td>' + escapeHtml(s.sup) + '</td>'
      + '<td>' + escapeHtml(s.tomador || '—') + '</td>'
      + '<td>' + formatarNumero(s.tendencia) + '</td>'
      + '<td>' + formatarNumero(s.capacidadeAlocada) + '</td>'
      + '<td>' + formatarNumero(s.saldo) + '</td>'
      + '<td>' + formatarPercentual(s.cobertura) + '</td>'
      + '<td>' + formatarNumero(s.carteira, 0) + '</td>'
      + '<td>' + (s.semanasDeCarteira === null || s.semanasDeCarteira === undefined
        ? '—' : (s.semanasDeCarteira === Infinity ? '∞' : formatarNumero(s.semanasDeCarteira, 1))) + '</td>'
      + '<td class="' + classe + '">' + escapeHtml(rotulo) + '</td>'
      + '</tr>';
  }).join('');

  return '<table class="resumo-sup-alocacao">'
    + '<thead><tr><th>#</th><th>SUP</th><th>Tomador</th><th>Tendência</th><th>Capacidade alocada</th>'
    + '<th>Saldo</th><th>Cobertura</th><th>Carteira</th><th>Semanas de carteira</th><th>Leitura</th></tr></thead>'
    + '<tbody>' + linhas + '</tbody></table>';
}

function renderResumoEquipe(porEquipe) {
  var linhas = (porEquipe || []).map(function (e) {
    var rotulo = ROTULO_SITUACAO[e.situacao] || e.situacao;
    var classe = CLASSE_SITUACAO[e.situacao] || '';
    return '<tr>'
      + '<td>' + escapeHtml(e.id) + '</td>'
      + '<td>' + escapeHtml(e.lider) + '</td>'
      + '<td>' + escapeHtml((e.colunas || []).join(', ')) + '</td>'
      + '<td>' + escapeHtml(e.sup || '—') + '</td>'
      + '<td>' + escapeHtml(e.coluna || '—') + '</td>'
      + '<td>' + formatarNumero(e.carga) + '</td>'
      + '<td>' + formatarNumero(e.capacidade) + '</td>'
      + '<td>' + formatarPercentual(e.ocupacao) + '</td>'
      + '<td class="' + classe + '">' + escapeHtml(rotulo) + '</td>'
      + '</tr>';
  }).join('');

  return '<table class="resumo-equipe-alocacao">'
    + '<thead><tr><th>Equipe</th><th>Líder</th><th>Colunas</th><th>SUP</th><th>Coluna</th>'
    + '<th>Carga</th><th>Capacidade</th><th>Ocupação</th><th>Situação</th></tr></thead>'
    + '<tbody>' + linhas + '</tbody></table>';
}

// --- A aba inteira -------------------------------------------------------------

// registros/indices: os de sempre. opcoes:
//   { mesIdx, ano, semanas, semana, demandas, equipes, foraDoQuadro, alocacao,
//     hojeEpoch, modoPersistencia, pendentes, semRoster, somenteLeitura }
// semRoster: a Sheet espelho da EQ não respondeu -- guarda, sem grade nenhuma.
// somenteLeitura: 'mes-diferente' quando a semana pedida é de outro mês que
//   não o que o espelho da EQ cobre -- desenha a grade, mas nada é arrastável.
function renderAbaAlocacao(registros, indices, opcoes) {
  var o = opcoes || {};

  // A guarda vem ANTES de qualquer grade -- um quadro vazio leria como "nada
  // alocado", que é uma afirmação diferente e falsa de "não sabemos".
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var somenteLeitura = o.somenteLeitura || null;
  var equipesBrutas = o.equipes || [];
  // O conflito herdado sai da alocação CRUA, nunca do resumo da grade: com o
  // filtro de SUP podando a linha, resumirAlocacao devolve sup: null para uma
  // equipe que ESTÁ alocada, e o conflito sumiria da tela sem ter sumido do
  // plano. Mesmo raciocínio da Decisão 7 de 2026-08-11 (o pool decide pela
  // alocação crua).
  //
  // A marca é anexada a uma CÓPIA rasa da equipe -- os objetos vêm de
  // ESTADO_ALOCACAO.equipes e não podem ser mutados por um render.
  var conflitos = conflitosDeVeiculo(equipesBrutas, o.alocacao || {});
  var equipes = equipesBrutas.map(function (e) {
    if (!conflitos[String(e.id)]) return e;
    var copia = {};
    Object.keys(e).forEach(function (k) { copia[k] = e[k]; });
    copia.conflitoVeiculo = conflitos[String(e.id)];
    return copia;
  });
  var equipesPorId = {};
  equipes.forEach(function (e) { equipesPorId[e.id] = e; });

  // A busca poda a GRADE também, não só o pool -- ver o comentário em
  // montarGradeAlocacao. `equipesVisiveis` fica null quando não há busca, e
  // null significa "não filtra", nunca "nenhuma".
  var termoBusca = normalizarBusca(o.buscaEquipe || '');
  var equipesVisiveis = null;
  if (termoBusca) {
    equipesVisiveis = [];
    equipes.forEach(function (e) {
      if (equipeCasaBusca(e, termoBusca)) equipesVisiveis.push(e.id);
    });
  }

  var opcoesGrade = {};
  Object.keys(o).forEach(function (k) { opcoesGrade[k] = o[k]; });
  opcoesGrade.equipesVisiveis = equipesVisiveis;
  opcoesGrade.tipologia = o.tipologiaAlocacao || null;

  var grade = montarGradeAlocacao(registros, indices, opcoesGrade);
  var resumo = resumirAlocacao(grade, { equipes: equipes, mesIdx: o.mesIdx });
  var porEquipeMap = {};
  resumo.porEquipe.forEach(function (e) { porEquipeMap[e.id] = e; });

  var html = renderControles(o, somenteLeitura);
  html += renderFaixaAlocacao(resumo.totais);
  if (somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  html += renderPool(equipes, o.foraDoQuadro, porEquipeMap, somenteLeitura, o.alocacao, o.buscaEquipe, o.tipologiaAlocacao || null);
  html += renderMatriz(grade, resumo, equipesPorId, somenteLeitura);
  html += renderResumoSup(resumo.porSup);
  html += renderResumoEquipe(resumo.porEquipe);
  return html;
}

module.exports = {
  renderAbaAlocacao, CLASSE_LEITURA, ROTULO_LEITURA, CLASSE_SITUACAO, ROTULO_SITUACAO,
  renderCartaoEquipe, renderCelula, renderMatriz, renderPool, renderFaixaAlocacao,
  // Os dois resumos e as duas guardas saem para snapshot-alocacao.js montar a
  // aba INTEIRA a partir de uma grade sintética, sem passar pelo pipeline de
  // dados -- ver o cabeçalho daquele arquivo.
  renderResumoSup, renderResumoEquipe, renderGuardaSemRoster, renderAvisoSomenteLeitura,
  renderControles,
  escapeHtml, corDaColuna,
};
