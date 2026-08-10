'use strict';

// Regra ÚNICA de exclusão de auto-consumo interno, decidida pelo dono do
// projeto em 2026-08-10: "aplica a exclusão em todas as fontes".
//
// Antes desta consolidação a mesma regra estava copiada literalmente em três
// mappers (mapear-producao-total.js, mapear-demandas-sondagem.js,
// mapear-demandas-lab.js) e AUSENTE em dois fetchers -- Lab Realizado
// (atualizar-lab-online.js gravava o grid cru) e Equipes (Link 7, sem mapper
// nenhum). O buraco era visível no dado: equipes-online.csv trazia SEG.A e o
// contrato "SUP- CT TREIN EQ SOND" (centro de treinamento), que as outras
// fontes já descartavam. Uma cópia só da regra é o que impede as fontes de
// divergirem de novo na próxima correção que só uma delas receber.
//
// A coluna do tomador NÃO tem o mesmo nome em toda fonte: o extrato de lab
// (Link 4) a chama de "Tomadora", as demais de "Tomador". São a mesma coluna
// -- confirmado pelo dono do projeto, "só altera o nome da coluna" -- por
// isso tomadorDaLinha() aceita as duas grafias em vez de cada chamador
// lembrar de tratar a sua.

const TOMADOR_EXCLUIDO = 'Suporte Sondagens - Filial Lapa';

// Mantido como regex (e não lista explícita) de propósito: é EXATAMENTE a
// semântica que as três fontes já aplicavam, e trocar por lista mudaria o
// comportamento para rótulos futuros sem decisão do dono do projeto. Contra
// os 20 rótulos crus que tipologias-avancos.js conhece hoje, o regex casa
// exatamente SEG.A, SEG.V e SN -- nem mais, nem menos. A troca por lista
// explícita está registrada como pergunta em aberto no documento de regras.
const RE_EXCLUSAO_TIPO = /SEG|SN/;

const ROTULOS_TOMADOR = ['Tomador', 'Tomadora'];

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

// Acha o valor de uma coluna comparando o rótulo ignorando variação de
// espaçamento -- o Link 7 usa espaço duplo em algumas colunas ("Data / Hora
// Primeira Foto"), e depender da chave exata já fez TODA linha ser
// descartada em silêncio uma vez (2026-08-08).
function colunaTolerante(linha, rotulo) {
  const alvo = rotulo.replace(/\s+/g, ' ').trim();
  for (const chave of Object.keys(linha || {})) {
    if (chave.replace(/\s+/g, ' ').trim() === alvo) return linha[chave];
  }
  return undefined;
}

// O tomador da linha, seja qual for a grafia da coluna na fonte.
function tomadorDaLinha(linha) {
  for (const rotulo of ROTULOS_TOMADOR) {
    const valor = colunaTolerante(linha, rotulo);
    if (valor !== undefined) return texto(valor);
  }
  return '';
}

function tipoExcluido(tipo) {
  return RE_EXCLUSAO_TIPO.test(texto(tipo).toUpperCase());
}

function tomadorExcluido(tomador) {
  return texto(tomador) === TOMADOR_EXCLUIDO;
}

// Decide pela linha inteira. 'tipo' é passado à parte porque nem toda fonte
// guarda o tipo na mesma coluna: o Link 1 usa "Tipo", o Link 5 usa "Sondagem
// Tipo", e em Demandas de sondagem o tipo confiável vem do Link 2 enquanto o
// tomador só existe no Link 3 (join por OS) -- por isso quem chama informa o
// tipo, e só o tomador é procurado na própria linha.
function linhaExcluida(linha, tipo) {
  return tomadorExcluido(tomadorDaLinha(linha)) || tipoExcluido(tipo);
}

module.exports = {
  TOMADOR_EXCLUIDO, RE_EXCLUSAO_TIPO,
  colunaTolerante, tomadorDaLinha, tipoExcluido, tomadorExcluido, linhaExcluida,
};
