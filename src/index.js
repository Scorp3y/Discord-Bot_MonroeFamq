import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  saveApplication,
  updateApplication,
  getApplication
} from './db.js';

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  panelChannelId: process.env.APPLICATION_PANEL_CHANNEL_ID,
  reviewChannelId: process.env.APPLICATION_REVIEW_CHANNEL_ID,
  resultChannelId: process.env.APPLICATION_RESULT_CHANNEL_ID,
  candidateRoleId: process.env.CANDIDATE_ROLE_ID,
  hrRoleId: process.env.HR_ROLE_ID,
  bannerUrl: process.env.APPLICATION_BANNER_URL,
  accentColor: Number(process.env.ACCENT_COLOR || 2368553),
  familyName: process.env.FAMILY_NAME || 'Monroe Family',
  serverName: process.env.SERVER_NAME || 'MONROE FAMQ',
  footerText: process.env.FOOTER_TEXT || 'Monroe FamQ • Recruitment System'
};

const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'APPLICATION_PANEL_CHANNEL_ID',
  'APPLICATION_REVIEW_CHANNEL_ID',
  'APPLICATION_RESULT_CHANNEL_ID',
  'CANDIDATE_ROLE_ID',
  'HR_ROLE_ID',
  'APPLICATION_BANNER_URL'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Не заполнено поле ${key} в .env`);
    process.exit(1);
  }
}

const IDS = {
  selectApply: 'mfq_apply_select',
  modalApply: 'mfq_apply_modal',
  approvePrefix: 'mfq_apply_approve:',
  rejectPrefix: 'mfq_apply_reject:',
  rejectReasonPrefix: 'mfq_apply_reject_reason:'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

function hasHrRole(member) {
  return Boolean(
    member?.roles?.cache?.has(CONFIG.hrRoleId) ||
    member?.permissions?.has('Administrator')
  );
}

function buildPanelPayload() {
  const bannerEmbed = new EmbedBuilder()
    .setColor(CONFIG.accentColor)
    .setImage(CONFIG.bannerUrl);

  const infoEmbed = new EmbedBuilder()
    .setColor(CONFIG.accentColor)
    .setTitle(`Заявки в ${CONFIG.familyName} открыты!`)
    .setDescription(
      [
        'Перед подачей заявки ознакомьтесь с условиями:',
        '',
        '• Для вступления в семью нужен **5+ уровень персонажа**.',
        '• Необходимо иметь **адекватный средний онлайн**.',
        '• Обязательно наличие **Discord** и готовность пройти обзвон.',
        '• Заявки рассматриваются по мере возможности свободного HR.',
        '',
        'Выберите действие ниже, чтобы открыть анкету.'
      ].join('\n')
    )
    .setFooter({ text: CONFIG.footerText });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.selectApply)
    .setPlaceholder('Выбери действие')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Подать заявку в семью')
        .setDescription(`Открыть анкету для вступления в ${CONFIG.familyName}`)
        .setEmoji('📝')
        .setValue('apply')
    );

  return {
    embeds: [bannerEmbed, infoEmbed],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

function buildApplyModal() {
  const modal = new ModalBuilder()
    .setCustomId(IDS.modalApply)
    .setTitle(`Заявка в ${CONFIG.familyName}`);

  const gameInfo = new TextInputBuilder()
    .setCustomId('game_info')
    .setLabel('Игровой ник + уровень персонажа')
    .setPlaceholder('Например: Artem Monroe, 15 lvl')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const ageOnline = new TextInputBuilder()
    .setCustomId('age_online')
    .setLabel('Возраст + средний онлайн')
    .setPlaceholder('Например: 16 лет, 4 часа в день')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const previousFamilies = new TextInputBuilder()
    .setCustomId('previous_families')
    .setLabel('В каких семьях / организациях состояли?')
    .setPlaceholder('Например: Mist, Cursed, Healz / не состоял')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(700);

  const whyFamily = new TextInputBuilder()
    .setCustomId('why_family')
    .setLabel(`Почему хотите вступить в ${CONFIG.familyName}?`)
    .setPlaceholder('Коротко опишите причину')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(700);

  const source = new TextInputBuilder()
    .setCustomId('source')
    .setLabel('Откуда узнали о семье?')
    .setPlaceholder('Друг посоветовал, реклама, Twitch, Discord...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(gameInfo),
    new ActionRowBuilder().addComponents(ageOnline),
    new ActionRowBuilder().addComponents(previousFamilies),
    new ActionRowBuilder().addComponents(whyFamily),
    new ActionRowBuilder().addComponents(source)
  );

  return modal;
}

function buildReviewEmbed({ applicant, answers }) {
  return new EmbedBuilder()
    .setColor(CONFIG.accentColor)
    .setTitle('📝 Новая заявка в семью')
    .setDescription(
      [
        `**Кандидат:** ${applicant}`,
        `**Discord ID:** \`${applicant.id}\``,
        `**Дата подачи:** <t:${Math.floor(Date.now() / 1000)}:f>`
      ].join('\n')
    )
    .addFields(
      {
        name: 'Игровой ник + уровень',
        value: answers.gameInfo,
        inline: false
      },
      {
        name: 'Возраст + средний онлайн',
        value: answers.ageOnline,
        inline: false
      },
      {
        name: 'Опыт в семьях / организациях',
        value: answers.previousFamilies,
        inline: false
      },
      {
        name: `Почему хочет вступить в ${CONFIG.familyName}`,
        value: answers.whyFamily,
        inline: false
      },
      {
        name: 'Откуда узнал о семье',
        value: answers.source,
        inline: false
      },
      {
        name: 'Статус',
        value: '⏳ На рассмотрении',
        inline: false
      }
    )
    .setFooter({ text: CONFIG.footerText });
}

function buildReviewButtons(applicantId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.approvePrefix}${applicantId}`)
      .setLabel('Принять')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${IDS.rejectPrefix}${applicantId}`)
      .setLabel('Отклонить')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildResultEmbed({ accepted, applicantId, reviewerId, reason }) {
  const color = accepted ? 0x57F287 : 0xED4245;
  const title = accepted ? '✅ Заявка принята' : '❌ Заявка отклонена';

  const lines = [
    `**Кандидат:** <@${applicantId}>`,
    `**Рассмотрел заявку:** <@${reviewerId}>`,
    ''
  ];

  if (accepted) {
    lines.push('Ваша заявка была принята. Ожидайте дальнейшей информации по обзвону.');
  } else {
    lines.push(`**Причина:** ${reason || 'Не указана.'}`);
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: CONFIG.footerText })
    .setTimestamp();
}

function buildUpdatedReviewEmbed(oldEmbed, { accepted, reviewerId, reason }) {
  const updated = EmbedBuilder.from(oldEmbed)
    .setColor(accepted ? 0x57F287 : 0xED4245);

  const statusValue = accepted
    ? `✅ Принято\n**Рассмотрел:** <@${reviewerId}>`
    : `❌ Отклонено\n**Рассмотрел:** <@${reviewerId}>\n**Причина:** ${reason || 'Не указана.'}`;

  const fields = oldEmbed.fields.map((field) => {
    if (field.name === 'Статус') {
      return {
        name: 'Статус',
        value: statusValue,
        inline: false
      };
    }
    return field;
  });

  updated.setFields(fields);
  return updated;
}

async function sendResult({ guild, applicantId, reviewerId, accepted, reason }) {
  const resultChannel = await guild.channels.fetch(CONFIG.resultChannelId);

  if (!resultChannel || resultChannel.type !== ChannelType.GuildText) {
    throw new Error('Канал результатов не найден или не является текстовым.');
  }

  await resultChannel.send({
    content: `<@${applicantId}>`,
    embeds: [
      buildResultEmbed({
        accepted,
        applicantId,
        reviewerId,
        reason
      })
    ],
    allowedMentions: {
      users: [applicantId],
      roles: []
    }
  });
}

async function approveApplication(interaction, applicantId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!hasHrRole(interaction.member)) {
    await interaction.editReply('❌ У тебя нет прав HR для рассмотрения заявок.');
    return;
  }

  const guild = interaction.guild;
  const reviewMessageId = interaction.message.id;

  const application = await getApplication(reviewMessageId);
  if (application?.status && application.status !== 'pending') {
    await interaction.editReply('⚠️ Эта заявка уже была рассмотрена.');
    return;
  }

  let roleGiven = false;

  try {
    const member = await guild.members.fetch(applicantId);
    await member.roles.add(CONFIG.candidateRoleId, `Заявка принята HR: ${interaction.user.tag}`);
    roleGiven = true;
  } catch (error) {
    console.error('Не удалось выдать роль кандидата:', error);
  }

  const oldEmbed = interaction.message.embeds[0];
  const updatedEmbed = buildUpdatedReviewEmbed(oldEmbed, {
    accepted: true,
    reviewerId: interaction.user.id
  });

  await interaction.message.edit({
    embeds: [updatedEmbed],
    components: [buildReviewButtons(applicantId, true)]
  });

  await sendResult({
    guild,
    applicantId,
    reviewerId: interaction.user.id,
    accepted: true
  });

  await updateApplication(reviewMessageId, {
    status: 'accepted',
    reviewedBy: interaction.user.id,
    reviewedAt: new Date().toISOString(),
    roleGiven
  });

  await interaction.editReply(
    roleGiven
      ? '✅ Заявка принята. Роль кандидата выдана, результат отправлен.'
      : '✅ Заявка принята, результат отправлен. ⚠️ Но роль кандидата выдать не удалось — проверь права и позицию роли бота.'
  );
}

function buildRejectReasonModal(applicantId, reviewMessageId) {
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.rejectReasonPrefix}${applicantId}:${reviewMessageId}`)
    .setTitle('Причина отклонения заявки');

  const reason = new TextInputBuilder()
    .setCustomId('reject_reason')
    .setLabel('Укажите причину отказа')
    .setPlaceholder('Например: недостаточно лет / слабый онлайн / не подходит по требованиям')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(700);

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  return modal;
}

async function rejectApplication(interaction, applicantId, reviewMessageId, reason) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!hasHrRole(interaction.member)) {
    await interaction.editReply('❌ У тебя нет прав HR для рассмотрения заявок.');
    return;
  }

  const guild = interaction.guild;

  const reviewChannel = await guild.channels.fetch(CONFIG.reviewChannelId);
  const reviewMessage = await reviewChannel.messages.fetch(reviewMessageId);

  const application = await getApplication(reviewMessageId);
  if (application?.status && application.status !== 'pending') {
    await interaction.editReply('⚠️ Эта заявка уже была рассмотрена.');
    return;
  }

  const oldEmbed = reviewMessage.embeds[0];
  const updatedEmbed = buildUpdatedReviewEmbed(oldEmbed, {
    accepted: false,
    reviewerId: interaction.user.id,
    reason
  });

  await reviewMessage.edit({
    embeds: [updatedEmbed],
    components: [buildReviewButtons(applicantId, true)]
  });

  await sendResult({
    guild,
    applicantId,
    reviewerId: interaction.user.id,
    accepted: false,
    reason
  });

  await updateApplication(reviewMessageId, {
    status: 'rejected',
    reviewedBy: interaction.user.id,
    reviewedAt: new Date().toISOString(),
    reason
  });

  await interaction.editReply('❌ Заявка отклонена, результат отправлен.');
}

client.once('ready', () => {
  console.log(`✅ Бот запущен как ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-applications') {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({
          content: '❌ Эту команду может использовать только администратор.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const channel = await interaction.guild.channels.fetch(CONFIG.panelChannelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: '❌ Канал для панели заявок не найден или не является текстовым.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await channel.send(buildPanelPayload());

      await interaction.reply({
        content: `✅ Панель подачи заявок отправлена в ${channel}.`,
        flags: MessageFlags.Ephemeral
      });

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === IDS.selectApply) {
      if (interaction.values[0] !== 'apply') return;
      await interaction.showModal(buildApplyModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === IDS.modalApply) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const answers = {
        gameInfo: interaction.fields.getTextInputValue('game_info'),
        ageOnline: interaction.fields.getTextInputValue('age_online'),
        previousFamilies: interaction.fields.getTextInputValue('previous_families'),
        whyFamily: interaction.fields.getTextInputValue('why_family'),
        source: interaction.fields.getTextInputValue('source')
      };

      const reviewChannel = await interaction.guild.channels.fetch(CONFIG.reviewChannelId);

      if (!reviewChannel || reviewChannel.type !== ChannelType.GuildText) {
        await interaction.editReply('❌ Канал для рассмотрения заявок не найден.');
        return;
      }

      const reviewMessage = await reviewChannel.send({
        content: `<@&${CONFIG.hrRoleId}>`,
        embeds: [
          buildReviewEmbed({
            applicant: interaction.user,
            answers
          })
        ],
        components: [buildReviewButtons(interaction.user.id)],
        allowedMentions: {
          roles: [CONFIG.hrRoleId],
          users: []
        }
      });

      await saveApplication(reviewMessage.id, {
        applicantId: interaction.user.id,
        applicantTag: interaction.user.tag,
        answers
      });

      await interaction.editReply(
        '✅ Заявка отправлена на рассмотрение. Ожидайте решения HR.'
      );

      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(IDS.approvePrefix)) {
      const applicantId = interaction.customId.slice(IDS.approvePrefix.length);
      await approveApplication(interaction, applicantId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(IDS.rejectPrefix)) {
      if (!hasHrRole(interaction.member)) {
        await interaction.reply({
          content: '❌ У тебя нет прав HR для рассмотрения заявок.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const applicantId = interaction.customId.slice(IDS.rejectPrefix.length);
      await interaction.showModal(buildRejectReasonModal(applicantId, interaction.message.id));
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.rejectReasonPrefix)) {
      const rest = interaction.customId.slice(IDS.rejectReasonPrefix.length);
      const [applicantId, reviewMessageId] = rest.split(':');
      const reason = interaction.fields.getTextInputValue('reject_reason');

      await rejectApplication(interaction, applicantId, reviewMessageId, reason);
      return;
    }
  } catch (error) {
    console.error('❌ Ошибка обработки interaction:', error);

    const message = '❌ Произошла ошибка. Проверь консоль бота и настройки каналов/ролей.';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

client.login(CONFIG.token);
