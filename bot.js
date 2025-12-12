/**
 * BadgRules Discord Bot - Node.js Version
 * =======================================
 * Управление пользователями через Discord + REST API для сайта
 * 
 * Команды:
 * /sub give <user_id> <plan> - Выдать подписку
 * /sub remove <user_id> - Убрать подписку
 * /sub check <user_id> - Проверить статус
 * /sub list - Список всех подписок
 * /sub extend <user_id> <days> - Продлить
 * /sub freeze <user_id> - Заморозить
 * /sub unfreeze <user_id> - Разморозить
 * 
 * /user ban <user_id> <reason> - Забанить
 * /user tempban <user_id> <days> <reason> - Временный бан
 * /user unban <user_id> - Разбанить
 * /user info <user_id> - Инфо о пользователе
 */

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // Discord
    BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID || '1445021855193895135',
    
    // Каналы
    LOGS_CHANNEL_ID: process.env.LOGS_CHANNEL_ID || '1445026471113654292',
    SUBS_CHANNEL_ID: process.env.SUBS_CHANNEL_ID || '1445026603888541716',
    BAN_CHANNEL_ID: process.env.BAN_CHANNEL_ID || '1445026603888541716',
    
    // Администраторы
    ADMIN_IDS: ['701782316623855668', '482499344982081546'],
    
    // API
    API_PORT: process.env.PORT || 5000,
    API_SECRET: process.env.API_SECRET || 'RwNbyMc-dR2g6aaz8YemkbxqHh5R7E0_',
    
    // Файлы данных
    DATA_DIR: './data',
    SUBS_FILE: './data/subscriptions.json',
    USERS_FILE: './data/users.json',
    LOGS_FILE: './data/logs.json'
};

// Тарифные планы
const PLANS = {
    '1month': { days: 30, name: '1 месяц', emoji: '📅' },
    '3months': { days: 90, name: '3 месяца', emoji: '📆' },
    '6months': { days: 180, name: '6 месяцев', emoji: '🗓️' },
    '1year': { days: 365, name: '1 год', emoji: '📅' },
    'lifetime': { days: 36500, name: 'Навсегда', emoji: '♾️' }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

class DatabaseManager {
    constructor() {
        this.data = {
            subscriptions: { subscriptions: {}, history: [] },
            users: { users: {}, banned: [] },
            logs: { logs: [] }
        };
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
            await this.loadAll();
            console.log('✅ База данных загружена');
        } catch (error) {
            console.error('❌ Ошибка инициализации БД:', error);
        }
    }

    async loadAll() {
        this.data.subscriptions = await this.loadJSON(CONFIG.SUBS_FILE, { subscriptions: {}, history: [] });
        this.data.users = await this.loadJSON(CONFIG.USERS_FILE, { users: {}, banned: [] });
        this.data.logs = await this.loadJSON(CONFIG.LOGS_FILE, { logs: [] });
    }

    async loadJSON(filepath, defaultValue) {
        try {
            const data = await fs.readFile(filepath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            await this.saveJSON(filepath, defaultValue);
            return defaultValue;
        }
    }

    async saveJSON(filepath, data) {
        await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    }

    async saveAll() {
        await this.saveJSON(CONFIG.SUBS_FILE, this.data.subscriptions);
        await this.saveJSON(CONFIG.USERS_FILE, this.data.users);
        await this.saveJSON(CONFIG.LOGS_FILE, this.data.logs);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUBSCRIPTION METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    async grantSubscription(userId, plan, days, adminId, reason = '') {
        const now = new Date();
        const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

        const sub = {
            user_id: userId,
            plan: plan,
            type: days >= 36500 ? 'lifetime' : 'pro',
            granted_at: now.toISOString(),
            expires_at: expires.toISOString(),
            granted_by: adminId,
            reason: reason,
            active: true
        };

        this.data.subscriptions.subscriptions[userId] = sub;
        this.data.subscriptions.history.push({
            action: 'grant',
            user_id: userId,
            plan: plan,
            admin_id: adminId,
            reason: reason,
            timestamp: now.toISOString()
        });

        await this.saveAll();
        console.log(`✅ Подписка выдана: ${userId} - ${plan}`);
        return sub;
    }

    async removeSubscription(userId, adminId, reason = '') {
        if (this.data.subscriptions.subscriptions[userId]) {
            delete this.data.subscriptions.subscriptions[userId];
            
            this.data.subscriptions.history.push({
                action: 'remove',
                user_id: userId,
                admin_id: adminId,
                reason: reason,
                timestamp: new Date().toISOString()
            });

            await this.saveAll();
            console.log(`✅ Подписка удалена: ${userId}`);
            return true;
        }
        return false;
    }

    getSubscription(userId) {
        const sub = this.data.subscriptions.subscriptions[userId];
        if (sub) {
            const expires = new Date(sub.expires_at);
            const now = new Date();
            
            if (expires < now) {
                sub.active = false;
            }
        }
        return sub || null;
    }

    getAllSubscriptions(filter = 'all') {
        const subs = this.data.subscriptions.subscriptions;
        const now = new Date();

        if (filter === 'active') {
            return Object.fromEntries(
                Object.entries(subs).filter(([_, sub]) => 
                    sub.active && new Date(sub.expires_at) > now
                )
            );
        } else if (filter === 'expired') {
            return Object.fromEntries(
                Object.entries(subs).filter(([_, sub]) => 
                    new Date(sub.expires_at) < now
                )
            );
        } else if (filter === 'lifetime') {
            return Object.fromEntries(
                Object.entries(subs).filter(([_, sub]) => sub.type === 'lifetime')
            );
        }
        return subs;
    }

    async extendSubscription(userId, days, adminId, reason = '') {
        const sub = this.getSubscription(userId);
        if (!sub) return null;

        const currentExpires = new Date(sub.expires_at);
        const newExpires = new Date(currentExpires.getTime() + days * 24 * 60 * 60 * 1000);

        sub.expires_at = newExpires.toISOString();
        sub.active = true;

        this.data.subscriptions.history.push({
            action: 'extend',
            user_id: userId,
            days: days,
            admin_id: adminId,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        await this.saveAll();
        console.log(`✅ Подписка продлена: ${userId} на ${days} дней`);
        return sub;
    }

    async freezeSubscription(userId, adminId, reason = '') {
        const sub = this.getSubscription(userId);
        if (!sub) return null;

        sub.frozen = true;
        sub.frozen_at = new Date().toISOString();

        this.data.subscriptions.history.push({
            action: 'freeze',
            user_id: userId,
            admin_id: adminId,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        await this.saveAll();
        return sub;
    }

    async unfreezeSubscription(userId, adminId, reason = '') {
        const sub = this.getSubscription(userId);
        if (!sub || !sub.frozen) return null;

        const frozenDuration = new Date() - new Date(sub.frozen_at);
        const currentExpires = new Date(sub.expires_at);
        const newExpires = new Date(currentExpires.getTime() + frozenDuration);

        sub.expires_at = newExpires.toISOString();
        sub.frozen = false;
        delete sub.frozen_at;

        this.data.subscriptions.history.push({
            action: 'unfreeze',
            user_id: userId,
            admin_id: adminId,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        await this.saveAll();
        return sub;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // USER METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    async banUser(userId, adminId, reason = '', temporary = false, days = 0) {
        const ban = {
            user_id: userId,
            banned_at: new Date().toISOString(),
            banned_by: adminId,
            reason: reason,
            active: true,
            temporary: temporary
        };

        if (temporary) {
            const expires = new Date();
            expires.setDate(expires.getDate() + days);
            ban.expires_at = expires.toISOString();
        }

        if (!this.data.users.users[userId]) {
            this.data.users.users[userId] = {};
        }

        this.data.users.users[userId].banned = true;
        this.data.users.users[userId].ban_info = ban;
        this.data.users.banned.push(ban);

        await this.saveAll();
        console.log(`✅ Пользователь забанен: ${userId}`);
        return ban;
    }

    async unbanUser(userId, adminId, reason = '') {
        if (this.data.users.users[userId]) {
            this.data.users.users[userId].banned = false;
            this.data.users.users[userId].unban_info = {
                unbanned_at: new Date().toISOString(),
                unbanned_by: adminId,
                reason: reason
            };

            await this.saveAll();
            console.log(`✅ Пользователь разбанен: ${userId}`);
            return true;
        }
        return false;
    }

    isBanned(userId) {
        const user = this.data.users.users[userId];
        if (!user || !user.banned) return false;

        const banInfo = user.ban_info;
        if (banInfo && banInfo.temporary) {
            const expires = new Date(banInfo.expires_at);
            if (expires < new Date()) {
                this.unbanUser(userId, 'system', 'Temporary ban expired');
                return false;
            }
        }

        return true;
    }

    getUserInfo(userId) {
        const user = this.data.users.users[userId] || {};
        const sub = this.getSubscription(userId);

        return {
            user_id: userId,
            banned: user.banned || false,
            ban_info: user.ban_info || null,
            subscription: sub,
            created_at: user.created_at || null,
            last_login: user.last_login || null
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LOGS
    // ═══════════════════════════════════════════════════════════════════════════════

    async addLog(eventType, userId, data = {}) {
        const log = {
            id: Date.now().toString(),
            event_type: eventType,
            user_id: userId,
            data: data,
            timestamp: new Date().toISOString()
        };

        this.data.logs.logs.push(log);
        
        // Хранить только последние 1000 логов
        if (this.data.logs.logs.length > 1000) {
            this.data.logs.logs = this.data.logs.logs.slice(-1000);
        }

        await this.saveAll();
        return log;
    }

    getLogs(limit = 50) {
        return this.data.logs.logs.slice(-limit).reverse();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCORD BOT
// ═══════════════════════════════════════════════════════════════════════════════

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

const db = new DatabaseManager();

// Проверка прав админа
function isAdmin(userId) {
    return CONFIG.ADMIN_IDS.includes(userId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const commands = [
    // SUB GIVE
    new SlashCommandBuilder()
        .setName('sub-give')
        .setDescription('Выдать подписку пользователю')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('plan')
                .setDescription('Тарифный план')
                .setRequired(true)
                .addChoices(
                    { name: '1 месяц', value: '1month' },
                    { name: '3 месяца', value: '3months' },
                    { name: '6 месяцев', value: '6months' },
                    { name: '1 год', value: '1year' },
                    { name: 'Навсегда', value: 'lifetime' }
                ))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Количество дней (опционально)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина выдачи')
                .setRequired(false)),

    // SUB REMOVE
    new SlashCommandBuilder()
        .setName('sub-remove')
        .setDescription('Убрать подписку у пользователя')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина удаления')
                .setRequired(false)),

    // SUB CHECK
    new SlashCommandBuilder()
        .setName('sub-check')
        .setDescription('Проверить статус подписки')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true)),

    // SUB LIST
    new SlashCommandBuilder()
        .setName('sub-list')
        .setDescription('Список всех подписок')
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('Фильтр')
                .setRequired(false)
                .addChoices(
                    { name: 'Все', value: 'all' },
                    { name: 'Активные', value: 'active' },
                    { name: 'Истекшие', value: 'expired' },
                    { name: 'Навсегда', value: 'lifetime' }
                )),

    // SUB EXTEND
    new SlashCommandBuilder()
        .setName('sub-extend')
        .setDescription('Продлить подписку')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Количество дней')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина продления')
                .setRequired(false)),

    // USER BAN
    new SlashCommandBuilder()
        .setName('user-ban')
        .setDescription('Забанить пользователя')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина бана')
                .setRequired(false)),

    // USER TEMPBAN
    new SlashCommandBuilder()
        .setName('user-tempban')
        .setDescription('Временно забанить пользователя')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Количество дней')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина бана')
                .setRequired(false)),

    // USER UNBAN
    new SlashCommandBuilder()
        .setName('user-unban')
        .setDescription('Разбанить пользователя')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Причина разбана')
                .setRequired(false)),

    // USER INFO
    new SlashCommandBuilder()
        .setName('user-info')
        .setDescription('Информация о пользователе')
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('Discord ID пользователя')
                .setRequired(true))
].map(command => command.toJSON());

// Регистрация команд
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);
    
    try {
        console.log('🔄 Регистрация slash команд...');
        
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );
        
        console.log(`✅ Зарегистрировано ${commands.length} команд`);
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
}

// Обработчики команд
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user } = interaction;

    // Проверка прав
    if (!isAdmin(user.id)) {
        return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }

    try {
        if (commandName === 'sub-give') {
            await handleSubGive(interaction);
        } else if (commandName === 'sub-remove') {
            await handleSubRemove(interaction);
        } else if (commandName === 'sub-check') {
            await handleSubCheck(interaction);
        } else if (commandName === 'sub-list') {
            await handleSubList(interaction);
        } else if (commandName === 'sub-extend') {
            await handleSubExtend(interaction);
        } else if (commandName === 'user-ban') {
            await handleUserBan(interaction);
        } else if (commandName === 'user-tempban') {
            await handleUserTempban(interaction);
        } else if (commandName === 'user-unban') {
            await handleUserUnban(interaction);
        } else if (commandName === 'user-info') {
            await handleUserInfo(interaction);
        }
    } catch (error) {
        console.error('❌ Ошибка выполнения команды:', error);
        await interaction.reply({ content: '❌ Произошла ошибка!', ephemeral: true });
    }
});

// Command Handlers
async function handleSubGive(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const plan = interaction.options.getString('plan');
    const customDays = interaction.options.getInteger('days');
    const reason = interaction.options.getString('reason') || 'Выдано администратором';

    const days = customDays || PLANS[plan].days;
    const sub = await db.grantSubscription(userId, plan, days, interaction.user.id, reason);

    const embed = new EmbedBuilder()
        .setTitle('💎 Подписка выдана')
        .setDescription(`**User ID:** \`${userId}\`\n**План:** ${PLANS[plan].emoji} ${PLANS[plan].name}\n**Дней:** ${days}\n**Истекает:** <t:${Math.floor(new Date(sub.expires_at).getTime() / 1000)}:R>`)
        .addFields({ name: 'Причина', value: reason })
        .setColor('#00ff00')
        .setFooter({ text: `Выдал: ${interaction.user.username}` })
        .setTimestamp();

    await interaction.followUp({ embeds: [embed] });

    // Отправить в канал
    const channel = client.channels.cache.get(CONFIG.SUBS_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [embed] });
}

async function handleSubRemove(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'Удалено администратором';

    const success = await db.removeSubscription(userId, interaction.user.id, reason);

    if (success) {
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Подписка удалена')
            .setDescription(`**User ID:** \`${userId}\``)
            .addFields({ name: 'Причина', value: reason })
            .setColor('#ff0000')
            .setFooter({ text: `Удалил: ${interaction.user.username}` })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });
    } else {
        await interaction.followUp({ content: '❌ Подписка не найдена!' });
    }
}

async function handleSubCheck(interaction) {
    const userId = interaction.options.getString('user_id');
    const sub = db.getSubscription(userId);

    if (!sub) {
        return interaction.reply({ content: '❌ Подписка не найдена!', ephemeral: true });
    }

    const expires = new Date(sub.expires_at);
    const now = new Date();
    const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

    const embed = new EmbedBuilder()
        .setTitle('💎 Информация о подписке')
        .setDescription(`**User ID:** \`${userId}\``)
        .addFields(
            { name: 'Тип', value: sub.type === 'lifetime' ? '♾️ Навсегда' : '💎 PRO', inline: true },
            { name: 'План', value: sub.plan, inline: true },
            { name: 'Активна', value: sub.active ? '✅ Да' : '❌ Нет', inline: true },
            { name: 'Выдана', value: `<t:${Math.floor(new Date(sub.granted_at).getTime() / 1000)}:R>`, inline: true },
            { name: 'Истекает', value: `<t:${Math.floor(expires.getTime() / 1000)}:R>`, inline: true },
            { name: 'Осталось', value: daysLeft > 0 ? `${daysLeft} дней` : 'Истекла', inline: true }
        )
        .setColor('#00ff00')
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSubList(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const filter = interaction.options.getString('filter') || 'all';
    const subs = db.getAllSubscriptions(filter);
    const count = Object.keys(subs).length;

    if (count === 0) {
        return interaction.followUp({ content: '❌ Подписки не найдены!' });
    }

    const list = Object.entries(subs)
        .slice(0, 20)
        .map(([userId, sub]) => {
            const expires = new Date(sub.expires_at);
            return `• \`${userId}\` - ${sub.type === 'lifetime' ? '♾️' : '💎'} ${sub.plan} (до <t:${Math.floor(expires.getTime() / 1000)}:d>)`;
        })
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`📋 Список подписок (${count})`)
        .setDescription(list + (count > 20 ? `\n\n*... и ещё ${count - 20}*` : ''))
        .setColor('#00ff00')
        .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
}

async function handleSubExtend(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const days = interaction.options.getInteger('days');
    const reason = interaction.options.getString('reason') || 'Продлено администратором';

    const sub = await db.extendSubscription(userId, days, interaction.user.id, reason);

    if (sub) {
        const embed = new EmbedBuilder()
            .setTitle('⏰ Подписка продлена')
            .setDescription(`**User ID:** \`${userId}\`\n**Продлено на:** ${days} дней\n**Новая дата:** <t:${Math.floor(new Date(sub.expires_at).getTime() / 1000)}:R>`)
            .addFields({ name: 'Причина', value: reason })
            .setColor('#00ff00')
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });
    } else {
        await interaction.followUp({ content: '❌ Подписка не найдена!' });
    }
}

async function handleUserBan(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'Нарушение правил';

    await db.banUser(userId, interaction.user.id, reason);

    const embed = new EmbedBuilder()
        .setTitle('🔨 Пользователь забанен')
        .setDescription(`**User ID:** \`${userId}\``)
        .addFields({ name: 'Причина', value: reason })
        .setColor('#ff0000')
        .setFooter({ text: `Забанил: ${interaction.user.username}` })
        .setTimestamp();

    await interaction.followUp({ embeds: [embed] });

    const channel = client.channels.cache.get(CONFIG.BAN_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [embed] });
}

async function handleUserTempban(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const days = interaction.options.getInteger('days');
    const reason = interaction.options.getString('reason') || 'Временное нарушение';

    await db.banUser(userId, interaction.user.id, reason, true, days);

    const embed = new EmbedBuilder()
        .setTitle('⏰ Временный бан')
        .setDescription(`**User ID:** \`${userId}\`\n**Длительность:** ${days} дней`)
        .addFields({ name: 'Причина', value: reason })
        .setColor('#ff9900')
        .setFooter({ text: `Забанил: ${interaction.user.username}` })
        .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
}

async function handleUserUnban(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'Разбанен администратором';

    const success = await db.unbanUser(userId, interaction.user.id, reason);

    if (success) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Пользователь разбанен')
            .setDescription(`**User ID:** \`${userId}\``)
            .addFields({ name: 'Причина', value: reason })
            .setColor('#00ff00')
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });
    } else {
        await interaction.followUp({ content: '❌ Пользователь не найден!' });
    }
}

async function handleUserInfo(interaction) {
    const userId = interaction.options.getString('user_id');
    const info = db.getUserInfo(userId);

    const embed = new EmbedBuilder()
        .setTitle('👤 Информация о пользователе')
        .setDescription(`**User ID:** \`${userId}\``)
        .addFields(
            { name: 'Забанен', value: info.banned ? '🔨 Да' : '✅ Нет', inline: true },
            { name: 'Подписка', value: info.subscription ? `${info.subscription.type === 'lifetime' ? '♾️' : '💎'} ${info.subscription.plan}` : '⚡ FREE', inline: true }
        )
        .setColor('#0099ff')
        .setTimestamp();

    if (info.banned && info.ban_info) {
        embed.addFields({ name: 'Причина бана', value: info.ban_info.reason || 'Не указана' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Bot ready
client.once('ready', async () => {
    console.log(`✅ Бот запущен: ${client.user.tag}`);
    await registerCommands();
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS API SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware
const authenticateAPI = (req, res, next) => {
    const secret = req.headers['x-api-secret'];
    if (secret !== CONFIG.API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// API Routes
app.get('/api/subscription/:userId', authenticateAPI, (req, res) => {
    const { userId } = req.params;
    const sub = db.getSubscription(userId);
    const banned = db.isBanned(userId);

    console.log(`📡 API: Запрос подписки для ${userId}`);
    
    res.json({
        user_id: userId,
        subscription: sub,
        banned: banned
    });
});

app.get('/api/subscriptions', authenticateAPI, (req, res) => {
    const filter = req.query.filter || 'all';
    const subs = db.getAllSubscriptions(filter);
    
    res.json({
        subscriptions: subs,
        count: Object.keys(subs).length
    });
});

app.post('/api/log', authenticateAPI, async (req, res) => {
    const { event_type, user_id, data } = req.body;
    
    const log = await db.addLog(event_type, user_id, data);
    
    // Отправить в Discord канал
    const channel = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`📝 ${event_type}`)
            .setDescription(`User ID: \`${user_id}\``)
            .setColor('#0099ff')
            .setTimestamp();

        for (const [key, value] of Object.entries(data)) {
            embed.addFields({ name: key, value: String(value).substring(0, 1024) });
        }

        await channel.send({ embeds: [embed] });
    }
    
    res.json({ status: 'ok', log: log });
});

app.get('/api/logs', authenticateAPI, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const logs = db.getLogs(limit);
    
    res.json({ logs: logs, count: logs.length });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Start server
app.listen(CONFIG.API_PORT, '0.0.0.0', () => {
    console.log(`✅ API сервер запущен на порту ${CONFIG.API_PORT}`);
    console.log(`🌐 CORS включён - разрешены запросы с любого origin`);
});

// Login bot
client.login(CONFIG.BOT_TOKEN).catch(error => {
    console.error('❌ Ошибка входа:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Остановка бота...');
    await db.saveAll();
    client.destroy();
    process.exit(0);
});
