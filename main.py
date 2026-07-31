

import discord
from discord import app_commands
from discord.ext import commands

import os
import database
import config


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





def roster_bar(current, maximum):

    filled = int(
        (current / maximum) * 10
    )

    return (
        "🟩" * filled +
        "⬜" * (10-filled)
        +
        f" `{current}/{maximum}`"
    )





def create_logo(path):

    if os.path.exists(path):

        return discord.File(
            path,
            filename="logo.png"
        )

    return None





def create_transfer_embed(
    club,
    player,
    title="⚽ Transfer Offer"
):

    embed = discord.Embed(

        title=title,

        description=(

            f"## {club[1]}\n\n"

            f"👤 Player\n"
            f"{player.mention}\n\n"

            f"🌍 Country\n"
            f"{club[4]}\n\n"

            f"🏟 Stadium\n"
            f"{club[5]}\n\n"

            f"📊 Squad\n"
            f"{roster_bar(club[7], club[8])}"

        ),

        color=club[3]

    )


    embed.set_footer(
        text=config.FOOTER_TEXT
    )


    embed.timestamp = (
        discord.utils.utcnow()
    )


    return embed







class OfferView(discord.ui.View):


    def __init__(
        self,
        player_id,
        guild_id,
        club,
        manager_id
    ):

        super().__init__(
            timeout=86400
        )


        self.player_id = player_id
        self.guild_id = guild_id
        self.club = club
        self.manager_id = manager_id





    async def send_transfer_news(
        self,
        player
    ):


        channel = await bot.fetch_channel(
            config.TRANSFER_CHANNEL_ID
        )


        database.increase_roster(
            self.club[0]
        )


        database.add_transfer(

            player.id,

            str(player),

            "Free Agent",

            self.club[1],

            self.manager_id

        )



        updated = database.get_club_by_role(
            self.club[0]
        )



        news = discord.Embed(

            title="🚨 BREAKING TRANSFER NEWS",

            description=(

                "## 🏆 Super League S5\n\n"

                f"👤 **Player**\n"
                f"{player.mention}\n\n"

                f"➡️ **Joined**\n"
                f"{self.club[1]}\n\n"

                f"📊 **New Squad Size**\n"
                f"{roster_bar(updated[7], updated[8])}"

            ),

            color=self.club[3]

        )



        news.set_footer(
            text="Official Transfer Market"
        )



        logo = create_logo(
            self.club[2]
        )



        if logo:

            news.set_thumbnail(
                url="attachment://logo.png"
            )


            await channel.send(
                embed=news,
                file=logo
            )


        else:

            await channel.send(
                embed=news
            )






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



        await self.send_transfer_news(
            interaction.user
        )



        embed = interaction.message.embeds[0]


        embed.color = discord.Color.green()


        embed.add_field(

            name="Status",

            value="✅ Accepted",

            inline=False

        )



        await interaction.message.edit(

            embed=embed,

            view=None

        )



        await interaction.followup.send(

            "✅ Transfer accepted.",

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



        await interaction.response.send_message(

            "❌ Offer rejected.",

            ephemeral=True

        )



        await interaction.message.edit(

            view=None

        )








@bot.event
async def on_ready():


    synced = await bot.tree.sync()



    print(
        f"✅ Online as {bot.user}"
    )


    print(
        f"✅ Loaded {len(synced)} commands"
    )









@bot.tree.command(
    name="offer",
    description="Send a transfer offer"
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

        role.id in config.ALLOWED_ROLES

        for role in interaction.user.roles

    ):


        await interaction.response.send_message(

            "❌ You cannot create offers.",

            ephemeral=True

        )

        return






    # Cannot offer yourself


    if player.id == interaction.user.id:


        await interaction.response.send_message(

            "❌ You cannot offer yourself.",

            ephemeral=True

        )

        return






    # Managers cannot receive offers


    if any(

        role.id in config.MANAGER_ROLES

        for role in player.roles

    ):


        await interaction.response.send_message(

            "❌ This user is a manager and cannot receive player offers.",

            ephemeral=True

        )

        return






    club = get_club(

        interaction.user

    )



    if club is None:


        await interaction.response.send_message(

            "❌ Your club role was not found.",

            ephemeral=True

        )

        return







    embed = create_transfer_embed(

        club,

        player

    )



    logo = create_logo(

        club[2]

    )



    view = OfferView(

        player.id,

        interaction.guild.id,

        club,

        interaction.user.id

    )





    try:



        if logo:


            embed.set_thumbnail(

                url="attachment://logo.png"

            )


            await player.send(

                embed=embed,

                file=logo,

                view=view

            )


        else:


            await player.send(

                embed=embed,

                view=view

            )



        await interaction.response.send_message(

            "✅ Transfer offer sent.",

            ephemeral=True

        )





    except discord.Forbidden:



        await interaction.response.send_message(

            "❌ Player has DMs disabled.",

            ephemeral=True

        )









@bot.tree.command(

    name="club",

    description="View your club information"

)

async def club(

    interaction: discord.Interaction

):


    club = get_club(

        interaction.user

    )



    if club is None:


        await interaction.response.send_message(

            "❌ You have no club.",

            ephemeral=True

        )

        return






    embed = discord.Embed(

        title=f"🏟 {club[1]}",

        description=(

            f"🌍 Country\n"
            f"{club[4]}\n\n"

            f"🏟 Stadium\n"
            f"{club[5]}\n\n"

            f"👔 Coach\n"
            f"{club[6]}\n\n"

            f"📊 Squad\n"
            f"{roster_bar(club[7],club[8])}"

        ),

        color=club[3]

    )



    logo = create_logo(

        club[2]

    )



    if logo:


        embed.set_thumbnail(

            url="attachment://logo.png"

        )


        await interaction.response.send_message(

            embed=embed,

            file=logo

        )


    else:


        await interaction.response.send_message(

            embed=embed

        )









@bot.tree.command(

    name="transfers",

    description="Show latest transfers"

)

async def transfers(

    interaction: discord.Interaction

):


    history = database.get_transfer_history()



    embed = discord.Embed(

        title="📜 Transfer History",

        color=0x3498db

    )



    if not history:


        embed.description = (
            "No transfers yet."
        )



    else:


        for transfer in history:


            embed.add_field(

                name=f"#{transfer[0]} {transfer[2]}",

                value=(

                    f"➡️ {transfer[4]}\n"

                    f"🕒 {transfer[6]}"

                ),

                inline=False

            )





    await interaction.response.send_message(

        embed=embed,

        ephemeral=True

    )








bot.run(
    config.TOKEN
)