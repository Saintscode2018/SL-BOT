import discord
from discord import app_commands
from discord.ext import commands

import database


database.setup()
database.load_default_clubs()


TOKEN = "YOUR_NEW_TOKEN"


TRANSFER_CHANNEL_ID = 1519210891596398745


TEAM_MANAGER_ROLE = 1520900719799042088
ASSISTANT_TEAM_MANAGER_ROLE = 1520899851393437797
PLAYER_MANAGER_ROLE = 1521309945851547780


ALLOWED_ROLES = [
    TEAM_MANAGER_ROLE,
    ASSISTANT_TEAM_MANAGER_ROLE,
    PLAYER_MANAGER_ROLE
]



def get_user_club(member):

    for role in member.roles:

        club = database.get_club_by_role(role.id)

        if club:
            return club

    return None




class OfferView(discord.ui.View):

    def __init__(self, player_id, club):

        super().__init__(timeout=None)

        self.player_id = player_id
        self.club = club



    @discord.ui.button(
        label="Accept",
        emoji="✅",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):


        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "❌ This offer is not for you.",
                ephemeral=True
            )

            return



        await interaction.response.defer()



        # Remove buttons

        await interaction.message.edit(
            view=None
        )



        channel = bot.get_channel(
            TRANSFER_CHANNEL_ID
        )



        if channel:


            announcement = discord.Embed(

                title="🏆 SUPER LEAGUE S5",

                description=(

                    "## ✅ TRANSFER COMPLETED\n\n"

                    f"👤 **Player**\n"
                    f"{interaction.user.mention}\n\n"

                    f"🏟 **New Club**\n"
                    f"**{self.club[1]}**\n\n"

                    f"🌍 **Country**\n"
                    f"{self.club[5]}\n\n"

                    f"🏟 **Stadium**\n"
                    f"{self.club[6]}\n\n"

                    f"📋 **Roster**\n"
                    f"{self.club[8]}/{self.club[9]}"

                ),

                color=self.club[4]

            )


            announcement.set_thumbnail(
                url=self.club[2]
            )


            announcement.set_image(
                url=self.club[3]
            )


            announcement.set_footer(
                text="Super League Transfer Market"
            )


            announcement.timestamp = discord.utils.utcnow()



            await channel.send(
                embed=announcement
            )



        await interaction.followup.send(
            "✅ Offer accepted!",
            ephemeral=True
        )





    @discord.ui.button(
        label="Reject",
        emoji="❌",
        style=discord.ButtonStyle.danger
    )
    async def reject(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):


        if interaction.user.id != self.player_id:


            await interaction.response.send_message(
                "❌ This offer is not for you.",
                ephemeral=True
            )

            return



        await interaction.message.edit(
            view=None
        )



        await interaction.response.send_message(
            "❌ Offer rejected.",
            ephemeral=True
        )






intents = discord.Intents.default()

intents.members = True



bot = commands.Bot(
    command_prefix="!",
    intents=intents
)




@bot.event
async def on_ready():

    synced = await bot.tree.sync()

    print(
        f"Bot online: {bot.user}"
    )

    print(
        f"Commands synced: {len(synced)}"
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


    # Permission check

    if not any(
        role.id in ALLOWED_ROLES
        for role in interaction.user.roles
    ):


        await interaction.response.send_message(
            "❌ You don't have permission.",
            ephemeral=True
        )

        return




    club = get_user_club(
        interaction.user
    )



    if club is None:


        await interaction.response.send_message(
            "❌ No club role detected.",
            ephemeral=True
        )

        return





    embed = discord.Embed(

        title="⚽ PLAYER TRANSFER OFFER",

        description=(

            f"## {club[1]}\n\n"

            "You have received a transfer offer."

        ),

        color=club[4]

    )



    embed.set_thumbnail(
        url=club[2]
    )



    embed.set_image(
        url=club[3]
    )



    embed.add_field(

        name="🏟 Club",

        value=club[1],

        inline=True

    )



    embed.add_field(

        name="🌍 Country",

        value=club[5],

        inline=True

    )



    embed.add_field(

        name="🏟 Stadium",

        value=club[6],

        inline=False

    )



    embed.add_field(

        name="📋 Squad",

        value=f"{club[8]}/{club[9]}",

        inline=True

    )



    embed.set_footer(
        text="Super League S5 Transfer System"
    )



    embed.timestamp = discord.utils.utcnow()



    try:


        await player.send(

            embed=embed,

            view=OfferView(

                player.id,

                club

            )

        )



        await interaction.response.send_message(

            "✅ Offer sent privately.",

            ephemeral=True

        )



    except discord.Forbidden:


        await interaction.response.send_message(

            "❌ Player has DMs disabled.",

            ephemeral=True

        )





bot.run(TOKEN)