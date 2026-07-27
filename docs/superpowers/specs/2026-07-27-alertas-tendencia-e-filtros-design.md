# Fechamento da Tendência no mês vigente, Equipes acumuladas e filtro de Dimensão duplicado

## Contexto

A aba Alertas (e, por extensão, a Tabela) tem 3 problemas reais, confirmados
ao vivo contra o dashboard publicado:

1. **"Tendência ÷ Previsto — Acumulado até Vigente" mostra valores incompletos
   ou zerados.** A série "Tendência" vem de uma 3ª linha física da planilha
   (linha "T", ao lado de "P"=Previsto e "R"=Realizado) preenchida pela área
   financeira mês a mês. Confirmado ao vivo: pra alguns SUPs essa linha só
   tem valor real a partir do mês vigente em diante (meses passados ficam
   zerados/em branco na própria planilha), fazendo qualquer acumulado que
   inclua meses passados (Acumulado até Vigente, Total Ano) somar muito menos
   do que deveria.
2. **Equipes acumuladas somam em vez de tirar média.** Equipes é uma "foto"
   (quantas equipes mobilizadas naquele mês), não um fluxo. Somar Equipes de
   vários meses (ex.: 3 meses com 5 equipes cada = "15") não tem significado
   -- o valor útil é uma média ponderada pelos dias de cada mês, mesma
   premissa que Produtividade já usa (Jan/Dez = 15 dias, os demais = 30).
3. **2 seletores "Dimensão" independentes confundem.** A barra de cima
   (Origem/Categoria/Tipologia/Grupo/SUP/Série/**Dimensão**) vale pra
   Tabela/Gráfico; a aba Alertas tem seu próprio conjunto de 6 filtros
   (Agrupar por/**Dimensão**/Numérico/Baseline/Período/Status). As duas
   "Dimensão" têm o mesmo visual mas estado próprio -- mudar uma não muda a
   outra, o que parece bug.

## Objetivo

1. Fechar a série Tendência do **mês vigente** combinando Realizado (o que já
   rodou) com a projeção da própria linha T (o que falta pra fechar o mês) --
   pro dashboard inteiro (Tabela, Gráfico, Alertas), não só Alertas. Meses já
   fechados (antes do vigente) passam a valer pelo Realizado; meses futuros
   continuam com o valor cru da linha T.
2. Trocar soma por média ponderada por dias sempre que a dimensão for
   Equipes e o período abranger mais de 1 mês -- na aba Alertas (todos os
   períodos acumulados) e na coluna "Total" da Tabela.
3. Remover o seletor de Dimensão próprio da aba Alertas -- ela passa a seguir
   a 1ª dimensão marcada na barra de cima (ordem canônica de
   `DIMENSOES_CONFIG`), igual às outras abas.

## Fora de escopo

- **Gráfico não ganha nenhuma mudança própria.** Ele já lê os mesmos valores
  mensais de `registro.total`/`calcularMensal` que a Seção A corrige na
  origem -- nenhuma lógica nova no Gráfico em si.
- **Coluna mensal individual (Tabela) não muda.** Só a coluna "Total"
  (ano inteiro) usa a média ponderada de Equipes -- cada mês isolado já
  mostra o valor daquele mês só, sem soma nem média.
- **Botão "Atualizar dados" (live-refresh) não precisa de nenhuma mudança
  própria.** A transformação da Seção A acontece uma vez, antes do JSON de
  `registros` ser embutido/cifrado na página (`render-dashboard.js`, logo
  após `calcularVigenteIdx`) -- o mesmo `window.__REGISTROS__` que o
  live-refresh já usa nasce com a Tendência já fechada, sem precisar
  recalcular nada no navegador.
- **`compute-orcamento.js` não é tocado.** Confirmado que esse módulo não é
  importado por `build-dashboard.js` nem `render-dashboard.js` -- é código
  morto (só o próprio teste o exercita), fora do escopo desta mudança.
- **Financeiro/Volume acumulados continuam somando** (Seção B só muda
  Equipes) -- são fluxos, somar já é correto.
- **Nenhum novo filtro de recorte.** A pergunta original também citava
  "melhorar a dinâmica dos filtros" de forma genérica; o único problema
  concreto identificado (e confirmado) foi a duplicação do seletor Dimensão
  -- os outros filtros (Origem/Categoria/Tipologia/Grupo/SUP/Série,
  Agrupar por/Numérico/Baseline/Período/Status) não mudam.

## Design

### Seção A: fechar a Tendência do mês vigente

Novo código em `tools/orcamento/render-dashboard.js`, perto de
`DIAS_PREMISSA_MES`/`CAMPOS_RATIO`:

```js
// Fecha a Tendência (série "total") do mês vigente combinando o Realizado
// parcial já ocorrido com a projeção da própria linha T da planilha pra
// completar o mês -- meses já fechados (antes do vigente) passam a valer
// pelo Realizado (fato, não projeção); meses futuros continuam com o valor
// cru da linha T. Financeiro/Volume são fluxos do mês (o que já rodou + o
// que falta pra fechar = soma); Equipes é uma foto (headcount), somar
// contaria equipe em dobro -- usa o maior dos dois em vez de somar.
// Confirmado com o usuário (2026-07-27): vale pro dashboard inteiro
// (Tabela/Gráfico/Alertas), aplicado uma vez antes de qualquer aba
// consumir registro.total.
function fecharValorMesVigenteFluxo(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return (realizadoMes || 0) + (totalMes || 0);
}
function fecharValorMesVigenteEquipes(totalMes, realizadoMes) {
  if ((totalMes === null || totalMes === undefined) && (realizadoMes === null || realizadoMes === undefined)) return null;
  return Math.max(realizadoMes || 0, totalMes || 0);
}
var CAMPOS_FECHAMENTO_VIGENTE = { equipes: fecharValorMesVigenteEquipes, volume: fecharValorMesVigenteFluxo, financeiro: fecharValorMesVigenteFluxo };

function fecharSerieMensal(totalMensal, realizadoMensal, vigenteIdx, fechar) {
  return totalMensal.map(function (v, i) {
    if (i < vigenteIdx) {
      var r = realizadoMensal ? realizadoMensal[i] : null;
      return (r === null || r === undefined) ? v : r;
    }
    if (i === vigenteIdx) return fechar(v, realizadoMensal ? realizadoMensal[i] : null);
    return v;
  });
}

function fecharTendenciaVigente(registros, vigenteIdx) {
  if (vigenteIdx < 0 || vigenteIdx > 11) return registros; // fora do ano coberto -- nada a fechar
  return registros.map(function (registro) {
    if (!registro.total) return registro;
    var realizado = registro.realizado;
    var totalFechado = Object.assign({}, registro.total);
    ['equipes', 'volume', 'financeiro'].forEach(function (campo) {
      totalFechado[campo] = fecharSerieMensal(
        registro.total[campo], realizado ? realizado[campo] : null, vigenteIdx, CAMPOS_FECHAMENTO_VIGENTE[campo]
      );
    });
    return Object.assign({}, registro, { total: totalFechado });
  });
}
```

Chamada em `renderDashboard` (`render-dashboard.js:2021-2026`), logo após
`calcularVigenteIdx`, antes do `JSON.stringify` que vira
`window.__REGISTROS__`:

```js
const vigenteIdx = calcularVigenteIdx(periodos, generatedAt);
const registrosFechados = fecharTendenciaVigente(registros, vigenteIdx);
const registrosJson = JSON.stringify(registrosFechados.map(r => ({ ... })));
```

Esse é o único ponto de aplicação necessário: `window.__REGISTROS__` é a
ÚNICA fonte de dados que toda a Tabela/Gráfico/Alertas (inicial e
live-refresh) já usa hoje -- nenhuma outra função precisa saber que a
Tendência foi "fechada".

### Seção B: Equipes acumuladas viram média ponderada por dias

Novo helper, ao lado de `somarIntervaloMensal`:

```js
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
```

Usada em 2 lugares (ambos já filtram pelo `dimensao` string, então o
`if (dimensao === 'equipes')` é um desvio local, sem mexer no resto):

- `bucketPeriodo` (aba Alertas, `render-dashboard.js:276-277`): troca
  `return somarIntervaloMensal(mensal, inicio, fim);` por
  `return dimensao === 'equipes' ? mediaEquipesPonderada(mensal, inicio, fim) : somarIntervaloMensal(mensal, inicio, fim);`
- `calcularTotalAno` (coluna "Total" da Tabela, branch não-ratio no fim da
  função, ~`render-dashboard.js:201`): mesma troca --
  `return dimensao === 'equipes' ? mediaEquipesPonderada(mensal, 0, 12) : somar(mensal);`
  (`mensal` já é o array de 12 posições ali, via `somarArraysMensais`).

### Seção C: Alertas segue a 1ª dimensão marcada na barra de cima

- Remove a entrada `filtro-alertas-dimensao` de `FILTROS_ALERTAS_CONFIG`
  (`render-dashboard.js:1390`) e a linha
  `filtrosAlertas.dimensao.add('financeiro');` (`render-dashboard.js:1416`).
- Remove o `<div class="filtro-multi" id="filtro-alertas-dimensao">...`
  do template (`render-dashboard.js:2363`).
- Em `recalcularAlertas` (`render-dashboard.js:925`), troca
  `var dimensao = filtrosAlertas.dimensao.values().next().value;` por
  `var dimensao = dimensoesEmOrdem(filtrosSelecionados.dimensao)[0];`
  (reaproveita o helper que já existe pra Tabela/Gráfico, `render-dashboard.js:1137`
  -- nunca vazio na prática, `seletor-dimensao` tem `minimoUm: true`).
- `colunasAlertas`/`renderCorpoAlertas` não mudam de assinatura -- continuam
  recebendo 1 `dimensao` string só, igual hoje.

## Testes

- `test/orcamento-render-dashboard.test.js` (estende):
  - `fecharTendenciaVigente`/`fecharSerieMensal` (via `extrairFuncoesPuras`):
    mês antes do vigente vira o valor de Realizado (não o cru da linha T);
    mês vigente com Financeiro/Volume soma Realizado+T; mês vigente com
    Equipes usa o maior dos dois; mês vigente com só um dos dois presente
    (o outro null) usa só o que existe; mês vigente com os dois null
    continua null (não vira 0 falso); mês futuro não muda.
  - `mediaEquipesPonderada`: 3 meses normais (30 dias) com valores
    diferentes dá a média aritmética simples; um mês Jan/Dez (15 dias)
    pesa metade de um mês normal no cálculo; intervalo com 1 mês só devolve
    o valor do próprio mês; meses com `null` no meio são ignorados (não
    contam nem no numerador nem no peso).
  - `bucketPeriodo`/`calcularTotalAno` com dimensão Equipes: confirma que
    Acumulado até Vigente / Acumulado Anterior / Total Ano usam a média
    ponderada, não a soma; Financeiro/Volume nos mesmos períodos continuam
    somando (sem regressão).
  - Aba Alertas sem seletor de Dimensão próprio: `recalcularAlertas` (via
    teste de integração client-side já existente no arquivo, se houver, ou
    novo teste de `renderDashboard`) usa a 1ª dimensão marcada na barra de
    cima; trocar a dimensão da barra de cima muda o resultado de Alertas
    sem precisar de nenhum controle próprio.
  - Regressão: banner/coluna existentes de Financeiro/Volume/Produtividade/
    TicketMedio continuam batendo os mesmos números de antes desta mudança
    nos casos que não envolvem mês vigente nem Equipes acumulado (para
    não quebrar testes já existentes sem necessidade).
