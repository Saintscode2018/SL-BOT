import discord
from discord import app_commands
from discord.ext import commands


TOKEN = "your_token_here"


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
# Replace these with your real Discord role IDs
TEAM_ROLES = {
    123456789012345678: "FC Barcelona",
    987654321098765432: "Real Madrid",
}


def get_user_team(member: discord.Member):
    for role in member.roles:
        if role.id in TEAM_ROLES:
            return TEAM_ROLES[role.id]

    return None


class OfferView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Accept",
        style=discord.ButtonStyle.success
    )
    async def accept(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button
    ):

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

    # Permission check
    if not any(
        role.id in ALLOWED_ROLES
        for role in interaction.user.roles
    ):

        await interaction.response.send_message(
            "You don't have permission to use this command.",
            ephemeral=True
        )

        return


    # Automatic team detection
    team = get_user_team(interaction.user)


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


    await interaction.response.send_message(
        embed=embed,
        view=OfferView()
    )


bot.run(TOKEN)