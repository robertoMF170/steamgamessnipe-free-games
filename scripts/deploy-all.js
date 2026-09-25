/* Registra os slash commands em TODOS os servers onde o bot está.
   Útil quando não sabes o GUILD_ID — só precisa do DISCORD_TOKEN. */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('../src/discord/commands');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ Falta DISCORD_TOKEN no .env');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  // O ID da aplicação = ID do utilizador do bot (dá para obter do próprio token)
  const me = await rest.get(Routes.user('@me'));
  const appId = process.env.DISCORD_APP_ID || me.id;

  const guilds = await rest.get(Routes.userGuilds());
  if (!guilds.length) {
    console.log('⚠️ O bot não está em nenhum server. Convida-o primeiro: npm run invite');
    process.exit(1);
  }

  console.log(`🤖 ${me.username} — a registrar comandos em ${guilds.length} server(s)...`);
  for (const g of guilds) {
    await rest.put(Routes.applicationGuildCommands(appId, g.id), { body: commands });
    console.log(`  ✅ ${g.name} (GUILD_ID=${g.id})`);
  }

  console.log('\n💡 Dica: se quiseres fixar um server no .env, copia o GUILD_ID acima para GUILD_ID.');
  console.log('   (IDs de server são números — não o link de convite discord.gg/... )');
}

main().catch((err) => {
  console.error('❌ Falhou:', err.status ? `${err.status} ${err.rawError?.message ?? ''}` : err.message);
  process.exit(1);
});
