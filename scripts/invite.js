/* Gera o URL de convite do bot para o Discord a partir do DISCORD_APP_ID. */
require('dotenv').config();

const id = process.env.DISCORD_APP_ID;
if (!id) {
  console.log('❌ Falta DISCORD_APP_ID no .env.');
  console.log('   Corre: npm run setup   (ou copia o Application ID de:');
  console.log('   discord.com/developers/applications → a tua app → General Information)');
  process.exit(1);
}

// Permissões: Ver canais, Enviar mensagens, Embed links, Ler histórico, Usar comandos de app
const PERMISSIONS = '277025508352';
const url = `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands&permissions=${PERMISSIONS}`;

console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│  🤖 Convite do SrRobs Cards                             │');
console.log('└─────────────────────────────────────────────────────────┘');
console.log('');
console.log('Abre este link no browser e escolhe o teu server:');
console.log('');
console.log(url);
console.log('');
console.log('No ecrã do Discord: seleciona o server → Autorizar.');
console.log('Depois: /help no canal para confirmar que chegou.');
