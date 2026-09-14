require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  REST, Routes, SlashCommandBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
if (!TOKEN || !CLIENT_ID) throw new Error('Configure DISCORD_TOKEN e CLIENT_ID no .env');

const DATA = path.join(process.cwd(), 'data');
const DB = path.join(DATA, 'store.json');
const TRANSCRIPTS = path.join(DATA, 'transcripts');
fs.mkdirSync(TRANSCRIPTS, { recursive: true });

const freshGuild = () => ({
  brand: { name: 'AMP', color: '#5865F2', footer: 'AMP • Multifuncional' },
  logs: { enabled: false, channelId: null },
  welcome: { enabled: false, channelId: null, message: '👋 Bem-vindo(a), {user}!' },
  leave: { enabled: false, channelId: null, message: '👋 {username} saiu do servidor.' },
  autorole: { enabled: false, roleId: null },
  verification: { enabled: false, channelId: null, roleId: null },
  tickets: { categoryId: null, staffRoleId: null, transcriptChannelId: null, panels: {}, counter: 0 },
  automod: { links: false, invites: false, spam: true, words: [], maxMentions: 5 },
  antiraid: { enabled: false, threshold: 6, window: 10, lock: true, timeout: 600, active: false, joins: [] },
  trap: { channelId: null, enabled: false },
  store: {
    enabled: false, orderCategoryId: null, staffRoleId: null, reviewChannelId: null,
    pixKey: '', pixName: '', pixNote: 'Faça o PIX e envie o comprovante aqui. A equipe confirma manualmente.',
    deliveryDM: true
  },
  products: {}, carts: {}, orders: {}, coupons: {}, affiliates: {}, reviews: [],
  stats: { sales: 0, revenue: 0, tickets: 0, verified: 0 }, users: {}
});

let db = {};
try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { db = {}; }
const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 2));
function gdata(id) {
  if (!id) return null;
  if (!db[id]) db[id] = freshGuild();
  const base = freshGuild();
  for (const k of Object.keys(base)) if (db[id][k] === undefined) db[id][k] = base[k];
  return db[id];
}
function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`; }
function money(v) { return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`; }
function isStaff(i, g) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (g.store.staffRoleId && i.member?.roles?.cache?.has(g.store.staffRoleId)) return true;
  if (g.tickets.staffRoleId && i.member?.roles?.cache?.has(g.tickets.staffRoleId)) return true;
  return false;
}
async function log(guild, title, desc, fields = []) {
  const g = gdata(guild.id); if (!g.logs.enabled || !g.logs.channelId) return;
  const ch = guild.channels.cache.get(g.logs.channelId); if (!ch?.isTextBased()) return;
  const e = new EmbedBuilder().setTitle(title).setDescription(desc).addFields(fields).setColor(g.brand.color).setFooter({ text: g.brand.footer }).setTimestamp();
  await ch.send({ embeds: [e] }).catch(() => {});
}

async function transcript(channel) {
  const all = []; let before;
  while (true) {
    const b = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!b?.size) break;
    all.push(...b.values()); if (b.size < 100) break; before = b.last().id;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const esc = x => String(x || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const rows = all.map(m => `<p><b>${esc(m.author.tag)}</b> <small>${new Date(m.createdTimestamp).toLocaleString('pt-BR')}</small><br>${esc(m.content)}${[...m.attachments.values()].map(a=>`<br><a href="${a.url}">${esc(a.name || a.url)}</a>`).join('')}</p>`).join('');
  const file = path.join(TRANSCRIPTS, `${channel.id}.html`);
  fs.writeFileSync(file, `<!doctype html><html lang="pt-br"><meta charset="utf-8"><title>${esc(channel.name)}</title><style>body{font-family:Arial;max-width:1000px;margin:30px auto}p{padding:8px 0;border-bottom:1px solid #ddd}</style><h1>${esc(channel.name)}</h1>${rows}`);
  return file;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Latência do bot.'),
  new SlashCommandBuilder().setName('ajuda').setDescription('Central de comandos.'),
  new SlashCommandBuilder().setName('setup').setDescription('Configuração rápida.')
    .addSubcommand(s=>s.setName('logs').setDescription('Canal de logs').addChannelOption(o=>o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s=>s.setName('welcome').setDescription('Canal de entrada').addChannelOption(o=>o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s=>s.setName('leave').setDescription('Canal de saída').addChannelOption(o=>o.setName('canal').setDescription('Canal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s=>s.setName('autorole').setDescription('Cargo automático').addRoleOption(o=>o.setName('cargo').setDescription('Cargo').setRequired(true)))
    .addSubcommand(s=>s.setName('automod').setDescription('Filtro de links').addBooleanOption(o=>o.setName('links').setDescription('Bloquear links').setRequired(true)))
    .addSubcommand(s=>s.setName('antiraid').setDescription('Ativar anti-raid').addBooleanOption(o=>o.setName('ativar').setDescription('Ativar').setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Sistema de tickets.')
    .addSubcommand(s=>s.setName('painel').setDescription('Painel pronto'))
    .addSubcommand(s=>s.setName('fechar').setDescription('Fecha o ticket')),
  new SlashCommandBuilder().setName('ticket-criar').setDescription('Cria painel de tickets customizado.')
    .addStringOption(o=>o.setName('titulo').setDescription('Título').setRequired(true))
    .addStringOption(o=>o.setName('descricao').setDescription('Descrição').setRequired(true))
    .addStringOption(o=>o.setName('opcoes').setDescription('Ex: suporte:🛠️,compras:🛒,denuncia:🚨').setRequired(true)),
  new SlashCommandBuilder().setName('verificacao').setDescription('Publica painel de verificação.'),
  new SlashCommandBuilder().setName('trap').setDescription('Painel de ajuda para conta comprometida.'),
  new SlashCommandBuilder().setName('loja').setDescription('Sistema de vendas.')
    .addSubcommand(s=>s.setName('config').setDescription('Configura o PIX e a loja.'))
    .addSubcommand(s=>s.setName('produto').setDescription('Criar produto pelo editor.'))
    .addSubcommand(s=>s.setName('produtos').setDescription('Lista produtos.'))
    .addSubcommand(s=>s.setName('painel').setDescription('Publica a vitrine.'))
    .addSubcommand(s=>s.setName('carrinho').setDescription('Ver carrinho.'))
    .addSubcommand(s=>s.setName('pedidos').setDescription('Ver pedidos.'))
    .addSubcommand(s=>s.setName('confirmar').setDescription('Confirma PIX e entrega.').addStringOption(o=>o.setName('pedido').setDescription('ID do pedido').setRequired(true)))
    .addSubcommand(s=>s.setName('cupom').setDescription('Criar cupom.').addStringOption(o=>o.setName('codigo').setDescription('Código').setRequired(true)).addIntegerOption(o=>o.setName('desconto').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))),
  new SlashCommandBuilder().setName('produto-painel').setDescription('Publica um único produto.').addStringOption(o=>o.setName('id').setDescription('ID').setRequired(true)),
  new SlashCommandBuilder().setName('avaliacao').setDescription('Avaliar compra.').addIntegerOption(o=>o.setName('nota').setDescription('1-5').setMinValue(1).setMaxValue(5).setRequired(true)).addStringOption(o=>o.setName('texto').setDescription('Comentário').setRequired(true)),
  new SlashCommandBuilder().setName('afiliado').setDescription('Afiliados.').addStringOption(o=>o.setName('codigo').setDescription('Criar código')),
  new SlashCommandBuilder().setName('stats').setDescription('Estatísticas.'),
  new SlashCommandBuilder().setName('warn').setDescription('Aplicar warn.').addUserOption(o=>o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o=>o.setName('motivo').setDescription('Motivo').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Expulsar.').addUserOption(o=>o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o=>o.setName('motivo').setDescription('Motivo')),
  new SlashCommandBuilder().setName('ban').setDescription('Banir.').addUserOption(o=>o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o=>o.setName('motivo').setDescription('Motivo')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout.').addUserOption(o=>o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o=>o.setName('minutos').setDescription('Minutos').setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o=>o.setName('motivo').setDescription('Motivo')),
  new SlashCommandBuilder().setName('limpar').setDescription('Limpa mensagens.').addIntegerOption(o=>o.setName('quantidade').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('lock').setDescription('Bloqueia o canal.'),
  new SlashCommandBuilder().setName('unlock').setDescription('Desbloqueia o canal.'),
  new SlashCommandBuilder().setName('slowmode').setDescription('Slowmode.').addIntegerOption(o=>o.setName('segundos').setDescription('0-21600').setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName('perfil').setDescription('Perfil.'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de XP.'),
  new SlashCommandBuilder().setName('sorteio').setDescription('Sorteio.').addIntegerOption(o=>o.setName('minutos').setDescription('Duração').setMinValue(1).setRequired(true)).addStringOption(o=>o.setName('premio').setDescription('Prêmio').setRequired(true)),
].map(x=>x.toJSON());

async function register() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Comandos registrados: ${commands.length}`);
}

async function createTicket(i, type) {
  const g = gdata(i.guild.id);
  const old = i.guild.channels.cache.find(c=>c.topic===`amp-ticket:${i.user.id}`);
  if (old) return i.reply({ content: `Você já tem um ticket: ${old}`, flags: 64 });
  const n = ++g.tickets.counter;
  const ow = [
    { id:i.guild.id, deny:[PermissionFlagsBits.ViewChannel] },
    { id:i.user.id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (g.tickets.staffRoleId) ow.push({ id:g.tickets.staffRoleId, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] });
  const ch = await i.guild.channels.create({ name:`${type}-${String(n).padStart(4,'0')}`, type:ChannelType.GuildText, parent:g.tickets.categoryId||undefined, topic:`amp-ticket:${i.user.id}`, permissionOverwrites:ow });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_claim:${ch.id}`).setLabel('Assumir').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`ticket_close:${ch.id}`).setLabel('Fechar').setStyle(ButtonStyle.Danger));
  await ch.send({ embeds:[new EmbedBuilder().setTitle(`🎫 ${type}`).setDescription(`Olá ${i.user}, sua solicitação foi aberta. Um membro da equipe irá atender você.`).setColor(g.brand.color).setFooter({text:g.brand.footer})], components:[row] });
  g.stats.tickets++; save();
  await log(i.guild,'🎫 Ticket aberto',`${i.user} abriu ${ch}.`,[{name:'Tipo',value:type,inline:true}]);
  return i.reply({ content:`✅ Ticket criado: ${ch}`, flags:64 });
}

async function closeTicket(i) {
  const g = gdata(i.guild.id), ch = i.channel;
  if (!ch?.topic?.startsWith('amp-ticket:')) return i.reply({ content:'Este canal não é um ticket.', flags:64 });
  const owner = ch.topic.split(':')[1];
  if (i.user.id !== owner && !isStaff(i,g)) return i.reply({ content:'Sem permissão.', flags:64 });
  await i.reply({ content:'⏳ Gerando transcript...', flags:64 });
  const file = await transcript(ch);
  if (g.tickets.transcriptChannelId) {
    const tc = i.guild.channels.cache.get(g.tickets.transcriptChannelId);
    if (tc?.isTextBased()) await tc.send({ content:`📚 Transcript de ${ch.name}`, files:[file] }).catch(()=>{});
  }
  await log(i.guild,'🎫 Ticket fechado',`${ch.name} fechado por ${i.user}.`);
  setTimeout(()=>ch.delete().catch(()=>{}),1500);
}

async function createOrder(i, items) {
  const g = gdata(i.guild.id);
  const clean = items.filter(x=>g.products[x.productId] && g.products[x.productId].stock.length >= x.quantity);
  if (!clean.length) return i.reply({content:'Nenhum item válido/estoque insuficiente.',flags:64});
  const total = clean.reduce((s,x)=>s + g.products[x.productId].price*x.quantity,0);
  const order = { id:uid('order'), shortId:crypto.randomBytes(3).toString('hex').toUpperCase(), userId:i.user.id, items:clean, total, status:'awaiting_payment', createdAt:Date.now(), channelId:null };
  const ow=[{id:i.guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}];
  if(g.store.staffRoleId) ow.push({id:g.store.staffRoleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  const ch=await i.guild.channels.create({name:`pedido-${order.shortId}`,type:ChannelType.GuildText,parent:g.store.orderCategoryId||undefined,permissionOverwrites:ow});
  order.channelId=ch.id; g.orders[order.id]=order; save();
  const products=clean.map(x=>{const p=g.products[x.productId];return `• **${p.name}** × ${x.quantity} — ${money(p.price*x.quantity)}`}).join('\n');
  const emb=new EmbedBuilder().setTitle(`🧾 Pedido #${order.shortId}`).setDescription(`Pedido de ${i.user}`).addFields(
    {name:'Itens',value:products,inline:false},{name:'Total',value:money(total),inline:true},{name:'Status',value:'🟡 Aguardando PIX',inline:true},
    {name:'Chave PIX',value:`\`${g.store.pixKey||'NÃO CONFIGURADA'}\``,inline:false},{name:'Favorecido',value:g.store.pixName||'Configure /loja config',inline:true},{name:'Instruções',value:g.store.pixNote,inline:true}
  ).setColor(g.brand.color).setFooter({text:`${g.brand.footer} • Pedido ${order.shortId}`});
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`order_confirm:${order.id}`).setLabel('PIX caiu — Liberar produto').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`order_cancel:${order.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger));
  await ch.send({embeds:[emb],components:[row]});
  await i.reply({content:`🧾 Pedido aberto: ${ch}`,flags:64});
  await log(i.guild,'🛒 Pedido criado',`${i.user} criou #${order.shortId}.`,[{name:'Total',value:money(total)}]);
}

async function confirmOrder(i, id) {
  const g=gdata(i.guild.id), order=g.orders[id]||Object.values(g.orders).find(x=>x.shortId.toLowerCase()===String(id).toLowerCase());
  if(!order)return i.reply({content:'Pedido não encontrado.',flags:64});
  if(!isStaff(i,g))return i.reply({content:'Somente a equipe confirma PIX.',flags:64});
  if(order.status==='paid')return i.reply({content:'Pedido já liberado.',flags:64});
  const buyer=await i.guild.members.fetch(order.userId).catch(()=>null); const deliveries=[];
  for(const item of order.items){const p=g.products[item.productId];if(!p||p.stock.length<item.quantity)return i.reply({content:`Estoque insuficiente em ${p?.name||item.productId}.`,flags:64});}
  for(const item of order.items){const p=g.products[item.productId];for(let n=0;n<item.quantity;n++)deliveries.push(`**${p.name}:**\n${p.stock.shift()}`);}
  order.status='paid';order.paidAt=Date.now();order.confirmedBy=i.user.id;g.stats.sales++;g.stats.revenue+=order.total;save();
  const delivery=deliveries.join('\n\n').slice(0,3900);
  if(buyer){await buyer.send({embeds:[new EmbedBuilder().setTitle('✅ Pagamento confirmado').setDescription(`Pedido **#${order.shortId}**\n\n${delivery}`).setColor('#2ecc71')]}).catch(()=>{});}
  if(order.channelId){const ch=i.guild.channels.cache.get(order.channelId);if(ch?.isTextBased())await ch.send({embeds:[new EmbedBuilder().setTitle('✅ PEDIDO LIBERADO').setDescription(`Confirmado por ${i.user}.\nA entrega foi enviada para a DM do cliente.${buyer?'':'\nCliente não recebeu DM.'}`).setColor('#2ecc71')]});}
  await log(i.guild,'💰 Venda confirmada',`Pedido #${order.shortId} liberado por ${i.user}.`,[{name:'Cliente',value:`<@${order.userId}>`,inline:true},{name:'Total',value:money(order.total),inline:true}]);
  return i.reply({content:`✅ PIX confirmado e pedido **#${order.shortId}** liberado.`,flags:64});
}

client.once(Events.ClientReady, async ready=>{console.log(`Online: ${ready.user.tag}`);await register().catch(e=>console.error('Registro:',e));});

client.on(Events.GuildMemberAdd, async m=>{
  const g=gdata(m.guild.id);
  const now=Date.now();g.antiraid.joins=(g.antiraid.joins||[]).filter(t=>now-t<=g.antiraid.window*1000);g.antiraid.joins.push(now);
  if(g.antiraid.enabled && g.antiraid.joins.length>=g.antiraid.threshold && !g.antiraid.active){g.antiraid.active=true;if(g.antiraid.lock)for(const c of m.guild.channels.cache.values())if(c.type===ChannelType.GuildText)await c.permissionOverwrites.edit(m.guild.roles.everyone,{SendMessages:false}).catch(()=>{});await log(m.guild,'🚨 Anti-Raid ativado',`Pico de entradas detectado: ${g.antiraid.joins.length} em ${g.antiraid.window}s.`);}
  if(g.autorole.enabled&&g.autorole.roleId)await m.roles.add(g.autorole.roleId).catch(()=>{});
  if(g.welcome.enabled&&g.welcome.channelId){const c=m.guild.channels.cache.get(g.welcome.channelId);if(c?.isTextBased())await c.send(g.welcome.message.replaceAll('{user}',`${m}`).replaceAll('{username}',m.user.username).replaceAll('{server}',m.guild.name));}
  await log(m.guild,'👋 Entrada',`${m.user.tag} entrou.`);save();
});
client.on(Events.GuildMemberRemove,async m=>{const g=gdata(m.guild.id);if(g.leave.enabled&&g.leave.channelId){const c=m.guild.channels.cache.get(g.leave.channelId);if(c?.isTextBased())await c.send(g.leave.message.replaceAll('{username}',m.user.username));}await log(m.guild,'👋 Saída',`${m.user.tag} saiu.`);});

const spam=new Map();
client.on(Events.MessageCreate,async m=>{
  if(!m.inGuild()||m.author.bot)return; const g=gdata(m.guild.id);
  const blocked=(!m.member.permissions.has(PermissionFlagsBits.ManageMessages)) && ((g.automod.links&&/https?:\/\//i.test(m.content))||(g.automod.invites&&/discord\.gg\//i.test(m.content))||(g.automod.words||[]).some(w=>w&&m.content.toLowerCase().includes(w.toLowerCase()))||(m.mentions.users.size>=g.automod.maxMentions));
  if(blocked){await m.delete().catch(()=>{});if(m.member.moderatable)await m.member.timeout(60000,'AutoMod').catch(()=>{});await log(m.guild,'🛡️ AutoMod',`${m.author} acionou um filtro.`);return;}
  const k=`${m.guild.id}:${m.author.id}`,now=Date.now();const arr=(spam.get(k)||[]).filter(t=>now-t<7000);arr.push(now);spam.set(k,arr);
  if(g.automod.spam&&arr.length>=7&&m.member.moderatable){await m.member.timeout(60000,'Spam').catch(()=>{});await log(m.guild,'🛡️ Anti-Spam',`${m.author} recebeu timeout.`);spam.delete(k);}
});

client.on(Events.InteractionCreate,async i=>{
  try{
    if(!i.isChatInputCommand()&&!i.isButton()&&!i.isModalSubmit()&&!i.isStringSelectMenu())return;
    if(!i.inGuild())return;
    const g=gdata(i.guild.id);
    if(i.isButton()){
      if(i.customId.startsWith('ticket_open:'))return createTicket(i,i.customId.split(':')[1]);
      if(i.customId.startsWith('ticket_close:'))return closeTicket(i);
      if(i.customId.startsWith('ticket_claim:')){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});return i.reply(`👑 Ticket assumido por ${i.user}.`);}
      if(i.customId==='verify_member'){if(!g.verification.roleId)return i.reply({content:'Cargo de verificado não configurado.',flags:64});await i.member.roles.add(g.verification.roleId).catch(()=>{});g.stats.verified++;save();return i.reply({content:'✅ Verificado.',flags:64});}
      if(i.customId==='trap_open'){const md=new ModalBuilder().setCustomId('trap_modal').setTitle('Conta comprometida');md.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('platform').setLabel('Plataforma/serviço').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('report').setLabel('Explique o que aconteceu').setStyle(TextInputStyle.Paragraph).setRequired(true)));return i.showModal(md);}
      if(i.customId.startsWith('store_buy:')){const pid=i.customId.split(':')[1];return createOrder(i,[{productId:pid,quantity:1}]);}
      if(i.customId.startsWith('store_cart:')){const pid=i.customId.split(':')[1];g.carts[i.user.id]??=[];const x=g.carts[i.user.id].find(a=>a.productId===pid);if(x)x.quantity++;else g.carts[i.user.id].push({productId:pid,quantity:1});save();return i.reply({content:'🛒 Adicionado ao carrinho.',flags:64});}
      if(i.customId==='cart_checkout'){const cart=g.carts[i.user.id]||[];g.carts[i.user.id]=[];save();return createOrder(i,cart);}
      if(i.customId.startsWith('order_confirm:'))return confirmOrder(i,i.customId.split(':')[1]);
      if(i.customId.startsWith('order_cancel:')){const id=i.customId.split(':')[1],o=g.orders[id];if(!o)return i.reply({content:'Pedido não encontrado.',flags:64});if(o.userId!==i.user.id&&!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});o.status='cancelled';save();await i.reply({content:'❌ Pedido cancelado.',flags:64});return i.channel.delete().catch(()=>{});}
    }
    if(i.isStringSelectMenu()&&i.customId.startsWith('ticket_select:'))return createTicket(i,i.values[0]);
    if(i.isModalSubmit()){
      if(i.customId==='trap_modal'){const c=g.trap.channelId?i.guild.channels.cache.get(g.trap.channelId):null;if(c?.isTextBased())await c.send({embeds:[new EmbedBuilder().setTitle('🚨 Conta comprometida').setDescription(`${i.user}\n**Plataforma:** ${i.fields.getTextInputValue('platform')}\n**Relato:** ${i.fields.getTextInputValue('report')}\n\n⚠️ Não peça nem registre senhas, tokens ou códigos 2FA.`).setColor('#e74c3c')]});return i.reply({content:'🚨 Chamado enviado para a equipe.',flags:64});}
      if(i.customId==='store_config'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});g.store.pixKey=i.fields.getTextInputValue('pix');g.store.pixName=i.fields.getTextInputValue('name');g.store.pixNote=i.fields.getTextInputValue('note');g.store.enabled=true;save();return i.reply({content:'✅ Loja configurada.',flags:64});}
      if(i.customId==='product_create'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});const name=i.fields.getTextInputValue('name');const price=Number(i.fields.getTextInputValue('price').replace(',','.'));const desc=i.fields.getTextInputValue('desc');const stock=i.fields.getTextInputValue('stock').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!Number.isFinite(price)||price<0)return i.reply({content:'Preço inválido.',flags:64});const id=crypto.randomBytes(4).toString('hex');g.products[id]={id,name,price,description:desc,stock,createdAt:Date.now()};save();return i.reply({content:`✅ Produto criado: **${name}**\nID: \`${id}\`\nEstoque: **${stock.length}**`,flags:64});}
    }
    if(!i.isChatInputCommand())return;
    const c=i.commandName;
    if(c==='ping')return i.reply(`🏓 ${client.ws.ping}ms`);
    if(c==='ajuda')return i.reply({embeds:[new EmbedBuilder().setTitle(`📚 ${g.brand.name}`).setDescription('`/ticket-criar` • `/loja` • `/verificacao` • `/trap` • `/setup` • moderação • estatísticas').setColor(g.brand.color)]});
    if(c==='setup'){
      if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});const s=i.options.getSubcommand();
      if(s==='logs')g.logs={enabled:true,channelId:i.options.getChannel('canal').id};
      if(s==='welcome')g.welcome={...g.welcome,enabled:true,channelId:i.options.getChannel('canal').id};
      if(s==='leave')g.leave={...g.leave,enabled:true,channelId:i.options.getChannel('canal').id};
      if(s==='autorole')g.autorole={enabled:true,roleId:i.options.getRole('cargo').id};
      if(s==='automod')g.automod.links=i.options.getBoolean('links');
      if(s==='antiraid')g.antiraid.enabled=i.options.getBoolean('ativar');
      save();return i.reply({content:`✅ ${s} configurado.`,flags:64});
    }
    if(c==='ticket-criar'){
      if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});
      const title=i.options.getString('titulo'),desc=i.options.getString('descricao');const specs=i.options.getString('opcoes').split(',').map(x=>x.trim()).filter(Boolean);
      const menu=new StringSelectMenuBuilder().setCustomId(`ticket_select:custom`).setPlaceholder('Selecione o atendimento');for(const spec of specs.slice(0,25)){const [label,emoji]=spec.split(':');menu.addOptions({label:label.slice(0,100),value:label.toLowerCase().replace(/[^a-z0-9_-]/gi,'-').slice(0,100),emoji:emoji||undefined});}
      return i.reply({embeds:[new EmbedBuilder().setTitle(title).setDescription(desc).setColor(g.brand.color).setFooter({text:g.brand.footer})],components:[new ActionRowBuilder().addComponents(menu)]});
    }
    if(c==='ticket'){const s=i.options.getSubcommand();if(s==='fechar')return closeTicket(i);const menu=new StringSelectMenuBuilder().setCustomId('ticket_select:default').setPlaceholder('Abrir atendimento').addOptions({label:'Suporte',value:'suporte',emoji:'🛠️'},{label:'Compras',value:'compras',emoji:'🛒'},{label:'Denúncia',value:'denuncia',emoji:'🚨'});return i.reply({embeds:[new EmbedBuilder().setTitle('🎫 Atendimento').setDescription('Escolha uma opção para abrir seu ticket.').setColor(g.brand.color)],components:[new ActionRowBuilder().addComponents(menu)]});}
    if(c==='verificacao'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});g.verification={enabled:true,channelId:i.channel.id,roleId:g.verification.roleId};if(!g.verification.roleId){return i.reply({content:'Configure o cargo de verificado no código/configuração antes de publicar.',flags:64});}save();return i.reply({embeds:[new EmbedBuilder().setTitle('🔐 Verificação').setDescription('Clique para receber o cargo de verificado.').setColor(g.brand.color)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_member').setLabel('Verificar').setStyle(ButtonStyle.Success))]});}
    if(c==='trap'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});g.trap={enabled:true,channelId:i.channel.id};save();return i.reply({embeds:[new EmbedBuilder().setTitle('🚨 Conta comprometida').setDescription('Abra este chamado se sua conta foi comprometida. Nunca envie senha, token ou código 2FA.').setColor('#e74c3c')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('trap_open').setLabel('Preciso de ajuda').setStyle(ButtonStyle.Danger))]});}
    if(c==='loja'){
      const s=i.options.getSubcommand();
      if(s==='config'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});const md=new ModalBuilder().setCustomId('store_config').setTitle('Configurar loja / PIX');md.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pix').setLabel('Chave PIX').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Favorecido').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Instruções').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(g.store.pixNote)));return i.showModal(md);}
      if(s==='produto'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});const md=new ModalBuilder().setCustomId('product_create').setTitle('Criar produto');md.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nome do produto').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('Preço (ex: 14.90)').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('stock').setLabel('Estoque — 1 entrega por linha').setStyle(TextInputStyle.Paragraph).setRequired(true)));return i.showModal(md);}
      if(s==='produtos'){const list=Object.values(g.products);const t=list.length?list.map(p=>`**${p.name}** • ${money(p.price)} • estoque ${p.stock.length} • \`${p.id}\``).join('\n'):'Nenhum produto.';return i.reply({embeds:[new EmbedBuilder().setTitle('🛍️ Produtos').setDescription(t).setColor(g.brand.color)]});}
      if(s==='painel'){const list=Object.values(g.products);if(!list.length)return i.reply({content:'Nenhum produto.',flags:64});for(const p of list.slice(0,25)){const e=new EmbedBuilder().setTitle(p.name).setDescription(p.description).addFields({name:'Preço',value:money(p.price),inline:true},{name:'Estoque',value:String(p.stock.length),inline:true}).setColor(g.brand.color).setFooter({text:`ID ${p.id}`});await i.channel.send({embeds:[e],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`store_buy:${p.id}`).setLabel('Comprar').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`store_cart:${p.id}`).setLabel('Adicionar ao carrinho').setStyle(ButtonStyle.Primary))]});}return i.reply({content:'✅ Vitrine publicada.',flags:64});}
      if(s==='carrinho'){const cart=g.carts[i.user.id]||[];if(!cart.length)return i.reply({content:'🛒 Carrinho vazio.',flags:64});const t=cart.map(x=>{const p=g.products[x.productId];return p?`• ${p.name} × ${x.quantity} — ${money(p.price*x.quantity)}`:'Produto removido';}).join('\n');const total=cart.reduce((sum,x)=>sum+(g.products[x.productId]?.price||0)*x.quantity,0);return i.reply({embeds:[new EmbedBuilder().setTitle('🛒 Carrinho').setDescription(t).addFields({name:'Total',value:money(total)}).setColor(g.brand.color)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cart_checkout').setLabel(`Finalizar ${money(total)}`).setStyle(ButtonStyle.Success))]});}
      if(s==='pedidos'){const list=Object.values(g.orders).filter(o=>o.userId===i.user.id).slice(-10).reverse();const t=list.length?list.map(o=>`#${o.shortId} • ${money(o.total)} • ${o.status}`).join('\n'):'Nenhum pedido.';return i.reply({embeds:[new EmbedBuilder().setTitle('🧾 Pedidos').setDescription(t).setColor(g.brand.color)]});}
      if(s==='confirmar')return confirmOrder(i,i.options.getString('pedido'));
      if(s==='cupom'){if(!isStaff(i,g))return i.reply({content:'Sem permissão.',flags:64});const code=i.options.getString('codigo').toUpperCase();g.coupons[code]={discount:i.options.getInteger('desconto')};save();return i.reply(`✅ Cupom **${code}** criado.`);}
    }
    if(c==='produto-painel'){const p=g.products[i.options.getString('id')];if(!p)return i.reply({content:'Produto não encontrado.',flags:64});return i.reply({embeds:[new EmbedBuilder().setTitle(p.name).setDescription(p.description).addFields({name:'Preço',value:money(p.price),inline:true},{name:'Estoque',value:String(p.stock.length),inline:true}).setColor(g.brand.color)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`store_buy:${p.id}`).setLabel('Comprar').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`store_cart:${p.id}`).setLabel('Carrinho').setStyle(ButtonStyle.Primary))]});}
    if(c==='avaliacao'){g.reviews.push({userId:i.user.id,note:i.options.getInteger('nota'),text:i.options.getString('texto'),at:Date.now()});save();return i.reply('⭐ Avaliação registrada.');}
    if(c==='afiliado'){const code=i.options.getString('codigo');if(code){g.affiliates[i.user.id]={userId:i.user.id,code:code.toUpperCase(),sales:0};save();return i.reply(`🤝 Código criado: **${code.toUpperCase()}**`);}const arr=Object.values(g.affiliates).sort((a,b)=>b.sales-a.sales).slice(0,10);return i.reply({embeds:[new EmbedBuilder().setTitle('🤝 Afiliados').setDescription(arr.length?arr.map((a,n)=>`${n+1}. <@${a.userId}> — ${a.sales} vendas`).join('\n'):'Nenhum afiliado.').setColor(g.brand.color)]});}
    if(c==='stats')return i.reply({embeds:[new EmbedBuilder().setTitle('📊 Estatísticas').addFields({name:'Vendas',value:String(g.stats.sales),inline:true},{name:'Faturamento',value:money(g.stats.revenue),inline:true},{name:'Tickets',value:String(g.stats.tickets),inline:true},{name:'Verificados',value:String(g.stats.verified),inline:true},{name:'Produtos',value:String(Object.keys(g.products).length),inline:true},{name:'Pedidos',value:String(Object.keys(g.orders).length),inline:true}).setColor(g.brand.color)]});
    if(['warn','kick','ban','timeout','limpar','lock','unlock','slowmode'].includes(c)&&!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)&&!i.memberPermissions.has(PermissionFlagsBits.Administrator))return i.reply({content:'Sem permissão.',flags:64});
    if(c==='warn'){const m=i.options.getMember('membro'),r=i.options.getString('motivo');await log(i.guild,'⚠️ Warn',`${m.user.tag} recebeu warn.`,[{name:'Motivo',value:r},{name:'Moderador',value:`${i.user}`}]);return i.reply(`⚠️ ${m.user.tag} advertido.`);}
    if(c==='kick'){const m=i.options.getMember('membro'),r=i.options.getString('motivo')||'Sem motivo';await m.kick(r);await log(i.guild,'👢 Kick',`${m.user.tag} expulso.`,[{name:'Motivo',value:r}]);return i.reply(`👢 ${m.user.tag} expulso.`);}
    if(c==='ban'){const m=i.options.getMember('membro'),r=i.options.getString('motivo')||'Sem motivo';await m.ban({reason:r});await log(i.guild,'🔨 Ban',`${m.user.tag} banido.`,[{name:'Motivo',value:r}]);return i.reply(`🔨 ${m.user.tag} banido.`);}
    if(c==='timeout'){const m=i.options.getMember('membro'),min=i.options.getInteger('minutos'),r=i.options.getString('motivo')||'Sem motivo';await m.timeout(min*60000,r);await log(i.guild,'⏱️ Timeout',`${m.user.tag} recebeu timeout.`,[{name:'Tempo',value:`${min} min`},{name:'Motivo',value:r}]);return i.reply(`⏱️ Timeout aplicado.`);}
    if(c==='limpar'){const n=i.options.getInteger('quantidade'),d=await i.channel.bulkDelete(n,true);await log(i.guild,'🧹 Limpeza',`${i.user} apagou ${d.size} mensagens.`);return i.reply({content:`🧹 ${d.size} apagadas.`,flags:64});}
    if(c==='lock'||c==='unlock'){await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:c==='lock'?false:null});await log(i.guild,c==='lock'?'🔒 Canal bloqueado':'🔓 Canal desbloqueado',`${i.user} executou /${c}.`);return i.reply(c==='lock'?'🔒 Bloqueado.':'🔓 Desbloqueado.');}
    if(c==='slowmode'){const s=i.options.getInteger('segundos');await i.channel.setRateLimitPerUser(s);return i.reply(`🐢 Slowmode: ${s}s`);}
    if(c==='perfil'){const u=g.users[i.user.id]||{xp:0,level:1};return i.reply({embeds:[new EmbedBuilder().setTitle(`Perfil de ${i.user.username}`).addFields({name:'Nível',value:String(u.level),inline:true},{name:'XP',value:String(u.xp),inline:true}).setColor(g.brand.color)]});}
    if(c==='ranking'){const rows=Object.entries(g.users).sort((a,b)=>(b[1].xp||0)-(a[1].xp||0)).slice(0,10);return i.reply((rows.map((x,n)=>`${n+1}. <@${x[0]}> — ${x[1].xp||0} XP`).join('\n'))||'Sem dados.');}
    if(c==='sorteio'){const mins=i.options.getInteger('minutos'),prize=i.options.getString('premio');const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${uid('gw')}`).setLabel('Participar').setStyle(ButtonStyle.Success));return i.reply({embeds:[new EmbedBuilder().setTitle('🎉 Sorteio').setDescription(`Prêmio: **${prize}**\nFinaliza <t:${Math.floor((Date.now()+mins*60000)/1000)}:R>`).setColor(g.brand.color)],components:[row]});}
  }catch(e){console.error('Interaction error:',e);if(!i.replied&&!i.deferred)await i.reply({content:'❌ Erro ao executar. Veja o console.',flags:64}).catch(()=>{});}
});

client.login(TOKEN);
