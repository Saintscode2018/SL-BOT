import sqlite3
import config
from datetime import datetime


def connect():
    return sqlite3.connect(config.DATABASE_NAME)


def setup():
    conn = connect()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS clubs(
        role_id INTEGER PRIMARY KEY,
        name TEXT,
        logo_url TEXT,
        color INTEGER,
        country TEXT,
        coach TEXT,
        roster INTEGER,
        max_roster INTEGER
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS players(
        discord_id INTEGER PRIMARY KEY,
        discord_name TEXT,
        roblox_name TEXT,
        club TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS managers(
        discord_id INTEGER PRIMARY KEY,
        discord_name TEXT,
        roblox_name TEXT,
        club TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS transfers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_discord_id INTEGER,
        player_discord TEXT,
        player_roblox TEXT,
        manager_discord TEXT,
        manager_roblox TEXT,
        club TEXT,
        action TEXT,
        date TEXT
    )
    """)

    conn.commit()
    conn.close()



def load_default_clubs():

    clubs = [

        (
            1520903589931909141,
            "FC Barcelona",
            "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg",
            0xA50044,
            "Spain",
            "Unknown",
            15,
            17
        ),

        (
            1520903596210655252,
            "Real Madrid",
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            0xFEBE10,
            "Spain",
            "Unknown",
            15,
            17
        ),

        (
            1520903250969231430,
            "Bayern Munich",
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg",
            0xDC052D,
            "Germany",
            "Unknown",
            15,
            17
        ),

        (
            1520912782961414154,
            "AC Milan",
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            0x000000,
            "Italy",
            "Unknown",
            15,
            17
        ),

        (
            1520903252961526033,
            "Chelsea",
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            0x034694,
            "England",
            "Unknown",
            15,
            17
        ),

        (
            1520903594709352508,
            "Paris Saint-Germain",
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            0x004170,
            "France",
            "Unknown",
            15,
            17
        ),

        (
            1520903247945007105,
            "Manchester United",
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            0xDA291C,
            "England",
            "Unknown",
            15,
            17
        ),

        (
            1520903245458047007,
            "Manchester City",
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            0x6CABDD,
            "England",
            "Unknown",
            15,
            17
        ),

        (
            1520903242815639612,
            "Liverpool",
            "https://upload.wikimedia.org/wikipedia/en/0/0c/Liverpool_FC.svg",
            0xC8102E,
            "England",
            "Unknown",
            15,
            17
        ),

        (
            1520904237016547438,
            "Juventus",
            "https://upload.wikimedia.org/wikipedia/commons/1/15/Juventus_FC_2017_logo.svg",
            0x000000,
            "Italy",
            "Unknown",
            15,
            17
        ),

        (
            1520903587612459189,
            "Borussia Dortmund",
            "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
            0xFDE100,
            "Germany",
            "Unknown",
            15,
            17
        ),

        (
            1520908994024050728,
            "Brazil",
            "https://upload.wikimedia.org/wikipedia/en/0/05/Brazil_national_football_team_logo.svg",
            0x009C3B,
            "Brazil",
            "Unknown",
            15,
            17
        ),

        (
            1520908986319241457,
            "Santos FC",
            "https://upload.wikimedia.org/wikipedia/en/3/35/Santos_FC_logo.svg",
            0x000000,
            "Brazil",
            "Unknown",
            15,
            17
        ),

        (
            1520908990068953170,
            "Atletico Madrid",
            "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",
            0xCB3524,
            "Spain",
            "Unknown",
            15,
            17
        ),

        (
            1520908992430346250,
            "Inter Milan",
            "https://upload.wikimedia.org/wikipedia/commons/0/05/FC_Internazionale_Milano_2021.svg",
            0x00529F,
            "Italy",
            "Unknown",
            15,
            17
        ),

        (
            1520903592331186346,
            "Newcastle",
            "https://upload.wikimedia.org/wikipedia/en/5/56/Newcastle_United_Logo.svg",
            0x241F20,
            "England",
            "Unknown",
            15,
            17
        )

    ]


    conn = connect()
    cur = conn.cursor()

    cur.executemany(
        """
        INSERT OR REPLACE INTO clubs
        VALUES (?,?,?,?,?,?,?,?)
        """,
        clubs
    )

    conn.commit()
    conn.close()



def get_club_by_role(role_id):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        "SELECT * FROM clubs WHERE role_id=?",
        (role_id,)
    )

    club = cur.fetchone()

    conn.close()

    return club



def add_transfer(
    player_id,
    player_discord,
    player_roblox,
    manager_discord,
    manager_roblox,
    club,
    action
):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO transfers VALUES(
        NULL,?,?,?,?,?,?,?,?
        )
        """,
        (
            player_id,
            player_discord,
            player_roblox,
            manager_discord,
            manager_roblox,
            club,
            action,
            datetime.now().strftime("%d/%m/%Y %H:%M")
        )
    )

    conn.commit()
    conn.close()



def increase_roster(role_id):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE clubs
        SET roster = roster + 1
        WHERE role_id=?
        """,
        (role_id,)
    )

    conn.commit()
    conn.close()