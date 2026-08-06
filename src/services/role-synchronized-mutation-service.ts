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

  public async executeMany<T>(
    rolePlans: readonly MemberRoleMutationPlan[],
    mutate: () => Promise<T>,
  ): Promise<T> {
    const applied: Array<{ plan: MemberRoleMutationPlan; mutation: AppliedMemberRoleMutation }> =
      [];

    try {
      for (const plan of rolePlans) {
        applied.push({ plan, mutation: await this.roles.apply(plan) });
      }
    } catch (roleError: unknown) {
      await this.compensateApplied(applied, roleError, 'Discord role synchronization failed');
      throw roleError;
    }

    try {
      return await mutate();
    } catch (databaseError: unknown) {
      await this.compensateApplied(applied, databaseError, 'database mutation failed');
      throw databaseError;
    }
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

  private async compensateApplied(
    applied: ReadonlyArray<{
      plan: MemberRoleMutationPlan;
      mutation: AppliedMemberRoleMutation;
    }>,
    originalError: unknown,
    failureDescription: string,
  ): Promise<void> {
    const compensationErrors: unknown[] = [];
    const affectedRolePurposes: string[] = [];

    for (const { plan, mutation } of [...applied].reverse()) {
      try {
        await this.roles.compensate(plan, mutation);
      } catch (compensationError: unknown) {
        compensationErrors.push(compensationError);
        affectedRolePurposes.push(
          ...mutation.addedRoles.map(({ purpose }) => purpose),
          ...mutation.removedRoles.map(({ purpose }) => purpose),
        );
        this.logger.error(
          `${failureDescription} and Discord compensation also failed`,
          originalError,
          {
            discordGuildId: plan.discordGuildId,
            discordUserId: plan.discordUserId,
            compensationError,
          },
        );
      }
    }

    if (compensationErrors.length === 0) return;
    throw new DiscordRoleCompensationFailedError([...new Set(affectedRolePurposes)], {
      cause: new AggregateError(
        [originalError, ...compensationErrors],
        `${failureDescription} and Discord compensation failed`,
      ),
    });
  }
}
