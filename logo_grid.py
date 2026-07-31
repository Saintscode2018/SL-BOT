"""
Super League S5 Club Logo Grid
"""

import io
import aiohttp

from PIL import Image, ImageDraw, ImageFont

import config
import database



def rgb(color):

    return (
        (color >> 16) & 255,
        (color >> 8) & 255,
        color & 255
    )





def placeholder(club, size):

    img = Image.new(
        "RGBA",
        (size, size),
        (15,15,20,255)
    )


    draw = ImageDraw.Draw(img)


    draw.rounded_rectangle(
        (
            10,
            10,
            size-10,
            size-10
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


    return img







async def download_logo(
    session,
    club,
    size
):


    url = club[2]


    if not url:

        return placeholder(
            club,
            size
        )



    try:


        async with session.get(
            url,
            timeout=15
        ) as response:


            if response.status != 200:

                return placeholder(
                    club,
                    size
                )


            data = await response.read()



        # SVG support

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
                size-30,
                size-30
            )
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



    except Exception:

        return placeholder(
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
        +
        columns
        -
        1
    ) // columns



    grid = Image.new(
        "RGBA",
        (
            columns*size,
            rows*size
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


        for i, club in enumerate(clubs):


            x = (
                i % columns
            ) * size


            y = (
                i // columns
            ) * size



            logo = await download_logo(
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



            # Highlight detected club

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
        "PNG"
    )


    output.seek(0)


    return output