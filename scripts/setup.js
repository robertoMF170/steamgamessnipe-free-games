/* Wizard de configuração do SrRobs Free Games — escreve .env. */
const readline = require('node:readline/promises');
const fs = require('node:fs');
const path = require('node:path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function pergunta(titulo, def = '', obrigatorio = false) {
  for (;;) {
    const sufixo = def !== '' ? ` [${def}]` : '';
    const resp = (await rl.question(`${titulo}${sufixo}: `)).trim() || def;
    if (resp || !obrigatorio) return resp;
    console.log('  ⚠️ este campo é obrigatório');
  }
}

async function main() {
  console.log('──────────────────────────────────────────────');
  console.log(' 🎁 SrRobs Free Games — configuração inicial');
  console.log('──────────────────────────────────────────────');
  console.log('Vou criar o .env neste diretório.\n');

  const discordToken = await pergunta('DISCORD_TOKEN (discord.com/developers → Bot)', '', true);
  const appId = await pergunta('DISCORD_APP_ID (General Information → Application ID)', '', true);
  const guildId = await pergunta('GUILD_ID (Definições do server → Integrações)', '', true);
  const logChannel = await pergunta('DISCORD_LOG_CHANNEL_ID (canal onde publicar ofertas)', '', true);
  const intervalo = await pergunta('Minutos entre verificações da Steam', '30');
  const tz = await pergunta('Timezone', 'Europe/Lisbon');

  const env = [
    '# gerado por npm run setup',
    `DISCORD_TOKEN=${discordToken}`,
    `DISCORD_APP_ID=${appId}`,
    `GUILD_ID=${guildId}`,
    `DISCORD_LOG_CHANNEL_ID=${logChannel}`,
    '',
    `OFERTA_INTERVAL_MIN=${intervalo}`,
    '',
    'HEALTH_PORT=3000',
    'DB_PATH=./data/srrobs.db',
    'LOG_LEVEL=info',
    `TZ=${tz}`,
    'OWNER_DISCORD_ID=',
  ].join('\n') + '\n';
  fs.writeFileSync('.env', env);

  console.log('\n✅ Feito! Ficheiro criado: .env');
  console.log('\nPróximos passos:');
  console.log(' 1. Convida o bot ao server:  npm run invite');
  console.log(' 2. Regista os comandos:     npm run deploy-commands');
  console.log(' 3. Arranca:                 npm start');
  console.log('    (ou como serviço: bash deploy/install.sh)');
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
