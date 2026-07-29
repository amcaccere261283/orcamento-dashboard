'use strict';
const fs = require('node:fs');

// Fonte única do cálculo de equipes, compartilhada entre o dashboard de
// orçamento e a página de planejamento semanal -- reimplementar seria a
// forma mais fácil de as duas discordarem sobre quantas equipes havia num
// período.
//
// Os dois blocos marcados abaixo são copiados VERBATIM do JS de cliente do
// orçamento (tools/orcamento/render-dashboard.js), que agora os injeta de
// volta via trechosParaCliente(). Os `var` e os comentários fazem parte do
// texto emitido no HTML publicado, que precisa continuar byte-a-byte
// idêntico (test/orcamento-html-inalterado.test.js) -- não modernize pra
// `const`, não reformate, não reescreva comentário.
//
// São DOIS blocos, e não um, porque no orçamento DIAS_PREMISSA_MES e as duas
// funções ficam em pontos distantes do mesmo script: cada trecho é injetado
// na posição exata em que a definição estava. fonteParaCliente() concatena
// os dois, que é o que uma página nova precisa.

// <<< INICIO CLIENTE
// Premissa de dias úteis considerados por mês, pra Produtividade virar uma
// taxa por EQUIPE-DIA (volume ÷ (equipes × dias)), não só por equipe-mês --
// Jan/Dez usam 15 (meses parciais), os outros 10 usam 30. Confirmado com o
// usuário. Só entra na conta de Realizado/Tendência (e num Previsto
// agregando várias tipologias) -- a premissa de Previsto de UMA tipologia
// (equipesResumo.prod, abaixo) já vem pronta como taxa diária da própria
// planilha, não passa por aqui.
var DIAS_PREMISSA_MES = [15, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 15];
// FIM CLIENTE >>>

// <<< INICIO CLIENTE
// Equipes é uma foto por mês, não um fluxo -- acumular vários meses deve
// ser uma MÉDIA ponderada pelos dias de cada mês (mesma premissa de
// DIAS_PREMISSA_MES do denominador de Produtividade), não uma soma bruta
// (que produziria um "equipe-meses" sem significado prático). Um único mês
// no intervalo devolve o próprio valor do mês (peso 1, sem diferença de
// comportamento pros buckets de 1 mês só).
function mediaEquipesPonderada(mensal, inicio, fim) {
  var somaEquipeDias = null, somaDias = 0;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    somaEquipeDias = (somaEquipeDias === null ? 0 : somaEquipeDias) + mensal[i] * DIAS_PREMISSA_MES[i];
    somaDias += DIAS_PREMISSA_MES[i];
  }
  return somaDias ? somaEquipeDias / somaDias : null;
}

// produtividade soma equipe-DIAS no intervalo (não só equipes), mesma
// premissa de DIAS_PREMISSA_MES que calcularTotalAno já usa pro ano
// inteiro -- generalizada aqui pra qualquer intervalo de meses.
function somarIntervaloEquipeDias(mensal, inicio, fim) {
  var soma = null;
  var ini = Math.max(0, inicio), lim = Math.min(mensal.length, fim);
  for (var i = ini; i < lim; i++) {
    if (mensal[i] === null || mensal[i] === undefined) continue;
    soma = (soma === null ? 0 : soma) + mensal[i] * DIAS_PREMISSA_MES[i];
  }
  return soma;
}
// FIM CLIENTE >>>

// Recorta os blocos marcados para inlinar no navegador exatamente o mesmo
// código que o Node testou. A regex escapa as barras, então o próprio
// padrão não casa consigo mesmo e não vira um bloco fantasma.
//
// O \r\n vira \n na leitura porque é isso que o resto do HTML já faz: o JS
// de cliente do orçamento mora em template literal, e a linguagem normaliza
// a quebra de linha do literal pra \n mesmo quando o .js está em CRLF no
// disco. fs.readFileSync não normaliza nada, então sem esse replace o
// trecho injetado sairia em CRLF num checkout Windows (core.autocrlf=true) e
// em LF num checkout Linux -- o HTML publicado passaria a depender de como o
// repositório foi clonado.
function trechosParaCliente() {
  const src = fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n');
  const padrao = /\/\/ <<< INICIO CLIENTE([\s\S]*?)\/\/ FIM CLIENTE >>>/g;
  const trechos = [];
  let achado;
  while ((achado = padrao.exec(src)) !== null) trechos.push(achado[1]);
  return trechos;
}

// Os trechos já começam e terminam em quebra de linha, então concatenar
// direto reproduz o espaçamento natural entre eles.
function fonteParaCliente() {
  return trechosParaCliente().join('');
}

module.exports = { DIAS_PREMISSA_MES, mediaEquipesPonderada, somarIntervaloEquipeDias, trechosParaCliente, fonteParaCliente };
