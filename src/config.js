const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}
/** Aceita tanto "123456789012345678" como "https://discord.com/channels/111/123456789012345678" */
function channelId(name, def) {
  const raw = str(name, def).trim();
  if (!raw) return def;
  // extrai o último bloco de 17-20 dígitos (ID do canal)
  const m = raw.match(/(\d{17,22})\b\s*$/);
  if (m) return m[1];
  // fallback: se for URL com /channels/<guild>/<channel>, tenta o último segmento numérico
  const parts = raw.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (/^\d{17,22}$/.test(parts[i])) return parts[i];
  return raw;
}

const dbPath = str('DB_PATH', './data/srrobs.db');
const dataDir = path.dirname(dbPath);
fs.mkdirSync(dataDir, { recursive: true });

const config = {
  discord: {
    token: str('DISCORD_TOKEN', ''),
    applicationId: str('DISCORD_APP_ID', ''),
    guildId: channelId('GUILD_ID', ''),
    logChannelId: channelId('DISCORD_LOG_CHANNEL_ID', ''),
    ownerId: str('OWNER_DISCORD_ID', ''),
  },
  oferta: {
    intervalMin: num('OFERTA_INTERVAL_MIN', 30),
    maxPaginas: num('OFERTA_MAX_PAGINAS', 4),
    limparAposDias: num('OFERTA_LIMPAR_APOS_DIAS', 30),
  },
  cartas: {
    // Anúncios de arbitragem: jogos em promoção a ≤ preço máximo com cartas que,
    // vendidas, devolvem ≥ preço do jogo + lucro mínimo (%).
    // 0 = as cartas têm de recuperar o custo do jogo. 100 = têm de o dobrar. Negativo = aceita perdas pequenas.
    precoMaxCent: num('CARTAS_PRECO_MAX_EUR', 3) * 100,
    lucroMinPct: num('CARTAS_LUCRO_MIN_PCT', 0),
    porCiclo: num('CARTAS_POR_CICLO', 15),
  },
  infra: {
    healthPort: num('HEALTH_PORT', 3000),
    dbPath,
    logLevel: str('LOG_LEVEL', 'info'),
    tz: str('TZ', 'Europe/Lisbon'),
    logDir: str('LOG_DIR', path.join(dataDir, 'logs')),
  },
};

// Fuso horário para o processo (afeta o resumo diário)
if (config.oferta.tz) process.env.TZ = config.infra.tz;

function validate() {
  const problems = [];
  if (!config.discord.token) problems.push('DISCORD_TOKEN em falta');
  return problems;
}

module.exports = { config, validate };
