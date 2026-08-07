import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

import {
  ConfigurationError,
  DemandRateLimitedError,
  StaleConfirmationError,
} from '../domain/errors.js';
import { fromStaffRoleCode, type StaffRoleCode } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type {
  ConfirmationContext,
  ConfirmationRegistry,
} from '../services/confirmation-registry.js';
import type { GuildUserRateLimiter } from '../services/guild-user-rate-limiter.js';
import type {
  DemandEligibility,
  ReleaseEligibility,
  RosterDepartureService,
} from '../services/roster-departure-service.js';
import { getFriendlyPositionName } from '../services/staff-management-service.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from './embeds.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  formatUserWithVisibleName,
  getUserDisplayName,
} from './presentation/index.js';
import { getTeamEmbedColor, resolveTeamPresentation } from './team-presentation.js';
import type {
  ButtonInteractionAdapter,
  CommandInteraction,
  CommandInteractionOptions,
} from './types.js';

export type DateClock = () => Date;

interface GuildCommandExecution {
  guildId: string;
  guildName: string;
  channelId: string;
  options: CommandInteractionOptions;
  authorization: AuthorizationInput;
}

const announcementWarning = `${BOT_EMOJIS.warning} The roster and Discord roles were updated, but the Transfer Market announcement could not be delivered.`;

function requireExecution(interaction: CommandInteraction): GuildCommandExecution {
  const { guildId, guildName, guildOwnerId, userId, channelId, options } = interaction;
  if (
    guildId === undefined ||
    guildName === undefined ||
    guildOwnerId === undefined ||
    userId === undefined ||
    channelId === undefined ||
    options === undefined
  ) {
    throw new ConfigurationError('this command must be used in a Discord server text channel');
  }
  return {
    guildId,
    guildName,
    channelId,
    options,
    authorization: {
      discordGuildId: guildId,
      discordUserId: userId,
      guildOwnerId,
      memberRoleIds: interaction.memberRoleIds ?? [],
      hasAdministratorPermission: interaction.hasAdministratorPermission ?? false,
    },
  };
}

function confirmationCancelledEmbed() {
  return createWarningEmbed({
    title: `${BOT_EMOJIS.warning} Action Cancelled`,
    description: 'No roster or Discord role changes were made.',
  });
}

function confirmationExpiredEmbed() {
  return createErrorEmbed({
    title: `${BOT_EMOJIS.error} Confirmation Expired`,
    description: 'This confirmation expired after two minutes. Run the command again to retry.',
  });
}

function addAnnouncementWarning(
  description: string,
  delivered: boolean | null | undefined,
): string {
  return delivered === false ? `${description}\n\n${announcementWarning}` : description;
}

function expectedRole(role: StaffRoleCode | null): StaffRoleCode | undefined {
  return role ?? undefined;
}

function sameDemandState(context: ConfirmationContext, eligibility: DemandEligibility): boolean {
  return (
    context.action === 'DEMAND' &&
    context.commandName === 'demand' &&
    context.teamId === eligibility.club.id &&
    context.targetDiscordUserId === eligibility.user.discordUserId &&
    context.targetStaffRole === expectedRole(eligibility.staffRole)
  );
}

function sameReleaseState(context: ConfirmationContext, eligibility: ReleaseEligibility): boolean {
  return (
    context.action === 'RELEASE' &&
    context.commandName === 'release' &&
    context.teamId === eligibility.club.id &&
    context.initiatorStaffRole === eligibility.callerStaffRole &&
    context.targetDiscordUserId === eligibility.target.discordUserId &&
    context.targetStaffRole === expectedRole(eligibility.targetStaffRole)
  );
}

export class RosterDepartureCommandHandler {
  public constructor(
    private readonly channelPolicy: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>,
    private readonly departures: Pick<
      RosterDepartureService,
      | 'getDemandEligibility'
      | 'getReleaseEligibility'
      | 'leaveStaffPosition'
      | 'demandFullDeparture'
      | 'release'
    >,
    private readonly confirmations: ConfirmationRegistry,
    private readonly demandRateLimiter: Pick<GuildUserRateLimiter, 'tryAcquire'>,
    private readonly now: DateClock = () => new Date(),
  ) {}

  public canHandle(customId: string): boolean {
    return customId.startsWith('roster-confirm:');
  }

  public async beginDemand(interaction: CommandInteraction): Promise<void> {
    const execution = requireExecution(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'demand',
      subcommand: null,
    });
    const rateLimit = this.demandRateLimiter.tryAcquire(
      execution.guildId,
      execution.authorization.discordUserId,
    );
    if (!rateLimit.allowed) {
      throw new DemandRateLimitedError(rateLimit.retryAfterSeconds);
    }

    const eligibility = await this.departures.getDemandEligibility(
      execution.guildId,
      execution.authorization.discordUserId,
    );
    const confirmation = this.confirmations.create(
      {
        action: 'DEMAND',
        commandName: 'demand',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        teamId: eligibility.club.id,
        targetDiscordUserId: eligibility.user.discordUserId,
        ...(eligibility.staffRole === null ? {} : { targetStaffRole: eligibility.staffRole }),
      },
      {
        now: this.now(),
        onExpire: async () => {
          await interaction.editReply({
            embeds: [confirmationExpiredEmbed()],
            components: [],
          });
        },
      },
    );

    const presentation = await resolveTeamPresentation(interaction, eligibility.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const color = getTeamEmbedColor(presentation, BOT_COLORS.warning);
    const isStaff = eligibility.staffRole !== null;
    const description = isStaff
      ? [
          `You currently hold the **${getFriendlyPositionName(eligibility.staffType!)}** position for ${team}.`,
          '',
          '**Leave Staff Position** keeps you signed as an ordinary player and keeps your team role, but removes your staff role.',
          '**Leave Team Completely** ends both your staff appointment and roster membership, removes both affected roles, and makes you a free agent immediately.',
        ].join('\n')
      : [
          `You are about to leave ${team} and become a free agent.`,
          '',
          'Your team Discord role will be removed. This action is immediate after confirmation.',
        ].join('\n');
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (isStaff) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(confirmation.staffOnlyCustomId)
          .setEmoji(BOT_EMOJIS.demotion)
          .setLabel('Leave Staff Position')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(confirmation.confirmCustomId)
          .setEmoji(BOT_EMOJIS.demand)
          .setLabel('Leave Team Completely')
          .setStyle(ButtonStyle.Danger),
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(confirmation.confirmCustomId)
          .setEmoji(BOT_EMOJIS.demand)
          .setLabel(BOT_LABELS.demand)
          .setStyle(ButtonStyle.Danger),
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.cancelCustomId)
        .setEmoji(BOT_EMOJIS.error)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [
        createWarningEmbed({
          title: `${BOT_EMOJIS.warning} Confirm Demand`,
          description,
          color,
        }),
      ],
      components: [row],
    });
  }

  public async beginRelease(interaction: CommandInteraction): Promise<void> {
    const execution = requireExecution(interaction);
    const player = execution.options.getUser('player');
    if (player === null) throw new ConfigurationError('player is required');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'release',
      subcommand: null,
    });
    const eligibility = await this.departures.getReleaseEligibility(
      execution.guildId,
      execution.authorization.discordUserId,
      player.id,
    );
    const confirmation = this.confirmations.create(
      {
        action: 'RELEASE',
        commandName: 'release',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        initiatorStaffRole: eligibility.callerStaffRole,
        teamId: eligibility.club.id,
        targetDiscordUserId: eligibility.target.discordUserId,
        ...(eligibility.targetStaffRole === null
          ? {}
          : { targetStaffRole: eligibility.targetStaffRole }),
      },
      {
        now: this.now(),
        onExpire: () =>
          interaction.editReply({
            embeds: [confirmationExpiredEmbed()],
            components: [],
          }),
      },
    );
    const presentation = await resolveTeamPresentation(interaction, eligibility.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const targetName = player.displayName || getUserDisplayName(interaction, player.id);
    const target = formatUserWithVisibleName(player.id, targetName);
    const staffLine =
      eligibility.targetStaffType === null
        ? ''
        : ` They currently hold the **${getFriendlyPositionName(eligibility.targetStaffType)}** position, which will also end.`;
    const description = [
      `${target} will be released completely from ${team}.${staffLine}`,
      '',
      'They will become a free agent immediately. Their team role and any active ATM/PM role will be removed.',
      'The target will not be asked to approve this action and will not receive a DM.',
    ].join('\n');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.confirmCustomId)
        .setEmoji(BOT_EMOJIS.release)
        .setLabel(BOT_LABELS.release)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(confirmation.cancelCustomId)
        .setEmoji(BOT_EMOJIS.error)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      embeds: [
        createWarningEmbed({
          title: `${BOT_EMOJIS.warning} Confirm Player Release`,
          description,
          color: getTeamEmbedColor(presentation, BOT_COLORS.warning),
        }),
      ],
      components: [row],
    });
  }

  public async handleButton(interaction: ButtonInteractionAdapter): Promise<boolean> {
    if (!this.canHandle(interaction.customId)) return false;
    if (interaction.guildId === undefined) throw new StaleConfirmationError();

    if (interaction.customId.endsWith(':cancel')) {
      await this.confirmations.cancel(
        interaction.customId,
        interaction.userId,
        this.now(),
        interaction.guildId,
      );
      await interaction.deferUpdate();
      await interaction.editReply({ embeds: [confirmationCancelledEmbed()], components: [] });
      return true;
    }

    const consumed = this.confirmations.consumeDecision(
      interaction.customId,
      interaction.userId,
      this.now(),
      interaction.guildId,
    );
    await interaction.deferUpdate();
    if (consumed.context.action === 'DEMAND') {
      await this.completeDemand(interaction, consumed.context, consumed.decision);
      return true;
    }
    if (consumed.context.action === 'RELEASE' && consumed.decision === 'confirm') {
      await this.completeRelease(interaction, consumed.context);
      return true;
    }
    throw new StaleConfirmationError();
  }

  private async completeDemand(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
    decision: 'confirm' | 'staff-only',
  ): Promise<void> {
    const eligibility = await this.departures.getDemandEligibility(
      context.discordGuildId,
      context.initiatorDiscordUserId,
    );
    if (!sameDemandState(context, eligibility)) throw new StaleConfirmationError();
    if (decision === 'staff-only' && eligibility.staffRole === null) {
      throw new StaleConfirmationError();
    }
    const occurredAt = this.now();
    const result =
      decision === 'staff-only'
        ? await this.departures.leaveStaffPosition({
            discordGuildId: context.discordGuildId,
            discordUserId: context.initiatorDiscordUserId,
            clubId: context.teamId,
            expectedStaffRole: eligibility.staffRole,
            occurredAt,
          })
        : await this.departures.demandFullDeparture({
            discordGuildId: context.discordGuildId,
            discordUserId: context.initiatorDiscordUserId,
            clubId: context.teamId,
            expectedStaffRole: eligibility.staffRole,
            occurredAt,
          });
    const presentation = await resolveTeamPresentation(interaction, result.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const description =
      decision === 'staff-only'
        ? addAnnouncementWarning(
            `You have left your ${getFriendlyPositionName(fromStaffRoleCode(eligibility.staffRole!))} position and remain a player for ${team}.`,
            result.announcementDelivered,
          )
        : addAnnouncementWarning(
            `You have left ${team} and are now a free agent.`,
            result.announcementDelivered,
          );
    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title:
            decision === 'staff-only'
              ? `${BOT_EMOJIS.success} Staff Position Left`
              : `${BOT_EMOJIS.success} Demand Completed`,
          description,
          color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        }),
      ],
      components: [],
    });
  }

  private async completeRelease(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
  ): Promise<void> {
    if (context.targetDiscordUserId === undefined || context.initiatorStaffRole === undefined) {
      throw new StaleConfirmationError();
    }
    const eligibility = await this.departures.getReleaseEligibility(
      context.discordGuildId,
      context.initiatorDiscordUserId,
      context.targetDiscordUserId,
    );
    if (!sameReleaseState(context, eligibility)) throw new StaleConfirmationError();
    const result = await this.departures.release({
      discordGuildId: context.discordGuildId,
      actorDiscordUserId: context.initiatorDiscordUserId,
      targetDiscordUserId: context.targetDiscordUserId,
      clubId: context.teamId,
      expectedActorStaffRole: eligibility.callerStaffRole,
      expectedTargetStaffRole: eligibility.targetStaffRole,
      occurredAt: this.now(),
    });
    const presentation = await resolveTeamPresentation(interaction, result.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const target = formatUserWithVisibleName(
      context.targetDiscordUserId,
      getUserDisplayName(interaction, context.targetDiscordUserId),
    );
    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Player Released`,
          description: addAnnouncementWarning(
            `${target} has been released from ${team}.`,
            result.announcementDelivered,
          ),
          color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        }),
      ],
      components: [],
    });
  }
}
