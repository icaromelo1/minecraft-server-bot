# Minecraft Server Bot

Bot de operação de um servidor de Minecraft: acompanha o que acontece no jogo e deixa
administrar pelo Discord.

## O que faz

Lê os logs do servidor e conversa com ele por RCON. Publica entrada, saída, morte e
conquista no canal; mantém um painel fixado com o estado; e expõe comandos de barra para
consultar quem está online, ver perfil e ranking, e administrar a lista de permissão sem
ninguém precisar de acesso à máquina.

## A parte difícil

O servidor dorme quando não tem gente e acorda no primeiro acesso, para não ficar ligado à
toa. Isso quebra a suposição de que o bot sempre encontra o jogo no ar: ele precisa
distinguir "ninguém jogando" de "servidor fora", e não anunciar queda quando é só sono.

## Como rodar

Copiar `.env.example` para `.env`, preencher, e subir com Docker Compose.

## Stack

TypeScript · Node.js · discord.js · RCON · Docker
