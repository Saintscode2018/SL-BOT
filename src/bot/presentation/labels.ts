export const BOT_LABELS = {
  teamManager: 'Team Manager',
  assistantTeamManager: 'Assistant Team Manager',
  playerManager: 'Player Manager',

  players: 'Players',
  roster: 'Roster',
  rosterCount: 'Roster Count',
  squad: 'Squad',
  sourceTeam: 'Source Team',
  expires: 'Expires',

  appointment: 'Appointment',
  promotion: 'Promotion',
  demotion: 'Demotion',
  release: 'Release',
  demand: 'Demand',

  contractOffer: 'Contract Offer',
  offerAccepted: 'Offer Accepted',
  signContract: 'Sign Contract',
  declineOffer: 'Decline Offer',

  none: 'None',
  vacant: 'Vacant',
  unknownTeamRole: 'Unknown Team Role',
} as const;

export type BotLabelKey = keyof typeof BOT_LABELS;
