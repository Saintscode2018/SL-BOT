    def base_embed(
    title: str,
    description: str,
    color: int,
    thumbnail: str | None = None,
) -> discord.Embed:
    embed = discord.Embed(title=title, description=description, color=color)
    _brand_author(embed)
    if thumbnail:
        embed.set_thumbnail(url=thumbnail)
    return embed

def error_embed(title: str, description: str) -> discord.Embed:
    """Build a red error embed for permission or delivery failures."""
    return base_embed(
        title=title,
        description=description,
        color=config.COLOR_ERROR,
    )
def offer_embed(
    *,
    club: ClubRow,
    player: discord.Member,
    manager: discord.Member,
    expires_at: int,
) -> discord.Embed:
    """Build the private contract offer sent to a player."""
    embed = base_embed(
        title=f"Contract Offer — {club[1].upper()}",
        description=(
            f"**{club[1]}** has submitted an official professional contract offer "
            f"for {player.mention}.\n\n"
            "Review the contract details below and choose whether to sign or decline."
        ),
        color=club[3],
        thumbnail=club[2],
    )
    embed.add_field(name="Manager", value=manager.mention, inline=True)
    embed.add_field(name="Coach", value=club[5], inline=True)
    embed.add_field(name="Squad Status", value=f"**{club[6]}/{club[7]}**", inline=True)
    embed.add_field(name="Transfer Status", value="🟡 **Pending Response**", inline=True)
    embed.add_field(name="Contract Type", value=f"**{config.CONTRACT_TYPE}**", inline=True)
    embed.add_field(name="Response Window", value=f"<t:{expires_at}:R>", inline=True)
    embed.set_footer(text="This contract becomes void once the response window expires.")
    return embed
def offer_sent_embed(
    *,
    club: ClubRow,
    player: discord.Member,
    expires_at: int,
) -> discord.Embed:
    """Confirmation shown to the manager after an offer is delivered."""
    return base_embed(
        title="Transfer Offer Sent",
        description=(
            f"An official contract offer has been delivered to {player.mention}.\n\n"
            f"**Club:** {club[1]}\n"
            f"**Expires:** <t:{expires_at}:R>"
        ),
        color=config.COLOR_SUCCESS,
        thumbnail=club[2],
    )
def offer_failed_embed(player: discord.Member) -> discord.Embed:
    """Shown when the player cannot receive DMs."""
    return error_embed(
        title="Transfer Offer Failed",
        description=(
            f"{player.mention} has direct messages disabled, "
            "so the contract could not be delivered."
        ),
    )
def contract_signed_dm_embed(club: ClubRow) -> discord.Embed:
    """Welcome message sent to the player after signing."""
    embed = base_embed(
        title="Contract Signed",
        description=(
            f"Welcome to **{club[1]}**!\n\n"
            f"You have officially joined {club[1]} and are now registered "
            f"for {config.LEAGUE_NAME}."
        ),
        color=config.COLOR_SUCCESS,
        thumbnail=club[2],
    )
    embed.add_field(name="Club", value=club[1], inline=True)
    embed.add_field(name="Contract", value="First Team", inline=True)
    embed.add_field(name="Status", value="Approved", inline=True)
    return embed
def transfer_completed_dm_embed(
    *,
    player: discord.Member,
    club: ClubRow,
) -> discord.Embed:
    """Green embed replacing the original DM offer after signing."""
    embed = base_embed(
        title="Transfer Completed",
        description=(
            f"{player.mention} has signed with **{club[1]}**.\n\n"
            "Registration is complete. Welcome to the squad."
        ),
        color=config.COLOR_SUCCESS,
        thumbnail=club[2],
    )
    embed.set_footer(text=f"{player.display_name} • Transfer completed")
    return embed
def offer_declined_dm_embed(club: ClubRow) -> discord.Embed:
    """Red embed replacing the original DM offer after declining."""
    return base_embed(
        title="Offer Declined",
        description=(
            f"You have declined the transfer offer from **{club[1]}**.\n\n"
            "The contract has been voided and no registration has been processed."
        ),
        color=config.COLOR_ERROR,
        thumbnail=club[2],
    )
def transfer_announcement_embed(
    *,
    player: discord.Member,
    manager: discord.Member,
    club: ClubRow,
    squad_size: int,
) -> discord.Embed:
    """Public transfer card posted in the transfer channel."""
    club_name = club[1]
    embed = discord.Embed(
        title=f"Offer Accepted — {club_name}",
        description=(
            f"🏆 **{config.LEAGUE_NAME}**\n\n"
            f"{player.mention} has accepted the official contract offer "
            f"from **{club_name}**.\n\n"
            f"{config.DIVIDER}\n"
            f"👤 **Player**\n{player.mention}\n\n"
            f"🏟 **Club**\n{club_name}\n\n"
            f"👔 **Manager**\n{manager.mention}\n\n"
            f"🧑‍🏫 **Coach**\n{club[5]}\n\n"
            f"📋 **Squad**\n{squad_size} / {club[7]}\n\n"
            f"📄 **Contract**\n{config.CONTRACT_TYPE}\n\n"
            f"🟢 **Status**\nRegistered\n\n"
            f"{config.DIVIDER}\n\n"
            f"*{config.BRAND_TAGLINE}*"
        ),
        color=club[3],
        timestamp=_utc_now(),
    )
    embed.set_author(name=config.LEAGUE_NAME, icon_url=config.LEAGUE_LOGO)
    embed.set_thumbnail(url=club[2])
    embed.set_footer(text=f"{player.display_name} • Transfer completed")
    return embed