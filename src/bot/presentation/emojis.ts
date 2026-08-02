export const BOT_EMOJIS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',

  teamManager: '👑',
  assistantTeamManager: '👔',
  playerManager: '🧠',
  player: '🏃',
  roster: '📊',
  expiry: '⏰',

  appointment: '📌',
  promotion: '⬆️',
  demotion: '⬇️',
  release: '🚪',
  demand: '📣',
  offer: '✉️',
  contract: '📄',

  team: '🛡️',
  user: '👤',
  role: '🎭',
  settings: '⚙️',
  audit: '🧾',
  health: '🩺',

  botCommandsChannel: '🤖',
  staffCommandsChannel: '🛡️',
  transferMarketChannel: '🔄',
  auditChannel: '📋',

  botPermissions: '⚡',
} as const;

export type BotEmojiKey = keyof typeof BOT_EMOJIS;
