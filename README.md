# Spawn dos Bosses

Rastreador de respawn de boss (3 servers) com alerta automático no Discord.
Frontend em Next.js (o mesmo visual do rastreador que você já usava), backend
como API routes na própria aplicação — dá pra rodar local (`localhost`) e
hospedar de graça na Vercel.

## Como funciona

- Cada boss tem um horário de nascimento (`spawnAt`) guardado no servidor.
- Você abre a página, clica em **definir respawn**, digita quanto tempo falta
  (ex. `3:11` ou `45`) e isso vira o novo horário — vale tanto rodando local
  quanto na versão publicada, porque os dois leem/gravam no mesmo lugar.
- Um endpoint (`/api/cron/check`) verifica todos os bosses e dispara a
  mensagem no Discord quando: (1) faltam `DISCORD_WARN_MINUTES` minutos
  (padrão 10) e (2) quando o boss acabou de nascer. Cada alerta só é enviado
  uma vez por respawn.
- Esse endpoint **precisa ser chamado periodicamente** (a cada 1–5 min) por
  algo de fora — veja a seção "Disparando o cron" abaixo, é o único passo
  menos óbvio de todo o setup.

## 1. Rodando local

```bash
npm install
cp .env.example .env.local   # depois edite o .env.local com seus valores
npm run dev
```

Abra http://localhost:3000. Sem nenhuma variável configurada, o app já
funciona (mostra os bosses, deixa você ajustar o tempo), só não manda nada
pro Discord até você configurar o webhook.

## 2. Criando o webhook do Discord

No servidor do Discord: **Configurações do Servidor → Integrações →
Webhooks → Novo Webhook**. Escolha o canal onde os avisos devem cair, copie
a **Webhook URL** e cole em `DISCORD_WEBHOOK_URL` no `.env.local` (local) ou
nas variáveis de ambiente da Vercel (produção). Precisa ter permissão de
"Gerenciar Webhooks" no servidor pra criar um.

## 3. Persistência (Upstash Redis) — recomendado antes de ir pra produção

Sem isso, os horários ficam num arquivo local (`data/bosses.local.json`)
que funciona bem rodando na sua máquina, mas **não sobrevive** a um
redeploy na Vercel (o sistema de arquivos lá é efêmero). Pra guardar de
verdade:

1. Crie um banco grátis em https://console.upstash.com (ou pelo próprio
   dashboard da Vercel: **Storage → Marketplace → Upstash**).
2. Copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` pro
   `.env.local` / variáveis de ambiente da Vercel.

O app detecta essas variáveis sozinho e passa a usar o Redis; sem elas,
cai automaticamente no arquivo local (bom só pra testar).

## 4. Deploy na Vercel

```bash
npm i -g vercel   # se ainda não tiver
vercel
```

Ou pelo dashboard da Vercel: **Add New → Project → importe esta pasta/repo**.
Depois, em **Settings → Environment Variables**, adicione as mesmas
variáveis do `.env.example` (`DISCORD_WEBHOOK_URL`, `CRON_SECRET`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, opcionalmente
`DISCORD_WARN_MINUTES`).

## 5. Disparando o cron (o passo importante)

O plano **Hobby (grátis) da Vercel só permite cron job 1x por dia** — não
serve pra checar boss a cada minuto. O plano Pro ($20/mês) libera checagem
por minuto. Duas opções:

### Opção A — grátis, usando um pinger externo (recomendado)

Qualquer serviço externo que bata numa URL de tempos em tempos funciona,
porque o endpoint mora na sua própria aplicação, não dentro do cron da
Vercel. Sugestões grátis:

- **[cron-job.org](https://cron-job.org)** (mais simples): crie uma conta,
  adicione um "cronjob" apontando pra
  `https://SEU-APP.vercel.app/api/cron/check?secret=SEU_CRON_SECRET`,
  com intervalo de 1 a 5 minutos.
- **GitHub Actions** (se seu projeto já estiver num repo do GitHub): crie
  `.github/workflows/ping-cron.yml` com:

  ```yaml
  name: Ping boss cron
  on:
    schedule:
      - cron: "*/5 * * * *" # a cada 5 minutos
  jobs:
    ping:
      runs-on: ubuntu-latest
      steps:
        - run: curl -fsS "https://SEU-APP.vercel.app/api/cron/check?secret=${{ secrets.CRON_SECRET }}"
  ```

  E cadastre `CRON_SECRET` em Settings → Secrets do repositório.

### Opção B — Vercel Pro

Se você assinar o Pro, crie um `vercel.json` na raiz do projeto:

```json
{
  "crons": [{ "path": "/api/cron/check", "schedule": "*/1 * * * *" }]
}
```

A Vercel já envia automaticamente o header
`Authorization: Bearer $CRON_SECRET` quando a variável `CRON_SECRET` existe
no projeto, então nem precisa do `?secret=` na URL nesse caso.

### Testando manualmente

```bash
curl "https://SEU-APP.vercel.app/api/cron/check?secret=SEU_CRON_SECRET"
```

Retorna um JSON com os alertas enviados (`alertsSent`) — útil pra confirmar
que o webhook do Discord está funcionando antes de deixar o pinger
automático rodando.

## Estrutura do projeto

```
app/
  page.tsx              → tela (client component), consome a API abaixo
  globals.css           → design tokens e estilos (tema claro/escuro)
  api/
    bosses/route.ts          → GET: lista todos os bosses + status
    bosses/[id]/route.ts     → POST { minutes }: define novo respawn
    cron/check/route.ts      → GET: dispara os alertas pendentes no Discord
lib/
  bosses.ts   → tipos + dados iniciais (seed)
  store.ts    → persistência (Upstash Redis, com fallback pra arquivo local)
  discord.ts  → montagem e envio da mensagem pro webhook
  format.ts   → funções de data/hora e parsing do campo "respawn"
```

## Notas

- Os dados de exemplo (`lib/bosses.ts`) são só placeholders — assim que
  você abrir o app, use **definir respawn** em cada boss pra colocar os
  horários reais.
- `CRON_SECRET` é opcional, mas sem ele qualquer pessoa que descobrir a URL
  do seu `/api/cron/check` consegue disparar alertas manualmente — vale a
  pena configurar antes de deixar o link público em algum lugar.
