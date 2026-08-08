import type { Logger } from '../logging/logger.js';

export interface SetupAuditField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface SetupAuditMessage {
  channelId: string;
  title: string;
  description: string;
  fields: readonly SetupAuditField[];
  actorDiscordUserId: string;
  timestamp: Date;
  author?: { name: string; iconURL?: string } | null;
  actorVerb?:
    | 'Configured'
    | 'Updated'
    | 'Added'
    | 'Removed'
    | 'Appointed'
    | 'Edited'
    | 'Reset'
    | 'Demanded'
    | 'Released'
    | 'Promoted'
    | 'Demoted'
    | 'Disbanded'
    | 'Imported'
    | undefined;
}

export interface SetupAuditMessageAdapter {
  send(message: SetupAuditMessage): Promise<void>;
}

export class SetupAuditService {
  public constructor(
    private readonly messages: SetupAuditMessageAdapter,
    private readonly logger: Logger,
  ) {}

  public async publish(message: SetupAuditMessage): Promise<boolean> {
    try {
      await this.messages.send(message);
      return true;
    } catch (error: unknown) {
      this.logger.warn('setup audit message delivery failed', {
        channelId: message.channelId,
        title: message.title,
        error,
      });
      return false;
    }
  }
}
