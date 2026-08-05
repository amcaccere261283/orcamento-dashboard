# Lab Realizado + Equipes online — design

Data: 2026-08-05

## Objetivo

Estender o padrão já validado com Avanços (busca direto do sond.com.br, sem arquivo
local) para mais três fontes do Planejamento Semanal:

1. **Lab Realizado** — substitui a aba "Lab Concluido" local.
2. **Equipes produtivas** — nova fonte de verdade pro Δ equipes do Balanço de massa,
   substituindo a cadeia atual (ativas via aba EQ → mobilizadas via furos).
3. **Equipes não produtivas** — informação nova, ao lado do Δ equipes (não somada nele):
   quem está em campo sem furar, e quem está de férias/baixada/afastada/desligada.

## Decisões já tomadas com o usuário

- **Equipes produtivas substitui o Δ equipes atual** (não coexiste com ele) —
  confirmado explicitamente. A cadeia de fallback existente (ativas → mobilizadas)
  vira reserva: se a fonte nova falhar, cai pra ativas, depois mobilizadas — mesmo
  espírito de resiliência que o projeto já usa em outros pontos (`montarEquipesAtivas`).
- **Equipes não produtivas é informação separada**, não entra na mesma conta de
  produtivas — evita que o Δ equipes cresça só porque passou a contar gente de férias.
- **Lab Realizado troca a semântica**: a série que hoje conta por "Concluído Dia" passa
  a contar por "Ensaiado Dia" — decisão implícita na escolha do link
  (`extrato-ensaios-realizados`, não um `-concluidos`). O campo interno `ensaios[].concluido`
  (nome já existente no código) não muda de nome — só a coluna de origem muda.

## Fontes

### 1. Lab Realizado

`https://sond.com.br/extrato-ensaios-realizados/mes/{MM}/ano/{AAAA}/` — uma busca só
por mês, empresa inteira (não é por contrato, diferente de Avanços). Tabela
`#DataTables_Table_0.producao-grid`, mesmo padrão de `extrato-producao-total` (já
raspada pra Avanços). Colunas confirmadas ao vivo:

```
Ensaiado Dia, Tomadora, ID Contrato, Usuário, Tipo de Amostra, Tipo de Ensaio,
Cod. Amostra, Identificação, OS, Ações
```

`ID Contrato` e `Tipo de Ensaio` batem exatamente com o que `parse-lab.js` já espera
(`sup`, `tipoEnsaio`). Só a coluna de data muda: `parse-lab.js` procura hoje
`'Concluído Dia'`; passa a procurar `'Ensaiado Dia'`. Classificação LAB.C/LAB.E
continua em `tools/comum/tipologias-lab.js`, sem mudança.

### 2. Equipes produtivas

`https://sond.com.br/campo/fotos/de/{primeiro-dia-do-mes}/ate/{ultimo-dia-do-mes}/tabela/1/`
— uma busca por mês, intervalo de datas (não é `mes/ano` na URL, é `de/ate`). Tabela
`#table`, mesma classe/mecanismo de `campo/sondagens` (paginação só visual — precisa
`page.len(-1)` depois de esperar o DataTable estabilizar; confirmado ao vivo: sem a
espera, `recordsTotal` lê 0 na primeira checagem). Colunas confirmadas:

```
Ordem de Serviço (OS), Contrato Financeiro, Identificação, Data, Hora, Lat/Lon,
Origem, Bateria, Tag, Sondador, Líder
```

Uma linha por FOTO (não por sondagem) — várias fotos por sondagem por dia são normais
(medido: 1.923 linhas num único dia). "Equipe produtiva num dia" = Sondador distinto
naquele dia, por Contrato Financeiro. Não tem coluna Tipo — resolvido reaproveitando
`tipologiaPorSondador` (tipologia mais frequente nos furos do sondador), que
`build-dashboard.js` já calcula hoje a partir de Avanços (`tools/semanal/build-dashboard.js:103-122`)
para o mesmo propósito na cadeia de equipes ativas.

### 3. Equipes não produtivas

**Não precisa de busca nova.** Já é buscada hoje via `URL_ESPELHO_EQ`
(`tools/semanal/build-dashboard.js:72`, Sheet espelho publicada, mantida por
`tools/semanal/apps-script-espelho-eq.gs`, que resolve sozinho qual aba mensal
"AAAA - MÊS (EQ)" copiar — mesmo mecanismo que já resolve o problema do gid mudar
todo mês, documentado em `docs/superpowers/specs/2026-08-03-equipes-ativas-design.md`).
`parseAbaEq` + `classificarDiaEquipe` (`tools/semanal/classificar-dia-equipe.js`) já
classificam cada equipe-dia em `mobilizada` / `campoSemFuro` / `fora` / `naoEquipe`.

"Não produtiva" = `campoSemFuro` (em campo, sem furo aquele dia) **ou** `fora`
(férias/baixada/afastada/desligada — o próprio `classificar-dia-equipe.js` já reconhece
essa lista via regex, sem precisar de nada novo). `naoEquipe` fica de fora (não é uma
equipe de campo).

## Arquitetura

```
tools/semanal/cdp-client.js
  Ganha rasparTabelaDataTable(session, selector, opts) + linhasComoObjetos(tabela) --
  não existia ainda neste projeto (só tinha fetchJson/fetchBuffer, pra Avanços, que
  baixa .xlsx binário). Técnica já provada (espera recordsTotal estabilizar, depois
  page.len(-1)) -- escrita do zero aqui, mesmo raciocínio já usado noutro projeto
  deste computador.

tools/semanal/atualizar-lab-online.js
  Uma sessão CDP, um fetch (mes/ano de HOJE -- não precisa D-1, a página semanal é
  mensal). Grava dist/lab-online.csv.

tools/semanal/atualizar-equipes-produtivas-online.js
  Uma sessão CDP, um fetch (de/ate cobrindo o mês inteiro sendo construído). Grava
  dist/equipes-produtivas-online.csv.

tools/semanal/compute-equipes-produtivas.js (novo)
  Pura: linhas (já parseadas) + tipologiaPorSondador -> agrega por (SUP, tipologia,
  dia), Sondador distinto por dia. Mesmo formato de saída (porDia) que
  agregarEquipesAtivas já produz, pra plugar no mesmo lugar em build-dashboard.js.

tools/semanal/compute-equipes-nao-produtivas.js (novo)
  Pura: reaproveita parseAbaEq (já teria que ser chamado de qualquer forma, já que
  é a mesma fonte) + classificarDiaEquipe. Agrega por MOTIVO (campoSemFuro, fora) e
  por dia -- não por SUP, já que uma equipe de férias não tem contrato associado
  naquele dia.

tools/semanal/parse-lab.js
  Uma linha muda: 'Concluído Dia' -> 'Ensaiado Dia' na busca de coluna.

tools/semanal/build-dashboard.js
  - Lab: troca readXlsxSheet(configLab...) por ler lab-online.csv (mesmo padrão de
    Avanços: parseCsvGrid + unshift(null) + parseLab inalterado).
  - Equipes: nova prioridade pro Δ equipes -- produtivas (se o CSV existir e tiver
    dado) -> ativas (aba EQ, como hoje) -> mobilizadas (furos, como hoje). Não
    produtivas entra como um campo NOVO e separado no payload pro cliente (não
    substitui nem se soma a nada).

tools/semanal/render-semanal.js
  - URL_ESPELHO_LAB_SEMANAL troca pro caminho relativo publicado (mesmo padrão de
    URL_ESPELHO_AVANCOS_SEMANAL).
  - Botão "Atualizar dados" ganha um terceiro fetch (equipes produtivas), mesmo
    padrão tudo-ou-nada dos outros.
  - Nova seção pequena na aba Balanço de massa (perto do Δ equipes) mostrando
    "Equipes não produtivas": total do dia mais recente do mês, por motivo
    (em campo sem furo / férias / baixada / afastada-desligada).
```

## O que NÃO muda

- `parse-avancos.js`, `compute-demandas.js`, `compute-balanco.js`,
  `compute-semanal.js`, `tools/comum/tipologias-avancos.js`,
  `tools/comum/tipologias-lab.js`, `classificar-dia-equipe.js` — zero mudança.
- A aba EQ continua vindo do mesmo espelho publicado que já funciona hoje — não é
  parte do escopo trocar essa fonte específica.

## Erros e resiliência

Mesmo padrão de Avanços: falha de um fetch não trava os outros dois; cada script
aborta sem gravar (protege o CSV bom já publicado) se o resultado vier vazio ou sem
o cabeçalho esperado; a cadeia de fallback do Δ equipes já existia e continua.

## Limpeza pendente (fora do código)

Com Lab também migrando pro online, o gatilho do Apps Script que ainda espelha
"Lab Concluido" (o mesmo `ORIGEM_FILE_ID` que a Avanços apagada usava) fica **sem
nenhum consumidor**. Ação pro usuário, fora deste repositório: desligar esse gatilho
na conta Google dona da Sheet.

## Fora de escopo

- UI nova além de uma seção simples de "não produtivas" no Balanço de massa — se o
  usuário quiser uma aba dedicada depois, é outro ciclo de desenho.
- Trocar a fonte da aba EQ (equipes não produtivas) por um fetch direto de gid —
  o mecanismo atual (Sheet espelho + Apps Script) já resolve o problema do gid mensal
  e não foi pedido pra mudar.
