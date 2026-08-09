import type { Logger } from '../logging/logger.js';

export type ModerationAnnouncementOperation = 'MUTE' | 'UNMUTE';

export interface ModerationUserPresentation {
  username: string;
  avatarUrl: string | null;
}

export interface ModerationAnnouncementPlan {
  operation: ModerationAnnouncementOperation;
  discordGuildId: string;
  caseFilesChannelId: string;
  auditChannelId: string;
  targetDiscordUserId: string;
  actorDiscordUserId: string;
  caseNumber: number;
  reason: string | null;
  durationSeconds: number | null;
  bail: number | null;
  occurredAt: Date;
  presentation?: {
    serverName: string;
    serverIconUrl: string | null;
    target: ModerationUserPresentation | null;
    actor: ModerationUserPresentation | null;
  };
}

export interface ModerationAnnouncementAdapter {
  send(plan: ModerationAnnouncementPlan, channelId: string): Promise<void>;
}

export interface ModerationAnnouncementPresentationProvider {
  resolve(plan: ModerationAnnouncementPlan): Promise<ModerationAnnouncementPlan>;
}

export interface ModerationAnnouncementDeliveryResult {
  caseFilesDelivered: boolean;
  auditDelivered: boolean;
}

export interface ModerationAnnouncementPublisher {
  publish(plan: ModerationAnnouncementPlan): Promise<ModerationAnnouncementDeliveryResult>;
}

export class ModerationAnnouncementService implements ModerationAnnouncementPublisher {
  public constructor(
    private readonly adapter: ModerationAnnouncementAdapter,
    private readonly logger: Logger,
    private readonly presentation?: ModerationAnnouncementPresentationProvider,
  ) {}

  public async publish(
    plan: ModerationAnnouncementPlan,
  ): Promise<ModerationAnnouncementDeliveryResult> {
    const presented = await this.resolvePresentation(plan);
    const caseFilesDelivered = await this.deliver(
      presented,
      presented.caseFilesChannelId,
      'CASE_FILES',
    );
    const auditDelivered = await this.deliver(presented, presented.auditChannelId, 'AUDIT');
    return { caseFilesDelivered, auditDelivered };
  }

  private async resolvePresentation(
    plan: ModerationAnnouncementPlan,
  ): Promise<ModerationAnnouncementPlan> {
    if (this.presentation === undefined) return plan;
    try {
      return await this.presentation.resolve(plan);
    } catch (error: unknown) {
      this.logger.error('moderation announcement presentation failed', error, {
        commandName: plan.operation === 'MUTE' ? 'mute' : 'unmute',
        guildId: plan.discordGuildId,
        actorDiscordUserId: plan.actorDiscordUserId,
        targetDiscordUserId: plan.targetDiscordUserId,
        caseNumber: plan.caseNumber,
        operation: plan.operation,
      });
      return plan;
    }
  }

  private async deliver(
    plan: ModerationAnnouncementPlan,
    channelId: string,
    destination: 'CASE_FILES' | 'AUDIT',
  ): Promise<boolean> {
    try {
      await this.adapter.send(plan, channelId);
      return true;
    } catch (error: unknown) {
      this.logger.error('moderation announcement delivery failed', error, {
        commandName: plan.operation === 'MUTE' ? 'mute' : 'unmute',
        guildId: plan.discordGuildId,
        actorDiscordUserId: plan.actorDiscordUserId,
        targetDiscordUserId: plan.targetDiscordUserId,
        caseNumber: plan.caseNumber,
        operation: plan.operation,
        destination,
        channelId,
      });
      return false;
    }
  }
}
