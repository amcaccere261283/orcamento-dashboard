# Troca de origem — Realizado, Demandas e Equipes — design

Data: 2026-08-08

## Objetivo

Trocar a tela/URL de origem de sond.com.br usada por três conceitos do Planejamento
Semanal — **Realizado de sondagens**, **Demandas** (sondagens e lab) e **Equipes** —
porque a origem atual vinha falhando: ~18 dos ~86 contratos ativos retornando "Not a
valid zip file" no download por contrato de Avanços (sintoma de uma tela que mudou),
diferente do "resposta vazia" esperado para contrato sem sondagem ainda.

Lab Realizado (`extrato-ensaios-realizados`) **não muda** — continua funcionando e
mantém a URL atual.

## Abordagem geral (decidida com o usuário: opção C, híbrida)

Duas opções descartadas:

- **A — forçar tudo no CSV/formato antigo.** Mínima mudança de código, mas a lógica
  nova é genuinamente diferente (fração de equipe por SUP+Tipo, junção de duas fontes
  por OS, fallback de 45 dias) — não cabe num CSV de "1 linha = 1 furo com Sondador
  único" sem gambiarra.
- **B — reescrever fetch + compute + render do zero.** Mais fiel à lógica nova, mas
  toca código hoje estável e testado (`compute-balanco.js`, `render-aba-semanal.js`,
  Alertas, Consolidado).

**Escolhida: C — híbrida.** Trocam os fetchers (novas URLs) e os `compute-*` de
Demandas/Equipes (a lógica realmente mudou), mas a **interface de saída** para o resto
do dashboard permanece a mesma que já existe hoje — `render-aba-semanal.js`,
`compute-balanco.js`, Alertas e Consolidado não mudam. Realizado (Link 1) é tratado
como uma variação leve dentro de C: a coluna `Tipo` do extrato já vem nos buckets de
destino finais, então o fetcher novo consegue alimentar `parse-avancos.js` com o mesmo
formato de sempre, sem precisar reescrever esse parser.

## Fontes (7 links, todas verificadas ao vivo em 2026-08-08 via CDP)

### Link 1 — `extrato-producao-total` (Realizado + metade de Demandas de sondagens)

`https://sond.com.br/extrato-producao-total/mes/{MM}/ano/{AAAA}/` — busca por mês/ano
(diferente do antigo, que trazia o histórico multi-ano inteiro num arquivo só).
Tabela `.producao-grid`. Colunas confirmadas ao vivo:

```
Tomador, ID Contrato, Sondador, Tipo, OS, Criação da OS, Identificação, Obra,
Observações de campo, Deslocamento, Solo c/SPT (m), Solo s/SPT (m), Rocha (m),
Pavimento (m), Água (m), Total (m), Executado Dia, Tags de Serviço, Status Atual,
Data Status Atual, Ações
```

- `Tipo` já vem no bucket de destino final (SP, ST, PI, SM, CPTu, SH, VT, BL) — não
  passa pelo mapa de 125 pares (esse mapa é só para ensaios de lab).
- `ID Contrato` → SUP, via `redirecionarSupsDesconhecidos`/MATRIZ (igual hoje — sem
  contrato conhecido cai em "Diversos").
- `Executado Dia` = evento "sondagem realizada" (Realizado da Tabela Semanal,
  Gráficos, Balanço) **e** evento de saída do estoque de Demandas.
- `Criação da OS` = evento de chegada de Demandas, para furos já realizados (linha
  furo-a-furo, sem precisar de join).
- Exclusão: `Tomador == "Suporte Sondagens - Filial Lapa"` OU `Tipo` contém `SEG`/`SN`
  → fora da conta, em Realizado e em Demandas.
- Filtro de status: só `Status Atual` ∈ `{CONCLUIDO, EXECUTADO}` conta como Realizado
  (mesma regra de hoje).

**Cache mensal** (decidido com o usuário): cobertura de **2025-01 em diante**. Mês
corrente sempre rebuscado (dado muda); meses fechados vão para
`dist/cache/producao-total-AAAA-MM.csv` e só são rebuscados se o arquivo de cache não
existir — execução já concluída não muda depois. `dist/cache/` entra no `.gitignore`
(dado derivado, reproduzível a qualquer momento a partir da fonte).

### Link 2 — `maps-sondagens` (metade de Demandas de sondagens: pendentes agora)

`https://sond.com.br/maps-sondagens/tabela/inicial/1/` — snapshot do que está pendente
no momento da busca, sem filtro de mês. Tabela `table`. Colunas confirmadas:

```
Ordem de Serviço (OS), Identificação, Tipo, Latitude/Longitude, Status,
Desde (dd/mm/aaaa), Data Fim OS (dd/mm/aaaa), Prof. Total (m),
Observação de Campo, Critério de Paralisação, Ações
```

Uma linha por furo pendente. `Desde` apareceu vazio nas amostras verificadas — não é
usado como data de chegada (ver Link 3 abaixo). Não tem Contrato/Tomador — resolvido
via join com Link 3 pelo número da OS.

### Link 3 — `avanco-sondagens` (join para Demandas de sondagens)

`https://sond.com.br/avanco-sondagens/` — tabela `#avanco-grid` (agregada por
OS+Tipo, **não** por furo individual). Colunas confirmadas:

```
Ordens de Serviço (OS), OS desde, Contrato, Tomador, Obra, Tipo, Prioridade,
Pendente, Avanço 7dias, Avanço Diário, Projeção Término, Status,
Data Fim OS (cliente), Atualizado, Ações
```

Join: cada furo pendente do Link 2 recebe `Contrato`/`Tomador` da linha de Link 3 com
a mesma OS; `OS desde` do Link 3 vira a data de chegada de todo furo pendente daquela
OS+Tipo no Link 2 (aproximação de lote — furos da mesma OS+Tipo nascem juntos).
Confirmado com o usuário: essa aproximação está OK.

### Demandas de sondagens — evento sem snapshot (Link 1 + 2 + 3)

Mesmo princípio de hoje (`pendentesNaData`, saldo = chegadas − saídas acumuladas até
uma data, sem guardar histórico):

- Furo **realizado** (aparece no Link 1): chegada = `Criação da OS`, saída =
  `Executado Dia`. Linha auto-suficiente, sem join.
- Furo **pendente** (aparece no Link 2): chegada = `OS desde` do Link 3 correspondente
  (join por OS), sem saída (ainda em aberto).
- Contrato/SUP desconhecido → "Diversos"; exclusão Suporte Sondagens/SEG/SN vale aqui
  também.

### Link 4 — `extrato-ensaios-realizados` (Lab Realizado + metade de Demandas de lab)

**Sem mudança de URL** — já é a fonte atual. Uma correção de documentação: a coluna
`Data Programada` **existe** nessa tabela (confirmado ao vivo em 2026-08-08; o
CLAUDE.md antigo não a listava). Colunas confirmadas:

```
Data Programada, Ensaiado Dia, Tomadora, ID Contrato, Usuário, Tipo de Amostra,
Tipo de Ensaio, Cod. Amostra, Identificação, OS, Ações
```

- `Ensaiado Dia` = Realizado de lab (sem mudança).
- `Tipo de Ensaio` = tag de classificação LAB.C/LAB.E, contra a tabela de 125 pares
  (`Mapa Tipo SONDAGEM`) extraída de `Frcst Novo 2.xlsx` (Desktop) — ver seção
  "Classificação LAB.C/LAB.E" abaixo. Tag fora da tabela → build avisa, não falha
  silenciosa nem cai em Especiais.
- `Data Programada` = chegada de Demandas de lab, `Ensaiado Dia` = saída — linha
  auto-suficiente, sem join (diferente de sondagens).

### Link 5 — `detalhes-ensaios-programados` (metade de Demandas de lab: pendentes agora)

`https://sond.com.br/detalhes-ensaios-programados/` — tabela `#table`. Colunas
confirmadas:

```
Tomador, ID Contrato, Código do Ensaio, Ordem de Serviço (OS), Sondagem,
Sondagem Tipo, Status da Sondagem, Tipo do Ensaio, Status do Ensaio,
Status da Amostra, Data Programada
```

Cada linha já tem `Data Programada` própria (chegada), sem saída — linha
auto-suficiente, sem precisar de join com Link 4. `Sondagem Tipo` é usado para a
exclusão SEG/SN (Link 5 não tem uma coluna "Tipo" de ensaio direta).

### Demandas de lab — evento sem snapshot (Link 4 + 5)

Mesmo princípio de Demandas de sondagens, mas mais simples (nenhuma das duas fontes
precisa de join): Link 4 dá o fechado (chegada+saída na mesma linha), Link 5 dá o
aberto (chegada, sem saída).

### Link 6 — planilha "Equipes" (Google Sheets) — roster de equipes ativas

`https://docs.google.com/spreadsheets/d/1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU/`
— dezenas de abas por mês/categoria; só interessam as que terminam em **"(EQ)"**
(regex `/\(EQ\)$/` no nome já trimado, para não confundir com "(EQ e SUP.)", "(EQP)",
"(EQUIPAM.)"). Aba do mês corrente, ex. `"2026 - AGOSTO (EQ)"` (nomes têm espaçamento
irregular nas abas — usar `.trim()`). Buscada via
`/gviz/tq?tqx=out:csv&sheet={nome exato da aba}` (reaproveita cookies da sessão CDP,
sem precisar de compartilhamento público). Estrutura confirmada ao vivo:

- Coluna A = ID Sondador (chave de join com Link 7's "ID Sondador").
- Coluna "Equipe" = nome.
- Uma coluna por dia do mês (`1-Aug`..`31-Aug`), texto livre: ou um status
  (`Férias`, `Baixada`, `Folga`, `mobilização sonda`...) ou `Contrato (OS)` quando
  produziu naquele dia.

Essa aba é "a lista completa de equipes ativas" (confirmado pelo usuário) — toda linha
é candidata a contar, exceto quando a célula do dia bate com um status de exclusão.

### Link 7 — `campo/sondagens` — quem produziu, em qual SUP+Tipo, por dia

`https://sond.com.br/campo/sondagens/de/{inicio}/ate/{fim}/tabela/1/` — aceita
intervalo de datas num fetch só (confirmado: 8 dias trouxe 734 linhas numa única
busca). Tabela `#table`. Colunas confirmadas:

```
Ordem de Serviço (OS), ID Sistema, Identificação, Tipo, Contrato Financeiro, Status,
Profundidade Total, Tomadora, Data / Hora Primeira Foto, Data / Hora Ultima Foto,
Quantidade de Fotos, ID Sondador, Sondador, Líder
```

Uma linha por sondagem-dia (não por foto — diferente da fonte antiga
`campo/fotos`). `ID Sondador` + data (da "Data / Hora Primeira Foto") + `Contrato
Financeiro` + `Tipo` dão a base para o cálculo de equipes produtivas.

### Equipes — algoritmo (Link 6 + 7)

Um único fetch de Link 7 cobrindo `hoje − 45 dias` até o fim do mês sendo construído
(cobre tanto os dias do mês quanto a janela de fallback, sem repetir buscas).

Por dia D do mês:

1. **Roster do dia** = todo `ID Sondador` do Link 6 cuja célula do dia D **não** bate
   com um status de exclusão (baixada, férias, desligada, afastada, atestado —
   lista de textos reais a ser levantada durante a implementação; texto não
   reconhecido gera aviso pro usuário classificar junto, não é assumido como produtivo
   nem excluído por padrão).
2. **Produtiva**: sondador do roster que aparece no Link 7 no dia D → fração
   `1 ÷ (combinações SUP+Tipo distintas do sondador naquele dia)` para cada
   combinação (decidido com o usuário: por combinação distinta, não por linha/foto).
3. **Não produtiva mas ativa**: sondador do roster que não aparece no Link 7 no dia D
   → aloca a fração inteira (1) no último SUP+Tipo em que apareceu no Link 7 dentro
   dos 45 dias anteriores a D (decidido com o usuário: janela de 45 dias).
4. **Nunca produziu em 45 dias**: fora da conta inteiramente — nem soma, nem aparece
   (decidido com o usuário).

Saída agregada por (SUP, Tipo, dia) — mesmo formato que
`compute-equipes-mobilizadas.js` já entrega hoje, para não precisar tocar
`compute-balanco.js`/`render-aba-semanal.js`.

## Classificação LAB.C/LAB.E

Reaproveita a tabela `Mapa Tipo SONDAGEM` de `Frcst Novo 2.xlsx` (Desktop, query Power
Query, 125 pares — decidido com o usuário em vez de levantar uma lista nova). Extraída
uma vez via COM do Excel para `tools/comum/mapa-tipo-ensaio.js` (ou reaproveitando
`tools/comum/tipologias-lab.js` se a estrutura já for compatível — decisão de
implementação, não muda o resultado). Ensaio com `Tipo de Ensaio` fora da tabela →
build avisa explicitamente, não cai em Especiais nem falha silenciosa.

## Arquitetura (visão por arquivo)

```
tools/semanal/cdp-client.js
  Ganha um helper para fetch de CSV via /gviz/tq (Google Sheets) reaproveitando a
  sessão CDP -- não existia ainda (só fetchJson/fetchBuffer/rasparTabelaDataTable).

tools/semanal/atualizar-avancos-online.js (reescrito)
  Busca extrato-producao-total por mês (com cache de meses fechados em dist/cache/),
  desde 2025-01 até o mês corrente. Grava dist/avancos-online.csv no MESMO formato de
  colunas que parse-avancos.js já espera (Tipo já vem no bucket final, Executado Dia
  cobre Termino/Conclusão) -- parser não muda.

tools/semanal/atualizar-demandas-sondagem-online.js (novo)
  Busca Link 2 + Link 3, faz o join por OS, grava dist/demandas-sondagem-online.csv
  (furo pendente + chegada resolvida).

tools/semanal/atualizar-demandas-lab-online.js (novo)
  Busca Link 5 (Link 4 já é buscado por atualizar-lab-online.js, sem mudança), grava
  dist/demandas-lab-online.csv.

tools/semanal/atualizar-equipes-online.js (substitui atualizar-equipes-produtivas-online.js)
  Busca Link 6 (aba do mês, via gviz) + Link 7 (intervalo hoje-45..fim do mês), grava
  dist/equipes-online.csv já no formato agregado (SUP, Tipo, dia, equipesEquivalentes).

tools/semanal/compute-demandas.js
  Ganha um caminho de entrada alternativo: eventos vindos de
  demandas-sondagem-online.csv/demandas-lab-online.csv em vez do Avanço Sond.xlsx --
  a lógica de saldo por data (pendentesNaData) não muda, só a origem dos eventos.

tools/semanal/compute-equipes-mobilizadas.js
  Substituído pela leitura direta de equipes-online.csv (já vem agregado) -- o novo
  atualizar-equipes-online.js absorve o que este módulo calculava.

tools/semanal/build-dashboard.js
  Passa a ler os CSVs novos em vez de Avanço Sond.xlsx / campo-fotos. Continua
  exigindo G:\ montado só para a MATRIZ (sem mudança nesse ponto -- é um problema
  identificado nesta sessão, não faz parte do escopo desta troca de origem: a máquina
  usada hoje não tinha o Drive montado no momento do teste).
```

## O que NÃO muda

- `render-aba-semanal.js`, `compute-balanco.js`, `compute-semanal.js`,
  `render-aba-alertas.js`, `render-aba-consolidado.js` — zero mudança, consomem a
  mesma interface de saída de sempre.
- Lab Realizado mantém URL e semântica (`Ensaiado Dia`) sem mudança.
- `tools/comum/tipologias-avancos.js` — sem mudança (o `Tipo` de Link 1 já chega no
  bucket final).

## "Atualizar Dash Semanal.bat" (Área de Trabalho)

Um único `.bat`, clique-e-pronto:

1. Checa se `127.0.0.1:9222` responde; se não, abre
   `chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\supor\chrome-debug-profile"`
   (perfil dedicado — Chrome 151+ bloqueia CDP no perfil padrão, descoberto nesta
   sessão). Login em sond.com.br persiste nesse perfil entre execuções.
2. Roda o pipeline completo (7 fontes + build + `cp` para `docs/` + commit + push),
   mesmo padrão tudo-ou-nada por fonte que `atualizar-arquivos.js` já usa.
3. Para com mensagem clara se `G:\` não estiver montado (a MATRIZ ainda depende dele).
4. `ORCAMENTO_SENHA` fica **fixa dentro do próprio `.bat`** (decidido com o usuário —
   arquivo local na Área de Trabalho, nunca commitado/publicado).

## Erros e resiliência

Mesmo padrão já validado em Avanços/Lab/Equipes online: fetch de uma fonte falhando
não aborta as outras nem o build; script aborta sem gravar (protege o CSV bom já
publicado) se o resultado vier vazio ou sem o cabeçalho esperado; classificação
desconhecida (tipo de ensaio, status de equipe) gera aviso explícito no build, nunca
falha silenciosa nem cai num balde genérico sem avisar.

## Fora de escopo

- G:\ não montado (MATRIZ) — problema identificado durante os testes desta sessão,
  não faz parte da troca de origem.
- UI nova além do que já existe — os três conceitos continuam alimentando as mesmas
  abas/seções de hoje.
- Trocar a fonte de Equipes não produtivas (segue como está, fora deste pedido).
