import { Rcon } from "rcon-client";

/**
 * Envia um comando RCON de forma isolada (connect -> send -> end).
 * Abordagem sob demanda p/ evitar leaks e ser tolerante a reinicializações do servidor Minecraft.
 */
export async function sendRconCommand(command: string): Promise<string> {
  const host = process.env.RCON_HOST || "localhost";
  const port = parseInt(process.env.RCON_PORT || "25575", 10);
  const password = process.env.RCON_PASSWORD || "";

  if (!password) {
    throw new Error("Erro de configuração: RCON_PASSWORD não informado no ambiente.");
  }

  const rcon = new Rcon({ host, port, password, timeout: 5000 });

  try {
    await rcon.connect();
    const response = await rcon.send(command);
    await rcon.end();
    return response;
  } catch (error) {
    try {
      await rcon.end();
    } catch {
      // Ignora erro ao fechar conexão já quebrada
    }
    throw error;
  }
}
