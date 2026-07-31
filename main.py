import time

import discord
from discord import app_commands
from discord.ext import commands

import config
import database
import embeds


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





def has_manager_role(member: discord.Member):

    return any(
        role.id in config.ALLOWED_ROLES
        for role in member.roles
    )





def get_club(member: discord.Member):

    """
    Detection system:

    Manager Discord Role ID
            ↓
    Database role_id
            ↓
    Club
            ↓
    Logo + Name
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
                "This contract is not assigned to you.",
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



        updated_club = database.get_club_by_role(
            self.club[0]
        )



        announcement = embeds.transfer_announcement_embed(

            player=self.player,

            manager=self.manager,

            club=updated_club,

            squad_size=updated_club[4]

        )



        channel = bot.get_channel(
            config.TRANSFER_CHANNEL_ID
        )



        if isinstance(
            channel,
            discord.TextChannel
        ):


            await channel.send(
                embed=announcement
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

            embed=embeds.transfer_completed_dm_embed(

                player=self.player,

                club=updated_club

            ),

            view=self

        )



        await interaction.followup.send(

            "✅ Contract signed successfully.",

            ephemeral=True

        )







    @discord.ui.button(

        label="Decline Offer",

        emoji="❌",

        style=discord.ButtonStyle.danger

    )
    async def decline(

        self,

        interaction,

        button

    ):


        disable_view(self)



        await interaction.response.edit_message(

            embed=embeds.offer_declined_dm_embed(
                self.club
            ),

            view=self

        )







@bot.event
async def on_ready():


    database.setup()

    database.load_default_clubs()



    synced = await bot.tree.sync()



    print(
        f"{bot.user} is online"
    )


    print(
        f"{len(synced)} commands synced"
    )








@bot.tree.command(
    name="offer",
    description="Send an official transfer offer"
)
@app_commands.describe(
    player="Player receiving the offer"
)
async def offer(
    interaction: discord.Interaction,
    player: discord.Member
):


    await interaction.response.defer(
        ephemeral=True
    )





    if not has_manager_role(
        interaction.user
    ):


        await interaction.followup.send(

            embed=embeds.error_embed(

                "Permission Denied",

                "You cannot send transfer offers."

            )

        )

        return





    club = get_club(
        interaction.user
    )



    if club is None:


        await interaction.followup.send(

            embed=embeds.error_embed(

                "Club Not Found",

                "Your manager role is not linked to a club."

            )

        )

        return





    expires_at = (
        int(time.time())
        +
        config.OFFER_TIMEOUT
    )





    offer_embed = embeds.offer_embed(

        club=club,

        player=player,

        manager=interaction.user,

        expires_at=expires_at

    )






    try:


        await player.send(

            embed=offer_embed,

            view=OfferView(

                player,

                interaction.user,

                club

            )

        )



    except discord.Forbidden:


        await interaction.followup.send(

            embed=embeds.offer_failed_embed(
                player
            )

        )

        return





    await interaction.followup.send(

        embed=embeds.offer_sent_embed(

            club=club,

            player=player,

            expires_at=expires_at

        )

    )









if __name__ == "__main__":

    bot.run(
        config.TOKEN
    )