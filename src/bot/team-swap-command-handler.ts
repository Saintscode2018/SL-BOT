import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

import { StaleConfirmationError } from '../domain/errors.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type {
  ConfirmationContext,
  ConfirmationRegistry,
} from '../services/confirmation-registry.js';
import type { TeamSwapService } from '../services/team-swap-service.js';
import { createSuccessEmbed, createWarningEmbed, formatRosterAdminWarning } from './embeds.js';
import { getTeamThumbnail } from './emoji-helper.js';
import { extractAuthorizationInput, requireGuildExecution } from './guild-execution.js';
import { requireString } from './option-parsing.js';
import { createConfirmationExpiredEmbed, handleConfirmationCancel } from './confirmation-ui.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  createActorFooter,
  createGuildAuthor,
  getUserDisplayName,
} from './presentation/index.js';
import { resolveTeamPresentation } from './team-presentation.js';
import type { ButtonInteractionAdapter, CommandInteraction } from './types.js';

export type TeamSwapClock = () => Date;

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

export class TeamSwapCommandHandler {
  public constructor(
    private readonly channelPolicy: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>,
    private readonly service: TeamSwapService,
    private readonly confirmations: ConfirmationRegistry,
    private readonly now: TeamSwapClock = () => new Date(),
  ) {}

  public canHandle(customId: string): boolean {
    return customId.startsWith('team-swap-confirm:');
  }

  public async begin(interaction: CommandInteraction): Promise<void> {
    const execution = requireGuildExecution(interaction, { requireChannel: true });
    const team1Id = requireString(execution.options, 'team1');
    const team2Id = requireString(execution.options, 'team2');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'team',
      subcommand: 'swap',
    });
    const eligibility = await this.service.getEligibility(
      execution.authorization,
      team1Id,
      team2Id,
    );
    const { team: presentation1 } = await resolveTeamPresentation(interaction, eligibility.team1);
    const { team: presentation2 } = await resolveTeamPresentation(interaction, eligibility.team2);

    const occurredAt = this.now();
    const confirmation = this.confirmations.create(
      {
        action: 'SWAP',
        commandName: 'team',
        discordGuildId: execution.guildId,
        initiatorDiscordUserId: execution.authorization.discordUserId,
        teamId: eligibility.team1.id,
        team2Id: eligibility.team2.id,
      },
      {
        prefix: 'team-swap-confirm',
        now: occurredAt,
        onExpire: async () => {
          await interaction.editReply({
            embeds: [
              createConfirmationExpiredEmbed({
                description:
                  'This confirmation expired after two minutes. Run `/team swap` again to retry.',
              }),
            ],
            components: [],
          });
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

    const formatted1 = formatTeamIdentity(presentation1, 'message');
    const formatted2 = formatTeamIdentity(presentation2, 'message');

    const description = [
      `You are about to swap the complete active populations of ${formatted1} and ${formatted2}.`,
      '',
      `**Moving to ${formatted1}:** ${eligibility.team2ActiveMemberCount} unique member(s)`,
      `**Moving to ${formatted2}:** ${eligibility.team1ActiveMemberCount} unique member(s)`,
      '',
      '> Active memberships will exchange teams',
      '> Team identities, roles, colors, and squad limits remain unchanged',
      '> Staff members will retain their global staff rank roles',
      '',
      '**This operation cannot be casually undone.**',
    ].join('\n');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmation.confirmCustomId)
        .setLabel('Confirm Swap')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(confirmation.cancelCustomId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [
        createWarningEmbed({
          title: `${BOT_EMOJIS.warning} Confirm Team Population Swap`,
          description,
          color: BOT_COLORS.warning,
          author: createGuildAuthor({
            guildName: execution.guildName,
            guildIconUrl: interaction.guildIconUrl,
          }),
          thumbnail: getTeamThumbnail(eligibility.team1.emoji),
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
      return handleConfirmationCancel(interaction, this.confirmations, this.now(), {
        title: `${BOT_EMOJIS.warning} Team Swap Cancelled`,
        description: 'No database or Discord role changes were made.',
      });
    }

    const consumed = this.confirmations.consumeDecision(
      interaction.customId,
      interaction.userId,
      this.now(),
      interaction.guildId,
    );
    if (consumed.context.action !== 'SWAP' || consumed.context.commandName !== 'team') {
      throw new StaleConfirmationError();
    }
    if (!consumed.context.team2Id) {
      throw new StaleConfirmationError();
    }

    const authorization = requireButtonAuthorization(interaction);
    await interaction.deferUpdate();
    await this.channelPolicy.validateChannelPolicy({
      authorization,
      channelId: interaction.channelId!,
      commandName: 'team',
      subcommand: 'swap',
    });
    await this.complete(interaction, consumed.context, authorization);
    return true;
  }

  private async complete(
    interaction: ButtonInteractionAdapter,
    context: ConfirmationContext,
    authorization: AuthorizationInput,
  ): Promise<void> {
    const occurredAt = this.now();
    const result = await this.service.swap({
      authorization,
      team1Id: context.teamId,
      team2Id: context.team2Id!,
      occurredAt,
    });

    const { team: presentation1 } = await resolveTeamPresentation(interaction, result.team1);
    const { team: presentation2 } = await resolveTeamPresentation(interaction, result.team2);

    const actorName = getUserDisplayName(
      interaction,
      authorization.discordUserId,
      interaction.userDisplayName,
    );
    const footer = createActorFooter({
      verb: 'Swapped',
      username: actorName,
      timestamp: occurredAt,
    });

    const warning = formatRosterAdminWarning(
      result.announcementDelivered,
      result.auditAnnouncementDelivered,
      'The team swap completed',
    );

    const formatted1 = formatTeamIdentity(presentation1, 'message');
    const formatted2 = formatTeamIdentity(presentation2, 'message');

    const descriptionLines = [
      `Successfully swapped active populations between ${formatted1} and ${formatted2}.`,
      '',
      `> Members moved to ${formatted1}: **${result.team2MovedCount}**`,
      `> Members moved to ${formatted2}: **${result.team1MovedCount}**`,
      '> Team identities and settings preserved',
      '> Staff rank roles preserved',
    ];

    if (warning !== null) {
      descriptionLines.push('', warning);
    }

    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Teams Swapped`,
          description: descriptionLines.join('\n'),
          color: BOT_COLORS.success,
          author: createGuildAuthor({
            guildName: interaction.guildName ?? result.guild.name,
            guildIconUrl: interaction.guildIconUrl,
          }),
          thumbnail: getTeamThumbnail(result.team1.emoji),
          footer: footer.text,
          ...(footer.iconURL === undefined ? {} : { footerIconURL: footer.iconURL }),
          timestamp: occurredAt,
        }),
      ],
      components: [],
    });
  }
}
