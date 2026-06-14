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
  PermissionFlagsBits,
  Routes,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  saveApplication,
  updateApplication,
  getApplication,
  countPendingApplicationsByApplicant,
  getSettings,
  updateSettings
} from './db.js';

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  panelChannelId: process.env.APPLICATION_PANEL_CHANNEL_ID,
  reviewChannelId: process.env.APPLICATION_REVIEW_CHANNEL_ID,
  resultChannelId: process.env.APPLICATION_RESULT_CHANNEL_ID,
  humanLogChannelId: process.env.HUMAN_LOG_CHANNEL_ID,
  adminConsoleChannelId: process.env.ADMIN_CONSOLE_CHANNEL_ID,
  candidateRoleId: process.env.CANDIDATE_ROLE_ID,
  hrRoleId: process.env.HR_ROLE_ID,
  openBannerUrl: process.env.APPLICATION_OPEN_BANNER_URL || process.env.APPLICATION_BANNER_URL,
  closedBannerUrl: process.env.APPLICATION_CLOSED_BANNER_URL || process.env.APPLICATION_BANNER_URL,
  accentColor: Number(process.env.ACCENT_COLOR || 2368553),
  maxPendingApplications: Number(process.env.MAX_PENDING_APPLICATIONS || 3),
  spamScoreLimit: Number(process.env.SPAM_SCORE_LIMIT || 4),
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
  'HUMAN_LOG_CHANNEL_ID',
  'ADMIN_CONSOLE_CHANNEL_ID',
  'CANDIDATE_ROLE_ID',
  'HR_ROLE_ID',
  'APPLICATION_BANNER_URL'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Не заполнено поле ${key} в .env`);
    process.exit(1);
  }
}

const IDS = {
  selectApply: 'mfq_apply_select',
  modalApply: 'mfq_apply_modal',
  approvePrefix: 'mfq_apply_approve:',
  rejectPrefix: 'mfq_apply_reject:',
  rejectReasonPrefix: 'mfq_apply_reject_reason:',
  openApplications: 'mfq_admin_open_applications',
  closeApplications: 'mfq_admin_close_applications',
  refreshPanel: 'mfq_admin_refresh_panel'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

async function getGuild(interaction) {
  if (interaction.guild) return interaction.guild;
  return client.guilds.fetch(CONFIG.guildId);
}

function hasHrRole(member) {
  return Boolean(
    member?.roles?.cache?.has(CONFIG.hrRoleId) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function truncateText(value, max = 900) {
  const text = String(value || '').trim();
  if (text.length <= max) return text || '—';
  return `${text.slice(0, max - 3)}...`;
}

function hasManageAccess(member) {
  return Boolean(
    member?.roles?.cache?.has(CONFIG.hrRoleId) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function detectSpam(answers) {
  const values = Object.values(answers).map((value) => String(value || '').trim());
  const joined = values.join('\n').trim();
  const compact = joined.replace(/\s+/g, '');
  const lower = joined.toLowerCase();

  let score = 0;
  const reasons = [];

  if (joined.length < 45) {
    score += 2;
    reasons.push('слишком короткие ответы');
  }

  const letters = joined.match(/\p{L}/gu) || [];
  if (letters.length < 18) {
    score += 2;
    reasons.push('очень мало нормального текста');
  }

  if (/(.)\1{7,}/iu.test(compact)) {
    score += 3;
    reasons.push('много повторяющихся символов');
  }

  if (/https?:\/\/|discord\.gg|discord\.com\/invite/iu.test(lower)) {
    score += 3;
    reasons.push('обнаружена ссылка или инвайт');
  }

  if (/(qwerty|asdf|zxcv|йцук|фыва|олдж|ячсм|123456|abcdef)/iu.test(lower)) {
    score += 2;
    reasons.push('похоже на набор случайных клавиш');
  }

  const symbols = joined.match(/[^\p{L}\p{N}\s.,!?()+\-:;'"«»]/gu) || [];
  if (joined.length > 0 && symbols.length / joined.length > 0.35) {
    score += 2;
    reasons.push('слишком много спецсимволов');
  }

  const normalizedFields = values
    .map((value) => value.toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (normalizedFields.length >= 3 && new Set(normalizedFields).size <= 2) {
    score += 2;
    reasons.push('поля анкеты почти одинаковые');
  }

  const words = lower.match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (words.length >= 8) {
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    const maxRepeat = Math.max(...counts.values());
    if (maxRepeat >= Math.max(5, Math.ceil(words.length * 0.45))) {
      score += 2;
      reasons.push('одно и то же слово повторяется слишком часто');
    }
  }

  return {
    score,
    reasons,
    isSpam: score >= CONFIG.spamScoreLimit
  };
}

async function logHumanEvent({ title, description, fields = [], color = 0xFEE75C }) {
  if (!CONFIG.humanLogChannelId) return;

  try {
    const guild = await client.guilds.fetch(CONFIG.guildId);
    const channel = await guild.channels.fetch(CONFIG.humanLogChannelId);

    if (!channel || channel.type !== ChannelType.GuildText) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description || null)
      .setTimestamp()
      .setFooter({ text: CONFIG.footerText });

    if (fields.length) embed.addFields(fields);

    await channel.send({
      embeds: [embed],
      allowedMentions: { users: [], roles: [] }
    });
  } catch (error) {
    console.error('Не удалось отправить human-log:', error);
  }
}

async function refreshPanelMessage() {
  const settings = await getSettings();

  if (!settings.panelChannelId || !settings.panelMessageId) {
    return false;
  }

  try {
    await client.rest.patch(
      Routes.channelMessage(settings.panelChannelId, settings.panelMessageId),
      { body: await buildPanelPayload() }
    );
    return true;
  } catch (error) {
    console.error('Не удалось обновить панель заявок:', error);
    return false;
  }
}

async function buildPanelPayload() {
  const settings = await getSettings();
  const isOpen = settings.applicationsOpen !== false;
  const bannerUrl = isOpen ? CONFIG.openBannerUrl : CONFIG.closedBannerUrl;

  const textBlock = isOpen
    ? [
        `## Заявки в ${CONFIG.familyName} открыты!`,
        '',
        'Перед подачей заявки ознакомьтесь с условиями:',
        '',
        '• Для вступления в семью нужен **5+ уровень персонажа**.',
        '• Необходимо иметь **4+ часа среднего онлайна**.',
        '• Обязательно наличие **Discord** и готовность пройти обзвон.',
        '• Заявки рассматриваются по мере возможности свободного Рекрутмента.',
        '',
        'Выберите действие ниже, чтобы открыть анкету.',
        '',
        `-# ${CONFIG.footerText}`
      ].join('\n')
    : [
        `## Заявки в ${CONFIG.familyName} временно закрыты`,
        '',
        'Сейчас набор в семью приостановлен.',
        '',
        'Следите за обновлениями в этом канале — когда заявки снова откроются, здесь появится активная форма подачи.',
        '',
        `-# ${CONFIG.footerText}`
      ].join('\n');

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: CONFIG.accentColor,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: bannerUrl
                }
              }
            ]
          },
          {
            type: 10,
            content: textBlock
          },
          {
            type: 14,
            spacing: 1,
            divider: true
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: IDS.selectApply,
                placeholder: isOpen ? 'Подать заявку в семью' : 'Заявки закрыты',
                disabled: !isOpen,
                options: [
                  {
                    label: 'Подать заявку в семью',
                    description: `Открыть анкету для вступления в ${CONFIG.familyName}`,
                    emoji: { name: '📝' },
                    value: 'apply'
                  },
                  {
                    label: 'Другой выбор',
                    description: 'Сбросить выбор',
                    emoji: { name: '↩️' },
                    value: 'reset'
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

function buildAdminConsolePayload(settings) {
  const isOpen = settings.applicationsOpen !== false;
  const statusText = isOpen
    ? '🟢 **Заявки сейчас открыты.** Кандидаты могут заполнять форму.'
    : '🔴 **Заявки сейчас закрыты.** Кандидаты не могут отправлять новые анкеты.';

  const embed = new EmbedBuilder()
    .setColor(isOpen ? 0x57F287 : 0xED4245)
    .setTitle('Панель управления заявками')
    .setDescription(
      [
        statusText,
        '',
        '**Действия:**',
        '• `Открыть заявки` — включает форму и ставит баннер открытого набора.',
        '• `Закрыть заявки` — отключает форму и ставит баннер закрытого набора.',
        '• `Обновить панель` — вручную перерисовывает сообщение в канале заявок.',
        '',
        `-# ${CONFIG.footerText}`
      ].join('\n')
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.openApplications)
      .setLabel('Открыть заявки')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isOpen),
    new ButtonBuilder()
      .setCustomId(IDS.closeApplications)
      .setLabel('Закрыть заявки')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isOpen),
    new ButtonBuilder()
      .setCustomId(IDS.refreshPanel)
      .setLabel('Обновить панель')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

function buildApplyModal() {
  const modal = new ModalBuilder()
    .setCustomId(IDS.modalApply)
    .setTitle(`Заявка в ${CONFIG.familyName}`);

  const gameInfo = new TextInputBuilder()
    .setCustomId('game_info')
    .setLabel('Игровой ник + уровень персонажа')
    .setPlaceholder('Например: Spartak Monroe, 15 lvl')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const ageOnline = new TextInputBuilder()
    .setCustomId('age_online')
    .setLabel('Возраст + средний онлайн')
    .setPlaceholder('Например: 25 лет, 4 часа в день')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const previousFamilies = new TextInputBuilder()
    .setCustomId('previous_families')
    .setLabel('В каких семьях / организациях состояли?')
    .setPlaceholder('Например: Castairs, Cursed, Ethereal / не состоял')
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
    .setTitle('Новая заявка в семью')
    .setDescription(
      [
        `**Кандидат:** ${applicant}`,
        `**Discord ID:** \`${applicant.id}\`` ,
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
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildResultEmbed({ accepted, applicantId, reviewerId, reason }) {
  const color = accepted ? 0x57F287 : 0xED4245;
  const title = accepted ? '✅ Заявка принята' : '✖️ Заявка отклонена';

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
    : `✖️ Отклонено\n**Рассмотрел:** <@${reviewerId}>\n**Причина:** ${reason || 'Не указана.'}`;

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
    await interaction.editReply('У тебя нет прав Рекрутмента для рассмотрения заявок.');
    return;
  }

  const guild = await getGuild(interaction);
  const reviewMessageId = interaction.message.id;

  const application = await getApplication(reviewMessageId);
  if (application?.status && application.status !== 'pending') {
    await interaction.editReply('Эта заявка уже была рассмотрена.');
    return;
  }

  let roleGiven = false;

  try {
    const member = await guild.members.fetch(applicantId);
    await member.roles.add(CONFIG.candidateRoleId, `Заявка принята, рекрутмент: ${interaction.user.tag}`);
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
      ? 'Заявка принята. Роль кандидата выдана, результат отправлен.'
      : 'Заявка принята, результат отправлен. Но роль кандидата выдать не удалось — проверь права и позицию роли бота.'
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
    await interaction.editReply('У тебя нет прав Рекрутмента для рассмотрения заявок.');
    return;
  }

  const guild = await getGuild(interaction);

  const reviewChannel = await guild.channels.fetch(CONFIG.reviewChannelId);
  const reviewMessage = await reviewChannel.messages.fetch(reviewMessageId);

  const application = await getApplication(reviewMessageId);
  if (application?.status && application.status !== 'pending') {
    await interaction.editReply('Эта заявка уже была рассмотрена.');
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

  await interaction.editReply('Заявка отклонена, результат отправлен.');
}

client.once('ready', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'Эту команду может использовать только администратор.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const guild = await getGuild(interaction);
      const channel = await guild.channels.fetch(CONFIG.panelChannelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Канал для панели заявок не найден или не является текстовым.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const panelMessage = await client.rest.post(Routes.channelMessages(channel.id), {
        body: await buildPanelPayload()
      });

      await updateSettings({
        panelChannelId: channel.id,
        panelMessageId: panelMessage.id
      });

      await interaction.reply({
        content: `Панель подачи заявок отправлена в ${channel}.`,
        flags: MessageFlags.Ephemeral
      });

      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'console') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'Эту команду может использовать только администратор.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const guild = await getGuild(interaction);
      const channel = await guild.channels.fetch(CONFIG.adminConsoleChannelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Канал админ-консоли не найден или не является текстовым.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const settings = await getSettings();
      await channel.send(buildAdminConsolePayload(settings));

      await interaction.reply({
        content: `Админ-консоль заявок отправлена в ${channel}.`,
        flags: MessageFlags.Ephemeral
      });

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === IDS.selectApply) {
      const choice = interaction.values[0];

      if (choice === 'reset') {
        await interaction.deferUpdate();
        return;
      }

      if (choice === 'apply') {
        const settings = await getSettings();
        if (settings.applicationsOpen === false) {
          await interaction.reply({
            content: '🔴 Заявки сейчас закрыты. Следите за обновлениями в канале заявок.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.showModal(buildApplyModal());
        return;
      }

      await interaction.deferUpdate();
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

      const settings = await getSettings();
      if (settings.applicationsOpen === false) {
        await interaction.editReply('🔴 Заявки сейчас закрыты. Новые анкеты временно не принимаются.');
        return;
      }

      const pendingCount = await countPendingApplicationsByApplicant(interaction.user.id);
      if (pendingCount >= CONFIG.maxPendingApplications) {
        await logHumanEvent({
          title: '⚠️ Анти-спам: превышен лимит заявок',
          description: `Пользователь ${interaction.user} попытался отправить новую заявку, но у него уже **${pendingCount}** активных заявок.`,
          color: 0xFEE75C,
          fields: [
            { name: 'Discord ID', value: `\`${interaction.user.id}\``, inline: false },
            { name: 'Лимит', value: `${CONFIG.maxPendingApplications} активные заявки`, inline: true }
          ]
        });

        await interaction.editReply(
          `⚠️ У вас уже есть ${pendingCount} активных заявок. Дождитесь решения Рекрутмента перед новой подачей.`
        );
        return;
      }

      const spamCheck = detectSpam(answers);
      if (spamCheck.isSpam) {
        await logHumanEvent({
          title: '🚨 Анти-спам: заявка заблокирована',
          description: `Система заблокировала подозрительную заявку от ${interaction.user}.`,
          color: 0xED4245,
          fields: [
            { name: 'Discord ID', value: `\`${interaction.user.id}\``, inline: false },
            { name: 'Spam score', value: `${spamCheck.score}/${CONFIG.spamScoreLimit}`, inline: true },
            { name: 'Причины', value: spamCheck.reasons.join('\n') || '—', inline: false },
            { name: 'Игровой ник + уровень', value: truncateText(answers.gameInfo, 500), inline: false },
            { name: 'Возраст + онлайн', value: truncateText(answers.ageOnline, 500), inline: false },
            { name: 'Опыт', value: truncateText(answers.previousFamilies, 700), inline: false },
            { name: 'Почему хочет вступить', value: truncateText(answers.whyFamily, 700), inline: false },
            { name: 'Откуда узнал', value: truncateText(answers.source, 500), inline: false }
          ]
        });

        await interaction.editReply(
          '⚠️ Заявка не отправлена: система защиты посчитала ответы подозрительными. Заполните анкету нормально и без спама.'
        );
        return;
      }

      const guild = await getGuild(interaction);
      const reviewChannel = await guild.channels.fetch(CONFIG.reviewChannelId);

      if (!reviewChannel || reviewChannel.type !== ChannelType.GuildText) {
        await interaction.editReply('Канал для рассмотрения заявок не найден.');
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
        'Заявка отправлена на рассмотрение. Ожидайте решения Рекрутмента.'
      );

      return;
    }

    if (
      interaction.isButton() &&
      [IDS.openApplications, IDS.closeApplications, IDS.refreshPanel].includes(interaction.customId)
    ) {
      if (!hasManageAccess(interaction.member)) {
        await interaction.reply({
          content: 'У тебя нет прав для управления заявками.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.customId === IDS.openApplications) {
        await updateSettings({ applicationsOpen: true });
        const panelUpdated = await refreshPanelMessage();
        const settings = await getSettings();
        await interaction.update(buildAdminConsolePayload(settings));
        await logHumanEvent({
          title: '🟢 Заявки открыты',
          description: `${interaction.user} открыл заявки через админ-консоль.\nПанель заявок обновлена: **${panelUpdated ? 'да' : 'нет'}**.`,
          color: 0x57F287
        });
        return;
      }

      if (interaction.customId === IDS.closeApplications) {
        await updateSettings({ applicationsOpen: false });
        const panelUpdated = await refreshPanelMessage();
        const settings = await getSettings();
        await interaction.update(buildAdminConsolePayload(settings));
        await logHumanEvent({
          title: '🔴 Заявки закрыты',
          description: `${interaction.user} закрыл заявки через админ-консоль.\nПанель заявок обновлена: **${panelUpdated ? 'да' : 'нет'}**.`,
          color: 0xED4245
        });
        return;
      }

      if (interaction.customId === IDS.refreshPanel) {
        const panelUpdated = await refreshPanelMessage();
        const settings = await getSettings();
        await interaction.update(buildAdminConsolePayload(settings));
        await interaction.followUp({
          content: panelUpdated
            ? '✅ Панель заявок обновлена.'
            : '⚠️ Не нашёл сохранённое сообщение панели. Сначала выполните `/setup`.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith(IDS.approvePrefix)) {
      const applicantId = interaction.customId.slice(IDS.approvePrefix.length);
      await approveApplication(interaction, applicantId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(IDS.rejectPrefix)) {
      if (!hasHrRole(interaction.member)) {
        await interaction.reply({
          content: 'У тебя нет прав Рекрутмента для рассмотрения заявок.',
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
    console.error('Ошибка обработки interaction:', error);

    const message = 'Произошла ошибка. Проверь консоль бота и настройки каналов/ролей.';

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
