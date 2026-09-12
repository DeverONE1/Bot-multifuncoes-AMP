require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Preencha DISCORD_TOKEN e CLIENT_ID no arquivo .env');
  process.exit(1);
}

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'store.json');
fs.mkdirSync(dataDir, { recursive: true });

const defaultGuild = () => ({
  welcomeChannel: null,
  leaveChannel: null,
  autoRole: null,
  logChannel: null,
  ticketCategory: null,
  ticketStaffRole: null,
  applicationChannel: null,
  automod: { links: false, spam: true, words: [] },
  users: {},
  products: {},
  giveaways: {},
  daily: {}
});

let db = {};
try {
  db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
} catch {
  db = {};
}

function save() {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function getGuild(id) {
  if (!id) return null;
  if (!db[id]) db[id] = defaultGuild();
  const g = db[id];
  g.users ||= {};
  g.products ||= {};
  g.giveaways ||= {};
  g.daily ||= {};
  g.automod ||= { links: false, spam: true, words: [] };
  return g;
}

function getUser(g, id) {
  if (!g.users[id]) {
    g.users[id] = { xp: 0, level: 1, messages: 0, balance: 0 };
  }
  return g.users[id];
}

function levelFor(xp) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)));
}

function staff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

async function writeLog(guild, title, text) {
  const g = getGuild(guild?.id);
  if (!g?.logChannel) return;
  const channel = guild.channels.cache.get(g.logChannel);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(text).setTimestamp()]
  }).catch(() => {});
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Mostra a latência do bot.'),
  new SlashCommandBuilder().setName('ajuda').setDescription('Mostra os comandos disponíveis.'),
  new SlashCommandBuilder().setName('servidor').setDescription('Mostra informações do servidor.'),
  new SlashCommandBuilder().setName('usuario').setDescription('Mostra informações de um usuário.')
    .addUserOption(o => o.setName('membro').setDescription('Usuário')),
  new SlashCommandBuilder().setName('limpar').setDescription('Apaga mensagens.')
    .addIntegerOption(o => o.setName('quantidade').setDescription('1 a 100').setMinValue(1).setMaxValue(100).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro.')
    .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro.')
    .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.')
    .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('timeout').setDescription('Aplica timeout.')
    .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
    .addIntegerOption(o => o.setName('minutos').setDescription('1 a 40320').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('lock').setDescription('Bloqueia o canal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Desbloqueia o canal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('slowmode').setDescription('Define o slowmode.')
    .addIntegerOption(o => o.setName('segundos').setDescription('0 a 21600').setMinValue(0).setMaxValue(21600).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('say').setDescription('Envia uma mensagem.')
    .addStringOption(o => o.setName('texto').setDescription('Texto').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('setup').setDescription('Configura os sistemas.')
    .addSubcommand(s => s.setName('welcome').setDescription('Canal de entrada').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('leave').setDescription('Canal de saída').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('autorole').setDescription('Cargo automático').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)))
    .addSubcommand(s => s.setName('logs').setDescription('Canal de logs').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('ticket').setDescription('Categoria e equipe').addChannelOption(o => o.setName('categoria').setDescription('Categoria').addChannelTypes(ChannelType.GuildCategory).setRequired(true)).addRoleOption(o => o.setName('equipe').setDescription('Cargo da equipe').setRequired(true)))
    .addSubcommand(s => s.setName('automod').setDescription('Configura bloqueio de links').addBooleanOption(o => o.setName('links').setDescription('Bloquear links').setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Sistema de tickets.')
    .addSubcommand(s => s.setName('painel').setDescription('Envia o painel'))
    .addSubcommand(s => s.setName('fechar').setDescription('Fecha este ticket')),
  new SlashCommandBuilder().setName('sorteio').setDescription('Cria um sorteio.')
    .addIntegerOption(o => o.setName('minutos').setDescription('Duração').setMinValue(1).setRequired(true))
    .addIntegerOption(o => o.setName('vencedores').setDescription('1 a 10').setMinValue(1).setMaxValue(10).setRequired(true))
    .addStringOption(o => o.setName('premio').setDescription('Prêmio').setRequired(true)),
  new SlashCommandBuilder().setName('cargo').setDescription('Cria um botão de cargo.')
    .addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true))
    .addStringOption(o => o.setName('texto').setDescription('Texto do botão').setRequired(true)),
  new SlashCommandBuilder().setName('aplicacao').setDescription('Cria um formulário de aplicação.')
    .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)),
  new SlashCommandBuilder().setName('perfil').setDescription('Mostra seu perfil.'),
  new SlashCommandBuilder().setName('saldo').setDescription('Mostra seu saldo.'),
  new SlashCommandBuilder().setName('daily').setDescription('Recebe a recompensa diária.'),
  new SlashCommandBuilder().setName('work').setDescription('Trabalha e recebe moedas.'),
  new SlashCommandBuilder().setName('pagar').setDescription('Transfere moedas.')
    .addUserOption(o => o.setName('membro').setDescription('Destino').setRequired(true))
    .addIntegerOption(o => o.setName('quantia').setDescription('Valor').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de XP.'),
  new SlashCommandBuilder().setName('produto').setDescription('Gerencia produtos.')
    .addSubcommand(s => s.setName('criar').setDescription('Cria produto')
      .addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true))
      .addIntegerOption(o => o.setName('preco').setDescription('Preço').setMinValue(0).setRequired(true))
      .addIntegerOption(o => o.setName('estoque').setDescription('Estoque').setMinValue(0).setRequired(true))
      .addStringOption(o => o.setName('entrega').setDescription('Texto entregue por DM').setRequired(true)))
    .addSubcommand(s => s.setName('lista').setDescription('Lista produtos')),
  new SlashCommandBuilder().setName('comprar').setDescription('Compra um produto.')
    .addStringOption(o => o.setName('produto').setDescription('Nome').setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Comandos registrados: ${commands.length}`);
}

client.once(Events.ClientReady, ready => {
  console.log(`Online como ${ready.user.tag} em ${ready.guilds.cache.size} servidor(es).`);
});

client.on(Events.GuildMemberAdd, async member => {
  const g = getGuild(member.guild.id);
  if (g?.autoRole) await member.roles.add(g.autoRole).catch(() => {});
  if (g?.welcomeChannel) await member.guild.channels.cache.get(g.welcomeChannel)?.send(`👋 Bem-vindo(a), ${member}!`).catch(() => {});
});

client.on(Events.GuildMemberRemove, async member => {
  const g = getGuild(member.guild.id);
  if (g?.leaveChannel) await member.guild.channels.cache.get(g.leaveChannel)?.send(`👋 **${member.user.username}** saiu do servidor.`).catch(() => {});
});

const spam = new Map();

client.on(Events.MessageCreate, async message => {
  if (!message.inGuild() || message.author.bot) return;

  const g = getGuild(message.guild.id);
  const u = getUser(g, message.author.id);
  const oldLevel = u.level;
  u.messages += 1;
  u.xp += Math.floor(Math.random() * 8) + 8;
  u.level = levelFor(u.xp);

  if (u.level > oldLevel) {
    await message.channel.send(`🎉 ${message.author}, você chegou ao nível **${u.level}**!`).catch(() => {});
  }

  if (g.automod.links && /(https?:\/\/|www\.|discord\.gg\/)/i.test(message.content) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => {});
    return;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const list = (spam.get(key) || []).filter(t => now - t < 7000);
  list.push(now);
  spam.set(key, list);

  if (g.automod.spam && list.length >= 7 && message.member.moderatable) {
    await message.member.timeout(60_000, 'AutoMod: spam').catch(() => {});
    await writeLog(message.guild, 'AutoMod', `${message.author} recebeu timeout por spam.`);
    spam.delete(key);
  }

  save();
});

async function openTicket(interaction) {
  const g = getGuild(interaction.guild.id);
  const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`);
  if (existing) return interaction.reply({ content: `Você já possui um ticket: ${existing}`, ephemeral: true });

  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ];

  if (g.ticketStaffRole) {
    overwrites.push({ id: g.ticketStaffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.id}`,
    type: ChannelType.GuildText,
    parent: g.ticketCategory || undefined,
    permissionOverwrites: overwrites
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `${interaction.user} seu atendimento começou.`, components: [row] });
  await interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true });
  await writeLog(interaction.guild, 'Ticket aberto', `${interaction.user} abriu ${channel}.`);
}

async function startGiveaway(interaction) {
  const minutes = interaction.options.getInteger('minutos');
  const winners = interaction.options.getInteger('vencedores');
  const prize = interaction.options.getString('premio');
  const end = Date.now() + minutes * 60_000;

  const message = await interaction.channel.send({
    embeds: [new EmbedBuilder().setTitle('🎉 Sorteio').setDescription(`Prêmio: **${prize}**\nVencedores: **${winners}**\nTermina <t:${Math.floor(end / 1000)}:R>`).setTimestamp(end)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participar').setStyle(ButtonStyle.Success))]
  });

  getGuild(interaction.guild.id).giveaways[message.id] = {
    channelId: interaction.channel.id,
    prize,
    winners,
    end,
    users: []
  };
  save();

  await interaction.reply({ content: 'Sorteio criado.', ephemeral: true });
  setTimeout(() => finishGiveaway(interaction.guild.id, message.id), minutes * 60_000);
}

async function finishGiveaway(guildId, messageId) {
  const g = getGuild(guildId);
  const data = g?.giveaways?.[messageId];
  if (!data) return;

  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(data.channelId);
  if (!channel) return;

  const pool = [...new Set(data.users)];
  const winners = [];
  while (winners.length < Math.min(data.winners, pool.length)) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }

  await channel.send(`🎉 Sorteio encerrado! Prêmio **${data.prize}** — ${winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'ninguém participou.'}`);
  delete g.giveaways[messageId];
  save();
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    if (!interaction.inGuild()) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Este recurso só pode ser usado dentro de um servidor.', ephemeral: true });
      }
      return;
    }

    const guild = interaction.guild;
    const g = getGuild(guild.id);

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_open') return openTicket(interaction);

      if (interaction.customId === 'ticket_close') {
        await interaction.reply('🔒 Fechando ticket...');
        await writeLog(guild, 'Ticket fechado', `${interaction.user} fechou ${interaction.channel}.`);
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 1000);
        return;
      }

      if (interaction.customId === 'giveaway_join') {
        const giveaway = g.giveaways[interaction.message.id];
        if (!giveaway) return interaction.reply({ content: 'Esse sorteio já terminou.', ephemeral: true });
        if (!giveaway.users.includes(interaction.user.id)) giveaway.users.push(interaction.user.id);
        save();
        return interaction.reply({ content: 'Você entrou no sorteio.', ephemeral: true });
      }

      if (interaction.customId.startsWith('role_')) {
        const roleId = interaction.customId.slice(5);
        const role = guild.roles.cache.get(roleId);
        if (!role) return interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });
        if (role.position >= guild.members.me.roles.highest.position) return interaction.reply({ content: 'Meu cargo precisa estar acima desse cargo.', ephemeral: true });
        const member = interaction.member;
        const has = member.roles.cache.has(roleId);
        await member.roles[has ? 'remove' : 'add'](role);
        return interaction.reply({ content: has ? `Cargo removido: ${role}` : `Cargo adicionado: ${role}`, ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId !== 'application_modal') return;
      const channel = g.applicationChannel ? guild.channels.cache.get(g.applicationChannel) : interaction.channel;
      const nome = interaction.fields.getTextInputValue('nome');
      const resposta = interaction.fields.getTextInputValue('resposta');

      await channel?.send({
        embeds: [new EmbedBuilder().setTitle('📋 Nova aplicação').addFields(
          { name: 'Usuário', value: `${interaction.user}` },
          { name: 'Nome', value: nome },
          { name: 'Resposta', value: resposta }
        ).setTimestamp()]
      }).catch(() => {});

      return interaction.reply({ content: 'Aplicação enviada.', ephemeral: true });
    }

    const cmd = interaction.commandName;

    if (cmd === 'ping') return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);

    if (cmd === 'ajuda') {
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🤖 AMP').setDescription(
        '**Moderação:** `/warn` `/kick` `/ban` `/timeout` `/limpar` `/lock` `/unlock` `/slowmode`\n' +
        '**Servidor:** `/setup` `/ticket` `/sorteio` `/cargo` `/aplicacao`\n' +
        '**Economia:** `/perfil` `/saldo` `/daily` `/work` `/pagar` `/ranking` `/produto` `/comprar`'
      )] });
    }

    if (cmd === 'servidor') {
      const embed = new EmbedBuilder().setTitle(`📊 ${guild.name}`).addFields(
        { name: 'Membros', value: `${guild.memberCount}`, inline: true },
        { name: 'Canais', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'ID', value: guild.id, inline: true }
      );
      if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ size: 256 }));
      return interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'usuario') {
      const user = interaction.options.getUser('membro') || interaction.user;
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields(
        { name: 'ID', value: user.id },
        { name: 'Conta criada', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` }
      )] });
    }

    if (cmd === 'limpar') {
      const n = interaction.options.getInteger('quantidade');
      const deleted = await interaction.channel.bulkDelete(n, true);
      return interaction.reply({ content: `🧹 ${deleted.size} mensagens removidas.`, ephemeral: true });
    }

    if (cmd === 'warn') {
      const member = interaction.options.getMember('membro');
      const reason = interaction.options.getString('motivo');
      if (!member) return interaction.reply({ content: 'Membro não encontrado.', ephemeral: true });
      await writeLog(guild, 'Warn', `${interaction.user} advertiu ${member} — ${reason}`);
      return interaction.reply(`⚠️ ${member} advertido. Motivo: ${reason}`);
    }

    if (cmd === 'kick') {
      const member = interaction.options.getMember('membro');
      const reason = interaction.options.getString('motivo') || 'Sem motivo';
      if (!member?.kickable) return interaction.reply({ content: 'Não consigo expulsar esse membro.', ephemeral: true });
      await member.kick(reason);
      await writeLog(guild, 'Kick', `${interaction.user} expulsou ${member.user.tag} — ${reason}`);
      return interaction.reply(`👢 ${member.user.tag} foi expulso.`);
    }

    if (cmd === 'ban') {
      const member = interaction.options.getMember('membro');
      const reason = interaction.options.getString('motivo') || 'Sem motivo';
      if (!member?.bannable) return interaction.reply({ content: 'Não consigo banir esse membro.', ephemeral: true });
      await member.ban({ reason });
      await writeLog(guild, 'Ban', `${interaction.user} baniu ${member.user.tag} — ${reason}`);
      return interaction.reply(`🔨 ${member.user.tag} foi banido.`);
    }

    if (cmd === 'timeout') {
      const member = interaction.options.getMember('membro');
      const minutes = interaction.options.getInteger('minutos');
      const reason = interaction.options.getString('motivo') || 'Sem motivo';
      if (!member?.moderatable) return interaction.reply({ content: 'Não consigo aplicar timeout.', ephemeral: true });
      await member.timeout(minutes * 60_000, reason);
      await writeLog(guild, 'Timeout', `${interaction.user} aplicou ${minutes}min em ${member} — ${reason}`);
      return interaction.reply(`⏳ ${member} recebeu timeout por ${minutes} minuto(s).`);
    }

    if (cmd === 'lock' || cmd === 'unlock') {
      const open = cmd === 'unlock';
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: open });
      return interaction.reply(open ? '🔓 Canal desbloqueado.' : '🔒 Canal bloqueado.');
    }

    if (cmd === 'slowmode') {
      const seconds = interaction.options.getInteger('segundos');
      await interaction.channel.setRateLimitPerUser(seconds);
      return interaction.reply(`🐢 Slowmode: ${seconds}s.`);
    }

    if (cmd === 'say') {
      await interaction.channel.send(interaction.options.getString('texto'));
      return interaction.reply({ content: 'Enviado.', ephemeral: true });
    }

    if (cmd === 'setup') {
      if (!staff(interaction)) return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
      const sub = interaction.options.getSubcommand();
      if (sub === 'welcome') g.welcomeChannel = interaction.options.getChannel('canal').id;
      if (sub === 'leave') g.leaveChannel = interaction.options.getChannel('canal').id;
      if (sub === 'autorole') g.autoRole = interaction.options.getRole('cargo').id;
      if (sub === 'logs') g.logChannel = interaction.options.getChannel('canal').id;
      if (sub === 'ticket') {
        g.ticketCategory = interaction.options.getChannel('categoria').id;
        g.ticketStaffRole = interaction.options.getRole('equipe').id;
      }
      if (sub === 'automod') g.automod.links = interaction.options.getBoolean('links');
      save();
      return interaction.reply(`✅ Configuração **${sub}** salva.`);
    }

    if (cmd === 'ticket') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'painel') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_open').setLabel('Abrir atendimento').setEmoji('🎫').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎫 Atendimento').setDescription('Clique no botão para abrir um ticket.')], components: [row] });
      }
      if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'Use este comando dentro de um ticket.', ephemeral: true });
      await interaction.reply('🔒 Fechando ticket...');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 1000);
      return;
    }

    if (cmd === 'sorteio') return startGiveaway(interaction);

    if (cmd === 'cargo') {
      const role = interaction.options.getRole('cargo');
      if (role.position >= guild.members.me.roles.highest.position) return interaction.reply({ content: 'Meu cargo precisa estar acima do cargo escolhido.', ephemeral: true });
      const text = interaction.options.getString('texto');
      return interaction.reply({ content: `Clique para receber ${role}.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role_${role.id}`).setLabel(text).setStyle(ButtonStyle.Secondary))] });
    }

    if (cmd === 'aplicacao') {
      g.applicationChannel = interaction.channel.id;
      save();

      const modal = new ModalBuilder().setCustomId('application_modal').setTitle(interaction.options.getString('titulo'));
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('resposta').setLabel('Por que devemos aceitar você?').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );

      return interaction.showModal(modal);
    }

    if (['perfil', 'saldo', 'daily', 'work', 'pagar', 'ranking'].includes(cmd)) {
      const user = getUser(g, interaction.user.id);
      if (cmd === 'perfil') {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${interaction.user.username}`).setThumbnail(interaction.user.displayAvatarURL()).addFields(
          { name: 'Nível', value: `${user.level}`, inline: true },
          { name: 'XP', value: `${user.xp}`, inline: true },
          { name: 'Mensagens', value: `${user.messages}`, inline: true },
          { name: 'Saldo', value: `${user.balance} moedas`, inline: true }
        )] });
      }
      if (cmd === 'saldo') return interaction.reply(`💰 Seu saldo: **${user.balance} moedas**.`);
      if (cmd === 'daily') {
        const last = g.daily[interaction.user.id] || 0;
        if (Date.now() - last < 86_400_000) return interaction.reply({ content: `⏰ Você já coletou. Volte <t:${Math.floor((last + 86_400_000) / 1000)}:R>.`, ephemeral: true });
        g.daily[interaction.user.id] = Date.now();
        user.balance += 250;
        save();
        return interaction.reply('🎁 Você recebeu **250 moedas**.');
      }
      if (cmd === 'work') {
        const amount = Math.floor(Math.random() * 151) + 50;
        user.balance += amount;
        save();
        return interaction.reply(`💼 Você ganhou **${amount} moedas** trabalhando.`);
      }
      if (cmd === 'pagar') {
        const target = interaction.options.getUser('membro');
        const amount = interaction.options.getInteger('quantia');
        if (target.id === interaction.user.id) return interaction.reply({ content: 'Você não pode pagar a si mesmo.', ephemeral: true });
        if (user.balance < amount) return interaction.reply({ content: 'Saldo insuficiente.', ephemeral: true });
        const receiver = getUser(g, target.id);
        user.balance -= amount;
        receiver.balance += amount;
        save();
        return interaction.reply(`💸 Você enviou **${amount} moedas** para ${target}.`);
      }
      if (cmd === 'ranking') {
        const list = Object.entries(g.users).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
        return interaction.reply(list.length ? `🏆 **Ranking**\n${list.map((x, i) => `${i + 1}. <@${x[0]}> — nível ${x[1].level} (${x[1].xp} XP)`).join('\n')}` : 'Ainda não há dados.');
      }
    }

    if (cmd === 'produto') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'criar') {
        if (!staff(interaction)) return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
        const name = interaction.options.getString('nome');
        g.products[name.toLowerCase()] = {
          name,
          price: interaction.options.getInteger('preco'),
          stock: interaction.options.getInteger('estoque'),
          delivery: interaction.options.getString('entrega')
        };
        save();
        return interaction.reply(`✅ Produto **${name}** criado.`);
      }
      const products = Object.values(g.products);
      return interaction.reply(products.length ? products.map(p => `**${p.name}** — ${p.price} moedas — estoque: ${p.stock}`).join('\n') : 'A loja está vazia.');
    }

    if (cmd === 'comprar') {
      const key = interaction.options.getString('produto').toLowerCase();
      const product = g.products[key];
      const user = getUser(g, interaction.user.id);

      if (!product) return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true });
      if (product.stock <= 0) return interaction.reply({ content: 'Sem estoque.', ephemeral: true });
      if (user.balance < product.price) return interaction.reply({ content: 'Saldo insuficiente.', ephemeral: true });

      user.balance -= product.price;
      product.stock -= 1;
      save();

      await interaction.user.send(`🛒 Compra aprovada!\nProduto: **${product.name}**\nEntrega:\n${product.delivery}`).catch(() => {});
      return interaction.reply('✅ Compra aprovada. A entrega foi enviada na sua DM.');
    }
  } catch (error) {
    console.error('Erro na interação:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Ocorreu um erro ao executar o comando. Veja o console para mais detalhes.', ephemeral: true }).catch(() => {});
    }
  }
});

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(error => {
    console.error('Falha ao iniciar:', error);
    process.exit(1);
  });
