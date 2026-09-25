const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Estado do bot e da última verificação de ofertas'),

  new SlashCommandBuilder()
    .setName('ofertas')
    .setDescription('Ofertas de jogos grátis (100% off) ativas e recentes'),

  new SlashCommandBuilder()
    .setName('verificar')
    .setDescription('⚙️ Força uma verificação de ofertas agora (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('help').setDescription('Como usar o bot de jogos grátis'),

  new SlashCommandBuilder()
    .setName('cartas')
    .setDescription('🃏 Lista jogos baratos com cartas — porquê comprar/idlar (ciclo infinito)')
    .addStringOption((o) =>
      o
        .setName('nivel')
        .setDescription('Filtra por confiança/custo')
        .addChoices(
          { name: 'Todos (com cartas)', value: 'todos' },
          { name: '🟢 Baixo — Barato p/ cartas', value: 'baixo' },
          { name: '🟡 Médio — Ela por ela', value: 'medio' },
          { name: '🔴 Alto — Caro p/ cartas', value: 'alto' },
          { name: 'Sem cartas', value: 'sem' },
        ),
    )
    .addIntegerOption((o) =>
      o.setName('limite').setDescription('Quantos listar (1-25, padrão 15)').setMinValue(1).setMaxValue(25),
    )
    .addBooleanOption((o) =>
      o.setName('publicar').setDescription('⚙️ Publica os listados como mensagens (admin)'),
    ),
].map((c) => c.toJSON());

module.exports = { commands };
