import datetime
import discord

import config



def base_embed(title, description, color):

    embed = discord.Embed(
        title=title,
        description=description,
        color=color,
        timestamp=datetime.datetime.now(
            datetime.timezone.utc
        )
    )


    if config.LEAGUE_LOGO.startswith("http"):

        embed.set_author(
            name=config.LEAGUE_NAME,
            icon_url=config.LEAGUE_LOGO
        )


    embed.set_footer(
        text=config.FOOTER_TEXT
    )


    return embed






def add_club_logo(embed, club):

    if club and club[2]:

        embed.set_thumbnail(
            url=club[2]
        )

    return embed







def error_embed(title, description):

    return base_embed(
        title,
        description,
        config.COLOR_ERROR
    )








def offer_embed(
    *,
    club,
    player,
    manager,
    expires_at
):

    embed = base_embed(

        f"Contract Offer — {club[1]}",

        (
            f"**{club[1]}** wants to sign "
            f"{player.mention}.\n\n"

            "Press a button below to accept or decline."
        ),

        club[3]

    )


    add_club_logo(
        embed,
        club
    )


    embed.add_field(
        name="Manager",
        value=manager.mention,
        inline=True
    )


    embed.add_field(
        name="Squad",
        value=f"{club[4]}/{club[5]}",
        inline=True
    )


    embed.add_field(
        name="Contract",
        value=config.CONTRACT_TYPE,
        inline=True
    )


    embed.add_field(
        name="Expires",
        value=f"<t:{expires_at}:R>",
        inline=True
    )


    return embed







def offer_sent_embed(
    *,
    club,
    player,
    expires_at
):

    embed = base_embed(

        "Transfer Offer Sent",

        (
            f"Offer sent to {player.mention}\n\n"
            f"Club: **{club[1]}**\n"
            f"Expires: <t:{expires_at}:R>"
        ),

        config.COLOR_SUCCESS

    )


    add_club_logo(
        embed,
        club
    )


    return embed







def offer_failed_embed(player):

    return error_embed(

        "Offer Failed",

        f"Could not send an offer to {player.mention}."

    )








def transfer_announcement_embed(
    *,
    player,
    manager,
    club,
    squad_size
):


    embed = base_embed(

        f"🚨 New Signing — {club[1]}",

        (

            f"🏆 **{config.LEAGUE_NAME}**\n\n"

            f"👤 **Player**\n"
            f"{player.mention}\n\n"

            f"🏟️ **Club**\n"
            f"{club[1]}\n\n"

            f"👔 **Manager**\n"
            f"{manager.mention}\n\n"

            f"📋 **Squad**\n"
            f"{squad_size}/{club[5]}\n\n"

            f"📄 **Contract**\n"
            f"{config.CONTRACT_TYPE}\n\n"

            "✅ **Status**\n"
            "Officially Signed"

        ),

        club[3]

    )


    # Club logo right side

    add_club_logo(
        embed,
        club
    )


    return embed







def contract_signed_dm_embed(club):

    embed = base_embed(

        "Contract Signed ✅",

        (
            f"You are now a player for "
            f"**{club[1]}**."
        ),

        config.COLOR_SUCCESS

    )


    add_club_logo(
        embed,
        club
    )


    return embed








def offer_declined_dm_embed(club):

    embed = base_embed(

        "Offer Declined ❌",

        (
            f"You declined the offer from "
            f"**{club[1]}**."
        ),

        config.COLOR_ERROR

    )


    add_club_logo(
        embed,
        club
    )


    return embed