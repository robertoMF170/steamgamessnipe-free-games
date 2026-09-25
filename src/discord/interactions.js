const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../logger');
const { config } = require('../config');
const db = require('../db');
const { cicloProtegido } = require('../jobs');
const { ofertasAtivas } = require('../ofertas');

const COR = { verde: 0x57f287, azul: 0x5865f2, vermelho: 0xed4245 };
const PAGE_SIZE = 8;

// Cache de sessões /cartas — cada invocação guarda avaliados para filtrar sem voltar à API
const cartasSessions = new Map(); // cacheId -> { avaliados, currentNivel, currentPage, limite, createdAt, ownerId }
const SESSION_TTL_MS = 20 * 60 * 1000;

function fmtDuracao(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}
function fmtData(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}
function euros(cent) {
  return (cent / 100).toFixed(2).replace('.', ',') + ' €';
}
function nivelDe(ratio) {
  if (ratio >= 0.75) return 'BAIXO';
  if (ratio >= 0.45) return 'MEDIO';
  return 'ALTO';
}
const BADGE = { BAIXO: '🟢 BAIXO', MEDIO: '🟡 MÉDIO', ALTO: '🔴 ALTO', SEM: '⚪ SEM CARTAS' };
const ORDEM = { BAIXO: 0, MEDIO: 1, ALTO: 2, SEM: 3 };

function getFiltrados(session) {
  const n = (session.currentNivel || 'todos').toLowerCase();
  if (n === 'todos') return session.avaliados.filter((x) => x.nivel !== 'SEM');
  if (n === 'baixo') return session.avaliados.filter((x) => x.nivel === 'BAIXO');
  if (n === 'medio') return session.avaliados.filter((x) => x.nivel === 'MEDIO');
  if (n === 'alto') return session.avaliados.filter((x) => x.nivel === 'ALTO');
  if (n === 'sem') return session.avaliados.filter((x) => x.nivel === 'SEM');
  return session.avaliados.filter((x) => x.nivel !== 'SEM');
}

function buildCartasView(session, cacheId) {
  const filtrados = getFiltrados(session);
  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const page = Math.min(session.currentPage || 0, totalPages - 1);
  const start = page * PAGE_SIZE;
  const slice = filtrados.slice(start, start + PAGE_SIZE);

  // stats por nível para o header
  const counts = { BAIXO: 0, MEDIO: 0, ALTO: 0, SEM: 0 };
  for (const a of session.avaliados) counts[a.nivel] = (counts[a.nivel] || 0) + 1;
  const stats = `🟢 ${counts.BAIXO} · 🟡 ${counts.MEDIO} · 🔴 ${counts.ALTO} · ⚪ ${counts.SEM} · total ${session.avaliados.length} varridos`;

  const nivelLabel = (session.currentNivel || 'todos').toUpperCase();
  const tituloNivel =
    nivelLabel === 'TODOS'
      ? 'Todos (com cartas)'
      : nivelLabel === 'BAIXO'
        ? '🟢 Baixo — Barato p/ cartas'
        : nivelLabel === 'MEDIO'
          ? '🟡 Médio — Ela por ela'
          : nivelLabel === 'ALTO'
            ? '🔴 Alto — Caro p/ cartas'
            : '⚪ Sem cartas';

  let color = 0xfee75c;
  if (nivelLabel === 'BAIXO') color = 0x57f287;
  else if (nivelLabel === 'ALTO') color = 0xed4245;
  else if (nivelLabel === 'SEM') color = 0x95a5a6;

  const linhas = slice.map((a) => {
    if (!a.est) return `${BADGE.SEM} **${a.nome}** — ${a.preco_final_texto} — sem trading cards · <https://store.steampowered.com/app/${a.appid}>`;
    const r = a.est;
    const volta = Math.round(r.ratio * 100);
    return `${BADGE[a.nivel]} **${a.nome}** — ${a.preco_final_texto} (era ${a.preco_original || '?'}) → ${r.nCartas}c × ${euros(r.mediaCent)} × ${r.drops} = **${euros(r.retornoCent)}** (${r.lucroPct >= 0 ? '+' : ''}${r.lucroPct}%, ${volta}% volta) · <https://store.steampowered.com/app/${a.appid}>`;
  });

  const descHeader = `${stats}\nFiltro: **${tituloNivel}** — ${filtrados.length} jogo(s) · pág ${page + 1}/${totalPages}`;
  const desc =
    (linhas.length ? linhas.join('\n') : '_Nada neste filtro — tenta outro nível._').slice(0, 4000);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 Cartas ≤3,00€ — ${tituloNivel}`)
    .setDescription(`${descHeader}\n\n${desc}`)
    .setFooter({ text: `🟢 Baixo=barato · 🟡 Médio=ela por ela · 🔴 Alto=caro · todos dão retorno/nível — ciclo infinito ♻️ · ${page + 1}/${totalPages}` })
    .setTimestamp();

  // Botões: linha 1 = filtros, linha 2 = paginação + publicar
  const active = (session.currentNivel || 'todos').toLowerCase();
  const btn = (nivel, label, styleActive) => {
    const isActive = active === nivel;
    return new ButtonBuilder()
      .setCustomId(`cartas:filter:${nivel}:${cacheId}`)
      .setLabel(label)
      .setStyle(isActive ? styleActive : ButtonStyle.Secondary);
  };
  const row1 = new ActionRowBuilder().addComponents(
    btn('todos', 'Todos', ButtonStyle.Primary),
    btn('baixo', '🟢 Baixo', ButtonStyle.Success),
    btn('medio', '🟡 Médio', ButtonStyle.Primary),
    btn('alto', '🔴 Alto', ButtonStyle.Danger),
    btn('sem', '⚪ Sem', ButtonStyle.Secondary),
  );

  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cartas:page:prev:${cacheId}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(`cartas:noop:${cacheId}`)
      .setLabel(`${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`cartas:page:next:${cacheId}`)
      .setLabel('Seguinte ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled),
    new ButtonBuilder()
      .setCustomId(`cartas:publish:${cacheId}`)
      .setLabel('📤 Publicar página')
      .setStyle(ButtonStyle.Success),
  );

  return { embed, components: [row1, row2], filtrados, page, totalPages };
}

async function responderStatus(interaction) {
  const counts = db.anunciosCount();
  const ultima = db.estatisticaGet('ultima_verificacao', null);
  const falhas = Number(db.estatisticaGet('canal_falhas', '0'));

  const embed = new EmbedBuilder()
    .setColor(COR.azul)
    .setTitle('🎁 Bot de jogos grátis — estado')
    .addFields(
      { name: 'Ofertas ativas', value: `${counts.ativos} (🎁 grátis + 🃏 cartas)`, inline: true },
      { name: 'Anunciadas (total)', value: String(counts.total), inline: true },
      { name: 'Ciclo', value: `cada ${fmtDuracao(config.oferta.intervalMin)}`, inline: true },
      {
        name: 'Última verificação',
        value: ultima ? fmtData(new Date(ultima).getTime()) : 'ainda não correu',
        inline: false,
      },
      {
        name: 'Canal de publicação',
        value: config.discord.logChannelId ? `<#${config.discord.logChannelId}>` : '⚠️ não configurado',
        inline: false,
      },
    )
    .setFooter({ text: falhas > 0 ? `⚠️ ${falhas} ciclo(s) sem conseguir publicar` : 'a vigiar a loja Steam 24/7' })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function responderOfertas(interaction) {
  const { gratis, cartas } = ofertasAtivas();

  const recentes = db.anunciosRecentes(20);

  const embed = new EmbedBuilder().setColor(COR.verde).setTitle('🎁 Ofertas ativas');

  if (gratis.length) {
    embed.addFields({
      name: '🎁 Grátis 100% (licença fica para sempre)',
      value: gratis
        .slice(0, 15)
        .map((a) => `**${a.nome}**${a.preco_original ? ` (estava ${a.preco_original})` : ''}\n<https://store.steampowered.com/app/${a.appid}>`)
        .join('\n\n')
        .slice(0, 1024),
    });
  } else {
    embed.setDescription('Nenhuma promoção 100% ativa neste momento. O bot avisa aqui mal apareça uma!');
  }

  if (cartas.length) {
    embed.addFields({
      name: '🃏 Baratos com cartas (publicados pelo ciclo)',
      value: cartas
        .slice(0, 10)
        .map((a) => {
          const d = (() => {
            try {
              return JSON.parse(a.detalhe ?? '{}');
            } catch {
              return {};
            }
          })();
          const lvl = d.nivel ? `${BADGE[d.nivel] || d.nivel} ` : '';
          const linha = d.retornoCent ? ` → ${lvl}${euros(d.retornoCent)} (${d.lucroPct >= 0 ? '+' : ''}${d.lucroPct}%)` : '';
          return `**${a.nome}** — ${d.preco_final_texto ?? ''}${linha}\n<https://store.steampowered.com/app/${a.appid}>`;
        })
        .join('\n\n')
        .slice(0, 1024),
    });
  }

  const historico = recentes.filter((r) => r.expirado_em).slice(0, 8);
  if (historico.length) {
    embed.addFields({
      name: 'Acabaram recentemente',
      value: historico
        .map((r) => `~~${r.nome}~~ — acabou ${fmtData(r.expirado_em)}`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  embed.setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function responderVerificar(interaction) {
  await interaction.editReply('🔍 A verificar a loja Steam agora...');
  const r = await cicloProtegido();
  const textos = [];
  if (r.gratuitos === 0 && !r.cartasPublicadas) textos.push('Nenhuma novidade neste momento.');
  if (r.publicados) textos.push(`🆕 ${r.publicados} nova(s) oferta(s) publicada(s).`);
  if (r.cartasPublicadas) textos.push(`🃏 ${r.cartasPublicadas} promo(s) de cartas publicada(s).`);
  if (r.apagadas) textos.push(`🗑️ ${r.apagadas} mensagem(ns) apagada(s) — promoção acabou.`);
  if (!textos.length) textos.push('Tudo em ordem — nada novo desde a última verificação.');
  await interaction.followUp({ content: `✅ ${textos.join(' ')}` });
}

async function responderCartas(interaction) {
  const nivelOpt = (interaction.options.getString('nivel') || 'todos').toLowerCase();
  const limite = Math.min(25, Math.max(1, interaction.options.getInteger('limite') || 15));
  const publicar = interaction.options.getBoolean('publicar') || false;

  if (publicar && !interaction.memberPermissions?.has('Administrator') && interaction.user.id !== config.discord.ownerId) {
    await interaction.editReply('❌ `publicar` só para admin.');
    return;
  }

  await interaction.editReply(`🔍 A varrer até 3,00€… (nivel=${nivelOpt}, limite=${limite}) — isto pode levar ~10s`);

  const { paginaSpecials } = require('../steam/search');
  const { estimarRetorno } = require('../steam/mercado');

  const { itens } = await paginaSpecials(0, 50);
  const elegiveis = itens.filter((i) => i.preco_final_cent !== null && i.preco_final_cent > 0 && i.preco_final_cent <= config.cartas.precoMaxCent);
  if (!elegiveis.length) {
    await interaction.editReply('Nenhum jogo elegível ≤3,00€ agora.');
    return;
  }

  // Avalia amostra maior para ter distribuição por nível — limitado para não spammar rate-limit
  const avaliarQtd = Math.min(50, Math.max(24, limite * 2));
  const amostra = elegiveis.slice(0, avaliarQtd);

  const avaliados = [];
  for (const c of amostra) {
    const est = await estimarRetorno(c.nome, c.appid);
    if (!est) {
      avaliados.push({ ...c, est: null, nivel: 'SEM', ratio: 0 });
      continue;
    }
    const ratio = est.retornoCent / c.preco_final_cent;
    const n = nivelDe(ratio);
    const lucroPct = Math.round(((est.retornoCent - c.preco_final_cent) / c.preco_final_cent) * 100);
    avaliados.push({ ...c, est: { ...est, lucroPct, ratio }, nivel: n, ratio });
    await new Promise((r) => setTimeout(r, 350));
  }

  // Ordena: BAIXO → MEDIO → ALTO → SEM, dentro por ratio desc
  avaliados.sort((a, b) => (ORDEM[a.nivel] - ORDEM[b.nivel]) || b.ratio - a.ratio);

  const cacheId = interaction.id;
  const session = {
    avaliados,
    currentNivel: nivelOpt,
    currentPage: 0,
    limite,
    ownerId: interaction.user.id,
    createdAt: Date.now(),
  };
  cartasSessions.set(cacheId, session);
  setTimeout(() => cartasSessions.delete(cacheId), SESSION_TTL_MS);

  const { embed, components } = buildCartasView(session, cacheId);

  await interaction.editReply({ content: '', embeds: [embed], components });

  // Se pediu publicar logo, publica a página atual filtrada (após mostrar)
  if (publicar) {
    const filtrados = getFiltrados(session);
    const slice = filtrados.slice(0, PAGE_SIZE).filter((x) => x.est);
    if (!slice.length) {
      await interaction.followUp({ content: 'Nada com cartas para publicar neste filtro.', ephemeral: true });
      return;
    }
    const notifier = require('./notifier');
    let pub = 0;
    for (const a of slice) {
      const url = `https://store.steampowered.com/app/${a.appid}`;
      const detalhe = {
        preco_final_texto: a.preco_final_texto,
        preco_final_cent: a.preco_final_cent,
        nCartas: a.est.nCartas,
        mediaCent: a.est.mediaCent,
        drops: a.est.drops,
        retornoCent: a.est.retornoCent,
        vendaSeguraCent: a.est.vendaSeguraCent,
        lucroPct: a.est.lucroPct,
        nivel: a.nivel,
      };
      const env = await notifier.publicarPromoCartas({ ...a, url }, detalhe, {});
      if (env) {
        try {
          db.anuncioGuardar(a.appid, a.nome, env.canalId, env.mensagemId, a.preco_original, 'cartas', JSON.stringify(detalhe));
        } catch {}
        pub++;
      }
      await new Promise((r) => setTimeout(r, 1300));
    }
    if (pub) await interaction.followUp({ content: `✅ Publiquei ${pub} jogo(s) desta vista no canal.` });
  }
}

async function handleCartasButton(interaction) {
  const parts = interaction.customId.split(':');
  // ex: cartas:filter:baixo:123456  | cartas:page:prev:123  | cartas:publish:123 | cartas:noop:123
  const action = parts[1];
  if (action === 'noop') {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  if (action === 'filter') {
    const nivel = parts[2];
    const cacheId = parts[3];
    const session = cartasSessions.get(cacheId);
    if (!session) {
      await interaction.reply({ content: '⏳ Esta lista expirou — corre `/cartas` de novo.', ephemeral: true }).catch(() => {});
      return;
    }
    session.currentNivel = nivel;
    session.currentPage = 0;
    const { embed, components } = buildCartasView(session, cacheId);
    await interaction.update({ embeds: [embed], components }).catch(() => {});
    return;
  }
  if (action === 'page') {
    const dir = parts[2];
    const cacheId = parts[3];
    const session = cartasSessions.get(cacheId);
    if (!session) {
      await interaction.reply({ content: '⏳ Esta lista expirou — corre `/cartas` de novo.', ephemeral: true }).catch(() => {});
      return;
    }
    const filtrados = getFiltrados(session);
    const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
    if (dir === 'prev' && session.currentPage > 0) session.currentPage--;
    if (dir === 'next' && session.currentPage < totalPages - 1) session.currentPage++;
    const { embed, components } = buildCartasView(session, cacheId);
    await interaction.update({ embeds: [embed], components }).catch(() => {});
    return;
  }
  if (action === 'publish') {
    const cacheId = parts[2];
    const session = cartasSessions.get(cacheId);
    if (!session) {
      await interaction.reply({ content: '⏳ Esta lista expirou — corre `/cartas` de novo.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!interaction.memberPermissions?.has('Administrator') && interaction.user.id !== config.discord.ownerId) {
      await interaction.reply({ content: '❌ Só admin pode publicar.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const filtrados = getFiltrados(session);
    const page = session.currentPage || 0;
    const slice = filtrados.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).filter((x) => x.est);
    if (!slice.length) {
      await interaction.editReply({ content: 'Nada com cartas nesta página para publicar.' }).catch(() => {});
      return;
    }
    const notifier = require('./notifier');
    let pub = 0;
    // feedback no ephemeral
    await interaction.editReply({ content: `📤 A publicar ${slice.length} jogo(s) desta página…` }).catch(() => {});
    for (const a of slice) {
      const url = `https://store.steampowered.com/app/${a.appid}`;
      const detalhe = {
        preco_final_texto: a.preco_final_texto,
        preco_final_cent: a.preco_final_cent,
        nCartas: a.est.nCartas,
        mediaCent: a.est.mediaCent,
        drops: a.est.drops,
        retornoCent: a.est.retornoCent,
        vendaSeguraCent: a.est.vendaSeguraCent,
        lucroPct: a.est.lucroPct,
        nivel: a.nivel,
      };
      const env = await notifier.publicarPromoCartas({ ...a, url }, detalhe, {});
      if (env) {
        try {
          db.anuncioGuardar(a.appid, a.nome, env.canalId, env.mensagemId, a.preco_original, 'cartas', JSON.stringify(detalhe));
        } catch {}
        pub++;
      }
      await new Promise((r) => setTimeout(r, 1300));
    }
    await interaction.editReply({ content: `✅ Publiquei ${pub}/${slice.length} jogo(s) desta página no canal.` }).catch(() => {});
    return;
  }
}

async function responderHelp(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COR.azul)
    .setTitle('🎁 Bot de jogos grátis — ajuda')
    .setDescription(
      [
        '**O que faço:** vigio a loja Steam e publico aqui duas coisas:',
        '🎁 **Jogos que estavam pagos e estão a 100% de graça** — resgatas e ficam para sempre na biblioteca (qualquer valor).',
        '🃏 **Jogos baratos ≤3€ com cartas** — compras, idlas 2-3h e vendes as cartas (ciclo infinito ♻️).',
        '',
        '**Não repito ofertas:** cada jogo só é anunciado uma vez. Quando a promoção acaba, **apago a mensagem** automaticamente.',
        '',
        '**Comandos:**',
        '• `/ofertas` — promoções ativas + histórico recente',
        '• `/status` — estado do bot',
        '• `/cartas [nivel] [limite] [publicar]` — lista interactiva: carrega nos botões para filtrar por 🟢/🟡/🔴 sem spam',
        '',
        '**Admin:** `/verificar` — força uma verificação imediata',
        '',
        `Ciclo automático: cada ${fmtDuracao(config.oferta.intervalMin)}.`,
        '',
        '♻️ **Ciclo infinito:** mesmo sem lucro direto, ficas com jogo + cartas + nível Steam — vendes e financias o próximo. Filtra por nível para escolher.',
      ].join('\n'),
    );
  await interaction.editReply({ embeds: [embed] });
}

const handlers = {
  status: responderStatus,
  ofertas: responderOfertas,
  verificar: responderVerificar,
  cartas: responderCartas,
  help: responderHelp,
};

async function handleInteraction(interaction) {
  // Botões / selects da vista /cartas — Só visíveis para quem invocou (ephemeral)
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('cartas:')) {
      try {
        await handleCartasButton(interaction);
      } catch (err) {
        logger.error(`Botão /cartas falhou: ${err.message}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ Erro: ${err.message}`, ephemeral: true }).catch(() => {});
        } else {
          await interaction.followUp({ content: `❌ Erro: ${err.message}`, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const h = handlers[interaction.commandName];
  if (!h) return;
  // /cartas é PRIVADO (ephemeral) — só quem pediu vê, não spamma o canal. Outros comandos ficam públicos.
  const isPrivate = interaction.commandName === 'cartas';
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(isPrivate ? { ephemeral: true } : {}).catch(() => {});
  }
  try {
    await h(interaction);
  } catch (err) {
    logger.error(`Comando /${interaction.commandName} falhou: ${err.message}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `❌ Erro: ${err.message}` }).catch(() => {});
    } else {
      await interaction.reply({ content: `❌ Erro: ${err.message}`, ephemeral: isPrivate }).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };
