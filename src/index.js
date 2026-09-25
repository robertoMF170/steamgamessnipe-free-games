const http = require('node:http');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { config, validate } = require('./config');
const logger = require('./logger');
const discordNotifier = require('./discord/notifier');
const { handleInteraction } = require('./discord/interactions');
const { iniciarJobs, pararJobs } = require('./jobs');

async function main() {
  const problems = validate();
  if (problems.length) {
    logger.error(`Config incompleta: ${problems.join('; ')}`);
    logger.error('Copia .env.example para .env e preenche os valores.');
    process.exit(1);
  }

  // Healthcheck HTTP interno (usado pelo Docker HEALTHCHECK)
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(config.infra.healthPort, '0.0.0.0', r));
  logger.info(`Healthcheck a ouvir em :${config.infra.healthPort}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info(`Discord ligado como ${c.user.tag}`);
    discordNotifier.setClient(c);
    iniciarJobs();
  });

  client.on(Events.InteractionCreate, (i) => {
    handleInteraction(i).catch((err) => logger.error(`Interaction: ${err.message}`));
  });

  client.on(Events.Error, (err) => logger.error(`Discord client: ${err.message}`));

  await client.login(config.discord.token);

  const shutdown = async (signal) => {
    logger.info(`${signal} recebido — a desligar...`);
    pararJobs();
    client.destroy();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Erro fatal: ${err.stack ?? err.message}`);
  process.exit(1);
});
