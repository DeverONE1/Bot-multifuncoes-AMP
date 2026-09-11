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
  StringSelectMenuBuilder,
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
  console.error('Configure DISCORD_TOKEN e CLIENT_ID no .env');
  process.exit(1);
}

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'store.json');
fs.mkdirSync(dataDir, { recursive: true });

const freshGuild = () => ({
  welcomeChannel: null, leaveChannel: null, autoRole: null, logChannel: null,
  ticketCategory: null, ticketStaffRole: null, applicationChannel: null,
  automod: { spam: true, links: false, words: [] },
  levels: {}, balances: {}, inventory: {}, products: {}, giveaways: {}
});

let db = {};
try { db = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { db = {}; }
const save = () => fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
const guildData = id => { if (!db[id]) db[id] = freshGuild(); return db[id]; };
const userData = (g, id) => {
  if (!g.levels[id]) g.levels[id] = { xp: 0, level: 1, messages: 0 };
  if (g.balances[id] == null) g.balances[id] = 0;
  if (!g.inventory[id]) g.inventory[id] = [];
  return g;
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rank = xp => Math.floor(Math.sqrt(xp / 100));
const log = async (guild, title, description) => {
  const g = guildData(guild.id);
  if (!g.logChannel) return;
  const ch = guild.channels.cache.get(g.logChannel);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
};
const isStaff = i => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

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
  new SlashCommandBuilder().setName('ping').setDescription('Mostra a latência.'),
  new SlashCommandBuilder().setName('ajuda').setDescription('Lista os comandos.'),
  new SlashCommandBuilder().setName('servidor').setDescription('Informações do servidor.'),
  new SlashCommandBuilder().setName('usuario').setDescription('Informações de um usuário.').addUserOption(o => o.setName('membro').setDescription('Usuário')),
  new SlashCommandBuilder().setName('limpar').setDescription('Apaga mensagens.').addIntegerOption(o => o.setName('quantidade').setDescription('1 a 100').setMinValue(1).setMaxValue(100).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('timeout').setDescription('Coloca em timeout.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('minutos').setDescription('Duração').setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('lock').setDescription('Bloqueia o canal.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Desbloqueia o canal.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('slowmode').setDescription('Define o slowmode.').addIntegerOption(o => o.setName('segundos').setDescription('0 a 21600').setMinValue(0).setMaxValue(21600).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('say').setDescription('Envia uma mensagem.').addStringOption(o => o.setName('texto').setDescription('Texto').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('setup').setDescription('Configura o bot.').addSubcommand(s => s.setName('welcome').setDescription('Define canal de entrada').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand(s => s.setName('leave').setDescription('Define canal de saída').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand(s => s.setName('autorole').setDescription('Define cargo automático').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true))).addSubcommand(s => s.setName('logs').setDescription('Define canal de logs').addChannelOption(o => o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand(s => s.setName('ticket').setDescription('Define categoria e equipe').addChannelOption(o => o.setName('categoria').setDescription('Categoria').addChannelTypes(ChannelType.GuildCategory).setRequired(true)).addRoleOption(o => o.setName('equipe').setDescription('Cargo da equipe').setRequired(true))).addSubcommand(s => s.setName('automod').setDescription('Ativa/desativa filtros').addBooleanOption(o => o.setName('links').setDescription('Bloquear links').setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Sistema de tickets.').addSubcommand(s => s.setName('painel').setDescription('Envia painel de tickets')).addSubcommand(s => s.setName('fechar').setDescription('Fecha o ticket')),
  new SlashCommandBuilder().setName('sorteio').setDescription('Cria um sorteio.').addIntegerOption(o => o.setName('minutos').setDescription('Duração').setMinValue(1).setRequired(true)).addIntegerOption(o => o.setName('vencedores').setDescription('Quantidade').setMinValue(1).setMaxValue(10).setRequired(true)).addStringOption(o => o.setName('premio').setDescription('Prêmio').setRequired(true)),
  new SlashCommandBuilder().setName('cargo').setDescription('Painel de cargo por botão.').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)).addStringOption(o => o.setName('texto').setDescription('Texto do botão').setRequired(true)),
  new SlashCommandBuilder().setName('aplicacao').setDescription('Painel de candidatura.').addStringOption(o => o.setName('titulo').setDescription('Título do formulário').setRequired(true)),
  new SlashCommandBuilder().setName('perfil').setDescription('Mostra seu perfil.'),
  new SlashCommandBuilder().setName('saldo').setDescription('Mostra seu saldo.'),
  new SlashCommandBuilder().setName('daily').setDescription('Recebe a recompensa diária.'),
  new SlashCommandBuilder().setName('work').setDescription('Trabalha e recebe moedas.'),
  new SlashCommandBuilder().setName('pagar').setDescription('Transfere moedas.').addUserOption(o => o.setName('membro').setDescription('Destino').setRequired(true)).addIntegerOption(o => o.setName('quantia').setDescription('Valor').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de nível do servidor.'),
  new SlashCommandBuilder().setName('produto').setDescription('Gerencia produtos.').addSubcommand(s => s.setName('criar').setDescription('Cria um produto').addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true)).addIntegerOption(o => o.setName('preco').setDescription('Preço em moedas').setMinValue(0).setRequired(true)).addIntegerOption(o => o.setName('estoque').setDescription('Estoque').setMinValue(0).setRequired(true)).addStringOption(o => o.setName('entrega').setDescription('Texto entregue por DM').setRequired(true))).addSubcommand(s => s.setName('lista').setDescription('Lista produtos')),
  new SlashCommandBuilder().setName('comprar').setDescription('Compra um produto da loja.').addStringOption(o => o.setName('produto').setDescription('Nome do produto').setRequired(true))
].map(x => x.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}

client.once(Events.ClientReady, c => console.log(`Online como ${c.user.tag} em ${c.guilds.cache.size} servidor(es).`));

client.on(Events.GuildMemberAdd, async member => {
  const g = guildData(member.guild.id);
  if (g.autoRole) member.roles.add(g.autoRole).catch(() => {});
  if (g.welcomeChannel) member.guild.channels.cache.get(g.welcomeChannel)?.send(`👋 Bem-vindo(a), ${member}!`).catch(() => {});
});

client.on(Events.GuildMemberRemove, member => {
  const g = guildData(member.guild.id);
  if (g.leaveChannel) member.guild.channels.cache.get(g.leaveChannel)?.send(`👋 **${member.user.username}** saiu do servidor.`).catch(() => {});
});

const spamMap = new Map();
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  const g = guildData(message.guild.id);
  userData(g, message.author.id);
  const u = g.levels[message.author.id];
  u.messages++;
  const old = u.level;
  u.xp += Math.floor(Math.random() * 8) + 8;
  u.level = Math.max(1, rank(u.xp));
  if (u.level > old) message.channel.send(`🎉 ${message.author}, você chegou ao nível **${u.level}**!`).catch(() => {});

  if (g.automod.links && /(https?:\/\/|discord\.gg\/|www\.)/i.test(message.content) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => {});
    return message.channel.send(`${message.author}, links não são permitidos aqui.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
  }
  if (g.automod.words.length && g.automod.words.some(w => message.content.toLowerCase().includes(w.toLowerCase())) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => {});
    return message.channel.send(`${message.author}, essa mensagem não pode ser enviada.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
  }
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = (spamMap.get(key) || []).filter(t => now - t < 7000);
  arr.push(now); spamMap.set(key, arr);
  if (g.automod.spam && arr.length >= 7 && message.member.moderatable) {
    await message.member.timeout(60_000, 'AutoMod: spam').catch(() => {});
    await log(message.guild, 'AutoMod', `${message.author} recebeu timeout por spam.`);
    spamMap.delete(key);
  }
  save();
});

async function makeTicket(interaction) {
  const g = guildData(interaction.guild.id);
  const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`);
  if (existing) return interaction.reply({ content: `Você já possui um ticket: ${existing}`, ephemeral: true });
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ];
  if (g.ticketStaffRole) overwrites.push({ id: g.ticketStaffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  const channel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.id}`, type: ChannelType.GuildText, parent: g.ticketCategory || undefined, permissionOverwrites: overwrites });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger));
  await channel.send({ content: `${interaction.user} seu atendimento começou.`, components: [row] });
  await interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true });
  await log(interaction.guild, 'Ticket aberto', `${interaction.user} abriu ${channel}.`);
}

async function createGiveaway(interaction) {
  const minutes = interaction.options.getInteger('minutos');
  const winners = interaction.options.getInteger('vencedores');
  const prize = interaction.options.getString('premio');
  const end = Date.now() + minutes * 60_000;
  const msg = await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('🎉 Sorteio').setDescription(`Prêmio: **${prize}**\nVencedores: **${winners}**\nTermina <t:${Math.floor(end / 1000)}:R>`).setTimestamp(end)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participar').setStyle(ButtonStyle.Success))] });
  guildData(interaction.guild.id).giveaways[msg.id] = { channel: interaction.channel.id, prize, winners, end, users: [] };
  save();
  await interaction.reply({ content: 'Sorteio criado.', ephemeral: true });
  setTimeout(() => finishGiveaway(interaction.guild.id, msg.id), minutes * 60_000);
}
async function finishGiveaway(guildId, messageId) {
  const g = guildData(guildId); const data = g.giveaways[messageId]; if (!data) return;
  const guild = client.guilds.cache.get(guildId); const channel = guild?.channels.cache.get(data.channel); if (!channel) return;
  const pool = [...new Set(data.users)]; const chosen = [];
  while (chosen.length < Math.min(data.winners, pool.length)) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  channel.send(`🎉 Sorteio encerrado! Prêmio **${data.prize}** — ${chosen.length ? chosen.map(x => `<@${x}>`).join(', ') : 'ninguém participou.'}`);
  delete g.giveaways[messageId]; save();
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_open') return makeTicket(interaction);
      if (interaction.customId === 'ticket_close') {
        await interaction.reply('🔒 Fechando ticket...');
        await log(interaction.guild, 'Ticket fechado', `${interaction.user} fechou ${interaction.channel}.`);
        return setTimeout(() => interaction.channel.delete().catch(() => {}), 1500);
      }
      if (interaction.customId === 'giveaway_join') {
        const g = guildData(interaction.guild.id); const data = g.giveaways[interaction.message.id];
        if (!data) return interaction.reply({ content: 'Esse sorteio já terminou.', ephemeral: true });
        if (!data.users.includes(interaction.user.id)) data.users.push(interaction.user.id); save();
        return interaction.reply({ content: 'Você entrou no sorteio.', ephemeral: true });
      }
      if (interaction.customId.startsWith('role_')) {
        const roleId = interaction.customId.slice(5); const role = interaction.guild.roles.cache.get(roleId); if (!role) return interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });
        const member = interaction.member;
        const has = member.roles.cache.has(roleId);
        await member.roles[has ? 'remove' : 'add'](role).catch(() => {});
        return interaction.reply({ content: has ? `Cargo removido: ${role}` : `Cargo adicionado: ${role}`, ephemeral: true });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'application_modal') {
      const g = guildData(interaction.guild.id); const ch = g.applicationChannel ? interaction.guild.channels.cache.get(g.applicationChannel) : interaction.channel;
      const nome = interaction.fields.getTextInputValue('nome'); const resposta = interaction.fields.getTextInputValue('resposta');
      if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('📋 Nova aplicação').addFields({ name: 'Usuário', value: `${interaction.user}` }, { name: 'Nome', value: nome }, { name: 'Resposta', value: resposta }).setTimestamp()] });
      return interaction.reply({ content: 'Aplicação enviada.', ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;
    const g = guildData(guild.id);
    const cmd = interaction.commandName;

    if (cmd === 'ping') return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);
    if (cmd === 'ajuda') return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🤖 AMP').setDescription('`/setup` · `/ticket` · `/sorteio` · `/cargo` · `/aplicacao` · `/perfil` · `/saldo` · `/daily` · `/work` · `/ranking` · `/produto` · `/comprar`\n\nModeração: `/warn` `/kick` `/ban` `/timeout` `/limpar` `/lock` `/unlock` `/slowmode` `/say`')] });
    if (cmd === 'servidor') return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📊 ${guild.name}`).setThumbnail(guild.iconURL({ size: 256 }) || null).addFields({ name: 'Membros', value: `${guild.memberCount}`, inline: true }, { name: 'Canais', value: `${guild.channels.cache.size}`, inline: true }, { name: 'ID', value: guild.id, inline: true })] });
    if (cmd === 'usuario') { const u = interaction.options.getUser('membro') || interaction.user; return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${u.username}`).setThumbnail(u.displayAvatarURL()).addFields({ name: 'ID', value: u.id }, { name: 'Conta', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:F>` })] }); }
    if (cmd === 'limpar') { const n = interaction.options.getInteger('quantidade'); const deleted = await interaction.channel.bulkDelete(n, true); return interaction.reply({ content: `🧹 ${deleted.size} mensagens removidas.`, ephemeral: true }); }
    if (cmd === 'warn') { const m = interaction.options.getMember('membro'); const reason = interaction.options.getString('motivo'); if (!m) return interaction.reply({ content: 'Membro não encontrado.', ephemeral: true }); await log(guild, 'Warn', `${interaction.user} advertiu ${m} — ${reason}`); return interaction.reply(`⚠️ ${m} advertido. Motivo: ${reason}`); }
    if (cmd === 'kick') { const m = interaction.options.getMember('membro'); if (!m?.kickable) return interaction.reply({ content: 'Não consigo expulsar esse membro.', ephemeral: true }); const reason = interaction.options.getString('motivo') || 'Sem motivo'; await m.kick(reason); await log(guild, 'Kick', `${interaction.user} expulsou ${m.user.tag} — ${reason}`); return interaction.reply(`👢 ${m.user.tag} foi expulso.`); }
    if (cmd === 'ban') { const m = interaction.options.getMember('membro'); if (!m?.bannable) return interaction.reply({ content: 'Não consigo banir esse membro.', ephemeral: true }); const reason = interaction.options.getString('motivo') || 'Sem motivo'; await m.ban({ reason }); await log(guild, 'Ban', `${interaction.user} baniu ${m.user.tag} — ${reason}`); return interaction.reply(`🔨 ${m.user.tag} foi banido.`); }
    if (cmd === 'timeout') { const m = interaction.options.getMember('membro'); if (!m?.moderatable) return interaction.reply({ content: 'Não consigo aplicar timeout.', ephemeral: true }); const min = interaction.options.getInteger('minutos'); const reason = interaction.options.getString('motivo') || 'Sem motivo'; await m.timeout(min * 60_000, reason); await log(guild, 'Timeout', `${interaction.user} aplicou ${min}min em ${m} — ${reason}`); return interaction.reply(`⏳ ${m} recebeu timeout por ${min} minuto(s).`); }
    if (cmd === 'lock' || cmd === 'unlock') { const allow = cmd === 'unlock'; await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: allow }); return interaction.reply(allow ? '🔓 Canal desbloqueado.' : '🔒 Canal bloqueado.'); }
    if (cmd === 'slowmode') { const sec = interaction.options.getInteger('segundos'); await interaction.channel.setRateLimitPerUser(sec); return interaction.reply(`🐢 Slowmode: ${sec}s.`); }
    if (cmd === 'say') { await interaction.channel.send(interaction.options.getString('texto')); return interaction.reply({ content: 'Enviado.', ephemeral: true }); }

    if (cmd === 'setup') {
      if (!isStaff(interaction)) return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
      const sub = interaction.options.getSubcommand();
      if (sub === 'welcome') g.welcomeChannel = interaction.options.getChannel('canal').id;
      if (sub === 'leave') g.leaveChannel = interaction.options.getChannel('canal').id;
      if (sub === 'autorole') g.autoRole = interaction.options.getRole('cargo').id;
      if (sub === 'logs') g.logChannel = interaction.options.getChannel('canal').id;
      if (sub === 'ticket') { g.ticketCategory = interaction.options.getChannel('categoria').id; g.ticketStaffRole = interaction.options.getRole('equipe').id; }
      if (sub === 'automod') g.automod.links = interaction.options.getBoolean('links');
      save(); return interaction.reply(`✅ Configuração **${sub}** salva.`);
    }

    if (cmd === 'ticket') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'painel') { const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_open').setLabel('Abrir atendimento').setEmoji('🎫').setStyle(ButtonStyle.Primary)); return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎫 Atendimento').setDescription('Clique no botão para abrir um ticket.')], components: [row] }); }
      if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'Use este comando dentro de um ticket.', ephemeral: true });
      await interaction.reply('🔒 Fechando ticket...'); return setTimeout(() => interaction.channel.delete().catch(() => {}), 1000);
    }

    if (cmd === 'sorteio') return createGiveaway(interaction);
    if (cmd === 'cargo') { const role = interaction.options.getRole('cargo'); const texto = interaction.options.getString('texto'); return interaction.reply({ content: `Clique para receber ${role}.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role_${role.id}`).setLabel(texto).setStyle(ButtonStyle.Secondary))] }); }
    if (cmd === 'aplicacao') { g.applicationChannel = interaction.channel.id; save(); const modal = new ModalBuilder().setCustomId('application_modal').setTitle(interaction.options.getString('titulo')); modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('resposta').setLabel('Por que devemos aceitar você?').setStyle(TextInputStyle.Paragraph).setRequired(true))); return interaction.reply({ content: 'Painel criado. Abra o formulário abaixo para enviar sua candidatura.', ephemeral: true }); }

    if (['perfil', 'saldo', 'daily', 'work', 'pagar', 'ranking'].includes(cmd)) {
      userData(g, interaction.user.id);
      const now = Date.now();
      if (cmd === 'perfil') { const u = g.levels[interaction.user.id]; return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${interaction.user.username}`).setThumbnail(interaction.user.displayAvatarURL()).addFields({ name: 'Nível', value: `${u.level}`, inline: true }, { name: 'XP', value: `${u.xp}`, inline: true }, { name: 'Mensagens', value: `${u.messages}`, inline: true }, { name: 'Saldo', value: `${g.balances[interaction.user.id]} moedas`, inline: true })] }); }
      if (cmd === 'saldo') return interaction.reply(`💰 Você tem **${g.balances[interaction.user.id]}** moedas.`);
      if (cmd === 'daily') { const key = `daily_${interaction.user.id}`; const last = g.daily?.[interaction.user.id] || 0; if (!g.daily) g.daily = {}; if (now - last < 86_400_000) return interaction.reply({ content: `⏰ Você já coletou. Volte <t:${Math.floor((last + 86_400_000) / 1000)}:R>.`, ephemeral: true }); g.daily[interaction.user.id] = now; g.balances[interaction.user.id] += 250; save(); return interaction.reply('🎁 Daily: +250 moedas.'); }
      if (cmd === 'work') { const value = Math.floor(Math.random() * 151) + 50; g.balances[interaction.user.id] += value; save(); return interaction.reply(`💼 Você trabalhou e ganhou **${value}** moedas.`); }
      if (cmd === 'pagar') { const to = interaction.options.getUser('membro'); const amount = interaction.options.getInteger('quantia'); userData(g, to.id); if (amount > g.balances[interaction.user.id]) return interaction.reply({ content: 'Saldo insuficiente.', ephemeral: true }); if (to.id === interaction.user.id) return interaction.reply({ content: 'Você não pode pagar a si mesmo.', ephemeral: true }); g.balances[interaction.user.id] -= amount; g.balances[to.id] += amount; save(); return interaction.reply(`💸 ${interaction.user} enviou **${amount}** moedas para ${to}.`); }
      if (cmd === 'ranking') { const list = Object.entries(g.levels).sort((a,b) => b[1].xp - a[1].xp).slice(0, 10); return interaction.reply(list.length ? `🏆 **Ranking**\n${list.map((x,i) => `${i + 1}. <@${x[0]}> — nível ${x[1].level} (${x[1].xp} XP)`).join('\n')}` : 'Ainda não há dados.'); }
    }

    if (cmd === 'produto') {
      if (!g.products) g.products = {};
      const sub = interaction.options.getSubcommand();
      if (sub === 'criar') { if (!isStaff(interaction)) return interaction.reply({ content: 'Sem permissão.', ephemeral: true }); const name = interaction.options.getString('nome'); g.products[name.toLowerCase()] = { name, price: interaction.options.getInteger('preco'), stock: interaction.options.getInteger('estoque'), delivery: interaction.options.getString('entrega') }; save(); return interaction.reply(`✅ Produto **${name}** criado.`); }
      const entries = Object.values(g.products); return interaction.reply(entries.length ? entries.map(p => `**${p.name}** — ${p.price} moedas — estoque: ${p.stock}`).join('\n') : 'A loja está vazia.');
    }
    if (cmd === 'comprar') {
      const key = interaction.options.getString('produto').toLowerCase(); const p = g.products[key]; if (!p) return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true }); userData(g, interaction.user.id); if (p.stock <= 0) return interaction.reply({ content: 'Sem estoque.', ephemeral: true }); if (g.balances[interaction.user.id] < p.price) return interaction.reply({ content: 'Saldo insuficiente.', ephemeral: true }); g.balances[interaction.user.id] -= p.price; p.stock--; g.inventory[interaction.user.id].push(p.name); save(); await interaction.user.send(`🛒 Compra aprovada!\nProduto: **${p.name}**\nEntrega:\n${p.delivery}`).catch(() => {}); return interaction.reply('✅ Compra aprovada. A entrega foi enviada na sua DM.');
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) interaction.reply({ content: 'Ocorreu um erro ao executar o comando.', ephemeral: true }).catch(() => {});
  }
});

registerCommands().then(() => client.login(TOKEN)).catch(err => { console.error(err); process.exit(1); });
