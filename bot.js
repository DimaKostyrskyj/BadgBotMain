/**
 * BadgRules Discord Bot - Node.js Version with Debug Control
 * ===========================================================
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
 * 
 * /debug enable - Включить логи (только владелец)
 * /debug disable - Выключить логи (только владелец)
 * /debug status - Проверить статус логирования
 * /debug report - Получить все логи и ошибки
 */

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// DEBUG SYSTEM - Система управления логами
// ═══════════════════════════════════════════════════════════════════════════════

class DebugSystem {
    constructor() {
        this.enabled = false;
        this.logs = [];
        this.errors = [];
        this.maxLogs = 1000; // Максимум логов в памяти
        
        // Перехватываем все console методы
        this.originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.debug
        };
        
        this.setupInterceptors();
    }
    
    setupInterceptors() {
        const self = this;
        
        console.log = (...args) => {
            if (self.enabled) {
                self.originalConsole.log(...args);
            }
            self.addLog('LOG', args);
        };
        
        console.error = (...args) => {
            if (self.enabled) {
                self.originalConsole.error(...args);
            }
            self.addLog('ERROR', args);
        };
        
        console.warn = (...args) => {
            if (self.enabled) {
                self.originalConsole.warn(...args);
            }
            self.addLog('WARN', args);
        };
        
        console.info = (...args) => {
            if (self.enabled) {
                self.originalConsole.info(...args);
            }
            self.addLog('INFO', args);
        };
        
        console.debug = (...args) => {
            if (self.enabled) {
                self.originalConsole.debug(...args);
            }
            self.addLog('DEBUG', args);
        };
    }
    
    addLog(type, args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
        
        const logEntry = {
            timestamp,
            type,
            message
        };
        
        if (type === 'ERROR') {
            this.errors.push(logEntry);
            if (this.errors.length > this.maxLogs) {
                this.errors.shift();
            }
        }
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }
    
    enable() {
        this.enabled = true;
        this.originalConsole.log('🔍 Debug mode ENABLED - Логи включены');
    }
    
    disable() {
        this.enabled = false;
        this.originalConsole.log('🔒 Debug mode DISABLED - Логи выключены');
    }
    
    getStatus() {
        return {
            enabled: this.enabled,
            totalLogs: this.logs.length,
            totalErrors: this.errors.length,
            lastLog: this.logs[this.logs.length - 1] || null,
            lastError: this.errors[this.errors.length - 1] || null
        };
    }
    
    getReport() {
        return {
            enabled: this.enabled,
            logs: this.logs,
            errors: this.errors,
            summary: {
                totalLogs: this.logs.length,
                totalErrors: this.errors.length,
                errorRate: this.logs.length > 0 ? (this.errors.length / this.logs.length * 100).toFixed(2) + '%' : '0%'
            }
        };
    }
    
    clearLogs() {
        this.logs = [];
        this.errors = [];
    }
}

// Создаем глобальную систему дебага
const DEBUG = new DebugSystem();

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
    OWNER_ID: '482499344982081546', // Только владелец может управлять дебагом
    
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
        const sub = this.data.subscriptions.subscriptions[userId];
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
        const sub = this.data.subscriptions.subscriptions[userId];
        if (!sub) return null;

        sub.frozen = true;
        sub.frozen_at = new Date().toISOString();
        sub.frozen_by = adminId;

        this.data.subscriptions.history.push({
            action: 'freeze',
            user_id: userId,
            admin_id: adminId,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        await this.saveAll();
        console.log(`❄️ Подписка заморожена: ${userId}`);
        return sub;
    }

    async unfreezeSubscription(userId, adminId, reason = '') {
        const sub = this.data.subscriptions.subscriptions[userId];
        if (!sub) return null;

        sub.frozen = false;
        delete sub.frozen_at;
        delete sub.frozen_by;

        this.data.subscriptions.history.push({
            action: 'unfreeze',
            user_id: userId,
            admin_id: adminId,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        await this.saveAll();
        console.log(`🔥 Подписка разморожена: ${userId}`);
        return sub;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // USER MANAGEMENT METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    async banUser(userId, reason, adminId, duration = null) {
        const now = new Date();
        const ban = {
            user_id: userId,
            reason: reason,
            banned_by: adminId,
            banned_at: now.toISOString(),
            expires_at: duration ? new Date(now.getTime() + duration * 24 * 60 * 60 * 1000).toISOString() : null,
            active: true
        };

        this.data.users.banned.push(ban);
        
        if (this.data.users.users[userId]) {
            this.data.users.users[userId].banned = true;
        }

        await this.saveAll();
        console.log(`🚫 Пользователь забанен: ${userId}`);
        return ban;
    }

    async unbanUser(userId, adminId, reason = '') {
        this.data.users.banned = this.data.users.banned.filter(ban => ban.user_id !== userId);
        
        if (this.data.users.users[userId]) {
            this.data.users.users[userId].banned = false;
        }

        await this.saveAll();
        console.log(`✅ Пользователь разбанен: ${userId}`);
        return true;
    }

    isUserBanned(userId) {
        const ban = this.data.users.banned.find(b => b.user_id === userId && b.active);
        if (!ban) return false;

        if (ban.expires_at) {
            const expires = new Date(ban.expires_at);
            if (expires < new Date()) {
                ban.active = false;
                return false;
            }
        }
        return true;
    }

    getUserInfo(userId) {
        return {
            user: this.data.users.users[userId] || null,
            subscription: this.getSubscription(userId),
            banned: this.isUserBanned(userId)
        };
    }

    async addLog(action, userId, adminId, details = {}) {
        this.data.logs.logs.push({
            action,
            user_id: userId,
            admin_id: adminId,
            details,
            timestamp: new Date().toISOString()
        });

        // Ограничиваем количество логов
        if (this.data.logs.logs.length > 10000) {
            this.data.logs.logs = this.data.logs.logs.slice(-5000);
        }

        await this.saveAll();
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

// Регистрация команд
const commands = [
    // SUB команды
    new SlashCommandBuilder()
        .setName('sub')
        .setDescription('Управление подписками')
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Выдать подписку')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('plan')
                        .setDescription('Тарифный план')
                        .setRequired(true)
                        .addChoices(
                            { name: '📅 1 месяц', value: '1month' },
                            { name: '📆 3 месяца', value: '3months' },
                            { name: '🗓️ 6 месяцев', value: '6months' },
                            { name: '📅 1 год', value: '1year' },
                            { name: '♾️ Навсегда', value: 'lifetime' }
                        ))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина выдачи')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Убрать подписку')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина удаления')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Проверить статус подписки')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Список подписок')
                .addStringOption(option =>
                    option.setName('filter')
                        .setDescription('Фильтр')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Все', value: 'all' },
                            { name: 'Активные', value: 'active' },
                            { name: 'Истекшие', value: 'expired' },
                            { name: 'Навсегда', value: 'lifetime' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('extend')
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
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('freeze')
                .setDescription('Заморозить подписку')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина заморозки')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unfreeze')
                .setDescription('Разморозить подписку')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина разморозки')
                        .setRequired(false))),

    // USER команды
    new SlashCommandBuilder()
        .setName('user')
        .setDescription('Управление пользователями')
        .addSubcommand(subcommand =>
            subcommand
                .setName('ban')
                .setDescription('Забанить пользователя')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина бана')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('tempban')
                .setDescription('Временный бан')
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
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unban')
                .setDescription('Разбанить пользователя')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Причина разбана')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Информация о пользователе')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('Discord ID пользователя')
                        .setRequired(true))),

    // DEBUG команды
    new SlashCommandBuilder()
        .setName('debug')
        .setDescription('Управление системой логирования (только владелец)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Включить логи'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Выключить логи'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Статус системы логирования'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('report')
                .setDescription('Получить полный отчет по логам'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Очистить все логи'))
];

// Регистрация команд в Discord
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);
        
        console.log('🔄 Регистрация команд...');
        
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );
        
        console.log('✅ Команды зарегистрированы');
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user } = interaction;
    const adminId = user.id;

    // Проверка прав администратора для всех команд кроме debug
    if (commandName !== 'debug' && !CONFIG.ADMIN_IDS.includes(adminId)) {
        return interaction.reply({
            content: '❌ У вас нет прав для использования этой команды',
            ephemeral: true
        });
    }

    // Проверка прав владельца для debug команд
    if (commandName === 'debug' && adminId !== CONFIG.OWNER_ID) {
        return interaction.reply({
            content: '❌ Только владелец бота может управлять системой логирования',
            ephemeral: true
        });
    }

    try {
        if (commandName === 'sub') {
            await handleSubCommand(interaction);
        } else if (commandName === 'user') {
            await handleUserCommand(interaction);
        } else if (commandName === 'debug') {
            await handleDebugCommand(interaction);
        }
    } catch (error) {
        console.error(`❌ Ошибка выполнения команды ${commandName}:`, error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('❌ Ошибка')
            .setDescription('Произошла ошибка при выполнении команды')
            .addFields({ name: 'Ошибка', value: `\`\`\`${error.message}\`\`\`` })
            .setTimestamp();

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEBUG COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleDebugCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'enable') {
        DEBUG.enable();
        
        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('🔍 Debug Mode Enabled')
            .setDescription('Система логирования **включена**\nВсе логи и ошибки теперь отображаются')
            .addFields(
                { name: '📊 Статус', value: '```Enabled: ✅\nВидимость: Полная```' }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (subcommand === 'disable') {
        DEBUG.disable();
        
        const embed = new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🔒 Debug Mode Disabled')
            .setDescription('Система логирования **выключена**\nВсе логи и ошибки скрыты (но записываются)')
            .addFields(
                { name: '📊 Статус', value: '```Enabled: ❌\nВидимость: Скрыта```' }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (subcommand === 'status') {
        const status = DEBUG.getStatus();
        
        const embed = new EmbedBuilder()
            .setColor(status.enabled ? 0x22c55e : 0x6b7280)
            .setTitle('📊 Debug System Status')
            .setDescription(`Текущий статус системы логирования`)
            .addFields(
                { name: '🔍 Режим', value: `\`\`\`${status.enabled ? '✅ Включен' : '❌ Выключен'}\`\`\``, inline: true },
                { name: '📝 Всего логов', value: `\`\`\`${status.totalLogs}\`\`\``, inline: true },
                { name: '❌ Ошибок', value: `\`\`\`${status.totalErrors}\`\`\``, inline: true }
            )
            .setTimestamp();

        if (status.lastLog) {
            embed.addFields({
                name: '📄 Последний лог',
                value: `\`\`\`${status.lastLog.type}: ${status.lastLog.message.substring(0, 100)}...\`\`\``
            });
        }

        if (status.lastError) {
            embed.addFields({
                name: '⚠️ Последняя ошибка',
                value: `\`\`\`${status.lastError.message.substring(0, 100)}...\`\`\``
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (subcommand === 'report') {
        await interaction.deferReply({ ephemeral: true });
        
        const report = DEBUG.getReport();
        
        // Создаем файл с полным отчетом
        const reportText = `
═══════════════════════════════════════════════════════════════
                    BADGRULES DEBUG REPORT
═══════════════════════════════════════════════════════════════

Время создания: ${new Date().toISOString()}
Статус: ${report.enabled ? 'ENABLED ✅' : 'DISABLED ❌'}

─────────────────────────────────────────────────────────────
СТАТИСТИКА
─────────────────────────────────────────────────────────────
Всего логов: ${report.summary.totalLogs}
Всего ошибок: ${report.summary.totalErrors}
Процент ошибок: ${report.summary.errorRate}

─────────────────────────────────────────────────────────────
ОШИБКИ (${report.errors.length})
─────────────────────────────────────────────────────────────
${report.errors.map((err, i) => `
[${i + 1}] ${err.timestamp}
TYPE: ${err.type}
MESSAGE: ${err.message}
${'─'.repeat(60)}
`).join('\n')}

─────────────────────────────────────────────────────────────
ВСЕ ЛОГИ (последние 500)
─────────────────────────────────────────────────────────────
${report.logs.slice(-500).map((log, i) => `
[${i + 1}] ${log.timestamp} | ${log.type}
${log.message}
${'─'.repeat(60)}
`).join('\n')}

═══════════════════════════════════════════════════════════════
                    END OF REPORT
═══════════════════════════════════════════════════════════════
        `;

        // Сохраняем отчет во временный файл
        const reportPath = path.join(__dirname, 'debug-report.txt');
        await fs.writeFile(reportPath, reportText, 'utf8');

        const embed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('📋 Debug Report Generated')
            .setDescription('Полный отчет по логам и ошибкам')
            .addFields(
                { name: '📊 Всего логов', value: `\`${report.summary.totalLogs}\``, inline: true },
                { name: '❌ Всего ошибок', value: `\`${report.summary.totalErrors}\``, inline: true },
                { name: '📈 Процент ошибок', value: `\`${report.summary.errorRate}\``, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed],
            files: [{
                attachment: reportPath,
                name: `debug-report-${Date.now()}.txt`
            }]
        });

        // Удаляем временный файл после отправки
        setTimeout(async () => {
            try {
                await fs.unlink(reportPath);
            } catch (e) {
                // Игнорируем ошибки удаления
            }
        }, 5000);

    } else if (subcommand === 'clear') {
        const oldCount = {
            logs: DEBUG.logs.length,
            errors: DEBUG.errors.length
        };
        
        DEBUG.clearLogs();
        
        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('🗑️ Logs Cleared')
            .setDescription('Все логи и ошибки очищены')
            .addFields(
                { name: '📝 Удалено логов', value: `\`${oldCount.logs}\``, inline: true },
                { name: '❌ Удалено ошибок', value: `\`${oldCount.errors}\``, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSubCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const adminId = interaction.user.id;

    if (subcommand === 'give') {
        const userId = interaction.options.getString('user_id');
        const plan = interaction.options.getString('plan');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        const planInfo = PLANS[plan];
        if (!planInfo) {
            return interaction.editReply({ content: '❌ Неверный тарифный план' });
        }

        const sub = await db.grantSubscription(userId, plan, planInfo.days, adminId, reason);

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('✅ Подписка выдана')
            .setDescription(`Подписка успешно выдана пользователю <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '📦 План', value: `${planInfo.emoji} ${planInfo.name}`, inline: true },
                { name: '⏳ Срок', value: planInfo.days >= 36500 ? 'Навсегда' : `${planInfo.days} дней`, inline: true },
                { name: '📅 Истекает', value: `<t:${Math.floor(new Date(sub.expires_at).getTime() / 1000)}:F>`, inline: false },
                { name: '💼 Выдал', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.SUBS_CHANNEL_ID, embed);

    } else if (subcommand === 'remove') {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        const removed = await db.removeSubscription(userId, adminId, reason);

        if (!removed) {
            return interaction.editReply({ content: '❌ У пользователя нет подписки' });
        }

        const embed = new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🗑️ Подписка удалена')
            .setDescription(`Подписка удалена у пользователя <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Удалил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.SUBS_CHANNEL_ID, embed);

    } else if (subcommand === 'check') {
        const userId = interaction.options.getString('user_id');
        const sub = db.getSubscription(userId);

        if (!sub) {
            return interaction.reply({
                content: `❌ У пользователя <@${userId}> нет подписки`,
                ephemeral: true
            });
        }

        const expires = new Date(sub.expires_at);
        const now = new Date();
        const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        const isActive = expires > now && sub.active && !sub.frozen;

        const embed = new EmbedBuilder()
            .setColor(isActive ? 0x22c55e : 0xef4444)
            .setTitle('📊 Статус подписки')
            .setDescription(`Информация о подписке <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '📦 План', value: sub.plan, inline: true },
                { name: '🎯 Тип', value: sub.type, inline: true },
                { name: '✅ Активна', value: isActive ? 'Да' : 'Нет', inline: true },
                { name: '❄️ Заморожена', value: sub.frozen ? 'Да' : 'Нет', inline: true },
                { name: '⏳ Осталось дней', value: daysLeft > 0 ? `${daysLeft}` : 'Истекла', inline: true },
                { name: '📅 Выдана', value: `<t:${Math.floor(new Date(sub.granted_at).getTime() / 1000)}:F>`, inline: false },
                { name: '📅 Истекает', value: `<t:${Math.floor(expires.getTime() / 1000)}:F>`, inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (subcommand === 'list') {
        const filter = interaction.options.getString('filter') || 'all';
        const subs = db.getAllSubscriptions(filter);
        const subsArray = Object.entries(subs);

        if (subsArray.length === 0) {
            return interaction.reply({
                content: '📭 Подписок не найдено',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('📋 Список подписок')
            .setDescription(`Фильтр: **${filter}**\nВсего: **${subsArray.length}**`)
            .setTimestamp();

        // Показываем первые 10 подписок
        subsArray.slice(0, 10).forEach(([userId, sub]) => {
            const expires = new Date(sub.expires_at);
            const now = new Date();
            const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
            const status = expires > now && sub.active ? '✅' : '❌';

            embed.addFields({
                name: `${status} <@${userId}>`,
                value: `План: ${sub.plan} | Дней: ${daysLeft > 0 ? daysLeft : 'Истекла'}`,
                inline: false
            });
        });

        if (subsArray.length > 10) {
            embed.setFooter({ text: `Показано 10 из ${subsArray.length} подписок` });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (subcommand === 'extend') {
        const userId = interaction.options.getString('user_id');
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        const sub = await db.extendSubscription(userId, days, adminId, reason);

        if (!sub) {
            return interaction.editReply({ content: '❌ У пользователя нет подписки' });
        }

        const embed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('⏰ Подписка продлена')
            .setDescription(`Подписка продлена для <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '➕ Добавлено дней', value: `${days}`, inline: true },
                { name: '📅 Новая дата истечения', value: `<t:${Math.floor(new Date(sub.expires_at).getTime() / 1000)}:F>`, inline: false },
                { name: '💼 Продлил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.SUBS_CHANNEL_ID, embed);

    } else if (subcommand === 'freeze') {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        const sub = await db.freezeSubscription(userId, adminId, reason);

        if (!sub) {
            return interaction.editReply({ content: '❌ У пользователя нет подписки' });
        }

        const embed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setTitle('❄️ Подписка заморожена')
            .setDescription(`Подписка заморожена для <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Заморозил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.SUBS_CHANNEL_ID, embed);

    } else if (subcommand === 'unfreeze') {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        const sub = await db.unfreezeSubscription(userId, adminId, reason);

        if (!sub) {
            return interaction.editReply({ content: '❌ У пользователя нет подписки' });
        }

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('🔥 Подписка разморожена')
            .setDescription(`Подписка разморожена для <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Разморозил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.SUBS_CHANNEL_ID, embed);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleUserCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const adminId = interaction.user.id;

    if (subcommand === 'ban') {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason');

        await interaction.deferReply();

        const ban = await db.banUser(userId, reason, adminId);

        const embed = new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🚫 Пользователь забанен')
            .setDescription(`Пользователь <@${userId}> был забанен`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Забанил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: false },
                { name: '⏰ Срок', value: 'Навсегда', inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.BAN_CHANNEL_ID, embed);

    } else if (subcommand === 'tempban') {
        const userId = interaction.options.getString('user_id');
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason');

        await interaction.deferReply();

        const ban = await db.banUser(userId, reason, adminId, days);

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('⏰ Временный бан')
            .setDescription(`Пользователь <@${userId}> забанен на ${days} дней`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Забанил', value: `<@${adminId}>`, inline: true },
                { name: '⏳ Срок', value: `${days} дней`, inline: true },
                { name: '📅 До', value: `<t:${Math.floor(new Date(ban.expires_at).getTime() / 1000)}:F>`, inline: false },
                { name: '📝 Причина', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.BAN_CHANNEL_ID, embed);

    } else if (subcommand === 'unban') {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'Не указана';

        await interaction.deferReply();

        await db.unbanUser(userId, adminId, reason);

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('✅ Пользователь разбанен')
            .setDescription(`Бан снят с пользователя <@${userId}>`)
            .addFields(
                { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                { name: '💼 Разбанил', value: `<@${adminId}>`, inline: true },
                { name: '📝 Причина', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await logToChannel(CONFIG.BAN_CHANNEL_ID, embed);

    } else if (subcommand === 'info') {
        const userId = interaction.options.getString('user_id');
        const info = db.getUserInfo(userId);

        const embed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('📊 Информация о пользователе')
            .setDescription(`Полная информация о <@${userId}>`)
            .addFields(
                { name: '👤 ID', value: userId, inline: true },
                { name: '🚫 Забанен', value: info.banned ? 'Да' : 'Нет', inline: true },
                { name: '💎 Подписка', value: info.subscription ? 'Есть' : 'Нет', inline: true }
            )
            .setTimestamp();

        if (info.subscription) {
            const expires = new Date(info.subscription.expires_at);
            const daysLeft = Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24));
            
            embed.addFields(
                { name: '📦 План', value: info.subscription.plan, inline: true },
                { name: '⏳ Дней осталось', value: daysLeft > 0 ? `${daysLeft}` : 'Истекла', inline: true },
                { name: '✅ Активна', value: info.subscription.active ? 'Да' : 'Нет', inline: true }
            );
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function logToChannel(channelId, embed) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Ошибка отправки в канал:', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REST API
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

// Middleware для проверки API ключа
const apiAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== CONFIG.API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// GET /api/subscription/:userId - Проверка подписки
app.get('/api/subscription/:userId', apiAuth, (req, res) => {
    try {
        const { userId } = req.params;
        const sub = db.getSubscription(userId);
        const banned = db.isUserBanned(userId);

        if (banned) {
            return res.json({
                active: false,
                banned: true,
                message: 'User is banned'
            });
        }

        if (!sub) {
            return res.json({
                active: false,
                banned: false,
                message: 'No subscription found'
            });
        }

        const expires = new Date(sub.expires_at);
        const now = new Date();
        const isActive = expires > now && sub.active && !sub.frozen;

        res.json({
            active: isActive,
            banned: false,
            subscription: {
                plan: sub.plan,
                type: sub.type,
                expires_at: sub.expires_at,
                frozen: sub.frozen || false,
                days_left: Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)))
            }
        });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/subscriptions - Список всех подписок
app.get('/api/subscriptions', apiAuth, (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const subs = db.getAllSubscriptions(filter);
        res.json(subs);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/user/:userId - Информация о пользователе
app.get('/api/user/:userId', apiAuth, (req, res) => {
    try {
        const { userId } = req.params;
        const info = db.getUserInfo(userId);
        res.json(info);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/log - Добавить лог
app.post('/api/log', apiAuth, async (req, res) => {
    try {
        const { action, userId, adminId, details } = req.body;
        await db.addLog(action, userId, adminId, details);
        res.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Запуск API сервера
app.listen(CONFIG.API_PORT, () => {
    console.log(`✅ API сервер запущен на порту ${CONFIG.API_PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOT STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

client.once('ready', async () => {
    console.log(`✅ Бот запущен как ${client.user.tag}`);
    console.log(`🔒 Debug mode: ${DEBUG.enabled ? 'ENABLED' : 'DISABLED'}`);
    await registerCommands();
});

client.login(CONFIG.BOT_TOKEN);