require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  PermissionFlagsBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('ERRO: configure DISCORD_TOKEN e CLIENT_ID no arquivo .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mostra a latência do bot.'),

  new SlashCommandBuilder()
    .setName('servidor')
    .setDescription('Mostra informações do servidor atual.'),

  new SlashCommandBuilder()
    .setName('usuario')
    .setDescription('Mostra informações de um usuário.')
    .addUserOption(option =>
      option.setName('membro')
        .setDescription('Usuário que você quer consultar.')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('limpar')
    .setDescription('Apaga mensagens do canal.')
    .addIntegerOption(option =>
      option.setName('quantidade')
        .setDescription('Quantidade de mensagens, de 1 a 100.')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('ajuda')
    .setDescription('Mostra os comandos disponíveis.')
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`✓ ${commands.length} comandos registrados.`);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`✓ Bot online como ${readyClient.user.tag}`);
  console.log(`✓ Conectado a ${readyClient.guilds.cache.size} servidor(es).`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'ping': {
        const latency = Date.now() - interaction.createdTimestamp;
        await interaction.reply(`🏓 Pong! Latência: **${latency}ms** | API: **${Math.round(client.ws.ping)}ms**`);
        break;
      }

      case 'servidor': {
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
          .setTitle(`📊 ${guild.name}`)
          .addFields(
            { name: '👑 Dono', value: `<@${guild.ownerId}>`, inline: true },
            { name: '👥 Membros', value: `${guild.memberCount}`, inline: true },
            { name: '🆔 ID', value: guild.id, inline: true },
            { name: '📅 Criado em', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
          )
          .setTimestamp();

        if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ size: 256 }));
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'usuario': {
        const member = interaction.options.getMember('membro') || interaction.member;
        const user = member.user;
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${user.username}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: '🆔 ID', value: user.id, inline: true },
            { name: '📅 Conta criada', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
            { name: '📥 Entrou no servidor', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Desconhecido', inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'limpar': {
        const quantidade = interaction.options.getInteger('quantidade');
        if (!interaction.channel || !interaction.channel.isTextBased()) {
          await interaction.reply({ content: '❌ Este comando só pode ser usado em um canal de texto.', ephemeral: true });
          return;
        }

        const deleted = await interaction.channel.bulkDelete(quantidade, true);
        await interaction.reply({ content: `🧹 **${deleted.size}** mensagens foram removidas.`, ephemeral: true });
        break;
      }

      case 'ajuda': {
        const embed = new EmbedBuilder()
          .setTitle('🤖 Bot Multifunções AMP')
          .setDescription('Comandos disponíveis no momento:')
          .addFields(
            { name: '🏓 /ping', value: 'Verifica a latência do bot.' },
            { name: '📊 /servidor', value: 'Exibe informações do servidor.' },
            { name: '👤 /usuario', value: 'Exibe informações de um usuário.' },
            { name: '🧹 /limpar', value: 'Apaga mensagens (requer Gerenciar Mensagens).' },
            { name: '❓ /ajuda', value: 'Mostra esta mensagem.' }
          )
          .setFooter({ text: 'Desenvolvido por Dvyson Ywre' })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }
    }
  } catch (error) {
    console.error('Erro ao executar comando:', error);
    const response = { content: '❌ Ocorreu um erro ao executar este comando.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response);
    else await interaction.reply(response);
  }
});

registerCommands()
  .then(() => client.login(token))
  .catch(error => {
    console.error('Não foi possível iniciar o bot:', error);
    process.exit(1);
  });
