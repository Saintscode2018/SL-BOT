import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

import { StaleConfirmationError } from '../domain/errors.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type {
  ConfirmationContext,
  ConfirmationRegistry,
} from '../services/confirmation-registry.js';
import type { TeamDisbandmentService } from '../services/team-disbandment-service.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from './embeds.js';
import { getTeamThumbnail } from './emoji-helper.js';
import { extractAuthorizationInput, requireGuildExecution } from './guild-execution.js';
import { requireString } from './option-parsing.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  createActorFooter,
  createGuildAuthor,
  getUserDisplayName,
} from './presentation/index.js';
import { getTeamEmbedColor, resolveTeamPresentation } from './team-presentation.js';
import type { ButtonInteractionAdapter, CommandInteraction } from './types.js';

export type TeamDisbandmentClock = () => Date;

function requireButtonAuthorization(interaction: ButtonInteractionAdapter): AuthorizationInput {
  if (
    interaction.guildId === undefined ||
    interaction.guildOwnerId === undefined ||
    interaction.channelId === undefined
  ) {
    throw new StaleConfirmationError();
  }
  return extractAuthorizationInput(interaction);
}

function cancelledEmbed() {
  return createWarningEmbed({
    title: `${BOT_EMOJIS.warning} Team Disbandment Cancelled`,
    description: 'No database or Discord role changes were made.',
  });
}

function expiredEmbed() {
  return createErrorEmbed({
    title: `${BOT_EMOJIS.error} Confirmation Expired`,
    description: 'This confirmation expired after two minutes. Run `/team disband` again to retry.',
  });
}

export class TeamDisbandmentCommandHandler {
  public constructor(
    private readonly channelPolicy: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>,
    private readonly service: TeamDisbandmentService,
    private readonly confirmations: ConfirmationRegistry,
    private readonly now: TeamDisbandmentClock = () => new Date(),
  ) {}

  public canHandle(customId: string): boolean {
    return customId.startsWith('team-disband-confirm:');
  }

  public async begin(interaction: CommandInteraction): Promise<void> {
    const execution = requireGuildExecution(interaction, { requireChannel: true });
    const teamId = requireString(execution.options, 'team');

    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'team',
      subcommand: 'disband',
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eligibility = await this.service.getEligibility(execution.authorization, teamId);
    const { team, role } = await resolveTeamPresentation(interaction, eligibility.team);
    const occurredAt = this.now();
    const confirmation = this.confirmations.create(
      {
        action: 'DISBAND',
        commandName: 'team',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        teamId: eligibility.team.id,
      },
      {
        prefix: 'team-disband-confirm',
        now: occurredAt,
        onExpire: async () => {
          await interaction.editReply({ embeds: [expiredEmbed()], components: [] });
        },
      },
    );
    const actorName = getUserDisplayName(
      interaction,
      execution.authorization.discordUserId,
      interaction.userDisplayName,
    );
    const footer = createActorFooter({
      verb: 'Requested',
      username: actorName,
      timestamp: occurredAt,
    });
    const description = [
      `You are about to disband ${formatTeamIdentity(team, 'message')}.`,
      '',
      'This will:',
      '',
      '> End all active staff and player memberships',
      '> Remove the team role from all affected members',
      '> Remove applicable Team Manager, Assistant Team Manager, and Player Manager roles',
      '> Expire outstanding offers involving this team',
      '> Mark the team as inactive',
      '',
      'The Discord team role and team emoji will not be deleted.',
      '',
      '**This operation cannot be casually undone.**',
    ].join('\n');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.confirmCustomId)
        .setLabel('Disband Team')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(confirmation.cancelCustomId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [
        createWarningEmbed({
          title: `${BOT_EMOJIS.warning} Confirm Team Disbandment`,
          description,
          color: getTeamEmbedColor({ role }, BOT_COLORS.warning),
          author: createGuildAuthor({
            guildName: execution.guildName,
            guildIconUrl: interaction.guildIconUrl,
          }),
          thumbnail: getTeamThumbnail(eligibility.team.emoji),
          footer: footer.text,
          ...(footer.iconURL === undefined ? {} : { footerIconURL: footer.iconURL }),
          timestamp: occurredAt,
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
      await interaction.editReply({ embeds: [cancelledEmbed()], components: [] });
      return true;
    }

    const consumed = this.confirmations.consumeDecision(
      interaction.customId,
      interaction.userId,
      this.now(),
      interaction.guildId,
    );
    if (consumed.context.action !== 'DISBAND' || consumed.context.commandName !== 'team') {
      throw new StaleConfirmationError();
    }

    const authorization = requireButtonAuthorization(interaction);
    await this.channelPolicy.validateChannelPolicy({
      authorization,
      channelId: interaction.channelId!,
      commandName: 'team',
      subcommand: 'disband',
    });
    await interaction.deferUpdate();
    await this.complete(interaction, consumed.context, authorization);
    return true;
  }

  private async complete(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
    authorization: AuthorizationInput,
  ): Promise<void> {
    const eligibility = await this.service.getEligibility(authorization, context.teamId);
    const presentation = await resolveTeamPresentation(interaction, eligibility.team);
    const role = presentation.role;
    const occurredAt = this.now();
    const result = await this.service.disband({
      authorization,
      teamId: context.teamId,
      teamName: role?.name ?? 'Unknown Team Role',
      occurredAt,
    });
    const team = { ...result.team, discordRoleName: role?.name ?? null };
    const actorName = getUserDisplayName(
      interaction,
      authorization.discordUserId,
      interaction.userDisplayName,
    );
    const footer = createActorFooter({
      verb: 'Disbanded',
      username: actorName,
      timestamp: occurredAt,
    });
    const description = [
      `${formatTeamIdentity(team, 'message')} has been disbanded.`,
      '',
      `> Staff and player memberships ended: **${result.endedMembershipCount}**`,
      `> Members moved to free agency: **${result.affectedUserCount}**`,
      `> Outstanding offers expired: **${result.expiredOfferCount}**`,
      '> Discord team role preserved',
      '> Team emoji preserved',
    ].join('\n');

    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Team Disbanded`,
          description,
          color: getTeamEmbedColor({ role }, BOT_COLORS.success),
          author: createGuildAuthor({
            guildName: interaction.guildName ?? result.guild.name,
            guildIconUrl: interaction.guildIconUrl,
          }),
          thumbnail: getTeamThumbnail(result.team.emoji),
          footer: footer.text,
          ...(footer.iconURL === undefined ? {} : { footerIconURL: footer.iconURL }),
          timestamp: occurredAt,
        }),
      ],
      components: [],
    });
  }
}
