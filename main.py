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


def get_user_team(member):

    for role in member.roles:

        club = database.get_club_by_role(role.id)

        if club:
            return club

    return None



class OfferView(discord.ui.View):

    def __init__(self, player_id, guild_id, club):

        super().__init__(timeout=None)

        self.player_id = player_id
        self.guild_id = guild_id
        self.club = club



    @discord.ui.button(
        label="Accept",
        emoji="✅",
        style=discord.ButtonStyle.success
    )
    async def accept(self, interaction, button):

        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "This offer is not yours.",
                ephemeral=True
            )
            return


        await interaction.response.defer()


        embed = interaction.message.embeds[0]

        embed.color = discord.Color(
            self.club[4]
        )


        embed.add_field(
            name="Status",
            value="✅ Accepted",
            inline=False
        )


        await interaction.message.edit(
            embed=embed,
            view=None
        )


        try:

            channel = await bot.fetch_channel(
                TRANSFER_CHANNEL_ID
            )


            news = discord.Embed(
                title="🏆 Super League S5",
                description=(
                    "## ✅ TRANSFER COMPLETED\n\n"
                    f"👤 Player\n"
                    f"{interaction.user.mention}\n\n"
                    f"🏟 New Club\n"
                    f"**{self.club[0]}**\n\n"
                    f"📁 Roster\n"
                    f"{self.club[6]}/{self.club[7]}"
                ),
                color=discord.Color(
                    self.club[4]
                )
            )


            news.set_thumbnail(
                url=self.club[2]
            )


            if self.club[3]:

                news.set_image(
                    url=self.club[3]
                )


            news.set_footer(
                text="Super League Transfer System"
            )


            await channel.send(
                embed=news
            )


        except Exception as e:

            print(
                "Transfer announcement error:",
                e
            )


        await interaction.followup.send(
            "Offer accepted!",
            ephemeral=True
        )



    @discord.ui.button(
        label="Reject",
        emoji="❌",
        style=discord.ButtonStyle.danger
    )
    async def reject(self, interaction, button):

        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "This offer is not yours.",
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
        f"Online: {bot.user}"
    )

    print(
        f"Commands: {len(synced)}"
    )




@bot.tree.command(
    name="offer",
    description="Send transfer offer"
)
@app_commands.describe(
    player="Player receiving offer"
)
async def offer(
    interaction: discord.Interaction,
    player: discord.Member
):


    if not any(
        role.id in ALLOWED_ROLES
        for role in interaction.user.roles
    ):

        await interaction.response.send_message(
            "No permission.",
            ephemeral=True
        )

        return



    club = get_user_team(
        interaction.user
    )


    if club is None:

        await interaction.response.send_message(
            "No club role found.",
            ephemeral=True
        )

        return



    embed = discord.Embed(
        title="⚽ Player Transfer Offer",
        description=(
            f"## {club[0]}\n\n"
            "You received a transfer offer."
        ),
        color=discord.Color(
            club[4]
        )
    )


    embed.set_thumbnail(
        url=club[2]
    )


    embed.set_image(
        url=club[3]
    )


    embed.add_field(
        name="🏟 Club",
        value=club[0],
        inline=False
    )


    embed.add_field(
        name="📁 Roster",
        value=f"{club[6]}/{club[7]}",
        inline=False
    )


    embed.set_footer(
        text="Super League S5 Transfer System"
    )


    try:

        await player.send(
            embed=embed,
            view=OfferView(
                player.id,
                interaction.guild.id,
                club
            )
        )


        await interaction.response.send_message(
            "Offer sent successfully.",
            ephemeral=True
        )


    except discord.Forbidden:

        await interaction.response.send_message(
            "Player DMs are disabled.",
            ephemeral=True
        )



bot.run(TOKEN)