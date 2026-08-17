import { Client, GatewayIntentBits, Options, REST, Routes, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { sendRconCommand } from "./rcon";
import { LogWatcher } from "./log-watcher";

// Carrega variáveis do arquivo .env
dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;
const roleId = process.env.ROLE_ID;
const logPath = process.env.MINECRAFT_LOG_PATH || "/app/minecraft.log";
const playerdataPath = process.env.PLAYERDATA_PATH || "/app/playerdata";
const portainerUrl = process.env.PORTAINER_URL ?? "";

if (!token || !clientId || !guildId || !channelId) {
  console.error("[Bot] Erro: DISCORD_TOKEN, CLIENT_ID, GUILD_ID e CHANNEL_ID devem ser definidos no .env");
  process.exit(1);
}

// Recupera as últimas N linhas do arquivo de log
function getLastLogLines(filePath: string, maxLines: number = 10): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return "";

    const bufferSize = Math.min(size, 8192);
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(bufferSize);
    
    fs.readSync(fd, buffer, 0, bufferSize, size - bufferSize);
    fs.closeSync(fd);

    const text = buffer.toString("utf-8");
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.slice(-maxLines).join("\n");
  } catch (err) {
    console.error("[Bot] Erro ao ler últimas linhas do log:", err);
    return "Erro ao ler as últimas linhas do log.";
  }
}

// Analisa os logs para determinar o motivo da queda/parada
function analyzeOfflineReason(lastLines: string): { reason: string; color: string; isCrash: boolean } {
  const lowercaseLines = lastLines.toLowerCase();
  
  if (lowercaseLines.includes("stopping server") || lowercaseLines.includes("saving worlds") || lowercaseLines.includes("stopping!")) {
    return {
      reason: "O servidor foi desligado/reiniciado de forma ordenada (manutenção ou comando de parada).",
      color: "#FFC107", // Amarelo
      isCrash: false
    };
  }
  
  if (lowercaseLines.includes("outofmemoryerror") || lowercaseLines.includes("out of memory")) {
    return {
      reason: "O servidor sofreu um crash por falta de memória (OutOfMemoryError).",
      color: "#DC3545", // Vermelho
      isCrash: true
    };
  }

  if (lowercaseLines.includes("exception") || lowercaseLines.includes("error") || lowercaseLines.includes("fatal")) {
    return {
      reason: "O servidor pode ter crashado devido a um erro crítico ou exceção detectada nos logs.",
      color: "#DC3545",
      isCrash: true
    };
  }

  return {
    reason: "O servidor parou de responder repentinamente. Pode ter crashado ou sido encerrado de forma abrupta pelo sistema.",
    color: "#DC3545",
    isCrash: true
  };
}

// Inicializa o Client Discord com caches mínimos (RAM otimizada)
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    PresenceManager: 0,
    VoiceStateManager: 0,
    ReactionManager: 0,
    ThreadManager: 0,
    StageInstanceManager: 0,
    GuildMemberManager: 0,
    BaseGuildEmojiManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0,
    GuildScheduledEventManager: 0,
    GuildInviteManager: 0,
  }),
});

// Watcher do arquivo de logs
let watcher: LogWatcher | null = null;

client.once("ready", async () => {
  console.log(`[Bot] Logado com sucesso como ${client.user?.tag}`);

  // Configura a presença/atividade do bot
  client.user?.setActivity("ATM10 To the Sky", { type: ActivityType.Playing });

  // Registro instantâneo de comandos slash na Guild alvo (single-guild lock)
  await registerCommands();

  // Inicializa o watcher de logs com try/catch para evitar crash do processo caso falte acesso ao canal
  try {
    const targetChannel = await client.channels.fetch(channelId);
    if (targetChannel && targetChannel.isTextBased()) {
      const textChannel = targetChannel as any; // Cast para 'any' evita limitações de type-narrowing do TS em closures
      
      // 1. Inicializa o LogWatcher para eventos do jogo
      watcher = new LogWatcher(logPath, playerdataPath, {
        onJoin: (player, isFirst) => {
          const embed = new EmbedBuilder()
            .setColor("#3FCA8E") // Verde Mint
            .setTitle("👥 Jogador Conectou")
            .setDescription(`**${player}** entrou no servidor.`);

          if (isFirst) {
            embed.setTitle("🆕 Primeiro Acesso!")
                 .setDescription(`Seja muito bem-vindo ao servidor, **${player}**!`);
          }

          // Primeiro login não marca o cargo (sem menções desnecessárias no dia a dia)
          textChannel.send({ embeds: [embed] }).catch((err: any) => {
            console.error("[Bot] Erro ao enviar log de Join:", err);
          });
        },
        onLeave: (player) => {
          const embed = new EmbedBuilder()
            .setColor("#7A8B99") // Cinza
            .setTitle("👥 Jogador Desconectou")
            .setDescription(`**${player}** saiu do servidor.`);

          textChannel.send({ embeds: [embed] }).catch((err: any) => {
            console.error("[Bot] Erro ao enviar log de Leave:", err);
          });
        },
        onDeath: (message) => {
          const embed = new EmbedBuilder()
            .setColor("#DC3545") // Vermelho
            .setTitle("💀 Jogador Morreu")
            .setDescription(`*${message}*`);

          textChannel.send({ embeds: [embed] }).catch((err: any) => {
            console.error("[Bot] Erro ao enviar log de Morte:", err);
          });
        },
        onAdvancement: (player, title, isChallenge) => {
          const embed = new EmbedBuilder()
            .setColor(isChallenge ? "#E0A800" : "#FFC107") // Ouro/Amarelo
            .setTitle(isChallenge ? "🏆 Desafio Concluído!" : "🏅 Progresso Alcançado!")
            .setDescription(`**${player}** completou: **${title}**`);

          textChannel.send({ embeds: [embed] }).catch((err: any) => {
            console.error("[Bot] Erro ao enviar log de Conquista:", err);
          });
        }
      });

      watcher.start();

      // 2. Monitoramento de integridade do servidor Minecraft (Ping RCON a cada 30 segundos)
      let wasOnline = true;
      setInterval(async () => {
        try {
          const response = await sendRconCommand("list");

          // Atualiza status do bot com a quantidade de jogadores
          const match = response.match(/There are (\d+) of (?:a max of )?(\d+) players/);
          if (match) {
            const online = parseInt(match[1], 10);
            client.user?.setActivity(`🟢 Online: ${online}`, { type: ActivityType.Playing });
          } else {
            client.user?.setActivity("ATM10 To the Sky", { type: ActivityType.Playing });
          }

          if (!wasOnline) {
            wasOnline = true;
            const embed = new EmbedBuilder()
              .setColor("#3FCA8E")
              .setTitle("🟢 Servidor Restaurado")
              .setDescription("O servidor de Minecraft voltou a responder às consultas RCON.")
              .setTimestamp();
            textChannel.send({ embeds: [embed] }).catch((e: any) => console.error("[Bot] Erro ao enviar log de restauração:", e));
          }
        } catch (error) {
          if (wasOnline) {
            wasOnline = false;

            // Atualiza status do bot para offline
            client.user?.setActivity("🔴 Servidor Offline", { type: ActivityType.Playing });

            const lastLogs = getLastLogLines(logPath, 10);
            const analysis = analyzeOfflineReason(lastLogs);

            const embed = new EmbedBuilder()
              .setColor(analysis.color as any)
              .setTitle(analysis.isCrash ? "🚨 Alerta: Queda do Servidor" : "⚠️ Alerta: Servidor Offline")
              .setDescription(analysis.reason)
              .setTimestamp();

            if (lastLogs && lastLogs.trim().length > 0) {
              const logBlock = lastLogs.length > 950 ? lastLogs.slice(-950) : lastLogs;
              embed.addFields({
                name: "📝 Últimos Logs do Servidor",
                value: `\`\`\`log\n${logBlock}\n\`\`\``
              });
            }

            const components: any[] = [];
            if (portainerUrl) {
              const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                  new ButtonBuilder()
                    .setLabel("Ver Logs no Portainer")
                    .setStyle(ButtonStyle.Link)
                    .setURL(portainerUrl)
                );
              components.push(row);
            }
            
            // Menciona o cargo de alertas apenas quando necessita de atenção real (crash/offline inesperado)
            const content = (analysis.isCrash && roleId) ? `<@&${roleId}>` : "";
            textChannel.send({ content, embeds: [embed], components }).catch((e: any) => console.error("[Bot] Erro ao enviar log de queda:", e));
          }
        }
      }, 30000);

    } else {
      console.error(`[Bot] Canal ${channelId} não encontrado ou não é canal de texto baseado.`);
    }
  } catch (error) {
    console.error(`[Bot] Erro crítico ao carregar canal de logs ${channelId}:`, error);
  }
});

// Escuta comandos e interações
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Guild Lock: Rejeita comandos de outros servidores
  if (interaction.guildId !== guildId) {
    await interaction.reply({ content: "Comando não autorizado para esta Guild.", ephemeral: true });
    return;
  }

  const { commandName } = interaction;

  if (commandName === "status") {
    await interaction.deferReply();
    try {
      // Tenta rodar 'list' no RCON para medir tempo de resposta e atividade do server
      const startTime = Date.now();
      await sendRconCommand("list");
      const latency = Date.now() - startTime;

      const embed = new EmbedBuilder()
        .setColor("#3FCA8E")
        .setTitle("🟢 Servidor Online")
        .addFields(
          { name: "Status", value: "Ativo e responsivo", inline: true },
          { name: "RCON Latência", value: `${latency}ms`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const lastLogs = getLastLogLines(logPath, 10);
      const analysis = analyzeOfflineReason(lastLogs);

      const embed = new EmbedBuilder()
        .setColor(analysis.color as any)
        .setTitle("🔴 Servidor Inacessível")
        .setDescription(`${analysis.reason}\n\nO servidor de Minecraft não respondeu às consultas RCON.`)
        .setTimestamp();

      if (lastLogs && lastLogs.trim().length > 0) {
        const logBlock = lastLogs.length > 950 ? lastLogs.slice(-950) : lastLogs;
        embed.addFields({
          name: "📝 Últimos Logs do Servidor",
          value: `\`\`\`log\n${logBlock}\n\`\`\``
        });
      }

      const components: any[] = [];
      if (portainerUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setLabel("Ver Logs no Portainer")
              .setStyle(ButtonStyle.Link)
              .setURL(portainerUrl)
          );
        components.push(row);
      }

      await interaction.editReply({ embeds: [embed], components });
    }
  }

  else if (commandName === "online") {
    await interaction.deferReply();
    try {
      const response = await sendRconCommand("list");
      // Exemplo de resposta RCON: "There are 2 of 20 players online: Tiltado121, Rchaer"
      const embed = new EmbedBuilder()
        .setColor("#007BFF")
        .setTitle("👥 Jogadores Online")
        .setDescription(response)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: "❌ Erro ao consultar a lista de jogadores via RCON." });
    }
  }

  else if (commandName === "bluemap") {
    const embed = new EmbedBuilder()
      .setColor("#007BFF")
      .setTitle("🗺️ Mapa Tridimensional (BlueMap)")
      .setDescription("Acesse o mapa 3D em tempo real do nosso mundo Skyblock!")
      .addFields(
        { name: "URL", value: "https://icaromelodev.com.br/minecraft/map/" },
        { name: "Nota", value: "Exige autenticação (ver credenciais do BlueMap)." }
      );

    await interaction.reply({ embeds: [embed] });
  }
});

// Registra comandos Slash usando REST API do Discord
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token!);
  const commands = [
    {
      name: "status",
      description: "Verifica a integridade e latência RCON do servidor",
    },
    {
      name: "online",
      description: "Lista os jogadores que estão online no servidor",
    },
    {
      name: "bluemap",
      description: "Exibe o link de acesso ao mapa 3D do mundo",
    }
  ];

  try {
    console.log("[Bot] Registrando comandos Slash na Guild alvo...");
    await rest.put(
      Routes.applicationGuildCommands(clientId!, guildId!),
      { body: commands }
    );
    console.log("[Bot] Comandos Slash registrados com sucesso!");
  } catch (error) {
    console.error("[Bot] Erro ao registrar comandos Slash:", error);
  }
}

// Graceful Shutdown
process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());

function shutdown() {
  console.log("[Bot] Encerrando processos...");
  if (watcher) watcher.stop();
  client.destroy();
  process.exit(0);
}

// Conectar o Bot
client.login(token);
