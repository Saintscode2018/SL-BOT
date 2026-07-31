import discord
from discord import app_commands
from discord.ext import commands

import config
import database


database.setup()
database.load_default_clubs()


intents = discord.Intents.default()
intents.members = True


bot = commands.Bot(
    command_prefix="!",
    intents=intents
)



def get_club(member):

    for role in member.roles:

        club = database.get_club_by_role(
            role.id
        )

        if club:
            return club

    return None



def has_manager_role(member):

    return any(
        role.id in config.MANAGER_ROLES
        for role in member.roles
    )



class OfferView(discord.ui.View):

    def __init__(
        self,
        player,
        manager,
        club
    ):

        super().__init__(
            timeout=config.OFFER_TIMEOUT
        )

        self.player = player
        self.manager = manager
        self.club = club



    @discord.ui.button(
        label="Accept",
        emoji="✅",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction,
        button
    ):


        if interaction.user.id != self.player.id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return



        await interaction.response.defer()


        embed = discord.Embed(
            title="🚨 TRANSFER COMPLETED",
            description=f"""
🏟 **{self.club[1]}**

👤 **Player Signed**
Discord:
{self.player.mention}

Roblox:
`Not Set`


👔 **Signed By**
Discord:
{self.manager.mention}


🧑‍💼 **Coach**
{self.club[5]}


✅ Status:
Accepted
""",
            color=self.club[3]
        )


        embed.set_thumbnail(
            url=self.club[2]
        )


        embed.set_footer(
            text=config.FOOTER_TEXT
        )


        channel = bot.get_channel(
            config.TRANSFER_CHANNEL_ID
        )


        if channel:

            await channel.send(
                embed=embed
            )


        database.add_transfer(
            self.player.id,
            str(self.player),
            "Not Set",
            str(self.manager),
            "Not Set",
            self.club[1],
            "SIGNED"
        )


        database.increase_roster(
            self.club[0]
        )


        await interaction.message.edit(
            view=None
        )


        await interaction.followup.send(
            "Transfer accepted!",
            ephemeral=True
        )




    @discord.ui.button(
        label="Reject",
        emoji="❌",
        style=discord.ButtonStyle.danger
    )
    async def reject(
        self,
        interaction,
        button
    ):


        if interaction.user.id != self.player.id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return



        await interaction.response.send_message(
            "Offer rejected.",
            ephemeral=True
        )


        await interaction.message.edit(
            view=None
        )





@bot.event
async def on_ready():

    synced = await bot.tree.sync()

    print(
        f"{bot.user} online"
    )

    print(
        f"{len(synced)} commands loaded"
    )





@bot.tree.command(
    name="offer",
    description="Send a player transfer offer"
)
@app_commands.describe(
    player="Player receiving the offer"
)
async def offer(
    interaction: discord.Interaction,
    player: discord.Member
):


    if not any(
        role.id in config.ALLOWED_ROLES
        for role in interaction.user.roles
    ):

        await interaction.response.send_message(
            "No permission.",
            ephemeral=True
        )

        return



    if has_manager_role(player):

        await interaction.response.send_message(
            "Managers cannot receive transfer offers.",
            ephemeral=True
        )

        return



    club = get_club(
        interaction.user
    )


    if club is None:

        await interaction.response.send_message(
            "Your club was not found.",
            ephemeral=True
        )

        return



    embed = discord.Embed(
        title="⚽ PLAYER TRANSFER OFFER",
        description=f"""
🏟 **{club[1]}**

You have received an official transfer offer.

👤 Player:
{player.mention}


👔 Offered By:
{interaction.user.mention}


🧑‍💼 Coach:
{club[5]}
""",
        color=club[3]
    )


    embed.set_thumbnail(
        url=club[2]
    )


    embed.add_field(
        name="📋 Squad",
        value=f"{club[6]}/{club[7]}",
        inline=True
    )


    embed.set_footer(
        text=config.FOOTER_TEXT
    )


    try:

        await player.send(
            embed=embed,
            view=OfferView(
                player,
                interaction.user,
                club
            )
        )


        await interaction.response.send_message(
            "Offer sent successfully.",
            ephemeral=True
        )


    except discord.Forbidden:

        await interaction.response.send_message(
            "Player has DMs disabled.",
            ephemeral=True
        )




bot.run(
    config.TOKEN
)