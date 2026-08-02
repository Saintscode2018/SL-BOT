import { DiscordRoleCompensationFailedError } from '../domain/errors.js';
import type { MemberRoleMutationPlan, MutationPlans } from '../domain/roster-mutation.js';
import type { Logger } from '../logging/logger.js';
import type {
  AppliedMemberRoleMutation,
  MemberRoleSynchronizationService,
} from './member-role-synchronization-service.js';

export interface TransferAnnouncementPublisher {
  publish(plan: NonNullable<MutationPlans['announcement']>): Promise<boolean>;
}

export type SynchronizedMutationResult<T extends MutationPlans> = T & {
  announcementDelivered: boolean | null;
};

export class RoleSynchronizedMutationService {
  public constructor(
    private readonly roles: Pick<MemberRoleSynchronizationService, 'apply' | 'compensate'>,
    private readonly announcements: TransferAnnouncementPublisher,
    private readonly logger: Logger,
  ) {}

  public async execute<T extends MutationPlans>(
    rolePlan: MemberRoleMutationPlan,
    mutate: () => Promise<T>,
  ): Promise<SynchronizedMutationResult<T>> {
    const applied = await this.roles.apply(rolePlan);
    let result: T;
    try {
      result = await mutate();
    } catch (databaseError: unknown) {
      await this.compensateDatabaseFailure(rolePlan, applied, databaseError);
      throw databaseError;
    }

    const announcementDelivered =
      result.announcement === null ? null : await this.announcements.publish(result.announcement);
    return { ...result, announcementDelivered };
  }

  private async compensateDatabaseFailure(
    plan: MemberRoleMutationPlan,
    applied: AppliedMemberRoleMutation,
    databaseError: unknown,
  ): Promise<void> {
    try {
      await this.roles.compensate(plan, applied);
    } catch (compensationError: unknown) {
      this.logger.error(
        'database mutation failed and Discord compensation also failed',
        databaseError,
        {
          discordGuildId: plan.discordGuildId,
          discordUserId: plan.discordUserId,
          compensationError,
        },
      );
      if (compensationError instanceof DiscordRoleCompensationFailedError) {
        throw compensationError;
      }
      throw new DiscordRoleCompensationFailedError([], {
        cause: new AggregateError(
          [databaseError, compensationError],
          'database and Discord compensation failed',
        ),
      });
    }
  }
}
