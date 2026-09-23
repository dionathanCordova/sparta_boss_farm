Bot do Discord — o que foi implementado

Este documento descreve tudo que foi adicionado ao projeto boss-farm-tracker para integrar um bot do Discord com comandos de barra (/proximos, /bosses, /respawn), além do alerta automático que já existia via webhook. A ideia é você conseguir recriar (ou conferir) essa implementação dentro da sua cópia atual do projeto, mesmo que ela já tenha outros ajustes seus por cima.

Visão geral

O projeto passou a ter dois mecanismos de aviso no Discord, que coexistem e compartilham o mesmo código de formatação:

O primeiro é o alerta automático passivo: um endpoint (/api/cron/check), chamado periodicamente por algo externo (Vercel Cron no plano Pro, ou um pinger gratuito tipo cron-job.org), que verifica todos os bosses e dispara uma mensagem via webhook do Discord quando falta pouco tempo pro spawn e quando o boss acabou de nascer.

O segundo, novo, é o bot interativo: uma aplicação do Discord com bot próprio (nome e avatar configuráveis) que responde a comandos digitados por qualquer pessoa no server — /proximos, /bosses e /respawn. Tecnicamente ele usa o modelo de HTTP Interactions do Discord em vez de um processo discord.js com conexão persistente (Gateway/WebSocket): o Discord manda um POST direto pra uma rota da própria aplicação Next.js toda vez que alguém usa um comando. Isso foi escolhido de propósito porque o projeto roda em ambiente serverless (Vercel) — não tem como manter um processo de bot tradicional ligado 24h nesse modelo de hospedagem, mas o HTTP Interactions funciona perfeitamente porque cada comando vira só mais uma chamada de API, exatamente como as rotas que já existiam.

Arquivos novos
lib/discord-commands.mjs

Define os três comandos de barra em formato de objeto (schema que o Discord espera). Fica em .mjs (JavaScript puro, sem TypeScript) de propósito: assim tanto a rota da API quanto o script de registro (que roda fora do Next, direto com node) importam exatamente o mesmo arquivo, sem duplicar a definição em dois lugares.

js
// Shared slash-command definitions.
// Kept as plain ESM (.mjs) so both the Next.js app (app/api/discord/interactions/route.ts)
// and the standalone registration script (scripts/register-commands.mjs, run with
// plain `node`, no TypeScript build step) can import the exact same array.

const SERVER_CHOICES = [
  { name: "Server 1", value: "Server 1" },
  { name: "Server 2", value: "Server 2" },
  { name: "Server 3", value: "Server 3" },
];

export const COMMANDS = [
  {
    name: "proximos",
    description: "Mostra os 5 bosses mais próximos de nascer, em todos os servers",
    type: 1,
  },
  {
    name: "bosses",
    description: "Lista os bosses de um server com o tempo até nascer",
    type: 1,
    options: [
      {
        type: 3, // STRING
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
    ],
  },
  {
    name: "respawn",
    description: "Define o tempo de respawn de um boss (igual clicar em 'definir respawn' no site)",
    type: 1,
    options: [
      {
        type: 3,
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
      {
        type: 3,
        name: "boss",
        description: "Qual boss (comece a digitar pra ver as opções)",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "tempo",
        description: "Tempo até nascer: 3:11 (3h11) ou 45 (45 min)",
        required: true,
      },
    ],
  },
];
lib/discord-verify.ts

Verifica se uma requisição recebida realmente veio do Discord, checando a assinatura Ed25519 que ele envia em todo POST (headers X-Signature-Ed25519 e X-Signature-Timestamp), usando a DISCORD_PUBLIC_KEY da sua aplicação. Isso é obrigatório — sem essa verificação, qualquer pessoa poderia forjar requisições pro seu endpoint fingindo ser o Discord.

ts
import nacl from "tweetnacl";

/**
 * Verifies that an incoming request really came from Discord, per
 * https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
export function verifyDiscordRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string | undefined
): boolean {
  if (!signature || !timestamp || !publicKey) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
}
app/api/discord/interactions/route.ts

O coração do bot. Recebe todo POST que o Discord manda (PING de verificação, comandos executados, e pedidos de autocomplete), valida a assinatura e responde de acordo com o tipo de interação.

ts
import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordRequest } from "@/lib/discord-verify";
import { getBosses, updateBoss } from "@/lib/store";
import { bossLine } from "@/lib/discord";
import { fmtEta, fmtSpawnAt, parseDurationToMinutes } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // tweetnacl + Buffer need the Node runtime, not edge

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
} as const;

const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  AUTOCOMPLETE_RESULT: 8,
} as const;

const EMBED_COLOR = 0xa3720f;

type DiscordOption = { name: string; value?: string; focused?: boolean };

function getOptionValue(options: DiscordOption[] | undefined, name: string): string | undefined {
  return options?.find((o) => o.name === name)?.value;
}

function ephemeral(content: string) {
  return NextResponse.json({
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: 64 },
  });
}

export async function POST(req: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");

  if (!verifyDiscordRequest(rawBody, signature, timestamp, publicKey)) {
    return NextResponse.json({ error: "invalid request signature" }, { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: ResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    const options: DiscordOption[] = interaction.data?.options ?? [];
    const server = getOptionValue(options, "server");
    const focusedOpt = options.find((o) => o.focused);
    const typed = (focusedOpt?.value ?? "").toString().toLowerCase();

    const bosses = await getBosses();
    const pool = server ? bosses.filter((b) => b.server === server) : bosses;

    const choices = pool
      .filter((b) => b.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((b) => ({ name: `${b.name} (${b.server})`, value: b.id }));

    return NextResponse.json({
      type: ResponseType.AUTOCOMPLETE_RESULT,
      data: { choices },
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = interaction.data?.name;
    const options: DiscordOption[] = interaction.data?.options ?? [];
    const now = new Date();

    if (name === "proximos") {
      const bosses = await getBosses();
      const upcoming = bosses
        .filter((b) => new Date(b.spawnAt).getTime() - now.getTime() > 0)
        .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime())
        .slice(0, 5);

      const description = upcoming.length
        ? upcoming.map((b) => bossLine(b, now)).join("\n")
        : "Nenhum boss com horário futuro definido ainda.";

      return NextResponse.json({
        type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ title: "⏳ Próximos a nascer", description, color: EMBED_COLOR }] },
      });
    }

    if (name === "bosses") {
      const server = getOptionValue(options, "server") ?? "Server 1";
      const bosses = (await getBosses())
        .filter((b) => b.server === server)
        .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime());

      const description = bosses.length
        ? bosses.map((b) => bossLine(b, now)).join("\n")
        : "Nenhum boss cadastrado nesse server.";

      return NextResponse.json({
        type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [{ title: `📋 Bosses — ${server}`, description, color: EMBED_COLOR }] },
      });
    }

    if (name === "respawn") {
      const bossId = getOptionValue(options, "boss");
      const tempo = getOptionValue(options, "tempo");
      const minutes = tempo ? parseDurationToMinutes(tempo) : null;

      if (!bossId) {
        return ephemeral("Escolha um boss na lista de sugestões enquanto digita.");
      }
      if (minutes === null) {
        return ephemeral("Não entendi o tempo. Use algo como `3:11` (3h11) ou `45` (45 min).");
      }

      const updated = await updateBoss(bossId, {
        spawnAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
        alertedSpawn: false,
        alertedWarn: false,
      });

      if (!updated) {
        return ephemeral("Boss não encontrado — tente escolher de novo pela lista de sugestões.");
      }

      const ms = new Date(updated.spawnAt).getTime() - now.getTime();
      return NextResponse.json({
        type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: "✅ Respawn atualizado",
              description: `**${updated.name}** (${updated.server}) nasce ${fmtSpawnAt(
                new Date(updated.spawnAt),
                now
              )} — daqui a ${fmtEta(ms) ?? "menos de 1s"}.`,
              color: 0x2f8f74,
            },
          ],
        },
      });
    }

    return ephemeral(`Comando "${name}" não reconhecido.`);
  }

  return NextResponse.json({ error: "unknown interaction type" }, { status: 400 });
}

Pontos importantes desse arquivo: runtime = "nodejs" é necessário porque a verificação de assinatura usa Buffer, que não existe no runtime Edge da Vercel. As respostas de erro de validação (ephemeral) usam flags: 64, que faz a mensagem aparecer só pra quem digitou o comando, sem poluir o canal pros outros. As respostas de sucesso (proximos, bosses, respawn) não têm essa flag — aparecem pra todo mundo no canal, porque servem como um mural compartilhado do grupo.

scripts/register-commands.mjs

Script standalone (roda com node, fora do Next) que registra ou atualiza os comandos no Discord. Precisa ser rodado uma vez no começo, e de novo toda vez que você alterar lib/discord-commands.mjs.

js
// Registers (or updates) the slash commands with Discord.
//
// Run once after you have DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN set,
// and again any time you change lib/discord-commands.mjs.
//
//   node scripts/register-commands.mjs
//
// With DISCORD_GUILD_ID set (in .env.local), commands are registered only
// for that server and show up instantly — great while testing. Without it,
// commands are registered globally and can take up to ~1h to propagate.

import { config } from "dotenv";
config({ path: ".env.local" });

import { COMMANDS } from "../lib/discord-commands.mjs";

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) {
  console.error(
    "Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN no .env.local antes de rodar este script."
  );
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Falhou (HTTP ${res.status}):`, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log(
  `✅ ${data.length} comando(s) registrado(s) ${
    guildId ? `no server ${guildId} (aparece na hora)` : "globalmente (pode levar até 1h pra aparecer em todo lugar)"
  }.`
);
for (const cmd of data) console.log(`   /${cmd.name} — ${cmd.description}`);

Com DISCORD_GUILD_ID (a Vercel/Discord chamam isso de ID do server) definido, os comandos aparecem instantaneamente só naquele server — ideal durante o desenvolvimento. Sem essa variável, o registro é global e pode levar até ~1h pra propagar em todo lugar onde o bot estiver.

Arquivos existentes que foram alterados
lib/discord.ts

Ganhou três adições: isDiscordBotConfigured() (checa se as três variáveis do bot estão definidas, usada pra mostrar o status na tela), e bossLine() (formata uma linha de boss pra usar tanto no /proximos quanto no /bosses, com emoji de status 🔴/🟡/🟢, nome, server, tempo restante e horário). A função sendDiscordAlert que já existia (usada pelo /api/cron/check) não mudou.

ts
import type { Boss } from "./bosses";
import { fmtEta, fmtSpawnAt, statusFor } from "./format";

export function isDiscordConfigured(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL);
}

export function isDiscordBotConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_PUBLIC_KEY &&
      process.env.DISCORD_APPLICATION_ID &&
      process.env.DISCORD_BOT_TOKEN
  );
}

/** One line of a boss list, used by both /proximos and /bosses embeds. */
export function bossLine(boss: Boss, now: Date): string {
  const spawnMs = new Date(boss.spawnAt).getTime() - now.getTime();
  const eta = fmtEta(spawnMs) ?? "disponível agora";
  const at = fmtSpawnAt(new Date(boss.spawnAt), now);
  const st = statusFor(spawnMs);
  const emoji = st.cls === "urgent" ? "🔴" : st.cls === "soon" ? "🟡" : "🟢";
  return `${emoji} **${boss.name}** (${boss.server}) — ${eta} (${at})`;
}
app/api/bosses/route.ts

Passou a incluir discordBotConfigured na resposta, pra tela poder mostrar se o bot está configurado ou não:

ts
import { isDiscordConfigured, isDiscordBotConfigured } from "@/lib/discord";
// ...
return NextResponse.json({
  bosses,
  now: new Date().toISOString(),
  discordConfigured: isDiscordConfigured(),
  discordBotConfigured: isDiscordBotConfigured(),
  persistenceDurable: isPersistenceDurable(),
  warnMinutes: WARN_MINUTES,
});
app/page.tsx

Ganhou um segundo indicador de status (bolinha verde/vermelha), igual ao que já existia pro webhook, agora avisando também se o bot com comandos está configurado:

tsx
const [discordBotConfigured, setDiscordBotConfigured] = useState(false);
// ...dentro do loadBosses(): setDiscordBotConfigured(data.discordBotConfigured);
tsx
<div className="status-line">
  <span className={`status-dot ${discordBotConfigured ? "on" : "off"}`} />
  <span>
    {discordBotConfigured
      ? "Bot com comandos (/proximos, /bosses, /respawn): configurado"
      : "Bot com comandos: defina DISCORD_APPLICATION_ID / DISCORD_PUBLIC_KEY / DISCORD_BOT_TOKEN (veja o README)"}
  </span>
</div>
package.json

Duas dependências novas e um script novo:

json
{
  "scripts": {
    "register:commands": "node scripts/register-commands.mjs"
  },
  "dependencies": {
    "tweetnacl": "1.0.3"
  },
  "devDependencies": {
    "dotenv": "16.4.5"
  }
}

tweetnacl faz a verificação de assinatura (dependência de produção, usada dentro da API route). dotenv só é usado pelo script de registro pra carregar o .env.local fora do contexto do Next (dependência de desenvolvimento).

.env.example

Quatro variáveis novas, todas vindas do painel do Discord:

bash
# --- Bot com comandos de barra (/proximos, /bosses, /respawn) ---
# Tudo em Discord Developer Portal → sua aplicação:
#   General Information → Application ID  e  Public Key
#   Bot → Reset Token (ou copie o token existente)
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
# Opcional: ID do server pra registrar os comandos só nele (aparecem na
# hora, ótimo pra testar). Sem isso os comandos são globais e levam até 1h.
DISCORD_GUILD_ID=
Passo a passo pra ativar

Primeiro, crie a aplicação em discord.com/developers/applications (ou reaproveite uma já existente). Na aba General Information, copie o Application ID e a Public Key pras variáveis DISCORD_APPLICATION_ID e DISCORD_PUBLIC_KEY. Na aba Bot, clique em Reset Token pra gerar (ou revelar) o token do bot e cole em DISCORD_BOT_TOKEN.

Em seguida, convide o bot pro seu server: na aba OAuth2 → URL Generator, marque os escopos bot e applications.commands, dê a permissão Send Messages, copie o link gerado no fim da página e abra ele no navegador pra escolher o server.

Com as variáveis já salvas no .env.local (local) e nas variáveis de ambiente do projeto na Vercel (produção), rode npm run register:commands — isso cadastra os três comandos no Discord. Defina DISCORD_GUILD_ID antes desse passo se quiser que eles apareçam instantaneamente só no seu server de teste.

Por último, com o projeto já publicado (a Vercel/Discord testam a URL na hora que você salva, então o deploy precisa vir primeiro), volte na aba General Information da aplicação no Discord e cole em Interactions Endpoint URL:

https://SEU-APP.vercel.app/api/discord/interactions

Se a verificação passar, o campo salva sem erro — nesse ponto, digitar / no canal do server já mostra os três comandos.

Comandos disponíveis

/proximos não recebe parâmetros e mostra os 5 bosses mais próximos de nascer somando os três servers, ordenados por proximidade. /bosses server: pede o server (com uma lista de escolha fixa: Server 1, 2 ou 3) e lista todos os bosses daquele server com o tempo restante e o horário exato. /respawn server: boss: tempo: define um novo respawn diretamente pelo Discord — equivale a clicar em "definir respawn" no site. O campo boss usa autocomplete: conforme a pessoa digita, o Discord chama o mesmo endpoint pra sugerir os nomes que batem com o que foi digitado, filtrados pelo server escolhido; o campo tempo aceita o mesmo formato usado no site (3:11 para 3h11, ou um número simples como 45 para 45 minutos).

Testes realizados antes da entrega

Antes de considerar pronto, o fluxo inteiro foi testado rodando o projeto de verdade (não só lido): um par de chaves Ed25519 de teste foi gerado, o servidor buildado subiu com DISCORD_PUBLIC_KEY apontando pra essa chave pública, e requisições assinadas com a chave privada correspondente foram enviadas simulando exatamente o que o Discord manda — confirmando que o PING responde PONG corretamente, que uma assinatura inválida é rejeitada com 401, que /proximos e /bosses retornam os embeds formatados certos, que o autocomplete filtra os bosses batendo com o texto digitado e com o server escolhido, e que /respawn tanto atualiza o horário corretamente (recalculando a partir do momento da chamada) quanto rejeita um tempo mal formatado com uma mensagem de erro visível só pra quem digitou o comando.

Notas de segurança

O DISCORD_PUBLIC_KEY protege o endpoint contra requisições forjadas — sem ele (ou com um valor errado), toda chamada é rejeitada com 401 antes mesmo de olhar o conteúdo. Diferente do CRON_SECRET do /api/cron/check (que é um segredo que você mesmo escolhe), a chave pública do Discord não precisa ficar em segredo — o que importa é que ela bata com a aplicação certa, e a assinatura só pode ser gerada por quem tem a chave privada correspondente, que é o próprio Discord.