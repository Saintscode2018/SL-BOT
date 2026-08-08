import type { AuditAnnouncementPlan } from '../domain/roster-mutation.js';
import type { Logger } from '../logging/logger.js';

export interface AuditAnnouncementAdapter {
  send(plan: AuditAnnouncementPlan): Promise<void>;
}

export interface AuditAnnouncementPresentationProvider {
  resolve(plan: AuditAnnouncementPlan): Promise<AuditAnnouncementPlan>;
}

export interface AuditAnnouncementPublisher {
  publish(plan: AuditAnnouncementPlan): Promise<boolean>;
}

export class AuditAnnouncementService implements AuditAnnouncementPublisher {
  public constructor(
    private readonly adapter: AuditAnnouncementAdapter,
    private readonly logger: Logger,
    private readonly presentation?: AuditAnnouncementPresentationProvider,
  ) {}

  public async publish(plan: AuditAnnouncementPlan): Promise<boolean> {
    try {
      const presented =
        this.presentation === undefined ? plan : await this.presentation.resolve(plan);
      await this.adapter.send(presented);
      return true;
    } catch (error: unknown) {
      this.logger.error('audit announcement delivery failed', error, {
        discordGuildId: plan.discordGuildId,
        operation: plan.operation,
        actorDiscordUserId: 'actorDiscordUserId' in plan ? plan.actorDiscordUserId : undefined,
        playerDiscordUserId:
          plan.operation === 'TEAM_DISBANDED' ? undefined : plan.playerDiscordUserId,
        teamRoleId: plan.teamIdentity.discordRoleId,
        channelId: plan.channelId,
      });
      return false;
    }
  }
}
