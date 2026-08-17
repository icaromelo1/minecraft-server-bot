import fs from "fs";
import path from "path";

export interface LogWatcherEvents {
  onJoin: (player: string, isFirst: boolean) => void;
  onLeave: (player: string) => void;
  onDeath: (message: string) => void;
  onAdvancement: (player: string, title: string, isChallenge: boolean) => void;
}

export class LogWatcher {
  private logPath: string;
  private playerdataPath: string;
  private events: LogWatcherEvents;
  private currentSize: number = 0;
  private timer: NodeJS.Timeout | null = null;

  // Mapa temporário para associar o PlayerName ao UUID no momento do handshake de login
  private playerToUuid = new Map<string, string>();

  // Expressões regulares de parsing
  private prefixRegex = /^\[\d{2}[A-Za-z]{3}\d{4} \d{2}:\d{2}:\d{2}\.\d{3}\] \[Server thread\/INFO\] \[net\.minecraft\.server\.MinecraftServer\/\]: (.*)$/;
  private uuidRegex = /^\[\d{2}[A-Za-z]{3}\d{4} \d{2}:\d{2}:\d{2}\.\d{3}\] \[User Authenticator #\d+\/INFO\] \[net\.minecraft\.server\.network\.ServerLoginPacketListenerImpl\/\]: UUID of player (\S+) is (\S+)$/;

  // Palavras-chave típicas de mortes no Minecraft
  private deathKeywords = [
    "was slain by", "was blown up by", "drowned", "hit the ground too hard",
    "fell from a high place", "was burnt to a crisp", "went up in flames",
    "walked into fire", "burned to death", "was pricked to death",
    "starved to death", "suffocated in a wall", "was squashed by",
    "was killed by magic", "withered away", "died", "slid down a ladder",
    "fell out of the world", "was knocked into the void", "was pricked by a cactus",
    "walked into a cactus", "was impaled by", "was squished by"
  ];

  constructor(logPath: string, playerdataPath: string, events: LogWatcherEvents) {
    this.logPath = logPath;
    this.playerdataPath = playerdataPath;
    this.events = events;
  }

  public start() {
    console.log(`[LogWatcher] Monitorando log em: ${this.logPath}`);
    console.log(`[LogWatcher] Verificando playerdata em: ${this.playerdataPath}`);

    if (fs.existsSync(this.logPath)) {
      this.currentSize = fs.statSync(this.logPath).size;
    } else {
      this.currentSize = 0;
    }

    // Polling leve de 1 segundo (resistente a inodes do Docker e NFS/SSD externos)
    this.timer = setInterval(() => this.checkFile(), 1000);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private checkFile() {
    if (!fs.existsSync(this.logPath)) {
      this.currentSize = 0;
      return;
    }

    try {
      const stats = fs.statSync(this.logPath);
      const size = stats.size;

      if (size < this.currentSize) {
        console.log("[LogWatcher] Arquivo rotacionado/reiniciado.");
        this.currentSize = 0;
      }

      if (size > this.currentSize) {
        const stream = fs.createReadStream(this.logPath, {
          start: this.currentSize,
          end: size - 1,
          encoding: "utf-8"
        });

        let buffer = "";
        stream.on("data", (chunk) => {
          buffer += chunk;
        });

        stream.on("end", () => {
          const lines = buffer.split(/\r?\n/);
          for (let i = 0; i < lines.length - 1; i++) {
            this.parseLine(lines[i]);
          }
          if (lines[lines.length - 1] !== "") {
            this.parseLine(lines[lines.length - 1]);
          }
        });

        this.currentSize = size;
      }
    } catch (error) {
      console.error("[LogWatcher] Erro de leitura de logs:", error);
    }
  }

  private parseLine(line: string) {
    // 1. Capturar o log de autenticação para associar PlayerName ao UUID
    const uuidMatch = line.match(this.uuidRegex);
    if (uuidMatch) {
      const playerName = uuidMatch[1];
      const uuid = uuidMatch[2];
      this.playerToUuid.set(playerName, uuid);
      console.log(`[LogWatcher] UUID Mapeado: ${playerName} -> ${uuid}`);
      return;
    }

    // 2. Filtrar logs que pertencem ao servidor principal
    const serverMatch = line.match(this.prefixRegex);
    if (!serverMatch) return;

    const message = serverMatch[1].trim();

    // 3. Processar Join Game
    if (message.endsWith("joined the game")) {
      const player = message.replace("joined the game", "").trim();
      const uuid = this.playerToUuid.get(player);
      let isFirst = false;

      if (uuid) {
        isFirst = this.checkFirstLogin(uuid);
      } else {
        console.warn(`[LogWatcher] Join detectado para ${player}, mas UUID não foi encontrado no mapa.`);
      }

      this.events.onJoin(player, isFirst);
      return;
    }

    // 4. Processar Left Game
    if (message.endsWith("left the game")) {
      const player = message.replace("left the game", "").trim();
      this.events.onLeave(player);
      // Remove do mapa de cache de sessão
      this.playerToUuid.delete(player);
      return;
    }

    // 5. Processar Conquistas (Advancements & Challenges)
    if (message.includes("has made the advancement")) {
      const parts = message.split("has made the advancement");
      const player = parts[0].trim();
      const rawTitle = parts[1].trim();
      const title = rawTitle.replace(/^\[|\]$/g, ""); // Remove colchetes [Nome]
      this.events.onAdvancement(player, title, false);
      return;
    }

    if (message.includes("has completed the challenge")) {
      const parts = message.split("has completed the challenge");
      const player = parts[0].trim();
      const rawTitle = parts[1].trim();
      const title = rawTitle.replace(/^\[|\]$/g, "");
      this.events.onAdvancement(player, title, true);
      return;
    }

    // 6. Processar Mortes (filtrando para não confundir com chat de jogador)
    const isChat = message.startsWith("<") || message.startsWith("[");
    if (!isChat) {
      const isDeath = this.deathKeywords.some((kw) => message.includes(kw));
      if (isDeath) {
        this.events.onDeath(message);
      }
    }
  }

  private checkFirstLogin(uuid: string): boolean {
    const file = path.join(this.playerdataPath, `${uuid}.dat`);
    if (!fs.existsSync(file)) {
      return true; // Se o arquivo não existe, com certeza é o primeiro login
    }
    try {
      const stats = fs.statSync(file);
      const ctime = stats.birthtimeMs || stats.ctimeMs; // Criação do arquivo .dat do jogador
      const diffMinutes = (Date.now() - ctime) / (1000 * 60);
      return diffMinutes <= 5; // Criado nos últimos 5 minutos = primeiro login
    } catch (error) {
      console.error(`[LogWatcher] Erro ao validar primeiro login de ${uuid}:`, error);
      return false;
    }
  }
}
