import discord
from discord import app_commands
from discord.ext import commands


TOKEN = "YOUR_NEW_TOKEN_HERE"


TRANSFER_CHANNEL_ID = 1519210891596398745


# Staff roles allowed to create offers
TEAM_MANAGER_ROLE = 1520900719799042088
ASSISTANT_TEAM_MANAGER_ROLE = 1520899851393437797
PLAYER_MANAGER_ROLE = 1521309945851547780


ALLOWED_ROLES = [
    TEAM_MANAGER_ROLE,
    ASSISTANT_TEAM_MANAGER_ROLE,
    PLAYER_MANAGER_ROLE,
]


# Team role IDs
TEAM_ROLES = {
    1520903589931909141: "FC Barcelona",
    1520903596210655252: "Real Madrid",
    1520903250969231430: "Bayern Munich",
    1520912782961414154: "AC Milan",
    1520903252961526033: "Chelsea",
    1520903594709352508: "Paris Saint-Germain",
    1520903247945007105: "Manchester United",
    1520903245458047007: "Manchester City",
    1520903242815639612: "Liverpool",
    1520904237016547438: "Juventus",
    1520903587612459189: "Borussia Dortmund",
    1520908994024050728: "Brazil",
    1520908986319241457: "Santos FC",
    1520908990068953170: "Atletico Madrid",
    1520908992430346250: "Inter Milan",
    1520903592331186346: "Newcastle"
}


def get_user_team(member: discord.Member):

    for role in member.roles:

        if role.id in TEAM_ROLES:
            return TEAM_ROLES[role.id]

    return None



class OfferView(discord.ui.View):

    def __init__(self, player_id, guild_id, team):

        super().__init__(timeout=None)

        self.player_id = player_id
        self.guild_id = guild_id
        self.team = team



    @discord.ui.button(
        label="Accept",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):


        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return



        embed = interaction.message.embeds[0]

        embed.color = discord.Color.green()

        embed.add_field(
            name="Status",
            value=f"Accepted by {interaction.user.mention}",
            inline=False
        )


        await interaction.message.edit(
            embed=embed,
            view=None
        )



        guild = bot.get_guild(self.guild_id)


        if guild:

            channel = guild.get_channel(
                TRANSFER_CHANNEL_ID
            )


            if channel:

                news = discord.Embed(
                    title="Super League S5",
                    description=(
                        f"✅ **Offer Accepted - {self.team}**\n\n"
                        f"{interaction.user.mention} has accepted the offer from "
                        f"**{self.team}**"
                    ),
                    color=discord.Color.green()
                )


                await channel.send(
                    embed=news
                )



        await interaction.response.send_message(
            "Offer accepted.",
            ephemeral=True
        )



    @discord.ui.button(
        label="Reject",
        style=discord.ButtonStyle.danger
    )
    async def reject(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):


        if interaction.user.id != self.player_id:

            await interaction.response.send_message(
                "This offer is not for you.",
                ephemeral=True
            )

            return



        embed = interaction.message.embeds[0]

        embed.color = discord.Color.red()


        embed.add_field(
            name="Status",
            value=f"Rejected by {interaction.user.mention}",
            inline=False
        )


        await interaction.message.edit(
            embed=embed,
            view=None
        )


        await interaction.response.send_message(
            "Offer rejected.",
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

    await bot.tree.sync()

    print(f"Bot online as {bot.user}")



@bot.tree.command(
    name="offer",
    description="Create a player offer"
)
@app_commands.describe(
    player="Player receiving the offer",
    contract="Contract length",
    salary="Salary",
    transfer_fee="Transfer fee"
)
async def offer(
    interaction: discord.Interaction,
    player: discord.Member,
    contract: str,
    salary: str,
    transfer_fee: str
):


    if not any(
        role.id in ALLOWED_ROLES
        for role in interaction.user.roles
    ):

        await interaction.response.send_message(
            "You don't have permission to use this command.",
            ephemeral=True
        )

        return



    team = get_user_team(
        interaction.user
    )



    if team is None:

        await interaction.response.send_message(
            "You don't have a team role.",
            ephemeral=True
        )

        return



    embed = discord.Embed(
        title="Player Offer",
        color=discord.Color.blue()
    )


    embed.add_field(
        name="Player",
        value=player.mention,
        inline=True
    )


    embed.add_field(
        name="Team",
        value=team,
        inline=True
    )


    embed.add_field(
        name="Contract",
        value=contract,
        inline=True
    )


    embed.add_field(
        name="Salary",
        value=salary,
        inline=True
    )


    embed.add_field(
        name="Transfer Fee",
        value=transfer_fee,
        inline=True
    )


    embed.set_footer(
        text=f"Offered by {interaction.user}"
    )


    embed.timestamp = discord.utils.utcnow()



    try:

        await player.send(
            embed=embed,
            view=OfferView(
                player.id,
                interaction.guild.id,
                team
            )
        )


        await interaction.response.send_message(
            "Offer sent successfully.",
            ephemeral=True
        )



    except discord.Forbidden:

        await interaction.response.send_message(
            "I cannot DM this player.",
            ephemeral=True
        )



bot.run(TOKEN)