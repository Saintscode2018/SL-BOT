import datetime

import discord

import config
from database import ClubRow



def _utc_now():

    return datetime.datetime.now(
        datetime.timezone.utc
    )





def _brand(embed):

    if config.LEAGUE_LOGO.startswith("http"):

        embed.set_author(

            name=config.LEAGUE_NAME,

            icon_url=config.LEAGUE_LOGO

        )

    else:

        embed.set_author(
            name=config.LEAGUE_NAME
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

        timestamp=_utc_now()

    )


    _brand(embed)



    if thumbnail and thumbnail.startswith("http"):

        embed.set_thumbnail(
            url=thumbnail
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
    club: ClubRow,
    player: discord.Member,
    manager: discord.Member,
    expires_at: int
):


    embed = base_embed(

        title=f"Contract Offer — {club[1]}",

        description=(

            f"**{club[1]}** has sent an official "
            f"contract offer to {player.mention}.\n\n"

            f"Review the offer and choose below."

        ),

        color=club[3],

        thumbnail=club[2]

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


    return base_embed(

        title="Transfer Offer Sent",

        description=(

            f"Offer sent to {player.mention}\n\n"

            f"Club: **{club[1]}**\n"

            f"Expires: <t:{expires_at}:R>"

        ),

        color=config.COLOR_SUCCESS,

        thumbnail=club[2]

    )







def offer_failed_embed(player):


    return error_embed(

        "Offer Failed",

        f"Could not DM {player.mention}."

    )









def contract_signed_dm_embed(club):


    embed = base_embed(

        title="Contract Signed",

        description=(

            f"Welcome to **{club[1]}**!\n\n"

            "Your registration has been completed."

        ),

        color=config.COLOR_SUCCESS,

        thumbnail=club[2]

    )


    embed.add_field(

        name="Club",

        value=club[1],

        inline=True

    )


    embed.add_field(

        name="Status",

        value="Registered",

        inline=True

    )


    return embed







def transfer_completed_dm_embed(
    *,
    player,
    club
):


    return base_embed(

        title="Transfer Completed",

        description=(

            f"{player.mention} joined **{club[1]}**."

        ),

        color=config.COLOR_SUCCESS,

        thumbnail=club[2]

    )









def offer_declined_dm_embed(club):


    return base_embed(

        title="Offer Declined",

        description=(

            f"You declined the offer from **{club[1]}**."

        ),

        color=config.COLOR_ERROR,

        thumbnail=club[2]

    )









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

            f"━━━━━━━━━━━━━━\n"

            f"👤 Player\n"

            f"{player.mention}\n\n"

            f"👔 Manager\n"

            f"{manager.mention}\n\n"

            f"📋 Squad\n"

            f"{squad_size}/{club[5]}\n\n"

            f"📄 Contract\n"

            f"{config.CONTRACT_TYPE}"

        ),

        color=club[3],

        timestamp=_utc_now()

    )


    # League logo on left

    if config.LEAGUE_LOGO.startswith("http"):

        embed.set_author(

            name=config.LEAGUE_NAME,

            icon_url=config.LEAGUE_LOGO

        )



    # Club logo on right

    if club[2].startswith("http"):

        embed.set_thumbnail(

            url=club[2]

        )


    embed.set_footer(

        text=config.FOOTER_TEXT

    )


    return embed