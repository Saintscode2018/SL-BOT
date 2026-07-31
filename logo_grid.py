"""
Super League S5 Logo Grid
"""

import io
import logging

import aiohttp
from PIL import Image, ImageDraw, ImageFont

import config
import database


logger = logging.getLogger(__name__)

USER_AGENT = "SuperLeagueS5Bot/1.0"





def rgb(color):

    return (
        (color >> 16) & 255,
        (color >> 8) & 255,
        color & 255
    )





def create_placeholder(club, size):

    image = Image.new(
        "RGBA",
        (size, size),
        (20, 20, 25, 255)
    )

    draw = ImageDraw.Draw(image)


    draw.rounded_rectangle(
        (
            8,
            8,
            size - 8,
            size - 8
        ),
        radius=20,
        fill=rgb(club[3])
    )


    text = club[1][:2].upper()


    font = ImageFont.load_default()


    box = draw.textbbox(
        (0,0),
        text,
        font=font
    )


    draw.text(
        (
            (size-(box[2]-box[0]))/2,
            (size-(box[3]-box[1]))/2
        ),
        text,
        fill="white",
        font=font
    )


    return image





async def fetch_logo(
    session,
    club,
    size
):


    url = club[2]


    if not url:

        return create_placeholder(
            club,
            size
        )



    try:

        async with session.get(
            url,
            headers={
                "User-Agent": USER_AGENT
            },
            timeout=aiohttp.ClientTimeout(
                total=15
            )
        ) as response:


            if response.status != 200:

                return create_placeholder(
                    club,
                    size
                )


            data = await response.read()



        if b"<svg" in data[:500].lower():

            import cairosvg

            data = cairosvg.svg2png(
                bytestring=data,
                output_width=size,
                output_height=size
            )



        logo = Image.open(
            io.BytesIO(data)
        ).convert(
            "RGBA"
        )



        logo.thumbnail(
            (
                size-25,
                size-25
            ),
            Image.Resampling.LANCZOS
        )



        canvas = Image.new(
            "RGBA",
            (
                size,
                size
            ),
            (
                0,
                0,
                0,
                0
            )
        )


        canvas.paste(
            logo,
            (
                (size-logo.width)//2,
                (size-logo.height)//2
            ),
            logo
        )


        return canvas



    except Exception as e:


        logger.error(
            "Logo error %s: %s",
            club[1],
            e
        )


        return create_placeholder(
            club,
            size
        )









async def build_club_logo_grid(
    highlight_role_id=None
):


    clubs = database.get_all_clubs()



    columns = config.LOGO_GRID_COLUMNS

    size = config.LOGO_GRID_CELL_SIZE



    rows = (
        len(clubs)
        + columns
        - 1
    ) // columns



    grid = Image.new(
        "RGBA",
        (
            columns * size,
            rows * size
        ),
        (
            10,
            10,
            15,
            255
        )
    )


    draw = ImageDraw.Draw(grid)



    async with aiohttp.ClientSession() as session:


        for index, club in enumerate(clubs):


            x = (
                index % columns
            ) * size


            y = (
                index // columns
            ) * size



            logo = await fetch_logo(
                session,
                club,
                size
            )


            grid.paste(
                logo,
                (
                    x,
                    y
                ),
                logo
            )



            if highlight_role_id == club[0]:


                draw.rectangle(

                    (
                        x+3,
                        y+3,
                        x+size-3,
                        y+size-3
                    ),

                    outline=rgb(club[3]),

                    width=config.LOGO_GRID_HIGHLIGHT_WIDTH

                )




    output = io.BytesIO()


    grid.save(
        output,
        format="PNG"
    )


    output.seek(0)


    return output