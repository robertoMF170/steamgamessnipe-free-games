const logger = require('./logger');
const db = require('./db');
const { config } = require('./config');
const discord = require('./discord/notifier');
const { cicloOfertas } = require('./ofertas');

let ofertaJob = null;

/**
 * Um ciclo com proteção de sobreposição e deteção de canal em falta.
 * Canal sem mensagens de ofertas há 6+ ciclos → erro persistente.
 */
async function cicloProtegido() {
  const canalId = config.discord.logChannelId;
  try {
    const r = await cicloOfertas({ canalId });
    if (r.gratuitos > 0 && r.publicados === 0 && !db.metaGet('canal_ok')) {
      const falhas = Number(db.estatisticaGet('canal_falhas', '0')) + 1;
      db.estatisticaSet('canal_falhas', String(falhas));
      if (falhas >= 6) {
        await discord.notificarErro(
          'Sem canal de ofertas',
          `Detetei ofertas mas não consigo publicar há ${falhas} ciclos. Verifica DISCORD_LOG_CHANNEL_ID e as permissões do bot.`,
        );
        db.estatisticaSet('canal_falhas', '0');
      }
    } else {
      db.estatisticaSet('canal_falhas', '0');
      db.metaSet('canal_ok', '1');
    }
    db.estatisticaSet('ultima_verificacao', new Date().toISOString());
    return r;
  } catch (err) {
    logger.error(`cicloProtegido: ${err.message}`);
    await discord.notificarErro('Ciclo de ofertas falhou', err.message);
    return { gratuitos: 0, publicados: 0, apagadas: 0, cartasPublicadas: 0, cartasAnalisados: 0, cartasElegiveis: 0, cartasJaEnviados: 0, erro: err.message };
  }
}

function iniciarJobs() {
  const intervaloMs = Math.max(10, config.oferta.intervalMin) * 60 * 1000;

  // 1ª corrida ~15s após o arranque, depois em intervalo
  setTimeout(() => cicloProtegido(), 15_000);
  ofertaJob = setInterval(cicloProtegido, intervaloMs);

  // Limpeza: anúncios expirados há +30 dias saem da BD (o dedupe passa a permitir re-anúncio
  // de jogos que voltam a ficar grátis muito tempo depois — corre a cada 24h)
  setInterval(() => {
    const cutoff = Date.now() - config.oferta.limparAposDias * 24 * 60 * 60 * 1000;
    const r = db.db.prepare('DELETE FROM anuncios WHERE expirado_em IS NOT NULL AND expirado_em < ?').run(cutoff);
    if (r.changes) logger.info(`Limpeza: ${r.changes} anúncio(s) antigos removidos do histórico`);
  }, 24 * 60 * 60 * 1000);

  logger.info(`Job de ofertas agendado: cada ${config.oferta.intervalMin} min`);
}

function pararJobs() {
  if (ofertaJob) clearInterval(ofertaJob);
}

module.exports = { iniciarJobs, pararJobs, cicloProtegido };
