
logger = logging.getLogger(__name__)
WIKI_USER_AGENT = "SuperLeagueS5Bot/1.0 (Discord transfer bot)"

def _club_initials(name: str) -> str:
    """Return up to three uppercase initials for placeholder tiles."""
    words = [word for word in name.replace("FC", "").split() if word]
    if not words:
        return "SL"
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(word[0] for word in words[:3]).upper()


def _placeholder_logo(club: ClubRow, size: int) -> Image.Image:
    """Draw a fallback tile when a remote logo cannot be rendered."""
    color = club[3] if isinstance(club[3], int) else config.COLOR_DEFAULT
    r = (color >> 16) & 0xFF
    g = (color >> 8) & 0xFF
    b = color & 0xFF
    image = Image.new("RGBA", (size, size), (18, 20, 28, 255))
    draw = ImageDraw.Draw(image)
    padding = size // 8
    draw.rounded_rectangle(
        (padding, padding, size - padding, size - padding),
        radius=size // 10,
        fill=(r, g, b, 255),
    )
    initials = _club_initials(club[1])
    font_size = max(size // 4, 18)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), initials, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    draw.text(
        ((size - text_width) / 2, (size - text_height) / 2),
        initials,
        fill=(255, 255, 255, 255),
        font=font,
    )
    return image


def _load_logo_bytes(data: bytes, club: ClubRow, size: int) -> Image.Image:
    """Convert downloaded logo bytes into a square RGBA image."""
    if data[:4] == b"<svg" or b"<svg" in data[:256].lower():
        try:
            import cairosvg
            png_data = cairosvg.svg2png(bytestring=data, output_width=size, output_height=size)
            logo = Image.open(io.BytesIO(png_data)).convert("RGBA")
        except Exception as exc:  # noqa: BLE001 - fallback placeholder is intentional
            logger.warning("SVG render failed for %s: %s", club[1], exc)
            return _placeholder_logo(club, size)
    else:
        try:
            logo = Image.open(io.BytesIO(data)).convert("RGBA")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Image decode failed for %s: %s", club[1], exc)
            return _placeholder_logo(club, size)
    logo.thumbnail((size - 24, size - 24), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - logo.width) // 2, (size - logo.height) // 2)
    canvas.paste(logo, offset, logo)
    return canvas

async def _fetch_logo(
    session: aiohttp.ClientSession,
    club: ClubRow,
    size: int,
) -> Image.Image:
    """Download and normalize a single club logo."""
    logo_url = club[2]
    if not logo_url:
        return _placeholder_logo(club, size)
    try:
        headers = {"User-Agent": WIKI_USER_AGENT}
        async with session.get(logo_url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as response:
            if response.status != 200:
                logger.warning("Logo fetch HTTP %s for %s", response.status, club[1])
                return _placeholder_logo(club, size)
            data = await response.read()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Logo fetch failed for %s: %s", club[1], exc)
        return _placeholder_logo(club, size)
    return _load_logo_bytes(data, club, size)
def _rgb_from_int(color: int) -> tuple[int, int, int]:
    return (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF
async def build_club_logo_grid(
    highlight_role_id: int | None = None,
) -> io.BytesIO:
    """
    Stitch all 16 club logos into a 4x4 PNG grid.
    The signing club receives a colored highlight border when ``highlight_role_id`` is set.
    """
    clubs = database.get_all_clubs()
    if not clubs:
        raise ValueError("No clubs found in database.")
    columns = config.LOGO_GRID_COLUMNS
    cell_size = config.LOGO_GRID_CELL_SIZE
    rows = (len(clubs) + columns - 1) // columns
    width = columns * cell_size
    height = rows * cell_size
    grid = Image.new("RGBA", (width, height), (12, 14, 20, 255))
    draw = ImageDraw.Draw(grid)
    async with aiohttp.ClientSession() as session:
        for index, club in enumerate(clubs):
            row = index // columns
            col = index % columns
            x = col * cell_size
            y = row * cell_size
            tile = Image.new("RGBA", (cell_size, cell_size), (22, 25, 34, 255))
            logo = await _fetch_logo(session, club, cell_size)
            tile.paste(logo, (0, 0), logo)
            is_highlight = highlight_role_id is not None and club[0] == highlight_role_id
            if is_highlight:
                highlight = club[3] if isinstance(club[3], int) else config.COLOR_SUCCESS
                border = config.LOGO_GRID_HIGHLIGHT_WIDTH
                draw.rectangle(
                    (x, y, x + cell_size - 1, y + cell_size - 1),
                    outline=_rgb_from_int(highlight),
                    width=border,
                )
                glow = Image.new("RGBA", (cell_size, cell_size), (0, 0, 0, 0))
                glow_draw = ImageDraw.Draw(glow)
                glow_draw.rectangle(
                    (2, 2, cell_size - 3, cell_size - 3),
                    outline=(*_rgb_from_int(highlight), 120),
                    width=2,
                )
                tile = Image.alpha_composite(tile, glow)
            grid.paste(tile, (x, y))
    output = io.BytesIO()
    grid.convert("RGB").save(output, format="PNG", optimize=True)
    output.seek(0)
    return output