import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Не заполнено поле ${key} в .env`);
    process.exit(1);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Отправить панель подачи заявок')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log('⏳ Регистрирую slash-команды...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('Команды зарегистрированы. Используй /setup на сервере.');
} catch (error) {
  console.error('Ошибка регистрации команд:', error);
  process.exit(1);
}
