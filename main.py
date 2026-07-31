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

  # Roster command
@bot.tree.command(
    name="roster",
    description="View a team's roster"
)
@app_commands.describe(
    team="Team role (leave empty for your own team)"
)
async def roster(
    interaction: discord.Interaction,
    team: discord.Role | None = None
):
    if team is None:
        club = get_club(interaction.user)
    else:
        club = database.get_club_by_role(team.id)

    if club is None:
        await interaction.response.send_message(
            embed=embeds.error_embed(
                "Team Not Found",
                "That team is not connected to the database."
            ),
            ephemeral=True
        )
        return

    guild = interaction.guild
    role = guild.get_role(club[0])

    if role is None:
        await interaction.response.send_message(
            "Team role no longer exists.",
            ephemeral=True
        )
        return

    manager = guild.get_member(club[6]) if club[6] else None
    assistant = guild.get_member(club[7]) if club[7] else None

    players = [
        member.mention
        for member in role.members
        if not member.bot
    ]

    embed = discord.Embed(
        title=f"{club[1]} Roster",
        color=club[3]
    )

    if club[2]:
        embed.set_thumbnail(url=club[2])

    embed.add_field(
        name="Team Manager",
        value=manager.mention if manager else "Not Assigned",
        inline=False
    )

    embed.add_field(
        name="Assistant Manager",
        value=assistant.mention if assistant else "Not Assigned",
        inline=False
    )

    embed.add_field(
        name=f"Players ({len(players)})",
        value="\n".join(players) if players else "*No players registered.*",
        inline=False
    )

    embed.set_footer(
        text=f"Squad Size: {len(players)}/{club[5]}"
    )

    await interaction.response.send_message(
        embed=embed
    )


# Team health command
@bot.tree.command(
    name="teamhealth",
    description="Admin only: view roster count for every team"
)
async def teamhealth(
    interaction: discord.Interaction
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    clubs = database.get_all_clubs()

    if not clubs:
        await interaction.response.send_message(
            "No clubs found in the database.",
            ephemeral=True
        )
        return

    embed = discord.Embed(
        title="Team Health Report",
        color=discord.Color.green()
    )

    guild = interaction.guild

    for club in clubs:
        role = guild.get_role(club[0])
        count = len(role.members) if role else 0

        embed.add_field(
            name=club[1],
            value=f"Roster Count: **{count}/{club[5]}**",
            inline=False
        )

    await interaction.response.send_message(
        embed=embed
    )


# FO list command
@bot.tree.command(
    name="folist",
    description="Admin only: list every team and its Team Manager"
)
async def folist(
    interaction: discord.Interaction
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    clubs = database.get_all_clubs()
    guild = interaction.guild

    embed = discord.Embed(
        title="Team Manager List",
        color=discord.Color.gold()
    )

    for club in clubs:
        manager = guild.get_member(club[6]) if club[6] else None

        embed.add_field(
            name=club[1],
            value=manager.mention if manager else "Not Assigned",
            inline=False
        )

    await interaction.response.send_message(
        embed=embed
    )

    # Appoint command
@bot.tree.command(
    name="appoint",
    description="Admin only: appoint a Team Manager"
)
@app_commands.describe(
    member="Member to appoint",
    team="Team role"
)
async def appoint(
    interaction: discord.Interaction,
    member: discord.Member,
    team: discord.Role
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    club = database.get_club_by_role(team.id)

    if club is None:
        await interaction.response.send_message(
            embed=embeds.error_embed(
                "Team Not Found",
                "That team is not connected to the database."
            ),
            ephemeral=True
        )
        return

    guild = interaction.guild
    manager_role = guild.get_role(config.TEAM_MANAGER_ROLE)

    old_manager_id = club[6]

    if old_manager_id:
        old_manager = guild.get_member(old_manager_id)

        if old_manager and manager_role:
            await old_manager.remove_roles(
                manager_role,
                reason="Replaced as Team Manager"
            )

    if manager_role:
        await member.add_roles(
            manager_role,
            reason="Appointed as Team Manager"
        )

    database.set_team_manager(
        team.id,
        member.id
    )

    embed = discord.Embed(
        title="Team Manager Appointed",
        description=f"{member.mention} has been appointed as the Team Manager of {team.mention}.",
        color=discord.Color.green()
    )

    await interaction.response.send_message(
        embed=embed
    )

    # Add team command
@bot.tree.command(
    name="addteam",
    description="Admin only: add a new team"
)
@app_commands.describe(
    name="Team name",
    role="Team role",
    logo="Team logo URL",
    color="Embed color in HEX (example: #004170)"
)
async def addteam(
    interaction: discord.Interaction,
    name: str,
    role: discord.Role,
    logo: str = "",
    color: str = "#3498DB"
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    if database.get_club_by_role(role.id):
        await interaction.response.send_message(
            embed=embeds.error_embed(
                "Team Already Exists",
                "That team is already connected to the database."
            ),
            ephemeral=True
        )
        return

    try:
        color_value = int(color.replace("#", ""), 16)
    except ValueError:
        await interaction.response.send_message(
            "Invalid HEX color. Example: `#004170`",
            ephemeral=True
        )
        return

    database.add_club(
        role.id,
        name,
        logo,
        color_value
    )

    embed = discord.Embed(
        title="Team Added",
        description=f"{role.mention} has been added to the league database.",
        color=color_value
    )

    if logo:
        embed.set_thumbnail(url=logo)

    embed.add_field(
        name="Team Name",
        value=name,
        inline=False
    )

    await interaction.response.send_message(
        embed=embed
    )

    # Disband command
@bot.tree.command(
    name="disband",
    description="Admin only: disband a team"
)
@app_commands.describe(
    team="Team role to disband"
)
async def disband(
    interaction: discord.Interaction,
    team: discord.Role
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    club = database.get_club_by_role(team.id)

    if club is None:
        await interaction.response.send_message(
            embed=embeds.error_embed(
                "Team Not Found",
                "That team is not connected to the database."
            ),
            ephemeral=True
        )
        return

    removed_players = 0

    for member in team.members:
        try:
            await member.remove_roles(
                team,
                reason="Team disbanded"
            )
            removed_players += 1
        except discord.Forbidden:
            pass

    database.remove_club(team.id)

    embed = discord.Embed(
        title="Team Disbanded",
        description=f"{team.mention} has been removed from the league database.",
        color=discord.Color.red()
    )

    embed.add_field(
        name="Players Removed",
        value=str(removed_players),
        inline=False
    )

    await interaction.response.send_message(
        embed=embed
    )


    # Team swap command
@bot.tree.command(
    name="teamswap",
    description="Admin only: swap all players between two teams"
)
@app_commands.describe(
    team_one="First team role",
    team_two="Second team role"
)
async def teamswap(
    interaction: discord.Interaction,
    team_one: discord.Role,
    team_two: discord.Role
):
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message(
            "Administrator only.",
            ephemeral=True
        )
        return

    club_one = database.get_club_by_role(team_one.id)
    club_two = database.get_club_by_role(team_two.id)

    if club_one is None or club_two is None:
        await interaction.response.send_message(
            "One or both teams are not connected to the database.",
            ephemeral=True
        )
        return

    team_one_members = list(team_one.members)
    team_two_members = list(team_two.members)

    swapped_one = 0
    swapped_two = 0

    for member in team_one_members:
        try:
            await member.remove_roles(team_one, reason="Team swap")
            await member.add_roles(team_two, reason="Team swap")
            swapped_one += 1
        except discord.Forbidden:
            pass

    for member in team_two_members:
        try:
            await member.remove_roles(team_two, reason="Team swap")
            await member.add_roles(team_one, reason="Team swap")
            swapped_two += 1
        except discord.Forbidden:
            pass

    embed = discord.Embed(
        title="Team Swap Completed",
        color=discord.Color.orange()
    )

    embed.add_field(
        name=club_one[1],
        value=f"Players moved: **{swapped_one}**",
        inline=True
    )

    embed.add_field(
        name=club_two[1],
        value=f"Players moved: **{swapped_two}**",
        inline=True
    )

    await interaction.response.send_message(embed=embed)

    # Release command
@bot.tree.command(
    name="release",
    description="Release a player from your team"
)
@app_commands.describe(
    player="Player to release"
)
async def release(
    interaction: discord.Interaction,
    player: discord.Member
):
    if not has_manager_role(interaction.user):
        await interaction.response.send_message(
            embed=embeds.error_embed(
                "No Permission",
                "You are not a manager."
            ),
            ephemeral=True
        )
        return

    club = get_club(interaction.user)

    if club is None:
        await interaction.response.send_message(
            "Your manager role is not connected to a team.",
            ephemeral=True
        )
        return

    team_role = interaction.guild.get_role(
        club[0]
    )

    if team_role not in player.roles:
        await interaction.response.send_message(
            "That player is not in your team.",
            ephemeral=True
        )
        return

    try:
        await player.remove_roles(
            team_role,
            reason="Player released"
        )

    except discord.Forbidden:
        await interaction.response.send_message(
            "I cannot remove that role.",
            ephemeral=True
        )
        return


    if config.ENABLE_ROSTER_TRACKING:
        database.decrease_roster(
            club[0]
        )


    database.add_transfer(
        player_id=player.id,
        player_name=str(player),
        old_club=club[1],
        manager=str(interaction.user),
        new_club="Free Agent",
        club_id=club[0],
        status="RELEASED"
    )


    embed = discord.Embed(
        title="Player Released",
        description=f"{player.mention} has been released from {club[1]}.",
        color=discord.Color.red()
    )

    embed.add_field(
        name="Released By",
        value=interaction.user.mention,
        inline=False
    )

    await interaction.response.send_message(
        embed=embed
    )

    # Promote command
@bot.tree.command(
    name="promote",
    description="Promote a staff member"
)
@app_commands.describe(
    member="Member to promote"
)
async def promote(
    interaction: discord.Interaction,
    member: discord.Member
):
    if not has_manager_role(interaction.user):
        await interaction.response.send_message(
            "You do not have permission to use this command.",
            ephemeral=True
        )
        return

    roles = config.STAFF_RANK_ROLES

    current_rank = None

    for index, role_id in enumerate(roles):
        role = interaction.guild.get_role(role_id)

        if role in member.roles:
            current_rank = index
            break

    if current_rank is None:
        await interaction.response.send_message(
            "This member does not have a staff rank.",
            ephemeral=True
        )
        return

    if current_rank == len(roles) - 1:
        await interaction.response.send_message(
            "This member is already the highest rank.",
            ephemeral=True
        )
        return

    old_role = interaction.guild.get_role(
        roles[current_rank]
    )

    new_role = interaction.guild.get_role(
        roles[current_rank + 1]
    )

    await member.remove_roles(
        old_role,
        reason="Staff promotion"
    )

    await member.add_roles(
        new_role,
        reason="Staff promotion"
    )

    embed = discord.Embed(
        title="Staff Promoted",
        description=f"{member.mention} has been promoted to **{new_role.name}**.",
        color=discord.Color.green()
    )

    await interaction.response.send_message(
        embed=embed
    )


# Demote command
@bot.tree.command(
    name="demote",
    description="Demote a staff member"
)
@app_commands.describe(
    member="Member to demote"
)
async def demote(
    interaction: discord.Interaction,
    member: discord.Member
):
    if not has_manager_role(interaction.user):
        await interaction.response.send_message(
            "You do not have permission to use this command.",
            ephemeral=True
        )
        return

    roles = config.STAFF_RANK_ROLES

    current_rank = None

    for index, role_id in enumerate(roles):
        role = interaction.guild.get_role(role_id)

        if role in member.roles:
            current_rank = index
            break

    if current_rank is None:
        await interaction.response.send_message(
            "This member does not have a staff rank.",
            ephemeral=True
        )
        return

    if current_rank == 0:
        await interaction.response.send_message(
            "This member is already the lowest rank.",
            ephemeral=True
        )
        return

    old_role = interaction.guild.get_role(
        roles[current_rank]
    )

    new_role = interaction.guild.get_role(
        roles[current_rank - 1]
    )

    await member.remove_roles(
        old_role,
        reason="Staff demotion"
    )

    await member.add_roles(
        new_role,
        reason="Staff demotion"
    )

    embed = discord.Embed(
        title="Staff Demoted",
        description=f"{member.mention} has been demoted to **{new_role.name}**.",
        color=discord.Color.red()
    )

    await interaction.response.send_message(
        embed=embed
    )

    # Schedule button view

class ScheduleView(discord.ui.View):

    def __init__(self, home, away):
        super().__init__(
            timeout=None
        )

        self.home = home
        self.away = away

        self.referee = None
        self.broadcaster = None
        self.commentator = None


    async def update_message(self, interaction):

        embed = discord.Embed(
            title="Super League Fixture",
            color=discord.Color.blue()
        )

        embed.add_field(
            name="Match",
            value=f"{self.home.mention} vs {self.away.mention}",
            inline=False
        )

        embed.add_field(
            name="Referee",
            value=self.referee.mention if self.referee else "Not Assigned",
            inline=True
        )

        embed.add_field(
            name="Broadcaster",
            value=self.broadcaster.mention if self.broadcaster else "Not Assigned",
            inline=True
        )

        embed.add_field(
            name="Commentator",
            value=self.commentator.mention if self.commentator else "Not Assigned",
            inline=True
        )


        await interaction.message.edit(
            embed=embed,
            view=self
        )


    @discord.ui.button(
        label="Claim Referee",
        emoji="🟦",
        style=discord.ButtonStyle.primary
    )
    async def referee_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.REF_ROLE_ID
        )

        if role not in interaction.user.roles:
            await interaction.response.send_message(
                "You are not a referee.",
                ephemeral=True
            )
            return


        self.referee = interaction.user

        await interaction.response.defer()

        await self.update_message(
            interaction
        )


    @discord.ui.button(
        label="Claim Broadcaster",
        emoji="🟪",
        style=discord.ButtonStyle.secondary
    )
    async def broadcaster_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.BROADCASTER_ROLE_ID
        )

        if role not in interaction.user.roles:
            await interaction.response.send_message(
                "You are not a broadcaster.",
                ephemeral=True
            )
            return


        self.broadcaster = interaction.user

        await interaction.response.defer()

        await self.update_message(
            interaction
        )


    @discord.ui.button(
        label="Claim Commentator",
        emoji="🟨",
        style=discord.ButtonStyle.success
    )
    async def commentator_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.COMMENTATOR_ROLE_ID
        )

        if role not in interaction.user.roles:
            await interaction.response.send_message(
                "You are not a commentator.",
                ephemeral=True
            )
            return


        self.commentator = interaction.user

        await interaction.response.defer()

        await self.update_message(
            interaction
        )



# Schedule button view

class ScheduleView(discord.ui.View):

    def __init__(
        self,
        match_id,
        home,
        away
    ):

        super().__init__(
            timeout=None
        )

        self.match_id = match_id
        self.home = home
        self.away = away


    async def update_message(
        self,
        interaction
    ):

        match = database.get_match(
            self.match_id
        )


        referee = (
            interaction.guild.get_member(match[5])
            if match[5]
            else None
        )

        broadcaster = (
            interaction.guild.get_member(match[6])
            if match[6]
            else None
        )

        commentator = (
            interaction.guild.get_member(match[7])
            if match[7]
            else None
        )


        embed = discord.Embed(
            title="Super League Fixture",
            color=discord.Color.blue()
        )


        embed.add_field(
            name="Match",
            value=f"{self.home.mention} vs {self.away.mention}",
            inline=False
        )


        embed.add_field(
            name="Referee",
            value=referee.mention if referee else "Not Assigned",
            inline=True
        )


        embed.add_field(
            name="Broadcaster",
            value=broadcaster.mention if broadcaster else "Not Assigned",
            inline=True
        )


        embed.add_field(
            name="Commentator",
            value=commentator.mention if commentator else "Not Assigned",
            inline=True
        )


        await interaction.message.edit(
            embed=embed,
            view=self
        )



    @discord.ui.button(
        label="Claim Referee",
        emoji="🟦",
        style=discord.ButtonStyle.primary
    )
    async def referee_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.REF_ROLE_ID
        )


        if role not in interaction.user.roles:

            await interaction.response.send_message(
                "You are not a referee.",
                ephemeral=True
            )

            return


        database.update_match_staff(
            self.match_id,
            referee_id=interaction.user.id
        )


        await interaction.response.defer()

        await self.update_message(
            interaction
        )



    @discord.ui.button(
        label="Claim Broadcaster",
        emoji="🟪",
        style=discord.ButtonStyle.secondary
    )
    async def broadcaster_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.BROADCASTER_ROLE_ID
        )


        if role not in interaction.user.roles:

            await interaction.response.send_message(
                "You are not a broadcaster.",
                ephemeral=True
            )

            return


        database.update_match_staff(
            self.match_id,
            broadcaster_id=interaction.user.id
        )


        await interaction.response.defer()

        await self.update_message(
            interaction
        )



    @discord.ui.button(
        label="Claim Commentator",
        emoji="🟨",
        style=discord.ButtonStyle.success
    )
    async def commentator_button(
        self,
        interaction,
        button
    ):

        role = interaction.guild.get_role(
            config.COMMENTATOR_ROLE_ID
        )


        if role not in interaction.user.roles:

            await interaction.response.send_message(
                "You are not a commentator.",
                ephemeral=True
            )

            return


        database.update_match_staff(
            self.match_id,
            commentator_id=interaction.user.id
        )


        await interaction.response.defer()

        await self.update_message(
            interaction
        )





# Schedule command

@bot.tree.command(
    name="schedule",
    description="Post a match fixture"
)
@app_commands.describe(
    home="Home team",
    away="Away team"
)
async def schedule(
    interaction: discord.Interaction,
    home: discord.Role,
    away: discord.Role
):


    if not has_manager_role(
        interaction.user
    ):

        await interaction.response.send_message(
            "You are not a team manager.",
            ephemeral=True
        )

        return



    home_club = database.get_club_by_role(
        home.id
    )

    away_club = database.get_club_by_role(
        away.id
    )


    if home_club is None or away_club is None:

        await interaction.response.send_message(
            "One of these teams is not registered.",
            ephemeral=True
        )

        return



    match_id = database.add_match(
        home_team=home_club[1],
        away_team=away_club[1],
        home_role_id=home.id,
        away_role_id=away.id
    )



    embed = discord.Embed(
        title="Super League Fixture",
        color=discord.Color.blue()
    )


    embed.add_field(
        name="Match",
        value=f"{home.mention} vs {away.mention}",
        inline=False
    )


    embed.add_field(
        name="Referee",
        value="Not Assigned",
        inline=True
    )


    embed.add_field(
        name="Broadcaster",
        value="Not Assigned",
        inline=True
    )


    embed.add_field(
        name="Commentator",
        value="Not Assigned",
        inline=True
    )


    view = ScheduleView(
        match_id,
        home,
        away
    )


    await interaction.response.send_message(
        embed=embed,
        view=view
    )


    staff_channel = bot.get_channel(
        config.STAFF_CHANNEL_ID
    )


    if staff_channel:

        await staff_channel.send(
            f"<@&{config.REF_ROLE_ID}> "
            f"<@&{config.BROADCASTER_ROLE_ID}> "
            f"<@&{config.COMMENTATOR_ROLE_ID}>\n\n"
            f"⚽ Game needs staff:\n"
            f"{home.mention} vs {away.mention}"
        )