import time

import discord
from discord import app_commands
from discord.ext import commands

import config
import database
import embeds


intents = discord.Intents.default()
intents.members = True
intents.message_content = True


bot = commands.Bot(
    command_prefix="!",
    intents=intents
)



def disable_view(view):

    for item in view.children:
        item.disabled = True





def has_manager_role(member):

    return any(
        role.id in config.ALLOWED_ROLES
        for role in member.roles
    )





def get_club(member):

    for role in member.roles:

        club = database.get_club_by_role(
            role.id
        )

        if club:
            return club

    return None





async def give_club_role(player_id, role_id):

    guild = bot.get_guild(
        config.SERVER_ID
    )


    if guild is None:
        print("Server not found")
        return False



    member = guild.get_member(
        player_id
    )


    role = guild.get_role(
        role_id
    )


    if member is None:

        print("Player not found")
        return False



    if role is None:

        print("Club role not found")
        return False



    await member.add_roles(
        role,
        reason="Signed transfer"
    )


    return True







class OfferView(discord.ui.View):

    def __init__(
        self,
        player_id,
        manager_id,
        club_id
    ):

        super().__init__(
            timeout=None
        )

        self.player_id = player_id
        self.manager_id = manager_id
        self.club_id = club_id




    async def interaction_check(
        self,
        interaction
    ):

        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return False


        return True






    @discord.ui.button(
        label="Accept Contract",
        emoji="✅",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction,
        button
    ):

        print("ACCEPT CLICKED")


        await interaction.response.defer(
            ephemeral=True
        )



        player = interaction.user



        club = database.get_club_by_role(
            self.club_id
        )


        if club is None:

            await interaction.followup.send(
                "Club not found in database.",
                ephemeral=True
            )

            return





        manager = bot.get_user(
            self.manager_id
        )


        if manager is None:

            manager = await bot.fetch_user(
                self.manager_id
            )





        database.add_transfer(

            player_id=player.id,

            player_name=str(player),

            old_club="Free Agent",

            manager=str(manager),

            new_club=club[1],

            club_id=club[0],

            status="SIGNED"

        )





        if config.ENABLE_ROSTER_TRACKING:

            database.increase_roster(
                club[0]
            )





        role_added = await give_club_role(

            player.id,

            club[0]

        )



        if not role_added:

            print(
                "Role could not be added"
            )







        channel = bot.get_channel(
            config.TRANSFER_CHANNEL_ID
        )


        if channel:


            embed = embeds.transfer_announcement_embed(

                player=player,

                manager=manager,

                club=club,

                squad_size=club[4]

            )


            await channel.send(
                embed=embed
            )







        disable_view(self)



        await interaction.message.edit(
            view=self
        )




        await interaction.followup.send(

            "You signed the contract!",

            ephemeral=True

        )









    @discord.ui.button(
        label="Decline Contract",
        emoji="❌",
        style=discord.ButtonStyle.danger
    )
    async def decline(
        self,
        interaction,
        button
    ):


        club = database.get_club_by_role(
            self.club_id
        )


        disable_view(self)


        await interaction.response.edit_message(

            embed=embeds.offer_declined_dm_embed(
                club
            ),

            view=self

        )









@bot.event
async def on_ready():


    database.setup()

    database.load_default_clubs()



    synced = await bot.tree.sync()


    print(
        f"Logged in as {bot.user}"
    )

    print(
        f"Synced {len(synced)} commands"
    )









@bot.tree.command(
    name="offer",
    description="Send a transfer offer"
)
@app_commands.describe(
    player="Player to offer"
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

                "No Permission",

                "You are not a manager."

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

                "Club Not Connected",

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





    offer_embed = embeds.offer_embed(

        club=club,

        player=player,

        manager=interaction.user,

        expires_at=expires

    )




    view = OfferView(

        player.id,

        interaction.user.id,

        club[0]

    )





    try:


        await player.send(

            embed=offer_embed,

            view=view

        )



    except discord.Forbidden:


        await interaction.response.send_message(

            "I cannot DM this player.",

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