/* Arranque com supervisão: lança o bot Discord e reinicia-o com backoff
   (3s → 60s) se ele cair. Sem ASF — este bot é só de anúncios. */
const { spawn } = require('node:child_process');
const path = require('node:path');

function arrancarBot() {
  console.log('[start-all] A arrancar o bot Discord...');
  return spawn(process.execPath, [path.join(__dirname, 'index.js')], { stdio: 'inherit' });
}

async function main() {
  console.log('════════════════════════════════════════════');
  console.log(' 🎁 SrRobs Free Games — arranque');
  console.log('════════════════════════════════════════════');

  let backoff = 3000;
  let bot = null;

  const loop = () => {
    bot = arrancarBot();
    bot.on('exit', (code) => {
      console.error(`[start-all] Bot saiu (código ${code}). Reinicio em ${Math.round(backoff / 1000)}s...`);
      setTimeout(() => {
        backoff = Math.min(backoff * 2, 60_000);
        loop();
      }, backoff);
    });
  };
  loop();

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`[start-all] ${sig} recebido — a parar...`);
      try { bot?.kill(sig); } catch {}
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error('[start-all] Erro fatal:', e);
  process.exit(1);
});
