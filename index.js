// Import required modules
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, generateDependencyReport } = require('@discordjs/voice');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Check audio dependencies on startup
console.log('🔍 Checking audio dependencies...');
console.log(generateDependencyReport());

// Environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const CATEGORY_ID = process.env.CATEGORY_ID || "1406286340517003285";
const CREATE_CHANNEL_ID = process.env.CREATE_CHANNEL_ID || "1381830384307798197";
const DELETE_DELAY = parseInt(process.env.DELETE_DELAY) || 1000;
const ENABLE_VOICE_LOGGING = process.env.ENABLE_VOICE_LOGGING === "true";
const VOICE_LOG_CHANNEL_ID = process.env.VOICE_LOG_CHANNEL_ID || "1406361945577095168";
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "1381679987689525348";
const AUDIO_VOLUME = parseFloat(process.env.AUDIO_VOLUME) || 0.4;
const PROTECTED_CHANNEL_IDS = process.env.PROTECTED_CHANNEL_IDS ? 
    process.env.PROTECTED_CHANNEL_IDS.split(',').map(id => id.trim()) : [];

// One Piece themed channel names
const CHANNEL_NAMES = [
    "🛡️ 〢 Marineford",
    "⛓️ 〢 Impel Down", 
    "🌳 〢 Sabaody",
    "⚖️ 〢 Enies Lobby",
    "🌊 〢 Water 7",
    "🎭 〢 Dressrosa",
    "🍰 〢 Whole Cake",
    "🎋 〢 Wano",
    "👹 〢 Onigashima",
    "🧪 〢 Egghead",
    "🏜️ 〢 Alabasta",
    "☁️ 〢 Skypiea",
    "🦇 〢 Thriller Bark",
    "🐠 〢 Fishman Island",
    "🐘 〢 Zou",
    "❄️ 〢 Drum",
    "⚡ 〢 Loguetown",
    "🍽️ 〢 Baratie",
    "🦈 〢 Arlong Park",
    "📚 〢 Ohara"
];

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize PostgreSQL connection
let pool;
try {
    if (!DATABASE_URL) {
        console.log('⚠️ DATABASE_URL not found. Database features will be disabled.');
        pool = null;
    } else {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            max: 10
        });
        
        // Test connection
        pool.on('error', (err) => {
            console.error('❌ PostgreSQL pool error:', err);
        });
    }
} catch (error) {
    console.error('❌ Failed to initialize database pool:', error);
    pool = null;
}

// Storage for active channels and user sessions
const activeChannels = new Map(); // channelId -> { name, createdAt }
const userSessions = new Map(); // userId -> { channelId, joinTime }

// Initialize database
async function initDatabase() {
    if (!pool) {
        console.log('⚠️ Database pool not available. Skipping database initialization.');
        return;
    }
    
    try {
        // Test connection first
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        console.log('✅ Database connection successful');
        
        // Create table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS voice_logs (
                id SERIAL PRIMARY KEY,
                discord_id VARCHAR(20) NOT NULL,
                username VARCHAR(100) NOT NULL,
                total_voice_time BIGINT DEFAULT 0,
                session_count INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(discord_id)
            )
        `);
        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.log('⚠️ Bot will continue without database features');
    }
}

// Get available channel name (no duplicates)
function getAvailableChannelName() {
    const usedNames = Array.from(activeChannels.values()).map(ch => ch.name);
    const availableNames = CHANNEL_NAMES.filter(name => !usedNames.includes(name));
    
    if (availableNames.length === 0) {
        // If all names are used, add a number suffix
        const randomName = CHANNEL_NAMES[Math.floor(Math.random() * CHANNEL_NAMES.length)];
        const suffix = Math.floor(Math.random() * 1000) + 1;
        return `${randomName} ${suffix}`;
    }
    
    return availableNames[Math.floor(Math.random() * availableNames.length)];
}

// Check if audio playback is supported
let audioSupported = false;
try {
    const report = generateDependencyReport();
    audioSupported = !report.includes('missing');
    console.log(audioSupported ? '✅ Audio playback supported' : '⚠️ Audio dependencies missing, playback disabled');
} catch (error) {
    console.log('⚠️ Could not check audio dependencies, playback disabled');
}

// Play welcome audio
async function playWelcomeAudio(channelId) {
    if (!audioSupported) {
        console.log('🔇 Audio playback disabled due to missing dependencies');
        return;
    }
    
    try {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.log('⚠️ Channel not found for audio playback');
            return;
        }

        const audioPath = path.join(__dirname, 'welcome.ogg');
        if (!fs.existsSync(audioPath)) {
            console.log('⚠️ welcome.ogg not found, skipping audio playback');
            return;
        }

        console.log('🎵 Attempting to play welcome audio...');
        
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('🔊 Voice connection ready, starting playback');
            
            try {
                const player = createAudioPlayer();
                const resource = createAudioResource(audioPath, { 
                    inlineVolume: true,
                    inputType: require('@discordjs/voice').StreamType.OggOpus
                });
                
                if (resource.volume) {
                    resource.volume.setVolume(AUDIO_VOLUME);
                }
                
                player.play(resource);
                connection.subscribe(player);

                player.on(AudioPlayerStatus.Playing, () => {
                    console.log('✅ Audio is now playing');
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    console.log('🎵 Audio playback finished');
                    connection.destroy();
                });

                player.on('error', (error) => {
                    console.error('❌ Audio player error:', error.message);
                    connection.destroy();
                });

                // Disconnect after 5 seconds as originally intended
                setTimeout(() => {
                    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                        console.log('🕒 Disconnecting after 5 seconds');
                        connection.destroy();
                    }
                }, 5000);
                
            } catch (playerError) {
                console.error('❌ Error creating audio player:', playerError.message);
                connection.destroy();
            }
        });

        connection.on('error', (error) => {
            console.error('❌ Voice connection error:', error.message);
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log('🔇 Voice connection disconnected');
        });

        // Emergency disconnect after 10 seconds
        setTimeout(() => {
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                console.log('🚨 Emergency disconnect after 10 seconds');
                connection.destroy();
            }
        }, 10000);

    } catch (error) {
        console.error('❌ Error in playWelcomeAudio:', error.message);
    }
}

// Update user voice time in database
async function updateVoiceTime(userId, username, sessionTime) {
    if (!pool) {
        console.log('⚠️ Database not available, skipping voice time update');
        return;
    }
    
    try {
        await pool.query(`
            INSERT INTO voice_logs (discord_id, username, total_voice_time, session_count, last_updated)
            VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (discord_id)
            DO UPDATE SET
                username = $2,
                total_voice_time = voice_logs.total_voice_time + $3,
                session_count = voice_logs.session_count + 1,
                last_updated = CURRENT_TIMESTAMP
        `, [userId, username, sessionTime]);
    } catch (error) {
        console.error('❌ Error updating voice time:', error);
    }
}

// Format time duration
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Log voice activity
async function logVoiceActivity(type, member, oldChannel, newChannel, duration = null) {
    if (!ENABLE_VOICE_LOGGING) return;
    
    try {
        const logChannel = client.channels.cache.get(VOICE_LOG_CHANNEL_ID);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: member.user.username,
                iconURL: member.user.displayAvatarURL()
            })
            .setTimestamp();

        switch (type) {
            case 'join':
                embed
                    .setColor(0x00ff00)
                    .setTitle('🔊 User Joined Voice Channel')
                    .addFields(
                        { name: 'Channel', value: newChannel.name, inline: true },
                        { name: 'User', value: `<@${member.id}>`, inline: true }
                    );
                break;
                
            case 'leave':
                embed
                    .setColor(0xff0000)
                    .setTitle('🔇 User Left Voice Channel')
                    .addFields(
                        { name: 'Channel', value: oldChannel.name, inline: true },
                        { name: 'User', value: `<@${member.id}>`, inline: true }
                    );
                if (duration) {
                    embed.addFields({ name: 'Duration', value: formatDuration(duration), inline: true });
                }
                break;
                
            case 'move':
                embed
                    .setColor(0xffff00)
                    .setTitle('🔄 User Moved Voice Channel')
                    .addFields(
                        { name: 'From', value: oldChannel.name, inline: true },
                        { name: 'To', value: newChannel.name, inline: true },
                        { name: 'User', value: `<@${member.id}>`, inline: true }
                    );
                if (duration) {
                    embed.addFields({ name: 'Time in Previous', value: formatDuration(duration), inline: true });
                }
                break;
        }

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('❌ Error logging voice activity:', error);
    }
}

// Voice state update handler
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    const userId = member.id;
    const username = member.user.username;
    
    // Handle user leaving voice channel
    if (oldState.channelId && !newState.channelId) {
        const session = userSessions.get(userId);
        if (session) {
            const sessionTime = Date.now() - session.joinTime;
            await updateVoiceTime(userId, username, sessionTime);
            await logVoiceActivity('leave', member, oldState.channel, null, sessionTime);
            userSessions.delete(userId);
        }
        
        // Check if old channel should be deleted
        if (oldState.channelId !== CREATE_CHANNEL_ID && 
            activeChannels.has(oldState.channelId) && 
            !PROTECTED_CHANNEL_IDS.includes(oldState.channelId)) {
            
            const channel = oldState.channel;
            if (channel && channel.members.size === 0) {
                setTimeout(async () => {
                    try {
                        const updatedChannel = client.channels.cache.get(oldState.channelId);
                        if (updatedChannel && 
                            updatedChannel.members.size === 0 && 
                            !PROTECTED_CHANNEL_IDS.includes(oldState.channelId)) {
                            
                            const channelInfo = activeChannels.get(oldState.channelId);
                            await updatedChannel.delete();
                            activeChannels.delete(oldState.channelId);
                            console.log(`🗑️ Deleted empty channel: ${channelInfo?.name || 'Unknown'}`);
                        }
                    } catch (error) {
                        console.error('❌ Error deleting channel:', error);
                    }
                }, DELETE_DELAY);
            }
        }
    }
    
    // Handle user joining voice channel
    if (!oldState.channelId && newState.channelId) {
        userSessions.set(userId, {
            channelId: newState.channelId,
            joinTime: Date.now()
        });
        
        // Check if user joined the create channel
        if (newState.channelId === CREATE_CHANNEL_ID) {
            try {
                const guild = newState.guild;
                const category = guild.channels.cache.get(CATEGORY_ID);
                const channelName = getAvailableChannelName();
                
                const newChannel = await guild.channels.create({
                    name: channelName,
                    type: 2, // Voice channel
                    parent: category,
                    userLimit: 0
                });
                
                activeChannels.set(newChannel.id, {
                    name: channelName,
                    createdAt: Date.now()
                });
                
                // Move user to new channel
                await member.voice.setChannel(newChannel);
                
                // Update user session
                userSessions.set(userId, {
                    channelId: newChannel.id,
                    joinTime: Date.now()
                });
                
                // Play welcome audio
                setTimeout(() => {
                    playWelcomeAudio(newChannel.id);
                }, 1000);
                
                await logVoiceActivity('join', member, null, newChannel);
                
                console.log(`✅ Created and moved user to: ${channelName}`);
                
            } catch (error) {
                console.error('❌ Error creating voice channel:', error);
            }
        } else {
            await logVoiceActivity('join', member, null, newState.channel);
        }
    }
    
    // Handle user moving between channels
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const session = userSessions.get(userId);
        if (session) {
            const sessionTime = Date.now() - session.joinTime;
            await updateVoiceTime(userId, username, sessionTime);
            await logVoiceActivity('move', member, oldState.channel, newState.channel, sessionTime);
            
            // Update session for new channel
            userSessions.set(userId, {
                channelId: newState.channelId,
                joinTime: Date.now()
            });
        }
    }
});

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('voice-channel-log')
        .setDescription('View top 25 voice channel statistics (Admin only)')
];

// Register slash commands
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Slash commands registered');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
            if (interaction.commandName === 'voice-channel-log') {
        // Check if user has admin role
        const hasAdminRole = interaction.member.roles.cache.has(ADMIN_ROLE_ID);
        if (!hasAdminRole) {
            await interaction.reply({
                content: '❌ You need administrator permissions to use this command.',
                ephemeral: true
            });
            return;
        }
        
        if (!pool) {
            await interaction.reply({
                content: '❌ Database is not available. Voice logging features are disabled.',
                ephemeral: true
            });
            return;
        }
        
        try {
            const result = await pool.query(`
                SELECT discord_id, username, total_voice_time, session_count,
                       (total_voice_time / GREATEST(session_count, 1)) as avg_time
                FROM voice_logs
                ORDER BY total_voice_time DESC
                LIMIT 25
            `);
            
            if (result.rows.length === 0) {
                await interaction.reply({
                    content: '📊 No voice channel data available yet.',
                    ephemeral: true
                });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('🎤 Top 25 Voice Channel Statistics')
                .setColor(0x0099ff)
                .setTimestamp();
            
            let description = '```\n';
            description += 'Rank | Username              | Total Time  | Avg Time    | Sessions\n';
            description += '-----|----------------------|-------------|-------------|----------\n';
            
            result.rows.forEach((row, index) => {
                const rank = (index + 1).toString().padStart(4);
                const username = row.username.substring(0, 20).padEnd(20);
                const totalTime = formatDuration(row.total_voice_time).padStart(11);
                const avgTime = formatDuration(row.avg_time).padStart(11);
                const sessions = row.session_count.toString().padStart(8);
                
                description += `${rank} | ${username} | ${totalTime} | ${avgTime} | ${sessions}\n`;
            });
            
            description += '```';
            embed.setDescription(description);
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Error fetching voice logs:', error);
            await interaction.reply({
                content: '❌ Error fetching voice channel statistics.',
                ephemeral: true
            });
        }
    }
});

// Bot ready event - Using clientReady to avoid deprecation warning
client.once('ready', async () => {
    console.log(`🚀 Bot logged in as ${client.user.tag}`);
    console.log(`🛡️ Protected channels: ${PROTECTED_CHANNEL_IDS.length > 0 ? PROTECTED_CHANNEL_IDS.join(', ') : 'None'}`);
    console.log(`🎵 Audio volume set to: ${AUDIO_VOLUME}`);
    console.log(`📊 Voice logging: ${ENABLE_VOICE_LOGGING ? 'Enabled' : 'Disabled'}`);
    await initDatabase();
    await registerCommands();
    console.log('✅ Bot is ready and operational!');
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

// Login to Discord
client.login(TOKEN);
