# Minecraft Server Bot

Bot de operação de servidor de Minecraft. Acompanha os eventos do jogo e permite a
administração pelo Discord.

## Descrição

Lê os registros do servidor e comunica-se com ele por RCON. Publica entrada, saída, morte e
conquista no canal, mantém um painel fixado com o estado atual e expõe comandos de barra
para consultar jogadores conectados, perfil e ranking, além de administrar a lista de
permissão sem exigir acesso à máquina.

## Decisão técnica

O servidor é suspenso quando não há jogadores e iniciado no primeiro acesso, para reduzir
consumo. A estratégia invalida a premissa de que o jogo está sempre disponível: o bot
precisa distinguir ausência de jogadores de indisponibilidade real, e não reportar queda
durante a suspensão programada.

## Execução

Copiar `.env.example` para `.env`, preencher as variáveis e iniciar com Docker Compose.

## Stack

TypeScript, Node.js, discord.js, RCON, Docker
