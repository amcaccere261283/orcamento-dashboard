# Realizado da Alocação via produção sond (Link 7) — design

Data: 2026-08-26

## Objetivo

Trocar a origem de `supRealizado`/`colunaRealizada` (o "onde a equipe está de fato",
usado pelo botão "Repor o realizado" da aba Alocação Equipes) para vir da produção real
raspada do sond.com.br (Link 7, `dist/equipes-online.csv`), em vez do texto digitado à
mão na planilha Google Sheets "Equipes" (Link 6, aba "(EQ)").

Pedido do dono do projeto: o AmCaccere está construindo uma aba de mapa nova na mesma
página — este trabalho não toca nela, nem em nenhum outro trecho de UI. É só a fonte de
dado que muda.

## Estado atual

`equipes-alocaveis.js` (`equipesDoQuadro`) varre dia a dia o texto da Sheet EQ (Link 6)
de cada equipe; quando acha uma OS num dia ativo, resolve o SUP via `osParaSup` (mapa
OS→SUP construído a partir dos furos do Link 1, `extrato-producao-total`). O último SUP
achado no mês, até o fim da semana em tela, vira `supRealizado`.

Problema: a Sheet EQ é preenchida manualmente — o "onde a equipe está" pode estar
desatualizado ou errado independente do que a equipe realmente executou.

## Fonte nova

Link 7 (`sond.com.br/campo/sondagens/de/{inicio}/ate/{fim}/tabela/1/`) já é raspado por
`atualizar-equipes-online.js` e publicado em `dist/equipes-online.csv`
(`IdEquipe,SUP,Tipo,DiaEpoch`, uma linha por sondagem-dia). O `IdEquipe` já usa o mesmo
espaço de chave do roster (`ID Sondador`/"Nº Equipe", ver `atualizar-equipes-online.js`).
Este CSV já viaja para o build (`build-dashboard.js`) e para o live-refresh
(`live-refresh.js`, variável `producaoOnlineCliente`) para alimentar o Realizado da
Tabela Semanal (via `agregarEquipesRealizadoAlocado`) — só não chega ainda até a aba
Alocação Equipes.

## Abordagem

`equipesDoQuadro` ganha uma opção nova, `producaoOnline` (array
`[{idEquipe, sup, tipo, diaEpoch}, ...]`, o mesmo formato que
`compute-equipes-realizado-alocado.js` já consome). Um helper novo,
`ultimoRealizadoPorEquipe`, indexa esse array por `idEquipe` (histórico ordenado por
`diaEpoch`) e devolve, para uma equipe e um dia-alvo, o último registro com
`diaEpoch <= alvo` **e** `alvo - diaEpoch <= 3` (`JANELA_ULTIMO_REALIZADO_DIAS`,
2026-08-27; antes era sem janela nenhuma) — diferente do carry-forward de 45 dias do
Realizado da Tabela Semanal. Produção mais antiga que isso não conta — equipe sem
produção recente (ou nenhuma) nasce no pool (`supRealizado: null`), nunca é chutada.

A opção `osParaSup` sai de `equipesDoQuadro` (só ela é afetada — `osParaSup` continua
existindo e sendo usado por `compute-equipes-ativas.js`/Tabela Semanal, sem mudança).

**Disponibilidade não muda**: os dias ativos/férias/baixada/folga da equipe continuam
vindo do roster da Sheet EQ (Link 6), exatamente como hoje — só o SUP/coluna
"realizado" muda de fonte. Decidido com o dono do projeto.

## Arquitetura (visão por arquivo)

```
tools/semanal/equipes-alocaveis.js
  ultimoRealizadoPorEquipe(producaoOnline) -- novo, indexa por idEquipe.
  equipesDoQuadro: troca osParaSup por producaoOnline na resolução de ultimoSup.

tools/semanal/build-dashboard.js
  No bloco que já lê dist/equipes-online.csv (CAMINHO_PRODUCAO_ONLINE) para o
  Realizado da Tabela Semanal, também expõe demandas.producaoOnline (o array já
  parseado por parseProducaoOnlineCsv) -- reaproveita a leitura existente, não
  adiciona I/O novo.

tools/semanal/live-refresh.js
  producaoOnlineCliente (já calculado a partir de textos.producao) passa a viajar
  também em demandasNovas.producaoOnline, dentro do bloco cfg.rosterAlocacao (mesmo
  gate de equipesCsv/osParaSup hoje).

tools/semanal/render-alocacao-pagina.js
  montarAbaAlocacao() passa demandas.producaoOnline (em vez de demandas.osParaSup)
  para EquipesAlocaveis.equipesDoQuadro().
```

## O que NÃO muda

- Disponibilidade (dias em campo/férias/baixada/folga) — continua vindo do roster
  Sheet EQ.
- `osParaSup`, `compute-equipes-ativas.js`, Realizado da Tabela Semanal
  (`agregarEquipesRealizadoAlocado`) — nenhuma mudança, são consumidores
  independentes do mesmo `equipes-online.csv`.
- Nenhuma UI — a aba de mapa em construção pelo AmCaccere não é tocada.

## Fora de escopo

- Trocar a fonte de disponibilidade (Sheet EQ continua sendo a única fonte).
- Qualquer mudança na aba de mapa nova.
