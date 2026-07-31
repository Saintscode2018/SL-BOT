
import discord
from discord.ext import commands

class OfferView(discord.ui.View):
    """Interactive contract offer sent to a player via DM."""

    def __init__(
        self,
        player: discord.Member,
        manager: discord.Member,
        club: database.ClubRow,
    ) -> None:
        super().__init__(timeout=config.OFFER_TIMEOUT)
        self.player = player
        self.manager = manager
        self.club = club

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.player.id:
            await interaction.response.send_message(
                "This contract is not assigned to you.",
                ephemeral=True,
            )
            return False
        return True

    @discord.ui.button(
        label="Sign Contract",
        emoji="✍️",
        style=discord.ButtonStyle.success,
    )
    async def accept(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ) -> None:
        await interaction.response.defer()
        database.add_transfer(
            player_id=self.player.id,
            player_name=str(self.player),
            old_club="Free Agent",
            manager=str(self.manager),
            new_club=self.club[1],
            club_role=self.club[0],
            status="SIGNED",
        )
        if config.ENABLE_ROSTER_TRACKING:
            database.increase_roster(self.club[0])
        updated_club = database.get_club_by_role(self.club[0]) or self.club
        squad_size = updated_club[6]
        announcement = embeds.transfer_announcement_embed(
            player=self.player,
            manager=self.manager,
            club=updated_club,
            squad_size=squad_size,
        )
        grid_buffer = await build_club_logo_grid(highlight_role_id=self.club[0])
        grid_file = discord.File(grid_buffer, filename=config.LOGO_GRID_FILENAME)
        announcement.set_image(url=f"attachment://{config.LOGO_GRID_FILENAME}")
        channel = bot.get_channel(config.TRANSFER_CHANNEL_ID)
        if channel and isinstance(channel, discord.TextChannel):
            await channel.send(embed=announcement, file=grid_file)
        try:
            await self.player.send(embed=embeds.contract_signed_dm_embed(updated_club))
        except discord.Forbidden:
            pass
        disable_view(self)
        completed_embed = embeds.transfer_completed_dm_embed(
            player=self.player,
            club=updated_club,
        )
        await interaction.message.edit(embed=completed_embed, view=self)
        await interaction.followup.send(
            "Contract signed successfully.",
            ephemeral=True,
        )

    @discord.ui.button(
        label="Decline Offer",
        emoji="❌",
        style=discord.ButtonStyle.danger,
    )
    async def reject(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ) -> None:
        declined_embed = embeds.offer_declined_dm_embed(self.club)
        disable_view(self)
        await interaction.response.edit_message(embed=declined_embed, view=self)


@bot.event
async def on_ready() -> None:
    synced = await bot.tree.sync()
    print(f"{bot.user} connected")
    print(f"{len(synced)} application commands synced")


@bot.tree.command(
    name="offer",
    description="Send an official transfer offer to a player",
)
@app_commands.describe(player="Player receiving the transfer offer")
async def offer(interaction: discord.Interaction, player: discord.Member) -> None:
    if not any(role.id in config.ALLOWED_ROLES for role in interaction.user.roles):
        await interaction.response.send_message(
            embed=embeds.error_embed(
                title="Permission Denied",
                description="You do not have permission to send transfer offers.",
            ),
            ephemeral=True,
        )
        return
    if has_manager_role(player):
        await interaction.response.send_message(
            embed=embeds.error_embed(
                title="Invalid Target",
                description="Managers cannot receive transfer offers.",
            ),
            ephemeral=True,
        )
        return
    club = get_club(interaction.user)
    if club is None:
        await interaction.response.send_message(
            embed=embeds.error_embed(
                title="Club Not Found",
                description="Your club could not be identified.",
            ),
            ephemeral=True,
        )
        return
    expires_at = int(time.time()) + config.OFFER_TIMEOUT
    offer_message = embeds.offer_embed(
        club=club,
        player=player,
        manager=interaction.user,
        expires_at=expires_at,
    )
    try:
        await player.send(
            embed=offer_message,
            view=OfferView(player, interaction.user, club),
        )
    except discord.Forbidden:
        await interaction.response.send_message(
            embed=embeds.offer_failed_embed(player),
            ephemeral=True,
        )
        return
    await interaction.response.send_message(
        embed=embeds.offer_sent_embed(
            club=club,
            player=player,
            expires_at=expires_at,
        ),
        ephemeral=True,
    )


if __name__ == "__main__":
    bot.run(config.TOKEN)
