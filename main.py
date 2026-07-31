import time
import discord

from discord import app_commands
from discord.ext import commands

import config
import database
import embeds

from logo_grid import build_club_logo_grid


intents = discord.Intents.default()
intents.members = True


bot = commands.Bot(
    command_prefix="!",
    intents=intents
)





def disable_view(view):

    for item in view.children:

        if isinstance(item, discord.ui.Button):

            item.disabled = True





def has_manager_role(member):

    return any(
        role.id in config.ALLOWED_ROLES
        for role in member.roles
    )





def get_club(member):

    """
    Detect club from manager Discord role
    """

    for role in member.roles:

        club = database.get_club_by_role(
            role.id
        )

        if club:

            return club


    return None





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





    async def interaction_check(
        self,
        interaction
    ):

        if interaction.user.id != self.player.id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return False


        return True








    @discord.ui.button(
        label="Sign Contract",
        emoji="✍️",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction,
        button
    ):


        await interaction.response.defer()


        # Save transfer
        database.add_transfer(

            player_id=self.player.id,

            player_name=str(self.player),

            old_club="Free Agent",

            manager=str(self.manager),

            new_club=self.club[1],

            club_id=self.club[0],

            status="SIGNED"

        )



        if config.ENABLE_ROSTER_TRACKING:

            database.increase_roster(
                self.club[0]
            )



        updated_club = (
            database.get_club_by_role(
                self.club[0]
            )
            or self.club
        )



        print("SIGNED CLUB:", updated_club)

        print(
            "CLUB LOGO:",
            updated_club[2]
        )



        squad_size = updated_club[4]



        announcement = embeds.transfer_announcement_embed(

            player=self.player,

            manager=self.manager,

            club=updated_club,

            squad_size=squad_size

        )



        # Create club logo grid image

        grid = await build_club_logo_grid(
            highlight_role_id=self.club[0]
        )



        file = discord.File(
            grid,
            filename=config.LOGO_GRID_FILENAME
        )



        channel = bot.get_channel(
            config.TRANSFER_CHANNEL_ID
        )


        if channel:

            await channel.send(

                embed=announcement,

                file=file

            )



        try:

            await self.player.send(

                embed=embeds.contract_signed_dm_embed(
                    updated_club
                )

            )

        except discord.Forbidden:

            pass



        disable_view(self)



        await interaction.message.edit(
            view=self
        )



        await interaction.followup.send(
            "Contract signed successfully.",
            ephemeral=True
        )









    @discord.ui.button(
        label="Decline Offer",
        emoji="❌",
        style=discord.ButtonStyle.danger
    )
    async def reject(
        self,
        interaction,
        button
    ):


        embed = embeds.offer_declined_dm_embed(
            self.club
        )


        disable_view(self)


        await interaction.response.edit_message(

            embed=embed,

            view=self

        )









@bot.event
async def on_ready():

    database.setup()

    database.load_default_clubs()


    synced = await bot.tree.sync()


    print(
        f"{bot.user} online"
    )

    print(
        f"{len(synced)} commands synced"
    )









@bot.tree.command(
    name="offer",
    description="Send a transfer offer to a player"
)
@app_commands.describe(
    player="Player receiving the offer"
)
async def offer(
    interaction: discord.Interaction,
    player: discord.Member
):


    if not has_manager_role(
        interaction.user
    ):

        await interaction.response.send_message(

            embed=embeds.error_embed(

                "Permission Denied",

                "You cannot send transfer offers."

            ),

            ephemeral=True

        )

        return





    club = get_club(
        interaction.user
    )



    if club is None:


        await interaction.response.send_message(

            embed=embeds.error_embed(

                "Club Not Found",

                "Your manager role is not linked to a club."

            ),

            ephemeral=True

        )

        return





    expires = (
        int(time.time())
        +
        config.OFFER_TIMEOUT
    )



    embed = embeds.offer_embed(

        club=club,

        player=player,

        manager=interaction.user,

        expires_at=expires

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



    except discord.Forbidden:


        await interaction.response.send_message(

            embed=embeds.offer_failed_embed(
                player
            ),

            ephemeral=True

        )

        return





    await interaction.response.send_message(

        embed=embeds.offer_sent_embed(

            club=club,

            player=player,

            expires_at=expires

        ),

        ephemeral=True

    )








if __name__ == "__main__":

    bot.run(
        config.TOKEN
    )