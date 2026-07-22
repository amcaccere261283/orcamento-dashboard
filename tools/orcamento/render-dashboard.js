'use strict';
const { formatarMesAno } = require('./datas.js');
const { cifrarComSenha } = require('./criptografia.js');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCabecalhoMeses(periodos) {
  return periodos.map(data => `<th>${formatarMesAno(data)}</th>`).join('');
}

// A tabela é renderizada inteiramente no navegador, depois que a senha
// certa decifra os registros -- ver o comentário grande antes de
// SCRIPT_CLIENTE. Por isso as opções de filtro (que listariam tipologia,
// grupo e SUP reais em texto puro) começam vazias aqui, só com o rótulo
// padrão, e são preenchidas pelo próprio script depois de decifrar.
function renderFiltroTipologia() {
  return `<select id="filtro-tipologia"><option value="">Todas as tipologias</option></select>`;
}
function renderFiltroGrupo() {
  return `<select id="filtro-grupo"><option value="">Todos os grupos</option></select>`;
}
function renderFiltroSup() {
  return `<select id="filtro-sup"><option value="">Todos os SUP</option></select>`;
}
function renderFiltroSerie() {
  return `<select id="filtro-serie"><option value="">Todas as séries</option>` +
    `<option value="previsto">Previsto</option>` +
    `<option value="realizado">Realizado</option>` +
    `<option value="total">Tendência</option>` +
    `</select>`;
}
function renderSeletorDimensao() {
  return `<select id="seletor-dimensao">` +
    `<option value="equipes">Equipes</option>` +
    `<option value="volume">Volume</option>` +
    `<option value="financeiro" selected>Financeiro</option>` +
    `<option value="produtividade">Produtividade</option>` +
    `<option value="ticketMedio">Ticket médio</option>` +
    `</select>`;
}

// A tabela inteira (linhas, filtros, cores de tipologia) é montada no
// navegador -- ver o comentário logo abaixo de SCRIPT_CLIENTE_INICIO. Este
// script SEMPRE roda (não depende de senha): implementa só o gate e, uma
// vez decifrado, delega pro segundo script (SCRIPT_CLIENTE_TABELA) que faz
// o trabalho de fato. Separados em duas strings só por legibilidade -- os
// dois rodam como um script só na página.
const SCRIPT_CLIENTE_GATE = `
function base64ParaBytes(base64) {
  var binario = atob(base64);
  var bytes = new Uint8Array(binario.length);
  for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// Espelha tools/orcamento/criptografia.js's decifrarComSenha, usando
// crypto.subtle (Web Crypto) no lugar de node:crypto -- mesmo algoritmo
// (PBKDF2-SHA256 pra derivar a chave, AES-256-GCM pra decifrar), mesmo
// formato de pacote (tag de autenticação concatenada no fim dos dados
// cifrados, que é o que crypto.subtle.decrypt espera por padrão).
async function decifrarComSenha(pacote, senha) {
  var salt = base64ParaBytes(pacote.salt);
  var iv = base64ParaBytes(pacote.iv);
  var dados = base64ParaBytes(pacote.dados);
  var chaveBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  var chave = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: pacote.iteracoes, hash: 'SHA-256' },
    chaveBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  var textoPlanoBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, chave, dados);
  return new TextDecoder().decode(textoPlanoBuffer);
}

function mostrarErroSenha(msg) {
  var erro = document.getElementById('gate-senha-erro');
  erro.textContent = msg;
  erro.style.display = 'block';
}

async function tentarDesbloquear() {
  var campo = document.getElementById('campo-senha');
  var botao = document.getElementById('btn-desbloquear');
  var senha = campo.value;
  botao.disabled = true;
  botao.textContent = 'Verificando…';
  try {
    var jsonTexto = await decifrarComSenha(window.__DADOS_CIFRADOS__, senha);
    window.__REGISTROS__ = JSON.parse(jsonTexto);
    document.getElementById('gate-senha').style.display = 'none';
    document.getElementById('conteudo-protegido').style.display = '';
    montarDashboard(window.__REGISTROS__);
  } catch (e) {
    mostrarErroSenha('Senha incorreta.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Abrir';
  }
}

document.getElementById('btn-desbloquear').addEventListener('click', tentarDesbloquear);
document.getElementById('campo-senha').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') tentarDesbloquear();
});
document.getElementById('campo-senha').focus();
`;

// Roda só DEPOIS que a senha certa decifra os registros (chamado por
// montarDashboard, no fim de SCRIPT_CLIENTE_GATE). Reimplementa em JS de
// navegador (sem require, HTML estático sem bundler) a mesma montagem de
// linhas/cores/filtros que antes rodava no servidor em
// tools/orcamento/render-dashboard.js -- precisa ser assim porque os
// PRÓPRIOS valores de SUP/Grupo/Tomador/Tipologia (não só os números
// mensais) são dados protegidos pela senha; se a tabela viesse pronta do
// servidor, esses nomes apareceriam em texto puro no código-fonte da
// página mesmo sem a senha certa.
const SCRIPT_CLIENTE_TABELA = `
function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// casasDecimais default 2 (mantém o comportamento de sempre pra quem já
// chama sem o argumento) -- Equipes usa 0 (arredonda pra inteiro: "número
// de equipes" não existe fracionado na prática, mesmo a planilha de origem
// tendo médias/frações internamente).
function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var fator = Math.pow(10, casasDecimais === undefined ? 2 : casasDecimais);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR');
}
function somar(array) { return (array || []).reduce(function (a, b) { return a + (b || 0); }, 0); }
// null num mês = nenhum registro que contribui pra essa soma tem dado
// digitado ali ainda (ver render-dashboard: R/P ficam em branco, não 0,
// quando a planilha de origem não tinha valor pro mês) -- soma[i] só vira
// número quando ALGUM dos arrays tem valor real naquele mês; um contribuinte
// em branco simplesmente não participa da soma, não vira 0 nela.
function somarArraysMensais(arrays) {
  var soma = new Array(12).fill(null);
  arrays.forEach(function (arr) {
    if (!arr) return;
    for (var i = 0; i < 12; i++) {
      if (arr[i] === null || arr[i] === undefined) continue;
      soma[i] = (soma[i] || 0) + arr[i];
    }
  });
  return soma;
}

var CAMPOS_RATIO = {
  produtividade: { numerador: 'volume', denominador: 'equipes' },
  ticketMedio: { numerador: 'financeiro', denominador: 'volume' },
};

// valoresLista: array de "valores" de UMA série (previsto/realizado/total),
// um item por registro agregado (lista de 1 item no caso normal de uma
// única tipologia; vários itens nas linhas de total por SUP/geral). Devolve
// os 12 valores mensais na dimensão escolhida. Previsto de produtividade/
// ticketMedio, quando é UMA ÚNICA tipologia, usa a premissa fixa da
// planilha (PROD./TICKET, nunca recalculada); quando agrega várias
// tipologias, não existe premissa própria do agregado, então usa a mesma
// razão-a-partir-da-soma que Realizado/Tendência (produtividade = Σvolume ÷
// Σequipes, ticketMedio = Σfinanceiro ÷ Σvolume -- fórmulas confirmadas com
// o usuário, estendidas aqui pra somar através das tipologias, não só dos
// meses).
function calcularMensal(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      var premissa = dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
      return new Array(12).fill((premissa === null || premissa === undefined) ? null : premissa);
    }
    var numeradorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.numerador]; }));
    var denominadorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.denominador]; }));
    return numeradorMensal.map(function (v, i) { return (v === null || v === undefined || !denominadorMensal[i]) ? null : v / denominadorMensal[i]; });
  }
  return somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
}

// Coluna "Total" (soma do ano inteiro) da mesma linha -- soma os 12 meses
// pras 3 dimensões brutas; produtividade/ticketMedio recalculam a razão a
// partir da soma do numerador/denominador do ANO INTEIRO, nunca a soma das
// razões mensais (somar "R$/m³" de 12 meses não seria um número válido).
function calcularTotalAno(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      return dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
    }
    var numeradorTotal = somar(lista.map(function (v) { return somar(v[ratio.numerador]); }));
    var denominadorTotal = somar(lista.map(function (v) { return somar(v[ratio.denominador]); }));
    return denominadorTotal ? numeradorTotal / denominadorTotal : null;
  }
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}

// Soma corrida mês a mês -- acumulado[i] = mensal[0]+...+mensal[i]. Trata
// null/undefined como 0 (não dá pra "acumular" um mês sem dado, mas
// também não pode quebrar a soma corrida dos meses seguintes).
function calcularAcumulado(mensal) {
  var soma = 0;
  return mensal.map(function (v) {
    soma += v || 0;
    return soma;
  });
}

// Índice (0=Jan..11=Dez) do último mês com dado real em \`mensal\` -- -1 se
// nenhum mês tem dado. Usado pra achar onde Realizado "parou" de ser
// reportado, tanto pra parar de desenhar Realizado dali em diante quanto
// pra saber onde a Tendência deve começar (ver montarGrafico).
function ultimoIndiceComDado(mensal) {
  for (var i = mensal.length - 1; i >= 0; i--) {
    if (mensal[i] !== null && mensal[i] !== undefined) return i;
  }
  return -1;
}

// Acumulado da série Tendência nunca recomeça do zero em Jan -- ele
// continua exatamente de onde o acumulado de Realizado parou (mesmo ponto
// de conexão usado no painel mensal, ver montarGrafico), somando dali em
// diante só a própria contribuição mensal da Tendência. Antes desse mês,
// null (nada desenhado -- quem cobre esses meses é a linha de Realizado).
// Sem nenhum mês de Realizado (ultimoMesRealizado -1), a Tendência acumula
// sozinha desde Jan, do jeito usual.
function calcularAcumuladoTendencia(mensalTotal, acumuladoRealizado, ultimoMesRealizado) {
  if (ultimoMesRealizado === -1) return calcularAcumulado(mensalTotal);
  var resultado = new Array(mensalTotal.length).fill(null);
  var soma = acumuladoRealizado[ultimoMesRealizado] || 0;
  resultado[ultimoMesRealizado] = soma;
  for (var i = ultimoMesRealizado + 1; i < mensalTotal.length; i++) {
    soma += mensalTotal[i] || 0;
    resultado[i] = soma;
  }
  return resultado;
}

// Acumulado de Realizado não continua reto (flat) até dezembro depois do
// último mês reportado -- corta ali (null dali em diante), igual ao painel
// Mensal, pra não parecer que o total "parou de crescer" já sabendo de
// verdade, quando na real é só que ainda não tem dado. É a partir desse
// mesmo ponto de corte que calcularAcumuladoTendencia continua a linha.
function cortarAcumuladoNoUltimoDado(acumulado, mensal) {
  var ultimo = ultimoIndiceComDado(mensal);
  return acumulado.map(function (v, i) { return i <= ultimo ? v : null; });
}

// Um filtro é um Set de valores selecionados -- Set vazio (ou ausente)
// significa "sem filtro" (não exclui nada), igual ao "" do <select> antigo.
// Com o filtro ativo, um valor passa se estiver em QUALQUER um dos
// selecionados (OR dentro do mesmo filtro -- "Tipologia = SP ou ST"),
// combinando com AND entre filtros diferentes (mesmo esquema de sempre).
function filtroExclui(filtro, valor) {
  return !!(filtro && filtro.size > 0 && !filtro.has(valor));
}

// Devolve os índices de \`registros\` que combinam com os filtros de
// tipologia/categoria/grupo/SUP atuais, calculada aqui direto sobre os
// registros crus, sem depender de uma linha <tr> já renderizada, pra o
// gráfico poder agregar o recorte atual sem precisar de uma linha "molde"
// no DOM.
function indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup) {
  var indices = [];
  registros.forEach(function (registro, indice) {
    if (filtroExclui(filtroTipologia, registro.tipologia)) return;
    if (filtroExclui(filtroCategoria, categoriaTipologia(registro.tipologia))) return;
    if (filtroExclui(filtroGrupo, registro.grupo)) return;
    if (filtroExclui(filtroSup, registro.sup)) return;
    indices.push(indice);
  });
  return indices;
}

var SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f' };
// Tracejado por série além da cor -- segunda camada de identidade (não só
// hue) pra sobreviver a daltonismo/impressão P&B: previsto sólido,
// realizado pontilhado fino, tendência tracejado longo.
var SERIE_TRACEJADO = { previsto: '', realizado: '1,5', total: '9,5' };
var DIMENSOES_RAZAO = ['produtividade', 'ticketMedio'];
var MESES_ABREVIADOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var GRAFICO_LARGURA = 1000;
var GRAFICO_ALTURA_BARRAS = 320;
var GRAFICO_ALTURA_LINHA = 280;
// Dois painéis, eixo único cada -- direita só precisa de espaço pro rótulo
// do último mês não vazar da borda (não tem mais 2º eixo do lado direito).
var GRAFICO_MARGEM_BARRAS = { topo: 36, baixo: 36, esquerda: 68, direita: 28 };
var GRAFICO_MARGEM_LINHA = { topo: 36, baixo: 36, esquerda: 68, direita: 36 };
var GRAFICO_NUM_TICKS = 4;
var GRAFICO_BARRA_MAX = 24;
var GRAFICO_BARRA_GAP = 2;
// Acima desse valor bruto (não escalado) o gráfico passa a exibir em
// milhares -- assim um recorte pequeno (poucas centenas) não vira "0"
// depois de dividido, e o eixo/rótulos ganham "(em milhares)" no título.
var GRAFICO_LIMIAR_MILHARES = 1000;

// Mapeia um valor pra uma distância em pixels dentro de [0, pixelMax],
// proporcional a valorMax -- 0 quando valorMax é 0 (evita divisão por
// zero quando não há nenhum dado no recorte filtrado).
function escalaLinear(valor, valorMax, pixelMax) {
  if (!valorMax) return 0;
  return (valor / valorMax) * pixelMax;
}

// Arredonda o teto do eixo Y pro próximo passo "limpo" (1/2/5 x 10^n), do
// jeito que uma pessoa desenharia à mão -- os ticks caem em números
// redondos (0 / 500 / 1.000...) em vez de frações arbitrárias do máximo.
function calcularEscalaEixo(valorMax) {
  if (!valorMax || valorMax <= 0) return { max: 1, passo: 0.25 };
  var passoBruto = valorMax / GRAFICO_NUM_TICKS;
  var magnitude = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  var normalizado = passoBruto / magnitude;
  var passoNormalizado = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 2.5 ? 2.5 : normalizado <= 5 ? 5 : 10;
  var passo = passoNormalizado * magnitude;
  return { max: passo * GRAFICO_NUM_TICKS, passo: passo };
}

// Formata um valor pro que aparece NO gráfico (eixo, rótulo de coluna/linha)
// -- em milhares quando o recorte é grande o bastante pra fazer sentido.
// O tooltip usa formatarNumero puro (valor exato), nunca esta função: hover
// é onde a pessoa vai quando quer o número completo, não o arredondado.
function formatarValorGrafico(valor, usarMilhares, casasDecimais) {
  if (valor === null || valor === undefined) return '—';
  var base = usarMilhares ? valor / 1000 : valor;
  var fator = Math.pow(10, casasDecimais === undefined ? 2 : casasDecimais);
  return (Math.round(base * fator) / fator).toLocaleString('pt-BR');
}

function construirEixoXSvg(larguraMes, alturaPlot, margem) {
  var svg = '';
  for (var mes = 0; mes < 12; mes++) {
    var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
    var y = margem.topo + alturaPlot + 20;
    svg += '<text class="grafico-eixo-texto" x="' + x.toFixed(1) + '" y="' + y + '" text-anchor="middle">' + MESES_ABREVIADOS[mes] + '</text>';
  }
  return svg;
}

function construirEixoYSvg(escala, alturaPlot, margem, ladoDireita, usarMilhares, casasDecimais) {
  var svg = '';
  for (var i = 0; i <= GRAFICO_NUM_TICKS; i++) {
    var valor = i * escala.passo;
    var y = margem.topo + alturaPlot - (valor / escala.max) * alturaPlot;
    var x = ladoDireita ? (GRAFICO_LARGURA - margem.direita + 10) : (margem.esquerda - 10);
    var ancora = ladoDireita ? 'start' : 'end';
    svg += '<text class="grafico-eixo-texto" x="' + x + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + ancora + '">' + formatarValorGrafico(valor, usarMilhares, casasDecimais) + '</text>';
    if (!ladoDireita) {
      svg += '<line class="grafico-gridline" x1="' + margem.esquerda + '" y1="' + y.toFixed(1) + '" x2="' + (GRAFICO_LARGURA - margem.direita) + '" y2="' + y.toFixed(1) + '"/>';
    }
  }
  return svg;
}

// Legenda só entra com 2+ séries -- com uma série só, o título do painel já
// diz o que é. O traço da legenda repete o tracejado da série, então o
// canal secundário (não só a cor) já aparece ali.
function construirLegendaSvg(dadosPorSerie, margem) {
  if (dadosPorSerie.length < 2) return '';
  var svg = '';
  var y = 14;
  dadosPorSerie.forEach(function (d, i) {
    var x = margem.esquerda + i * 140;
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    svg += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + 20) + '" y2="' + y + '" stroke="' + SERIE_COR[d.serie] + '" stroke-width="3" stroke-linecap="round"' + traco + '/>';
    svg += '<text class="grafico-eixo-texto" x="' + (x + 28) + '" y="' + (y + 4) + '" text-anchor="start">' + SERIE_LABELS[d.serie] + '</text>';
  });
  return svg;
}

// Desenha uma barra/coluna com topo arredondado (4px) e base quadrada,
// ancorada na baseline -- nunca um <rect> puro com cantos vivos nos 4 lados.
function desenharBarraArredondada(x, y, w, h, cor) {
  if (h <= 0) return '';
  var r = Math.min(4, w / 2, h);
  var d = 'M' + x.toFixed(1) + ',' + (y + h).toFixed(1) +
    ' L' + x.toFixed(1) + ',' + (y + r).toFixed(1) +
    ' Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + y.toFixed(1) +
    ' L' + (x + w - r).toFixed(1) + ',' + y.toFixed(1) +
    ' Q' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (y + r).toFixed(1) +
    ' L' + (x + w).toFixed(1) + ',' + (y + h).toFixed(1) + ' Z';
  return '<path class="grafico-barra" d="' + d + '" fill="' + cor + '"/>';
}

// Empurra rótulos que colidem (caixa estimada pela largura do texto) pra
// baixo do que colidiram, na ordem de cima pra baixo -- usado tanto pros
// rótulos de coluna quanto de linha JUNTOS, porque num eixo duplo os dois
// grupos têm escalas diferentes e podem convergir na mesma faixa vertical
// num mês onde ambas as séries estão perto do teto do seu próprio eixo
// (ex.: o último mês, que costuma ser o maior tanto no valor do mês quanto
// no acumulado). Empurrar só dentro do próprio grupo não pega esse caso.
function resolverColisoesRotulos(rotulos) {
  rotulos.sort(function (a, b) { return a.y - b.y; });
  var posicionados = [];
  rotulos.forEach(function (r) {
    var largura = r.texto.length * 6.5 + 6;
    var y = r.y;
    var tentativas = 0;
    var colidiu = true;
    while (colidiu && tentativas < 60) {
      colidiu = posicionados.some(function (p) {
        return Math.abs(p.x - r.x) < (largura + p.largura) / 2 && Math.abs(p.y - y) < 13;
      });
      if (colidiu) { y += 2; tentativas++; }
    }
    posicionados.push({ x: r.x, y: y, largura: largura });
    r.y = y;
  });
  return rotulos;
}

// Colunas agrupadas por mês, largura travada em <=24px com um respiro de
// 2px entre colunas vizinhas (nunca encostadas). Rótulo sempre visível em
// cada coluna (a pedido) -- fica denso com 3 séries, mas o valor exato
// também mora no tooltip (hover/foco) e na aba Tabela. Os candidatos a
// rótulo são só ACUMULADOS em \`rotulos\` -- desenhados depois, junto com os
// da linha, numa única passada de anti-colisão (ver construirGraficoSvg).
function construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
  var svg = '';
  var numSeries = dadosPorSerie.length;
  var slot = larguraMes * 0.72;
  var larguraColuna = Math.min(GRAFICO_BARRA_MAX, (slot - GRAFICO_BARRA_GAP * (numSeries - 1)) / numSeries);
  var slotOcupado = larguraColuna * numSeries + GRAFICO_BARRA_GAP * (numSeries - 1);

  for (var mes = 0; mes < 12; mes++) {
    var inicioSlot = margem.esquerda + mes * larguraMes + (larguraMes - slotOcupado) / 2;
    dadosPorSerie.forEach(function (d, i) {
      var valor = d.mensal[mes];
      // null = mês sem dado reportado ainda (nunca 0 -- ver
      // somarArraysMensais) -- não desenha nada pra essa série nesse mês,
      // em vez de uma coluna fantasma na base do eixo.
      if (valor === null || valor === undefined) return;
      var alturaColuna = escalaLinear(valor, escala.max, alturaPlot);
      var x = inicioSlot + i * (larguraColuna + GRAFICO_BARRA_GAP);
      var y = margem.topo + alturaPlot - alturaColuna;
      svg += desenharBarraArredondada(x, y, larguraColuna, alturaColuna, SERIE_COR[d.serie]);
      svg += '<rect class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" x="' + x.toFixed(1) + '" y="' + margem.topo + '" width="' + Math.max(larguraColuna, GRAFICO_BARRA_GAP).toFixed(1) + '" height="' + alturaPlot + '" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x + larguraColuna / 2, y: y - 6, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo' });
      }
    });
  }
  return svg;
}

// Linhas (usadas pro acumulado, e pro mensal das dimensões-razão) --
// marcador de 8px com anel na cor da superfície (fica legível cruzando
// outra linha ou uma coluna). Rótulo em CADA ponto (a pedido), também só
// acumulado em \`rotulos\` -- ver construirColunasSvg acima pro porquê.
// Um mês null (sem dado reportado ainda, ver somarArraysMensais) quebra a
// linha em vez de "cair" até a base -- desenha um <polyline> por trecho
// contínuo de meses com dado, não um só ligando os 12 pontos.
function construirLinhasSvg(dadosPorSerie, campo, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais) {
  var svg = '';
  dadosPorSerie.forEach(function (d) {
    var traco = SERIE_TRACEJADO[d.serie] ? ' stroke-dasharray="' + SERIE_TRACEJADO[d.serie] + '"' : '';
    var trecho = [];
    function fecharTrecho() {
      if (trecho.length > 1) {
        var pontosStr = trecho.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
        svg += '<polyline class="grafico-linha" points="' + pontosStr + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + traco + '/>';
      }
      trecho = [];
    }
    d[campo].forEach(function (valor, mes) {
      if (valor === null || valor === undefined) { fecharTrecho(); return; }
      var x = margem.esquerda + mes * larguraMes + larguraMes / 2;
      var y = margem.topo + alturaPlot - escalaLinear(valor, escala.max, alturaPlot);
      trecho.push({ x: x, y: y });
      svg += '<circle class="grafico-marcador" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + SERIE_COR[d.serie] + '" stroke="var(--surface-1)" stroke-width="2"/>';
      svg += '<circle class="grafico-hit" data-tooltip="' + MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor, casasDecimais) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="transparent"/>';
      if (valor) {
        rotulos.push({ x: x, y: y - 10, texto: formatarValorGrafico(valor, usarMilhares, casasDecimais), classe: 'grafico-rotulo-final' });
      }
    });
    fecharTrecho();
  });
  return svg;
}

// Monta o SVG final de um painel a partir das marcas (colunas OU linhas,
// já em \`svgMarcas\`) + candidatos a rótulo acumulados em \`rotulos\` --
// resolve a colisão uma vez, no conjunto inteiro do painel, e desenha os
// <text> por último (por cima de tudo, incluindo o halo).
function finalizarPainelSvg(svgMarcas, rotulos, altura) {
  var svg = svgMarcas;
  resolverColisoesRotulos(rotulos).forEach(function (r) {
    svg += '<text class="' + r.classe + '" x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" text-anchor="middle">' + r.texto + '</text>';
  });
  return '<svg viewBox="0 0 ' + GRAFICO_LARGURA + ' ' + altura + '" class="grafico-svg">' + svg + '</svg>';
}

// dadosPorSerie: [{ serie, mensal: number[12], acumulado: number[12]|null }],
// já filtrado só com as séries visíveis (respeita filtro-serie) e com
// valores mensais nunca-nulos (null já virou 0 antes de chegar aqui -- ver
// montarGrafico). ehRazao=true pras dimensões Produtividade/Ticket médio:
// nesse caso não faz sentido "acumular" uma razão, então só a linha do
// valor mensal aparece (painel único, sem colunas).
function construirGraficoMensalSvg(dadosPorSerie, ehRazao, casasDecimais) {
  var margem = ehRazao ? GRAFICO_MARGEM_LINHA : GRAFICO_MARGEM_BARRAS;
  var altura = ehRazao ? GRAFICO_ALTURA_LINHA : GRAFICO_ALTURA_BARRAS;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraMes = larguraPlot / 12;

  var maxMensal = 0;
  dadosPorSerie.forEach(function (d) { d.mensal.forEach(function (v) { if (v > maxMensal) maxMensal = v; }); });
  var escala = calcularEscalaEixo(maxMensal);
  var usarMilhares = maxMensal >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, false, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraMes, alturaPlot, margem);

  var rotulos = [];
  svg += ehRazao
    ? construirLinhasSvg(dadosPorSerie, 'mensal', escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais)
    : construirColunasSvg(dadosPorSerie, escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Painel separado, eixo único, pro acumulado no ano -- mensal e acumulado
// nunca compartilham escala (dezembro acumulado é ~12x um mês típico), um
// eixo duplo no mesmo plot inventaria uma correlação visual que não existe.
function construirGraficoAcumuladoSvg(dadosPorSerie, casasDecimais) {
  var margem = GRAFICO_MARGEM_LINHA;
  var altura = GRAFICO_ALTURA_LINHA;
  var larguraPlot = GRAFICO_LARGURA - margem.esquerda - margem.direita;
  var alturaPlot = altura - margem.topo - margem.baixo;
  var larguraMes = larguraPlot / 12;

  var maxAcumulado = 0;
  dadosPorSerie.forEach(function (d) { d.acumulado.forEach(function (v) { if (v > maxAcumulado) maxAcumulado = v; }); });
  var escala = calcularEscalaEixo(maxAcumulado);
  var usarMilhares = maxAcumulado >= GRAFICO_LIMIAR_MILHARES;

  var svg = '';
  svg += construirEixoYSvg(escala, alturaPlot, margem, false, usarMilhares, casasDecimais);
  svg += construirEixoXSvg(larguraMes, alturaPlot, margem);

  var rotulos = [];
  svg += construirLinhasSvg(dadosPorSerie, 'acumulado', escala, alturaPlot, larguraMes, margem, usarMilhares, rotulos, casasDecimais);
  svg += construirLegendaSvg(dadosPorSerie, margem);

  return { svg: finalizarPainelSvg(svg, rotulos, altura), milhares: usarMilhares };
}

// Recalcula e redesenha os gráficos a partir dos MESMOS filtros/dimensão da
// tabela -- chamado toda vez que recalcularTabela roda, então nunca fica
// desatualizado mesmo se o usuário estiver na aba Tabela quando muda um
// filtro e só depois troca pra aba Gráfico.
function montarGrafico(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroSerie, dimensao) {
  var indices = indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup);
  var seriesTodas = ['previsto', 'realizado', 'total'];
  var seriesVisiveis = seriesTodas.filter(function (s) { return !filtroExclui(filtroSerie, s); });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  var mensalPorSerie = {};
  seriesVisiveis.forEach(function (serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    mensalPorSerie[serie] = calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
  });

  // Tendência sempre parte do último Realizado -- se as duas séries estão
  // visíveis e a Tendência ainda não tem valor próprio nesse mês (regra "se
  // tem R não tem T"), usa o valor de Realizado ali como ponto de conexão,
  // pra Tendência nunca aparecer "flutuando" desconectada de onde o
  // Realizado parou.
  var ultimoMesRealizado = -1;
  if (mensalPorSerie.realizado) ultimoMesRealizado = ultimoIndiceComDado(mensalPorSerie.realizado);
  if (mensalPorSerie.total && ultimoMesRealizado !== -1 &&
      (mensalPorSerie.total[ultimoMesRealizado] === null || mensalPorSerie.total[ultimoMesRealizado] === undefined)) {
    mensalPorSerie.total[ultimoMesRealizado] = mensalPorSerie.realizado[ultimoMesRealizado];
  }

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var mensal = mensalPorSerie[serie];
    var acumulado = null;
    if (!ehRazao) {
      if (serie === 'total') {
        acumulado = calcularAcumuladoTendencia(mensal, calcularAcumulado(mensalPorSerie.realizado || []), ultimoMesRealizado);
      } else if (serie === 'realizado') {
        acumulado = cortarAcumuladoNoUltimoDado(calcularAcumulado(mensal), mensal);
      } else {
        acumulado = calcularAcumulado(mensal);
      }
    }
    return { serie: serie, mensal: mensal, acumulado: acumulado };
  });

  var opcaoDimensao = document.getElementById('seletor-dimensao').selectedOptions[0];
  var rotuloDimensao = opcaoDimensao ? opcaoDimensao.textContent : '';
  var casasDecimais = dimensao === 'equipes' ? 0 : 2;

  var mensalResultado = construirGraficoMensalSvg(dadosPorSerie, ehRazao, casasDecimais);
  var tituloMensal = (ehRazao ? 'Evolução mensal — ' : 'Mensal — ') + rotuloDimensao + (mensalResultado.milhares ? ' (em milhares)' : '');
  document.getElementById('grafico-titulo-mensal').textContent = tituloMensal;
  document.getElementById('grafico-mensal-container').innerHTML = mensalResultado.svg;

  var painelAcumulado = document.getElementById('grafico-painel-acumulado');
  if (ehRazao) {
    painelAcumulado.style.display = 'none';
  } else {
    painelAcumulado.style.display = '';
    var acumuladoResultado = construirGraficoAcumuladoSvg(dadosPorSerie, casasDecimais);
    var tituloAcumulado = 'Acumulado no ano — ' + rotuloDimensao + (acumuladoResultado.milhares ? ' (em milhares)' : '');
    document.getElementById('grafico-titulo-acumulado').textContent = tituloAcumulado;
    document.getElementById('grafico-acumulado-container').innerHTML = acumuladoResultado.svg;
  }
}

// Tooltip único, delegado (os SVGs são recriados via innerHTML a cada
// recalcularTabela, então um listener por elemento seria descartado toda
// hora) -- qualquer elemento com [data-tooltip] dentro da seção de
// gráficos aciona o balão, com foco/teclado cobrindo o mesmo caso via
// mouseover que já borbulha de um :focus programático.
function inicializarTooltipGrafico() {
  var secao = document.getElementById('secao-grafico');
  var tooltip = document.getElementById('grafico-tooltip');
  secao.addEventListener('mousemove', function (e) {
    var alvo = e.target.closest ? e.target.closest('[data-tooltip]') : null;
    if (!alvo) { tooltip.style.display = 'none'; return; }
    var rectSecao = secao.getBoundingClientRect();
    tooltip.textContent = alvo.getAttribute('data-tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX - rectSecao.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rectSecao.top - 12) + 'px';
  });
  secao.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });
}

function alternarAba(aba) {
  document.getElementById('secao-tabela').style.display = aba === 'tabela' ? '' : 'none';
  document.getElementById('secao-grafico').style.display = aba === 'grafico' ? '' : 'none';
  document.getElementById('aba-tabela').classList.toggle('aba-ativa', aba === 'tabela');
  document.getElementById('aba-grafico').classList.toggle('aba-ativa', aba === 'grafico');
}

function preencherLinha(linha, valoresLista, serie, dimensao) {
  var casasDecimais = dimensao === 'equipes' ? 0 : 2;
  var mensal = calcularMensal(valoresLista, serie, dimensao);
  var celulasMes = linha.querySelectorAll('.celula-mes');
  celulasMes.forEach(function (celula, idx) {
    celula.textContent = formatarNumero(mensal ? mensal[idx] : null, casasDecimais);
  });
  var celulaTotal = linha.querySelector('.celula-total-linha');
  if (celulaTotal) celulaTotal.textContent = formatarNumero(calcularTotalAno(valoresLista, serie, dimensao), casasDecimais);
}

// Dado um array de valores (na ordem das linhas visíveis de UMA coluna),
// devolve um array {valor, repetido} do mesmo tamanho -- repetido=true
// quando o valor é igual ao da linha visível anterior. O texto continua
// sempre visível (nunca vira '') -- quem decide como exibir isso (esmaecido
// quando repetido) é mesclarColunasRepetidas, não esta função. Função pura
// (sem DOM) pra poder testar sozinha.
function mesclarConsecutivos(valores) {
  var resultado = [];
  var anterior = null;
  valores.forEach(function (valor, i) {
    resultado.push({ valor: valor, repetido: i > 0 && valor === anterior });
    anterior = valor;
  });
  return resultado;
}

// Nunca reescreve o conteúdo da célula (só a classe que esmaece) -- a coluna
// Tipologia guarda um <span class="tipologia-chip"> colorido, e sobrescrever
// com textContent destruiria esse HTML. Pro mesmo motivo, sup/grupo/tomador
// também pararam de ter o conteúdo reescrito (era sempre o mesmo valor já
// presente, um no-op).
function mesclarColunasRepetidas() {
  var linhasVisiveis = Array.prototype.filter.call(
    document.querySelectorAll('#tabela-orcamento tbody tr'),
    function (tr) { return tr.style.display !== 'none'; }
  );

  // SUP > Grupo > Tomador é uma hierarquia, não 3 colunas independentes --
  // Grupo só pode contar como repetido se o SUP acima também não tiver
  // mudado (senão um SUP novo que por coincidência tem o mesmo Grupo do
  // anterior ficaria com o nome apagado, escondendo que um bloco novo
  // começou; mesmo raciocínio pra Tomador exigir Grupo+SUP inalterados).
  // Por isso cada nível usa uma CHAVE que inclui todos os níveis acima, não
  // só seu próprio texto -- reaproveita mesclarConsecutivos (já testada)
  // aplicando-a a essas chaves compostas em vez do texto puro.
  var celulasSup = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-sup'); });
  var celulasGrupo = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-grupo'); });
  var celulasTomador = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tomador'); });
  var valoresSup = celulasSup.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresGrupo = celulasGrupo.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresTomador = celulasTomador.map(function (c) { return c.getAttribute('data-valor'); });
  // Chave = array [niveis acima..., proprio valor] serializado em JSON, em
  // vez de uma string concatenada com separador -- evita qualquer risco de
  // colisao entre valores que por acaso contenham o proprio separador.
  var chavesGrupo = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i]]); });
  var chavesTomador = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i], valoresTomador[i]]); });

  var mescladosSup = mesclarConsecutivos(valoresSup);
  var mescladosGrupo = mesclarConsecutivos(chavesGrupo);
  var mescladosTomador = mesclarConsecutivos(chavesTomador);
  celulasSup.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosSup[i].repetido); });
  celulasGrupo.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosGrupo[i].repetido); });
  celulasTomador.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTomador[i].repetido); });

  // Tipologia (e os selos TOTAL/TOTAL GERAL) mesclam por GRUPO de linha
  // (as 3 linhas P/R/T de um mesmo bloco compartilham o mesmo
  // data-registro-indices), não por valor de texto -- se comparasse por
  // texto, duas tipologias iguais vindas de blocos diferentes (ex.: dois
  // SUPs distintos, ambos "SM") se mesclariam entre si, o que nunca foi o
  // comportamento pretendido.
  var celulasTipologia = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tipologia'); }).filter(Boolean);
  var chavesTipologia = linhasVisiveis.map(function (tr) { return tr.dataset.registroIndices; });
  var mescladosTipologia = mesclarConsecutivos(chavesTipologia);
  celulasTipologia.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTipologia[i].repetido); });
}

// Mesmo mapeamento de cores por tipologia da matriz de equipes
// (tools/matriz/render-dashboard.js's tipologiaColor), reimplementado aqui
// em JS de navegador pelo mesmo motivo do resto deste script: a própria
// tipologia é dado protegido por senha, não pode vir pronta do servidor.
var TIPOLOGIA_COLOR = {
  SP: '#3f851a', SM: '#2f6ad0', ST: '#8d6f00', PI: '#606060',
  BL: '#4a3aa7', CPTU: '#db244e', SH: '#e87ba4', VT: '#eda100',
  'SEGURANÇA': '#2775b8', ESPECIAIS: '#db244e', SSMA: '#2775b8',
};
var TIPOLOGIA_COMPOSTA_COLOR = {
  'CPTU / VT / SH': TIPOLOGIA_COLOR.CPTU,
  'SP/SM': TIPOLOGIA_COLOR.SP,
};
function tipologiaColor(tipologia) {
  var raw = String(tipologia || '').trim();
  var key = raw.toUpperCase();
  if (TIPOLOGIA_COLOR[key]) return TIPOLOGIA_COLOR[key];
  if (TIPOLOGIA_COMPOSTA_COLOR[key]) return TIPOLOGIA_COMPOSTA_COLOR[key];
  var parenMatch = raw.match(/\\(([^)]+)\\)\\s*$/);
  if (parenMatch) {
    var viaParen = TIPOLOGIA_COLOR[parenMatch[1].trim().toUpperCase()];
    if (viaParen) return viaParen;
  }
  var primeiroToken = key.split('/')[0].trim();
  if (TIPOLOGIA_COLOR[primeiroToken]) return TIPOLOGIA_COLOR[primeiroToken];
  return '#898781';
}

// Agrupamento fixo das 8 tipologias reais em 4 categorias -- Lab.
// Convencional (LAB.C) e Lab. Especial (LAB.E) são suas próprias
// categorias; entre as sondagens, CPTu/BL/SH/VT são "Especial" e todo o
// resto (SP, SM/SM.F/SR, ST, PI) é "Convencional" -- regra confirmada com
// o usuário, não uma inferência.
var TIPOLOGIAS_SONDAGEM_ESPECIAL = { CPTU: true, BL: true, SH: true, VT: true };
function categoriaTipologia(tipologia) {
  var key = String(tipologia || '').trim().toUpperCase();
  if (key === 'LAB.C') return 'labConvencional';
  if (key === 'LAB.E') return 'labEspecial';
  if (TIPOLOGIAS_SONDAGEM_ESPECIAL[key]) return 'sondagemEspecial';
  return 'sondagemConvencional';
}

var SERIE_LABELS = { previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' };

function celulasMesVazias() {
  var html = '';
  for (var i = 0; i < 12; i++) html += '<td class="celula-mes num"></td>';
  return html;
}

function renderLinhaTabela(registro, indice) {
  var chipColor = tipologiaColor(registro.tipologia);
  var dataAttrs = 'data-tipologia="' + escapeHtml(registro.tipologia) + '" data-categoria="' + categoriaTipologia(registro.tipologia) + '" data-grupo="' + escapeHtml(registro.grupo) + '" data-sup="' + escapeHtml(registro.sup) + '" data-registro-indices="' + indice + '"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(registro.sup) + '">' + escapeHtml(registro.sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(registro.grupo) + '">' + escapeHtml(registro.grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(registro.tomador) + '">' + escapeHtml(registro.tomador) + '</td>';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(registro.tipologia) + '</span></td>';
  return '<tr class="linha-serie linha-previsto" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderLinhaTotalSup(sup, grupo, tomador, indices) {
  var dataAttrs = 'data-grupo="' + escapeHtml(grupo) + '" data-sup="' + escapeHtml(sup) + '" data-registro-indices="' + indices.join(',') + '" data-total-sup="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(sup) + '">' + escapeHtml(sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(grupo) + '">' + escapeHtml(grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(tomador) + '">' + escapeHtml(tomador) + '</td>';
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-sup" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-sup" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-sup" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderLinhaTotalGeral(totalRegistros) {
  var todosIndices = [];
  for (var i = 0; i < totalRegistros; i++) todosIndices.push(i);
  var dataAttrs = 'data-registro-indices="' + todosIndices.join(',') + '" data-total-geral="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL GERAL</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-geral" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

// Total geral de UMA tipologia (soma através de TODOS os grupos/SUPs que
// têm essa tipologia, não só um) -- SUP fica em branco (como o total
// geral), Grupo/Tomador mostram "Todos" (não há um grupo/tomador único pra
// exibir aqui), mas a Tipologia aparece de verdade e colorida, pra
// distinguir qual bloco é qual quando vários aparecem juntos no topo.
function renderLinhaTotalGeralTipologia(tipologia, indices) {
  var chipColor = tipologiaColor(tipologia);
  var dataAttrs = 'data-tipologia="' + escapeHtml(tipologia) + '" data-categoria="' + categoriaTipologia(tipologia) + '" data-registro-indices="' + indices.join(',') + '" data-total-geral-tipologia="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(tipologia) + '</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-geral linha-total-geral-tipologia" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral linha-total-geral-tipologia" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral linha-total-geral-tipologia" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderCorpoTabela(registros) {
  var html = renderLinhaTotalGeral(registros.length);

  // Um total geral por tipologia, logo depois do total geral -- agrega
  // todos os registros daquela tipologia através de TODOS os SUPs (não só
  // do bloco de um contrato), em ordem alfabética (mesma ordem do filtro de
  // tipologia).
  var indicesPorTipologia = {};
  var ordemTipologias = [];
  registros.forEach(function (registro, indice) {
    if (!registro.tipologia) return;
    if (!indicesPorTipologia[registro.tipologia]) {
      indicesPorTipologia[registro.tipologia] = [];
      ordemTipologias.push(registro.tipologia);
    }
    indicesPorTipologia[registro.tipologia].push(indice);
  });
  ordemTipologias.sort();
  ordemTipologias.forEach(function (tipologia) {
    html += renderLinhaTotalGeralTipologia(tipologia, indicesPorTipologia[tipologia]);
  });

  var supAtual = null;
  var grupoAtual = null;
  var tomadorAtual = null;
  var indicesGrupoAtual = [];

  function fecharGrupo() {
    if (indicesGrupoAtual.length) {
      html += renderLinhaTotalSup(supAtual, grupoAtual, tomadorAtual, indicesGrupoAtual);
    }
  }

  registros.forEach(function (registro, indice) {
    if (supAtual !== null && registro.sup !== supAtual) {
      fecharGrupo();
      indicesGrupoAtual = [];
    }
    supAtual = registro.sup;
    grupoAtual = registro.grupo;
    tomadorAtual = registro.tomador;
    indicesGrupoAtual.push(indice);
    html += renderLinhaTabela(registro, indice);
  });
  fecharGrupo();
  return html;
}

function linhasDistintas(registros, campo) {
  var vistos = {};
  var resultado = [];
  registros.forEach(function (r) {
    var v = r[campo];
    if (v && !vistos[v]) { vistos[v] = true; resultado.push(v); }
  });
  resultado.sort();
  return resultado;
}

// Os 5 filtros (Tipologia/Categoria/Grupo/SUP/Série) são todos seleção
// múltipla, num dropdown de checkboxes -- Tipologia/Grupo/SUP têm opções
// dinâmicas (dependem dos registros decifrados); Categoria/Série têm
// opções fixas (rótulos genéricos, sem dado protegido, podem ir hardcoded).
var FILTROS_CONFIG = [
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup' },
  { id: 'filtro-serie', chave: 'serie', rotuloPadrao: 'Todas as séries', opcoesFixas: [
    { valor: 'previsto', rotulo: 'Previsto' },
    { valor: 'realizado', rotulo: 'Realizado' },
    { valor: 'total', rotulo: 'Tendência' },
  ] },
];

// chave -> Set dos valores marcados -- Set vazio tem a MESMA semântica que
// o <select> de valor único tinha com "" (nenhum filtro, mostra tudo).
var filtrosSelecionados = {};
FILTROS_CONFIG.forEach(function (cfg) { filtrosSelecionados[cfg.chave] = new Set(); });

function opcoesFiltro(cfg, registros) {
  if (cfg.opcoesFixas) return cfg.opcoesFixas;
  return linhasDistintas(registros, cfg.campo).map(function (v) { return { valor: v, rotulo: v }; });
}

function atualizarRotuloFiltro(cfg, opcoes) {
  var trigger = document.querySelector('#' + cfg.id + ' .filtro-multi-trigger');
  var seta = trigger.querySelector('.filtro-multi-seta');
  var selecionados = filtrosSelecionados[cfg.chave];
  var texto;
  if (selecionados.size === 0) {
    texto = cfg.rotuloPadrao;
  } else if (selecionados.size === 1) {
    var valor = selecionados.values().next().value;
    var opcao = opcoes.filter(function (o) { return o.valor === valor; })[0];
    texto = opcao ? opcao.rotulo : valor;
  } else {
    texto = selecionados.size + ' selecionadas';
  }
  trigger.textContent = texto;
  trigger.appendChild(seta);
}

// Monta (ou remonta, ex.: depois de um refresh ao vivo com dados novos) o
// painel de checkboxes de UM filtro -- descarta seleções que não existem
// mais nas opções atuais em vez de deixá-las "fantasma" (marcadas mas sem
// checkbox visível pra desmarcar).
function montarFiltroMulti(cfg, registros) {
  var opcoes = opcoesFiltro(cfg, registros);
  var valoresValidos = {};
  opcoes.forEach(function (o) { valoresValidos[o.valor] = true; });
  filtrosSelecionados[cfg.chave].forEach(function (v) {
    if (!valoresValidos[v]) filtrosSelecionados[cfg.chave].delete(v);
  });

  var painel = document.querySelector('#' + cfg.id + ' .filtro-multi-painel');
  painel.innerHTML = opcoes.length
    ? opcoes.map(function (o) {
        var marcado = filtrosSelecionados[cfg.chave].has(o.valor) ? ' checked' : '';
        return '<label class="filtro-multi-item"><input type="checkbox" value="' + escapeHtml(o.valor) + '"' + marcado + '>' + escapeHtml(o.rotulo) + '</label>';
      }).join('')
    : '<div class="filtro-multi-vazio">Nenhuma opção</div>';
  painel.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) filtrosSelecionados[cfg.chave].add(checkbox.value);
      else filtrosSelecionados[cfg.chave].delete(checkbox.value);
      atualizarRotuloFiltro(cfg, opcoes);
      recalcularTabela();
    });
  });
  atualizarRotuloFiltro(cfg, opcoes);
}

function montarTodosFiltrosMulti(registros) {
  FILTROS_CONFIG.forEach(function (cfg) { montarFiltroMulti(cfg, registros); });
}

// Abre/fecha o painel ao clicar no botão-gatilho (fechando qualquer outro
// que já estivesse aberto) e fecha ao clicar fora -- ligado uma vez só, no
// carregamento (os botões-gatilho são fixos; só o CONTEÚDO do painel é
// remontado por montarFiltroMulti).
function configurarAberturaFiltrosMulti() {
  document.querySelectorAll('.filtro-multi-trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function (evento) {
      evento.stopPropagation();
      var container = trigger.closest('.filtro-multi');
      var jaAberto = container.classList.contains('aberto');
      document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
        el.classList.remove('aberto');
        el.querySelector('.filtro-multi-painel').hidden = true;
      });
      if (!jaAberto) {
        container.classList.add('aberto');
        container.querySelector('.filtro-multi-painel').hidden = false;
      }
    });
  });
  // O painel (container fixo -- só o conteúdo dos checkboxes é remontado
  // por montarFiltroMulti) para a propagação de qualquer clique dentro
  // dele, senão marcar um checkbox borbulharia até o listener do document
  // logo abaixo e fecharia o painel a cada clique, impedindo marcar mais
  // de uma opção.
  document.querySelectorAll('.filtro-multi-painel').forEach(function (painel) {
    painel.addEventListener('click', function (evento) { evento.stopPropagation(); });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
      el.classList.remove('aberto');
      el.querySelector('.filtro-multi-painel').hidden = true;
    });
  });
}

function recalcularTabela() {
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = filtrosSelecionados.tipologia;
  var filtroCategoria = filtrosSelecionados.categoria;
  var filtroGrupo = filtrosSelecionados.grupo;
  var filtroSup = filtrosSelecionados.sup;
  var filtroSerie = filtrosSelecionados.serie;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha) {
    var combinaSerie = !filtroExclui(filtroSerie, linha.dataset.serie);
    var combinaGrupoSup = !filtroExclui(filtroGrupo, linha.dataset.grupo) &&
      !filtroExclui(filtroSup, linha.dataset.sup);
    var combinaTipologiaCategoria = !filtroExclui(filtroTipologia, linha.dataset.tipologia) &&
      !filtroExclui(filtroCategoria, linha.dataset.categoria);
    var ehTotalGeral = linha.dataset.totalGeral === '1';
    var ehTotalGeralTipologia = linha.dataset.totalGeralTipologia === '1';
    var ehTotalSup = linha.dataset.totalSup === '1';
    var indices = linha.dataset.registroIndices.split(',').map(Number);
    var mostra;
    if (ehTotalGeral) {
      // Total geral (a visão-resumo de TUDO): só aparece na visão sem
      // nenhum recorte -- some assim que qualquer filtro (tipologia,
      // categoria, grupo ou SUP) restringe os dados, porque nesse ponto o
      // total por SUP (ou a própria linha do registro) já cobre o recorte
      // atual.
      mostra = filtroGrupo.size === 0 && filtroSup.size === 0 && filtroTipologia.size === 0 && filtroCategoria.size === 0 && combinaSerie;
    } else if (ehTotalGeralTipologia) {
      // Total de UMA tipologia através de todos os grupos/SUPs -- mesma
      // regra do total geral (some com filtro de grupo/SUP), mas os
      // filtros de tipologia/categoria escolhem QUAIS blocos aparecem em
      // vez de escondê-los.
      mostra = filtroGrupo.size === 0 && filtroSup.size === 0 && combinaTipologiaCategoria && combinaSerie;
    } else if (ehTotalSup) {
      mostra = combinaGrupoSup && filtroTipologia.size === 0 && filtroCategoria.size === 0 && combinaSerie;
    } else {
      mostra = combinaGrupoSup && combinaTipologiaCategoria && combinaSerie;
    }
    linha.style.display = mostra ? '' : 'none';
    if (mostra) {
      var valoresLista = indices.map(function (idx) { return window.__REGISTROS__[idx][linha.dataset.serie]; });
      preencherLinha(linha, valoresLista, linha.dataset.serie, dimensao);
    }
  });
  mesclarColunasRepetidas();
  montarGrafico(window.__REGISTROS__, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroSerie, dimensao);
}

function limparFiltros() {
  FILTROS_CONFIG.forEach(function (cfg) {
    filtrosSelecionados[cfg.chave].clear();
  });
  montarTodosFiltrosMulti(window.__REGISTROS__);
  recalcularTabela();
}

// Chamado uma vez, pelo gate de senha, assim que a senha certa decifra os
// registros -- monta a tabela inteira e liga os filtros/botões.
function montarDashboard(registros) {
  montarTodosFiltrosMulti(registros);
  configurarAberturaFiltrosMulti();
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros);
  document.getElementById('seletor-dimensao').addEventListener('change', recalcularTabela);
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  document.getElementById('aba-tabela').addEventListener('click', function () { alternarAba('tabela'); });
  document.getElementById('aba-grafico').addEventListener('click', function () { alternarAba('grafico'); });
  inicializarTooltipGrafico();
  recalcularTabela();
}

// ---- Atualização ao vivo (busca a Sheet espelho publicada, sem tocar no
// .xlsx original) ----------------------------------------------------------
// A Sheet espelho é mantida em dia por um Apps Script separado (ver
// tools/orcamento/apps-script-espelho-matriz.gs) que roda a cada 30 min:
// converte o .xlsx real numa cópia Sheets temporária pra ler os valores
// calculados, copia a aba MATRIZ pra dentro da própria Sheet espelho, e
// apaga a cópia. O botão aqui só busca o CSV publicado dessa Sheet -- o
// arquivo .xlsx que você edita nunca é tocado por este fluxo.
var URL_ESPELHO_MATRIZ = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';

// Parser CSV RFC4180 simples (aspas duplicadas escapam aspas, vírgula/quebra
// de linha dentro de aspas não terminam o campo) -- suficiente pro que o
// Google Sheets exporta, sem precisar de nenhuma lib externa.
function parseCsvGrid(texto) {
  var linhas = [];
  var linha = [];
  var campo = '';
  var dentroAspas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\\r') {
      // ignora -- o \\n logo em seguida já fecha a linha
    } else if (c === '\\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Converte uma célula do CSV pra número, ou null. Trata string vazia, erro
// de fórmula (#NAME?/#REF!/#VALUE!/#N/A, que aparecem quando o Apps Script
// converte o .xlsx pro formato Sheets e alguma fórmula específica do Excel
// não tem equivalente direto lá) e "n/a" como "sem dado" -- nunca como 0,
// pelo mesmo motivo de somarArraysMensais não confundir os dois.
function numeroPtBr(valor) {
  if (valor === undefined || valor === null) return null;
  var texto = String(valor).trim();
  if (texto === '' || texto.charAt(0) === '#' || texto.toLowerCase() === 'n/a') return null;
  var numero = parseFloat(texto.replace(/\\./g, '').replace(',', '.'));
  return isNaN(numero) ? null : numero;
}

function celulaTexto(v) {
  var t = (v === undefined || v === null) ? '' : String(v).trim();
  return t === '' ? null : t;
}

// Réplica em JS de parse-matriz.js (locateColumns) -- acha cada coluna pelo
// próprio rótulo da linha de cabeçalho, nunca por posição fixa, igual ao
// lado servidor. Lançar erro cedo aqui evita ler dado desalinhado em
// silêncio se a Sheet espelho mudar de forma.
function acharColunaClient(headerRow, rotulo) {
  for (var col = 0; col < headerRow.length; col++) {
    if (String(headerRow[col] || '').trim() === rotulo) return col;
  }
  throw new Error('Coluna "' + rotulo + '" não encontrada no cabeçalho do espelho ao vivo');
}
function proximasNColunasClient(colunaAncora, quantidade) {
  var cols = [];
  for (var i = 0; i < quantidade; i++) cols.push(colunaAncora + 1 + i);
  return cols;
}
function exigirRotuloClient(headerRow, col, esperado) {
  var encontrado = String(headerRow[col] || '').trim();
  if (encontrado !== esperado) {
    throw new Error('Esperava a coluna "' + esperado + '" na posição ' + col + ' do espelho ao vivo, encontrei "' + encontrado + '" -- a forma da planilha pode ter mudado');
  }
}
function locateColumnsClient(headerRow) {
  var origem = acharColunaClient(headerRow, 'ORIGEM');
  var grupo = acharColunaClient(headerRow, 'GRUPO');
  var tomador = acharColunaClient(headerRow, 'TOMADOR');
  var sup = acharColunaClient(headerRow, 'SUP');
  var escopo = acharColunaClient(headerRow, 'ESCOPO');
  var apoio = acharColunaClient(headerRow, 'APOIO');
  var inicio = acharColunaClient(headerRow, 'INICIO');
  var termino = acharColunaClient(headerRow, 'TERMINO');
  var sondagem = acharColunaClient(headerRow, 'SONDAGEM');
  var base = acharColunaClient(headerRow, 'BASE');

  var equipesMeses = proximasNColunasClient(base, 12);
  var pico = equipesMeses[11] + 1;
  exigirRotuloClient(headerRow, pico, 'PICO');
  var media = pico + 1;
  exigirRotuloClient(headerRow, media, 'MÉDIA');
  var prod = media + 1;
  exigirRotuloClient(headerRow, prod, 'PROD.');
  var dias = prod + 1;
  exigirRotuloClient(headerRow, dias, 'DIAS');

  var volumeMeses = proximasNColunasClient(dias, 12);
  var volumeTotal = volumeMeses[11] + 1;
  exigirRotuloClient(headerRow, volumeTotal, 'TOTAL');
  var volumeTotalInicial = volumeTotal + 1;
  var ticket = volumeTotalInicial + 1;
  exigirRotuloClient(headerRow, ticket, 'TICKET');

  var financeiroMeses = proximasNColunasClient(ticket, 12);
  var financeiroTotal = financeiroMeses[11] + 1;
  exigirRotuloClient(headerRow, financeiroTotal, 'TOTAL');
  var financeiroTotalInicial = financeiroTotal + 1;

  return {
    origem: origem, grupo: grupo, tomador: tomador, sup: sup, escopo: escopo, apoio: apoio,
    inicio: inicio, termino: termino, sondagem: sondagem, base: base,
    equipesMeses: equipesMeses, equipesResumo: { pico: pico, media: media, prod: prod, dias: dias },
    volumeMeses: volumeMeses, volumeResumo: { total: volumeTotal, totalInicial: volumeTotalInicial, ticket: ticket },
    financeiroMeses: financeiroMeses, financeiroResumo: { total: financeiroTotal, totalInicial: financeiroTotalInicial },
    observacao: financeiroTotalInicial + 1,
  };
}

function extrairValoresLinhaClient(row, columns) {
  return {
    equipes: columns.equipesMeses.map(function (col) { return numeroPtBr(row[col]); }),
    equipesResumo: {
      pico: numeroPtBr(row[columns.equipesResumo.pico]) || 0,
      media: numeroPtBr(row[columns.equipesResumo.media]) || 0,
      prod: numeroPtBr(row[columns.equipesResumo.prod]) || 0,
      dias: numeroPtBr(row[columns.equipesResumo.dias]) || 0,
    },
    volume: columns.volumeMeses.map(function (col) { return numeroPtBr(row[col]); }),
    volumeResumo: {
      total: numeroPtBr(row[columns.volumeResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.volumeResumo.totalInicial]) || 0,
      ticket: numeroPtBr(row[columns.volumeResumo.ticket]) || 0,
    },
    financeiro: columns.financeiroMeses.map(function (col) { return numeroPtBr(row[col]); }),
    financeiroResumo: {
      total: numeroPtBr(row[columns.financeiroResumo.total]) || 0,
      totalInicial: numeroPtBr(row[columns.financeiroResumo.totalInicial]) || 0,
    },
  };
}

var TIPOLOGIAS_RESUMO_CLIENTE = { MENSAL: true, ACUMULADO: true };
function deveIncluirClient(registro) {
  if (!registro.grupo || registro.grupo === 'Todos') return false;
  if (!registro.tipologia || TIPOLOGIAS_RESUMO_CLIENTE[registro.tipologia]) return false;
  return true;
}

// Réplica em JS de parse-matriz.js (parseMatriz) -- mesmo esquema de 3
// linhas físicas por combinação (contrato, tipologia) identificadas pela
// coluna BASE (P/R/T) e preenchimento "sticky" dos campos identificadores.
// grid[0] é o cabeçalho (a exportação CSV não tem a linha 0 vazia que o
// .xlsx real tem antes da linha 1).
function parseMatrizClient(grid) {
  var columns = locateColumnsClient(grid[0]);
  var registros = [];
  var estado = {
    origem: null, grupo: null, tomador: null, sup: null, escopo: null,
    apoio: null, inicio: null, termino: null, tipologia: null,
  };
  var atual = null;

  for (var rowNum = 1; rowNum < grid.length; rowNum++) {
    var row = grid[rowNum];
    if (!row) continue;
    var base = celulaTexto(row[columns.base]);
    if (base === null) continue;

    estado.origem = celulaTexto(row[columns.origem]) || estado.origem;
    estado.grupo = celulaTexto(row[columns.grupo]) || estado.grupo;
    estado.tomador = celulaTexto(row[columns.tomador]) || estado.tomador;
    estado.sup = celulaTexto(row[columns.sup]) || estado.sup;
    estado.escopo = celulaTexto(row[columns.escopo]) || estado.escopo;
    estado.apoio = celulaTexto(row[columns.apoio]) || estado.apoio;
    estado.inicio = celulaTexto(row[columns.inicio]) || estado.inicio;
    estado.termino = celulaTexto(row[columns.termino]) || estado.termino;
    estado.tipologia = celulaTexto(row[columns.sondagem]) || estado.tipologia;

    if (base === 'P') {
      atual = {
        origem: estado.origem, grupo: estado.grupo, tomador: estado.tomador, sup: estado.sup,
        escopo: estado.escopo, apoio: estado.apoio, inicio: estado.inicio, termino: estado.termino,
        tipologia: estado.tipologia, observacao: null,
        previsto: extrairValoresLinhaClient(row, columns), realizado: null, total: null,
      };
    } else if (base === 'R' && atual) {
      atual.realizado = extrairValoresLinhaClient(row, columns);
    } else if (base === 'T' && atual) {
      atual.total = extrairValoresLinhaClient(row, columns);
      atual.observacao = celulaTexto(row[columns.observacao]);
      if (deveIncluirClient(atual)) registros.push(atual);
      atual = null;
    }
  }
  return registros;
}

function definirStatusAtualizacao(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

function atualizarDadosAoVivo() {
  definirStatusAtualizacao('Atualizando…', false);
  fetch(URL_ESPELHO_MATRIZ + (URL_ESPELHO_MATRIZ.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now())
    .then(function (resposta) {
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      return resposta.text();
    })
    .then(function (texto) {
      var grid = parseCsvGrid(texto);
      var registrosNovos = parseMatrizClient(grid);
      if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho -- confira se o Apps Script já rodou pelo menos uma vez');

      window.__REGISTROS__ = registrosNovos;
      montarTodosFiltrosMulti(window.__REGISTROS__);
      document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(window.__REGISTROS__);
      recalcularTabela();

      var agora = new Date();
      definirStatusAtualizacao('Atualizado às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), false);
    })
    .catch(function (erro) {
      definirStatusAtualizacao('Falha ao atualizar: ' + erro.message, true);
    });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivo);
`;

function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri, senha }) {
  if (!senha) {
    throw new Error('renderDashboard requer "senha" -- o conteúdo (SUP/Grupo/Tomador/Tipologia/valores) é cifrado com ela antes de ir pro HTML.');
  }
  const registrosJson = JSON.stringify(registros.map(r => ({
    sup: r.sup, grupo: r.grupo, tomador: r.tomador, tipologia: r.tipologia,
    previsto: r.previsto, realizado: r.realizado, total: r.total,
  })));
  const dadosCifrados = cifrarComSenha(registrosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';

  // Mesmo sistema visual (tema escuro, header com logo, chips, tabela) da
  // matriz de equipes (tools/matriz/render-dashboard.js) -- cores, fonte e
  // classes principais copiadas de lá pra manter os dois dashboards
  // consistentes entre si. Diferença deliberada: o fundo da tabela aqui é
  // translúcido, pra a marca d'água central aparecer por trás -- pedido
  // explícito do usuário, a matriz de equipes não faz isso.
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
  :root {
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --gridline: #2c2c2a;
    --border: rgba(255,255,255,0.10);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .generated { color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(70vw, 900px);
    height: auto;
    opacity: 0.16;
    pointer-events: none;
    z-index: 0;
  }
  .header-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .header-bar img { height: 36px; width: auto; }
  .header-bar-title { flex: 1 1 200px; min-width: 0; }
  .gate-senha {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: center;
    min-height: 40vh;
  }
  .gate-senha-box {
    background: var(--surface-1); border: 2px solid #f6b53f; border-radius: 12px;
    padding: 32px; max-width: 360px; width: 100%; text-align: center;
  }
  .gate-senha-box h2 { margin: 0 0 16px; font-size: 16px; }
  .gate-senha-box input {
    width: 100%; padding: 10px 12px; margin-bottom: 12px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--page); color: var(--text-primary); font-size: 14px;
  }
  .gate-senha-box button {
    width: 100%; padding: 10px 16px;
    border: 2px solid #f6b53f; border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .gate-senha-box button:hover { background: rgba(246,181,63,0.1); }
  .gate-senha-box button:disabled { opacity: 0.6; cursor: wait; }
  .gate-senha-erro { color: #f0857a; font-size: 13px; margin-top: 10px; }
  .filtros { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .filtros-selecao { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .filtros-acoes { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .filtros select,
  #limpar-filtros,
  #atualizar-dashboard,
  .abas-visualizacao button {
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease, box-shadow 150ms ease;
  }
  .filtros select:focus-visible,
  #limpar-filtros:focus-visible,
  #atualizar-dashboard:focus-visible,
  .abas-visualizacao button:focus-visible,
  .gate-senha-box input:focus-visible,
  .gate-senha-box button:focus-visible {
    outline: 2px solid #f6b53f; outline-offset: 2px;
  }
  .filtros select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .filtros select:hover { border-color: rgba(246,181,63,0.5); }
  .filtro-multi { position: relative; }
  .filtro-multi-trigger {
    display: inline-flex; align-items: center; gap: 8px;
    max-width: 190px;
    padding: 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  .filtro-multi-trigger span,
  .filtro-multi-trigger { overflow: hidden; text-overflow: ellipsis; }
  .filtro-multi-seta { flex: none; margin-left: auto; color: #c3c2b7; transition: transform 150ms ease; }
  .filtro-multi-trigger:hover { border-color: rgba(246,181,63,0.5); }
  .filtro-multi.aberto .filtro-multi-trigger { border-color: #f6b53f; }
  .filtro-multi.aberto .filtro-multi-seta { transform: rotate(180deg); }
  .filtro-multi-painel {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 30;
    min-width: 210px; max-width: 300px; max-height: 260px; overflow-y: auto;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    padding: 6px;
  }
  .filtro-multi-painel[hidden] { display: none; }
  .filtro-multi-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 8px; border-radius: 4px; cursor: pointer;
    font-size: 13px; color: var(--text-primary); white-space: nowrap;
  }
  .filtro-multi-item:hover { background: rgba(255,255,255,0.05); }
  .filtro-multi-item input[type="checkbox"] { accent-color: #f6b53f; cursor: pointer; flex: none; }
  .filtro-multi-vazio { padding: 7px 8px; font-size: 13px; color: var(--text-secondary); }
  #limpar-filtros,
  #atualizar-dashboard,
  .abas-visualizacao button {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  #limpar-filtros svg, #atualizar-dashboard svg, .abas-visualizacao button svg { flex: none; }
  #limpar-filtros {
    height: 36px; padding: 0 14px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-secondary);
  }
  #limpar-filtros:hover { border-color: #f6b53f; color: var(--text-primary); background: rgba(255,255,255,0.04); }
  #limpar-filtros:active { transform: translateY(1px); }
  #atualizar-dashboard {
    height: 38px; padding: 0 18px;
    border: 2px solid #f6b53f; border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 2px 6px rgba(0,0,0,0.35);
  }
  #atualizar-dashboard:hover { background: rgba(246,181,63,0.14); box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 10px rgba(0,0,0,0.4); transform: translateY(-1px); }
  #atualizar-dashboard:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(0,0,0,0.3) inset; }
  #atualizar-dashboard:active svg { transform: rotate(70deg); }
  #atualizar-dashboard svg { transition: transform 300ms ease; }
  .status-atualizacao { font-size: 12px; color: var(--text-secondary); margin-left: 8px; }
  .status-atualizacao.status-erro { color: #e0684f; }
  .abas-visualizacao {
    display: flex; gap: 2px;
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 3px;
  }
  .abas-visualizacao button {
    height: 30px; padding: 0 14px;
    border: none; border-radius: 6px;
    background: transparent; color: var(--text-secondary);
  }
  .abas-visualizacao button:hover { color: var(--text-primary); }
  .abas-visualizacao button:active { transform: translateY(1px); }
  .abas-visualizacao button.aba-ativa {
    background: var(--surface-1); color: var(--text-primary); font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(246,181,63,0.4) inset;
  }
  @media (prefers-reduced-motion: reduce) {
    .filtros select, #limpar-filtros, #atualizar-dashboard, .abas-visualizacao button, #atualizar-dashboard svg { transition: none; }
  }
  #secao-grafico {
    background: rgba(26,26,25,0.68); border-radius: 8px; padding: 16px 8px;
    position: relative; z-index: 1;
  }
  .grafico-svg { width: 100%; height: auto; display: block; }
  .grafico-painel { margin-bottom: 28px; }
  .grafico-painel:last-child { margin-bottom: 0; }
  .grafico-titulo { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .grafico-eixo-texto { fill: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
  .grafico-gridline, .grafico-linha-guia { stroke: var(--gridline); stroke-width: 1; }
  .grafico-linha { stroke-linecap: round; stroke-linejoin: round; }
  .grafico-rotulo { fill: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
  .grafico-rotulo-final { fill: var(--text-primary); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; paint-order: stroke; stroke: var(--page); stroke-width: 3px; stroke-linejoin: round; }
  .grafico-rotulo { paint-order: stroke; stroke: var(--page); stroke-width: 3px; stroke-linejoin: round; }
  .grafico-hit { cursor: pointer; pointer-events: all; }
  .grafico-marcador { pointer-events: none; }
  .grafico-tooltip {
    position: absolute; pointer-events: none;
    background: #0d0d0d; border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; font-size: 12px; color: var(--text-primary);
    white-space: nowrap; z-index: 5; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .table-scroll { overflow-x: auto; border-radius: 8px; position: relative; z-index: 1; }
  table { width: 100%; border-collapse: collapse; background: rgba(26,26,25,0.68); }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--gridline); font-size: 13px; }
  td.num { font-variant-numeric: tabular-nums; }
  th {
    color: var(--text-secondary); font-weight: 600; background: #141412;
    position: sticky; top: 0; z-index: 1;
    box-shadow: 0 1px 0 var(--gridline), 0 2px 6px rgba(0,0,0,0.3);
  }
  /* Primeira coluna (SUP) fixa ao rolar a tabela pro lado -- especificidade
     igual à das regras de fundo por tipo de linha (.linha-total-sup td etc.)
     abaixo, então essas continuam ganhando por ordem (vêm depois no CSS) e
     a coluna fixa herda o tom certo em cada tipo de linha, em vez de travar
     num fundo genérico. */
  td:first-child, th:first-child { position: sticky; left: 0; z-index: 1; }
  td:first-child { background: var(--surface-1); }
  th:first-child { z-index: 2; }
  #corpo-tabela tr:hover { filter: brightness(1.14); }
  .tipologia-chip {
    display: inline-block;
    background: var(--chip-color); color: #fff;
    border-radius: 4px; padding: 2px 8px;
    font-size: 12px; font-weight: 600;
  }
  .tipologia-chip-total { background: rgba(26,26,25,0.6); color: var(--text-primary); border: 2px solid var(--text-secondary); }
  .celula-mes { white-space: nowrap; }
  .celula-total-linha { white-space: nowrap; font-weight: 700; border-left: 2px solid var(--border); }
  .serie-label { font-weight: 700; border-left: 4px solid transparent; padding-left: 10px; white-space: nowrap; }
  .linha-previsto .serie-label, .linha-previsto .celula-mes, .linha-previsto .celula-total-linha { color: #2f6ad0; }
  .linha-previsto .serie-label { border-left-color: #2f6ad0; }
  .linha-realizado .serie-label, .linha-realizado .celula-mes, .linha-realizado .celula-total-linha { color: #7fd858; }
  .linha-realizado .serie-label { border-left-color: #7fd858; }
  .linha-total .serie-label, .linha-total .celula-mes, .linha-total .celula-total-linha { color: #f6b53f; }
  .linha-total .serie-label { border-left-color: #f6b53f; }
  tr.linha-total td { border-bottom: 2px solid var(--gridline); }
  .linha-total-sup td { background: rgba(0,0,0,0.32); }
  .linha-total-geral td { background: rgba(246,181,63,0.10); }
  tr.linha-total.linha-total-geral td { border-bottom: 2px solid #f6b53f; }
  .linha-total-geral-tipologia td { background: rgba(255,255,255,0.03); }
  tr.linha-total.linha-total-geral-tipologia td { border-bottom: 1px solid var(--gridline); }
  .valor-repetido { color: rgba(255,255,255,0.14); }
</style>
</head>
<body>
  ${watermarkImg}
  <main>
  <div class="header-bar">
    ${logoImg}
    <div class="header-bar-title">
      <h1>ORÇAMENTO — Previsto x Realizado x Tendência</h1>
      <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</div>
    </div>
  </div>

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
    <div class="filtros">
      <div class="filtros-selecao">
        <div class="filtro-multi" id="filtro-tipologia"><button type="button" class="filtro-multi-trigger">Todas as tipologias<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        <div class="filtro-multi" id="filtro-categoria"><button type="button" class="filtro-multi-trigger">Todas as categorias<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        <div class="filtro-multi" id="filtro-grupo"><button type="button" class="filtro-multi-trigger">Todos os grupos<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        <div class="filtro-multi" id="filtro-sup"><button type="button" class="filtro-multi-trigger">Todos os SUP<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        <div class="filtro-multi" id="filtro-serie"><button type="button" class="filtro-multi-trigger">Todas as séries<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="filtro-multi-painel" hidden></div></div>
        <select id="seletor-dimensao"><option value="equipes">Equipes</option><option value="volume">Volume</option><option value="financeiro" selected>Financeiro</option><option value="produtividade">Produtividade</option><option value="ticketMedio">Ticket médio</option></select>
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
      </div>
      <div class="filtros-acoes">
        <div class="abas-visualizacao">
          <button id="aba-tabela" type="button" class="aba-ativa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Tabela</button>
          <button id="aba-grafico" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>Gráfico</button>
        </div>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>
    </div>
    <div id="secao-tabela">
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
    </div>
    <div id="secao-grafico" style="display:none">
      <div class="grafico-painel">
        <div class="grafico-titulo" id="grafico-titulo-mensal">Mensal</div>
        <div id="grafico-mensal-container"></div>
      </div>
      <div class="grafico-painel" id="grafico-painel-acumulado">
        <div class="grafico-titulo" id="grafico-titulo-acumulado">Acumulado no ano</div>
        <div id="grafico-acumulado-container"></div>
      </div>
      <div id="grafico-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
  </div>
  </main>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${SCRIPT_CLIENTE_GATE}</script>
  <script>${SCRIPT_CLIENTE_TABELA}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
