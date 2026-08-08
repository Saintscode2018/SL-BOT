import type { TransferAnnouncementPlan } from '../domain/roster-mutation.js';
import type { Logger } from '../logging/logger.js';

export interface TransferAnnouncementAdapter {
  send(plan: TransferAnnouncementPlan): Promise<void>;
}

export interface TransferAnnouncementPresentationProvider {
  resolve(plan: TransferAnnouncementPlan): Promise<TransferAnnouncementPlan>;
}

export class TransferAnnouncementService {
  public constructor(
    private readonly adapter: TransferAnnouncementAdapter,
    private readonly logger: Logger,
    private readonly presentation?: TransferAnnouncementPresentationProvider,
  ) {}

  public async publish(plan: TransferAnnouncementPlan): Promise<boolean> {
    try {
      const presented =
        this.presentation === undefined ? plan : await this.presentation.resolve(plan);
      await this.adapter.send(presented);
      return true;
    } catch (error: unknown) {
      this.logger.error('transfer-market announcement delivery failed', error, {
        discordGuildId: plan.discordGuildId,
        announcementType: plan.type,
        discordUserId: plan.type === 'TEAM_DISBANDED' ? undefined : plan.discordUserId,
      });
      return false;
    }
  }
}
