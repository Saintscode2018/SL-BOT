import datetime

import discord

import config


def now():
    return datetime.datetime.now(
        datetime.timezone.utc
    )



def base_embed(
    title,
    description,
    color,
    thumbnail=None
):

    embed = discord.Embed(
        title=title,
        description=description,
        color=color,
        timestamp=now()
    )


    # League logo on the left
    if config.LEAGUE_LOGO.startswith("http"):

        embed.set_author(
            name=config.LEAGUE_NAME,
            icon_url=config.LEAGUE_LOGO
        )


    embed.set_footer(
        text=config.FOOTER_TEXT
    )


    return embed





def error_embed(
    title,
    description
):

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
            f"**{club[1]}** has sent an official "
            f"contract offer to {player.mention}.\n\n"
            "Choose an option below."
        ),

        club[3]

    )


    # Club logo right side
    if club[2]:

        embed.set_thumbnail(
            url=club[2]
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


    if club[2]:

        embed.set_thumbnail(
            url=club[2]
        )


    return embed





def offer_failed_embed(player):

    return error_embed(

        "Offer Failed",

        f"Could not DM {player.mention}."

    )





def contract_signed_dm_embed(club):

    embed = base_embed(

        "Contract Signed",

        (
            f"Welcome to **{club[1]}**!\n\n"
            "You are now registered."
        ),

        config.COLOR_SUCCESS

    )


    if club[2]:

        embed.set_thumbnail(
            url=club[2]
        )


    return embed





def transfer_completed_dm_embed(
    *,
    player,
    club
):

    embed = base_embed(

        "Transfer Completed",

        (
            f"{player.mention} joined "
            f"**{club[1]}**."
        ),

        config.COLOR_SUCCESS

    )


    if club[2]:

        embed.set_thumbnail(
            url=club[2]
        )


    return embed





def offer_declined_dm_embed(club):

    embed = base_embed(

        "Offer Declined",

        (
            f"You declined the offer from "
            f"**{club[1]}**."
        ),

        config.COLOR_ERROR

    )


    if club[2]:

        embed.set_thumbnail(
            url=club[2]
        )


    return embed





def transfer_announcement_embed(
    *,
    player,
    manager,
    club,
    squad_size
):


    embed = discord.Embed(

        title=f"🚨 New Signing — {club[1]}",

        description=(

            f"🏆 **{config.LEAGUE_NAME}**\n\n"

            f"{player.mention} has officially signed "
            f"for **{club[1]}**.\n\n"

            f"━━━━━━━━━━━━━━━━\n\n"

            f"👤 **Player**\n"
            f"{player.mention}\n\n"

            f"👔 **Manager**\n"
            f"{manager.mention}\n\n"

            f"📋 **Squad**\n"
            f"{squad_size}/{club[5]}\n\n"

            f"📄 **Contract**\n"
            f"{config.CONTRACT_TYPE}"

        ),

        color=club[3],

        timestamp=now()

    )


    # LEFT = Super League logo

    if config.LEAGUE_LOGO.startswith("http"):

        embed.set_author(

            name=config.LEAGUE_NAME,

            icon_url=config.LEAGUE_LOGO

        )



    # BIG CLUB LOGO

    if club[2] and club[2].startswith("http"):

        embed.set_image(

            url=club[2]

        )



    embed.set_footer(
        text=config.FOOTER_TEXT
    )


    return embed