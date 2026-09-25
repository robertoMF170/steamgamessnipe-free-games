const { REST, Routes } = require('discord.js');
const { config, validate } = require('../config');
const { commands } = require('./commands');
const logger = require('../logger');

async function main() {
  const problems = validate();
  if (problems.length) {
    console.error('Config incompleta:', problems.join('; '));
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  logger.info(`A registar ${commands.length} slash commands no guild ${config.discord.guildId}...`);

  await rest.put(Routes.applicationGuildCommands(config.discord.applicationId ?? '', config.discord.guildId), {
    body: commands,
  });

  logger.info('Slash commands registados ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
