import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

import { ConfigurationError, StaleConfirmationError } from '../domain/errors.js';
import type { StaffMembershipType, StaffRoleCode } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type {
  ConfirmationContext,
  ConfirmationRegistry,
} from '../services/confirmation-registry.js';
import type {
  DemotionEligibility,
  PromotionEligibility,
  RosterPromotionDemotionService,
} from '../services/roster-promotion-demotion-service.js';
import { getFriendlyPositionName } from '../services/staff-management-service.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from './embeds.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
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

function expectedRole(role: StaffRoleCode | null): StaffRoleCode | undefined {
  return role ?? undefined;
}

function samePromotionState(
  context: ConfirmationContext,
  eligibility: PromotionEligibility,
): boolean {
  return (
    context.action === 'PROMOTE' &&
    context.commandName === 'promote' &&
    context.teamId === eligibility.club.id &&
    context.initiatorDiscordUserId === eligibility.caller.discordUserId &&
    context.targetDiscordUserId === eligibility.target.discordUserId &&
    context.initiatorStaffRole === eligibility.callerStaffRole &&
    context.targetStaffRole === expectedRole(eligibility.targetStaffRole) &&
    context.destinationStaffRole === eligibility.destinationStaffRole
  );
}

function sameDemotionState(
  context: ConfirmationContext,
  eligibility: DemotionEligibility,
): boolean {
  return (
    context.action === 'DEMOTE' &&
    context.commandName === 'demote' &&
    context.teamId === eligibility.club.id &&
    context.initiatorDiscordUserId === eligibility.caller.discordUserId &&
    context.targetDiscordUserId === eligibility.target.discordUserId &&
    context.initiatorStaffRole === eligibility.callerStaffRole &&
    context.targetStaffRole === eligibility.targetStaffRole
  );
}

export class RosterPromotionDemotionCommandHandler {
  public constructor(
    private readonly channelPolicy: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>,
    private readonly service: RosterPromotionDemotionService,
    private readonly confirmations: ConfirmationRegistry,
    private readonly now: DateClock = () => new Date(),
  ) {}

  public canHandle(customId: string): boolean {
    return customId.startsWith('promotion-demotion-confirm:');
  }

  public async beginPromote(interaction: CommandInteraction): Promise<void> {
    const execution = requireExecution(interaction);
    const playerOption = execution.options.getUser('player');
    const rankOption = execution.options.getString('rank');

    if (playerOption === null) throw new ConfigurationError('player is required');
    if (rankOption === null || !['ATM', 'PM'].includes(rankOption)) {
      throw new ConfigurationError('rank must be Assistant Team Manager or Player Manager');
    }

    const destinationStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'> =
      rankOption === 'ATM' ? 'ASSISTANT_MANAGER' : 'PLAYER_MANAGER';

    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'promote',
      subcommand: null,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eligibility = await this.service.getPromotionEligibility(
      execution.guildId,
      execution.authorization.discordUserId,
      playerOption.id,
      destinationStaffType,
    );

    const confirmation = this.confirmations.create(
      {
        action: 'PROMOTE',
        commandName: 'promote',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        initiatorStaffRole: eligibility.callerStaffRole,
        teamId: eligibility.club.id,
        targetDiscordUserId: eligibility.target.discordUserId,
        destinationStaffRole: eligibility.destinationStaffRole,
        ...(eligibility.targetStaffRole === null
          ? {}
          : { targetStaffRole: eligibility.targetStaffRole }),
      },
      {
        prefix: 'promotion-demotion-confirm',
        now: this.now(),
        onExpire: async () => {
          await interaction.editReply({
            embeds: [confirmationExpiredEmbed()],
            components: [],
          });
        },
      },
    );

    const presentation = resolveTeamPresentation(interaction, eligibility.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const color = getTeamEmbedColor(presentation, BOT_COLORS.warning);
    const targetName = playerOption.displayName || getUserDisplayName(interaction, playerOption.id);
    const targetFormatted = formatUserWithVisibleName(playerOption.id, targetName);

    const currentRankLabel =
      eligibility.targetStaffType === null
        ? 'Player'
        : getFriendlyPositionName(eligibility.targetStaffType);
    const destRankLabel = getFriendlyPositionName(destinationStaffType);

    const roleTransitionDetails =
      eligibility.targetStaffType === 'PLAYER_MANAGER' &&
      destinationStaffType === 'ASSISTANT_MANAGER'
        ? 'The global Player Manager role will be removed and the global Assistant Team Manager role will be added.'
        : `The global ${destRankLabel} role will be added.`;

    const description = [
      `You are promoting ${targetFormatted} for ${team}.`,
      '',
      `**Current Rank:** ${currentRankLabel}`,
      `**Destination Rank:** ${destRankLabel}`,
      '',
      '• Target will remain an active member on the team roster.',
      `• ${roleTransitionDetails}`,
      '• The target will not be asked to approve this action.',
    ].join('\n');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.confirmCustomId)
        .setEmoji(BOT_EMOJIS.promotion)
        .setLabel('Promote')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(confirmation.cancelCustomId)
        .setEmoji(BOT_EMOJIS.error)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [
        createWarningEmbed({
          title: `${BOT_EMOJIS.promotion} Confirm Staff Promotion`,
          description,
          color,
        }),
      ],
      components: [row],
    });
  }

  public async beginDemote(interaction: CommandInteraction): Promise<void> {
    const execution = requireExecution(interaction);
    const staffOption = execution.options.getUser('staff');

    if (staffOption === null) throw new ConfigurationError('staff is required');

    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'demote',
      subcommand: null,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eligibility = await this.service.getDemotionEligibility(
      execution.guildId,
      execution.authorization.discordUserId,
      staffOption.id,
    );

    const confirmation = this.confirmations.create(
      {
        action: 'DEMOTE',
        commandName: 'demote',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        initiatorStaffRole: 'TM',
        teamId: eligibility.club.id,
        targetDiscordUserId: eligibility.target.discordUserId,
        targetStaffRole: eligibility.targetStaffRole,
      },
      {
        prefix: 'promotion-demotion-confirm',
        now: this.now(),
        onExpire: async () => {
          await interaction.editReply({
            embeds: [confirmationExpiredEmbed()],
            components: [],
          });
        },
      },
    );

    const presentation = resolveTeamPresentation(interaction, eligibility.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const color = getTeamEmbedColor(presentation, BOT_COLORS.warning);
    const targetName = staffOption.displayName || getUserDisplayName(interaction, staffOption.id);
    const targetFormatted = formatUserWithVisibleName(staffOption.id, targetName);
    const currentRankLabel = getFriendlyPositionName(eligibility.targetStaffType);

    const description = [
      `You are demoting ${targetFormatted} for ${team}.`,
      '',
      `**Current Rank:** ${currentRankLabel}`,
      '**Resulting Rank:** Player',
      '',
      `• Target's global ${currentRankLabel} role will be removed.`,
      '• Target will remain an active player on the team roster.',
      '• Team Discord role and roster count will remain unchanged.',
      '• The target will not be asked to approve this action and will receive no DM.',
    ].join('\n');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.confirmCustomId)
        .setEmoji(BOT_EMOJIS.demotion)
        .setLabel('Demote')
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
          title: `${BOT_EMOJIS.warning} Confirm Staff Demotion`,
          description,
          color,
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

    if (consumed.context.action === 'PROMOTE') {
      await this.completePromote(interaction, consumed.context);
      return true;
    }

    if (consumed.context.action === 'DEMOTE') {
      await this.completeDemote(interaction, consumed.context);
      return true;
    }

    throw new StaleConfirmationError();
  }

  private async completePromote(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
  ): Promise<void> {
    if (
      context.targetDiscordUserId === undefined ||
      context.initiatorStaffRole === undefined ||
      context.destinationStaffRole === undefined
    ) {
      throw new StaleConfirmationError();
    }

    const destStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'> =
      context.destinationStaffRole === 'ATM' ? 'ASSISTANT_MANAGER' : 'PLAYER_MANAGER';

    // Verify eligibility again at confirmation time
    const eligibility = await this.service.getPromotionEligibility(
      context.discordGuildId,
      context.initiatorDiscordUserId,
      context.targetDiscordUserId,
      destStaffType,
    );

    if (!samePromotionState(context, eligibility)) throw new StaleConfirmationError();

    const result = await this.service.promote({
      discordGuildId: context.discordGuildId,
      actorDiscordUserId: context.initiatorDiscordUserId,
      targetDiscordUserId: context.targetDiscordUserId,
      clubId: context.teamId,
      destinationStaffType: eligibility.destinationStaffType,
      expectedActorStaffRole: eligibility.callerStaffRole,
      expectedTargetStaffRole: eligibility.targetStaffRole,
      occurredAt: this.now(),
    });

    const presentation = resolveTeamPresentation(interaction, result.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const targetName = getUserDisplayName(interaction, context.targetDiscordUserId);
    const targetFormatted = formatUserWithVisibleName(context.targetDiscordUserId, targetName);

    const staffRoleId = result.announcement?.staffRoleId;
    const staffRoleMention = staffRoleId
      ? `<@&${staffRoleId}>`
      : `@${eligibility.destinationStaffRole}`;

    const description = `${targetFormatted} has been promoted to ${staffRoleMention} for ${team}.`;

    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Staff Member Promoted`,
          description,
          color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        }),
      ],
      components: [],
    });
  }

  private async completeDemote(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
  ): Promise<void> {
    if (
      context.targetDiscordUserId === undefined ||
      context.initiatorStaffRole === undefined ||
      context.targetStaffRole === undefined
    ) {
      throw new StaleConfirmationError();
    }

    const eligibility = await this.service.getDemotionEligibility(
      context.discordGuildId,
      context.initiatorDiscordUserId,
      context.targetDiscordUserId,
    );

    if (!sameDemotionState(context, eligibility)) throw new StaleConfirmationError();

    const result = await this.service.demote({
      discordGuildId: context.discordGuildId,
      actorDiscordUserId: context.initiatorDiscordUserId,
      targetDiscordUserId: context.targetDiscordUserId,
      clubId: context.teamId,
      expectedActorStaffRole: eligibility.callerStaffRole,
      expectedTargetStaffRole: eligibility.targetStaffRole,
      occurredAt: this.now(),
    });

    const presentation = resolveTeamPresentation(interaction, result.club);
    const team = formatTeamIdentity(presentation.team, 'message');
    const targetName = getUserDisplayName(interaction, context.targetDiscordUserId);
    const targetFormatted = formatUserWithVisibleName(context.targetDiscordUserId, targetName);

    const description = `${targetFormatted} has been demoted to player for ${team}.`;

    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Staff Member Demoted`,
          description,
          color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        }),
      ],
      components: [],
    });
  }
}
