const logger = require('../logger');
const { config } = require('../config');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

let clientRef = null;
let canalAuto = null; // canal escolhido automaticamente (cache)
function setClient(c) {
  clientRef = c;
  canalAuto = null;
}

/** Escolhe um canal de texto onde o bot pode escrever (preferência por nomes óbvios). */
function escolherCanalAuto() {
  if (canalAuto) return canalAuto;
  if (!clientRef?.channels) return null;
  const textos = [...clientRef.channels.cache.values()].filter(
    (ch) => ch.type === 0 /* GuildText */ && ch.viewable,
  );
  const preferidos = textos.filter((ch) => /general|geral|ofertas|free|gratis|promo/i.test(ch.name));
  const candidatos = [...(preferidos.length ? preferidos : textos)].sort((a, b) => a.rawPosition - b.rawPosition);
  for (const ch of candidatos) {
    let podeEscrever = true;
    try {
      const perms = ch.permissionsFor(ch.guild?.members?.me);
      podeEscrever = !perms || (perms.has('SendMessages') && perms.has('EmbedLinks'));
    } catch {} // canais parciais podem não ter perms — assume que sim
    if (podeEscrever) {
      canalAuto = ch;
      logger.info(`Canal de ofertas escolhido automaticamente: #${ch.name} (${ch.id})`);
      return ch;
    }
  }
  return null;
}

function resolveCanal(channelId) {
  if (channelId && clientRef?.channels) {
    const ch = clientRef.channels.cache.get(channelId);
    if (ch?.isTextBased()) return ch;
  }
  const fallback = config.discord.logChannelId;
  if (fallback && clientRef?.channels) {
    const ch = clientRef.channels.cache.get(fallback);
    if (ch?.isTextBased()) return ch;
  }
  return escolherCanalAuto();
}

/** Igual a resolveCanal mas tenta fetch na API se não estiver em cache. */
async function resolveCanalAsync(channelId) {
  const sync = resolveCanal(channelId);
  if (sync) return sync;
  const id = channelId || config.discord.logChannelId;
  if (!id || !clientRef?.channels?.fetch) return null;
  try {
    const ch = await clientRef.channels.fetch(id);
    if (ch?.isTextBased()) {
      logger.info(`Canal resolvido via fetch: #${ch.name ?? ch.id} (${ch.id})`);
      return ch;
    }
  } catch (err) {
    logger.warn(`resolveCanal: fetch(${id}) falhou: ${err.message}`);
  }
  return escolherCanalAuto();
}

/** Publica um jogo a -100% com botão "Resgatar na Steam". Devolve ids da mensagem. */
async function publicarOferta(jogo, { canalId = null } = {}) {
  const canal = await resolveCanalAsync(canalId);
  if (!canal) {
    logger.warn('publicarOferta: sem canal disponível (DISCORD_LOG_CHANNEL_ID?) — oferta não publicada');
    return null;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎁 ${jogo.nome} — GRÁTIS (estava ${jogo.preco_original || 'pago'}!)`)
    .setDescription(
      [
        'Este jogo **estava pago e agora está a 100% de graça**.',
        'Resgata agora: a licença **fica para sempre na tua biblioteca**, mesmo quando a promoção acabar.',
        '',
        `⏳ Promoção temporária — **porquê resgatar agora:** não pagas nada e fica teu para sempre.`,
        `🔗 ${jogo.url}`,
        '',
        'Clica no botão ou no link acima e carrega em **"Adicionar à biblioteca"**.',
      ].join('\n'),
    )
    .addFields(
      { name: 'Preço original', value: jogo.preco_original || '—', inline: true },
      { name: 'Agora', value: 'Grátis 🎉', inline: true },
      { name: '🔗 Link direto', value: jogo.url, inline: false },
    )
    .setImage(`https://cdn.cloudflare.steamstatic.com/steam/apps/${jogo.appid}/header.jpg`)
    .setFooter({ text: 'Licença permanente · mensagem é apagada quando a promoção acaba' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('🎮 Resgatar na Steam').setStyle(ButtonStyle.Link).setURL(jogo.url),
  );

  try {
    const msg = await canal.send({ embeds: [embed], components: [row] });
    return { canalId: msg.channelId ?? canal.id, mensagemId: msg.id };
  } catch (err) {
    logger.warn(`Falhou publicar oferta (${jogo.nome}): ${err.message}`);
    return null;
  }
}

/** Promo de "compra barata + vende cartas": embed com a matemática e botões. */
async function publicarPromoCartas(jogo, detalhe, { canalId = null } = {}) {
  const canal = await resolveCanalAsync(canalId);
  if (!canal) return null;

  const euros = (cent) => (cent / 100).toFixed(2).replace('.', ',') + ' €';
  const lucroEuro = (detalhe.retornoCent - detalhe.preco_final_cent) / 100;
  // Nível: se vier do classificador usa-o, senão calcula pelo ratio
  const ratio = detalhe.retornoCent / detalhe.preco_final_cent;
  const nivelInfo = detalhe.nivel || (ratio >= 0.75 ? 'BAIXO' : ratio >= 0.45 ? 'MEDIO' : 'ALTO');
  const nivelCfg = {
    BAIXO: { cor: 0x57f287, badge: '🟢 BAIXO — Barato', desc: 'Barato para as cartas' },
    MEDIO: { cor: 0xfee75c, badge: '🟡 MÉDIO — Ela por ela', desc: 'Ela por ela' },
    ALTO: { cor: 0xed4245, badge: '🔴 ALTO — Caro', desc: 'Caro para as cartas' },
  }[nivelInfo] || { cor: 0xfee75c, badge: nivelInfo, desc: '' };
  const cicloTxt = nivelInfo === 'BAIXO'
    ? 'Ideal para **ciclo infinito**: compras, idlas 2-3h, vendes as cartas e usas o saldo para o próximo jogo — biblioteca e nível Steam sempre a crescer.'
    : nivelInfo === 'MEDIO'
      ? 'Quase ela por ela — recuperas grande parte do investimento em cartas; bom para **crescer biblioteca/nível Steam** e financiar próximos drops.'
      : 'Recupera pouco, mas **aumenta biblioteca e nível Steam** e dá drops para trocar/vender no futuro — ciclo infinito a longo prazo.';
  const embed = new EmbedBuilder()
    .setColor(nivelCfg.cor)
    .setTitle(`${nivelCfg.badge} · ${jogo.nome} — ${jogo.preco_final_texto} (era ${jogo.preco_original || '?'})`)
    .setDescription(
      [
        `${nivelCfg.desc}: **${(ratio * 100).toFixed(0)}% do preço volta em cartas** — ` + cicloTxt,
        '',
        `**Porquê comprar / idlar?** ${detalhe.nCartas} cartas no set → ~${detalhe.drops} drops em 2-3h (idling/ASF). ` +
          `Média ${euros(detalhe.mediaCent)}/carta → retorno líquido ≈ **${euros(detalhe.retornoCent)}** após fee 15%. ` +
          `Saldo est. **${euros(Math.round(lucroEuro * 100))} (${detalhe.lucroPct >= 0 ? '+' : ''}${detalhe.lucroPct}%)**` +
          (detalhe.vendaSeguraCent ? ` — conservador ≈ ${euros(detalhe.vendaSeguraCent)}.` : '.'),
        '',
        `🔗 Loja: ${jogo.url}`,
        `🃏 Mercado: https://steamcommunity.com/market/search?appid=753&q=${encodeURIComponent(jogo.nome)}`,
      ].join('\n'),
    )
    .addFields(
      { name: '💵 Investimento', value: jogo.preco_final_texto, inline: true },
      { name: '🃏 Cartas no set', value: `${detalhe.nCartas} (~${detalhe.drops} drops)`, inline: true },
      { name: '📈 Retorno estimado', value: `≈ **${euros(detalhe.retornoCent)}** (${detalhe.lucroPct >= 0 ? '+' : ''}${detalhe.lucroPct}%)`, inline: true },
      { name: '🏷️ Nível', value: nivelCfg.badge, inline: true },
      { name: '🪙 Média por carta', value: euros(detalhe.mediaCent), inline: true },
      { name: '🛟 Venda segura (conservador)', value: `≈ ${euros(detalhe.vendaSeguraCent)}`, inline: true },
      { name: '🔗 Link direto', value: jogo.url, inline: false },
      { name: '♻️ Ciclo infinito', value: cicloTxt, inline: false },
    )
    .setImage(`https://cdn.cloudflare.steamstatic.com/steam/apps/${jogo.appid}/header.jpg`)
    .setFooter({ text: `${nivelCfg.badge} · estimativa com preços atuais do mercado · mensagem é apagada quando a promoção acaba` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('🎮 Comprar na Steam').setStyle(ButtonStyle.Link).setURL(jogo.url),
    new ButtonBuilder().setLabel('🃏 Ver cartas no mercado').setStyle(ButtonStyle.Link).setURL(`https://steamcommunity.com/market/search?appid=753#p1_tag_753_App_${jogo.appid}_tag_app_${jogo.appid}`),
  );

  try {
    const msg = await canal.send({ embeds: [embed], components: [row] });
    return { canalId: msg.channelId ?? canal.id, mensagemId: msg.id };
  } catch (err) {
    logger.warn(`Falhou publicar promo de cartas (${jogo.nome}): ${err.message}`);
    return null;
  }
}

/** Apaga a mensagem de uma oferta cuja promoção acabou. True se apagada ou já inexistente. */
async function apagarMensagem(canalId, mensagemId) {
  if (!clientRef) return false;
  try {
    const canal = await clientRef.channels.fetch(canalId);
    if (!canal?.isTextBased()) return false;
    await canal.messages.delete(mensagemId);
    return true;
  } catch (err) {
    if (err?.code === 10008) {
      // Unknown Message — já foi apagada (ex.: à mão). Tratar como sucesso.
      return true;
    }
    logger.warn(`Falhou apagar mensagem da oferta ${mensagemId}: ${err.message}`);
    return false;
  }
}

/** Avisos operacionais (erros, estado). */
async function notificarErro(titulo, detalhe, { canalId = null } = {}) {
  const canal = await resolveCanalAsync(canalId);
  if (!canal) return;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚠️ ${titulo}`)
    .setDescription(String(detalhe).slice(0, 2000))
    .setTimestamp();
  try {
    await canal.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Falhou enviar notificação de erro: ${err.message}`);
  }
}

module.exports = { setClient, publicarOferta, publicarPromoCartas, apagarMensagem, notificarErro };
