import { GuildChannelCollisionError } from './errors.js';

export type GuildChannelField =
  | 'botCommandsChannelId'
  | 'staffChannelId'
  | 'transferChannelId'
  | 'auditChannelId'
  | 'caseFilesChannelId';

export interface GuildChannelConfiguration {
  botCommandsChannelId: string | null;
  staffChannelId: string | null;
  transferChannelId: string | null;
  auditChannelId: string | null;
  caseFilesChannelId: string | null;
}

const channelLabels: Record<GuildChannelField, string> = {
  botCommandsChannelId: 'Bot Commands',
  staffChannelId: 'Staff Commands',
  transferChannelId: 'Transfer Market',
  auditChannelId: 'Audit',
  caseFilesChannelId: 'Case Files',
};

// Allowed sharing: command input with command input, public output with public
// command input, and the two administrative logging destinations. All other
// pairs cross an audience or sensitivity boundary and must be distinct.
const incompatiblePairs: readonly (readonly [GuildChannelField, GuildChannelField])[] = [
  ['botCommandsChannelId', 'auditChannelId'],
  ['botCommandsChannelId', 'caseFilesChannelId'],
  ['staffChannelId', 'transferChannelId'],
  ['staffChannelId', 'auditChannelId'],
  ['staffChannelId', 'caseFilesChannelId'],
  ['transferChannelId', 'auditChannelId'],
  ['transferChannelId', 'caseFilesChannelId'],
];

export function validateGuildChannelConfiguration(
  configuration: GuildChannelConfiguration,
): void {
  for (const [firstField, secondField] of incompatiblePairs) {
    const firstChannelId = configuration[firstField];
    const secondChannelId = configuration[secondField];
    if (firstChannelId !== null && firstChannelId === secondChannelId) {
      throw new GuildChannelCollisionError(channelLabels[firstField], channelLabels[secondField]);
    }
  }
}
