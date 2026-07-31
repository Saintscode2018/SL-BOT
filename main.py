import time
from datetime import datetime, timezone

import discord
from discord.ext import commands
from discord import app_commands

import config
import database


database.setup()
database.load_default_clubs()

intents = discord.Intents.default()
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)


def get_club(member: discord.Member):
    for role in member.roles:
        club = database.get_club_by_role(role.id)
        if club:
            return club
    return None


def has_manager_role(member: discord.Member):
    return any(role.id in config.MANAGER_ROLES for role in member.roles)


def make_embed(title: str, description: str, color: int, thumbnail: str | None = None):
    embed = discord.Embed(title=title, description=description, color=color)
    embed.set_author(
        name="Super League S5 • Transfer Centre",
        icon_url=config.LEAGUE_LOGO,
    )
    if thumbnail:
        embed.set_thumbnail(url=thumbnail)
    embed.timestamp = datetime.now(timezone.utc)
    return embed


class OfferView(discord.ui.View):
    def __init__(self, player: discord.Member, manager: discord.Member, club):
        super().__init__(timeout=config.OFFER_TIMEOUT)
        self.player = player
        self.manager = manager
        self.club = club

    @discord.ui.button(
        label="Sign Contract",
        emoji="✍️",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):

        if interaction.user.id != self.player.id:
            await interaction.response.send_message(
                "This contract is not assigned to you.",
                ephemeral=True,
            )
            return

        await interaction.response.defer()

        # Save transfer
        database.add_transfer(
            self.player.id,
            str(self.player),
            "Free Agent",
            str(self.manager),
            "Manchester United",
            self.club[1],
            "SIGNED",
        )

        # Update roster
        database.increase_roster(self.club[0])


        # ===============================
        # TRANSFER ANNOUNCEMENT EMBED
        # ===============================

       accepted = discord.Embed(
    title="🏆 TRANSFER COMPLETED",
    description=(
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎉 {self.player.mention} has accepted a contract offer from\n\n"
        f"🔴 **{self.club[1]}**\n\n"
        "The player has completed registration and is now "
        "officially part of **Super League S5**.\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    ),
    color=self.club[3],
    timestamp=datetime.now(timezone.utc)
)


accepted.set_author(
    name="Super League S5 • Transfer Centre",
    icon_url=config.LEAGUE_LOGO
)


accepted.set_thumbnail(
    url=self.club[2]
)


accepted.add_field(
    name="👤 Player",
    value=self.player.mention,
    inline=True
)


accepted.add_field(
    name="🏟️ New Club",
    value=f"**{self.club[1]}**",
    inline=True
)


accepted.add_field(
    name="👔 Manager",
    value=self.manager.mention,
    inline=True
)


accepted.add_field(
    name="🧑‍🏫 Coach",
    value=self.club[5],
    inline=True
)


accepted.add_field(
    name="📋 Squad Registration",
    value=f"**{self.club[6] + 1}/{self.club[7]}**",
    inline=True
)


accepted.add_field(
    name="📄 Contract",
    value="Professional First Team",
    inline=True
)


accepted.add_field(
    name="🟢 League Status",
    value="REGISTERED",
    inline=True
)


accepted.add_field(
    name="🏆 Competition",
    value="Super League S5",
    inline=True
)


accepted.set_footer(
    text=(
        f"Player: {self.player.display_name} • "
        "Official Transfer System"
    )
)
        # Send announcement

        channel = bot.get_channel(
            config.TRANSFER_CHANNEL_ID
        )

        if channel:
            await channel.send(
                embed=announcement
            )


    

        dm = discord.Embed(
            title="🎉 CONTRACT SIGNED",
            description=(
                f"Welcome to **{self.club[1]}**!\n\n"
                f"You have officially joined "
                f"{self.club[1]} and are now registered "
                "for Super League S5."
            ),
            color=0x2ECC71,
            timestamp=datetime.now(timezone.utc),
        )


        dm.set_thumbnail(
            url=self.club[2]
        )


        dm.add_field(
            name="🏟️ Club",
            value=self.club[1],
            inline=True,
        )


        dm.add_field(
            name="📄 Contract",
            value="First Team",
            inline=True,
        )


        dm.add_field(
            name="🟢 Status",
            value="Approved",
            inline=True,
        )


        await self.player.send(
            embed=dm
        )


        # Update original offer message

        accepted = discord.Embed(
            title="✅ OFFER ACCEPTED",
            description=(
                f"{self.player.mention} has accepted "
                f"the offer from 🔴 **{self.club[1]}**\n\n"
                "The transfer has been completed."
            ),
            color=0x2ECC71,
            timestamp=datetime.now(timezone.utc),
        )


        await interaction.message.edit(
            embed=accepted,
            view=None,
        )


        await interaction.followup.send(
            "Contract signed successfully.",
            ephemeral=True,
        )

    @discord.ui.button(label="Decline Offer", emoji="🚫", style=discord.ButtonStyle.secondary)
    async def reject(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.player.id:
            await interaction.response.send_message(
                "This contract is not assigned to you.",
                ephemeral=True,
            )
            return

        declined = make_embed(
            title="OFFER DECLINED",
            description=(
                f"You have declined the transfer offer from **{self.club[1]}**.\n\n"
                "The contract has been voided and no registration has been processed."
            ),
            color=0xE74C3C,
            thumbnail=self.club[2],
        )

        await interaction.response.edit_message(embed=declined, view=None)


@bot.event
async def on_ready():
    synced = await bot.tree.sync()
    print(f"{bot.user} connected")
    print(f"{len(synced)} application commands synced")


@bot.tree.command(
    name="offer",
    description="Send an official transfer offer to a player",
)
@app_commands.describe(player="Player receiving the transfer offer")
async def offer(interaction: discord.Interaction, player: discord.Member):
    if not any(role.id in config.ALLOWED_ROLES for role in interaction.user.roles):
        await interaction.response.send_message(
            "You do not have permission to send transfer offers.",
            ephemeral=True,
        )
        return

    if has_manager_role(player):
        await interaction.response.send_message(
            "Managers cannot receive transfer offers.",
            ephemeral=True,
        )
        return

    club = get_club(interaction.user)

    if club is None:
        await interaction.response.send_message(
            "Your club could not be identified.",
            ephemeral=True,
        )
        return

    expires = int(time.time()) + config.OFFER_TIMEOUT

    offer_embed = make_embed(
        title=f"CONTRACT OFFER — {club[1].upper()}",
        description=(
            f"**{club[1]}** has submitted an official professional contract offer for {player.mention}.\n\n"
            "Review the contract details below and choose whether to sign or decline the offer."
        ),
        color=club[3],
        thumbnail=club[2],
    )

    offer_embed.add_field(name="Manager", value=interaction.user.mention, inline=True)
    offer_embed.add_field(name="Coach", value=club[5], inline=True)
    offer_embed.add_field(name="Squad Status", value=f"**{club[6]}/{club[7]}**", inline=True)
    offer_embed.add_field(name="Transfer Status", value="🟡 **Pending Response**", inline=True)
    offer_embed.add_field(name="Contract Type", value="**Professional First Team**", inline=True)
    offer_embed.add_field(name="Response Window", value=f"<t:{expires}:R>", inline=True)
    offer_embed.set_footer(text="This contract becomes void once the response window expires.")

    try:
        await player.send(
            embed=offer_embed,
            view=OfferView(player, interaction.user, club),
        )

        confirmation = make_embed(
            title="TRANSFER OFFER SENT",
            description=(
                f"An official contract offer has been delivered to {player.mention}.\n\n"
                f"**Club:** {club[1]}\n"
                f"**Expires:** <t:{expires}:R>"
            ),
            color=0x2ECC71,
            thumbnail=club[2],
        )

        await interaction.response.send_message(embed=confirmation, ephemeral=True)

    except discord.Forbidden:
        error = make_embed(
            title="TRANSFER OFFER FAILED",
            description=(
                f"{player.mention} has direct messages disabled, so the contract could not be delivered."
            ),
            color=0xE74C3C,
        )

        await interaction.response.send_message(embed=error, ephemeral=True)