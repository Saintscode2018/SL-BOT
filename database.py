"""
Super League S5 database system
Role ID = Club ID
"""

from __future__ import annotations

import sqlite3
from typing import Any

import config


ClubRow = tuple[Any, ...]

DATABASE = config.DATABASE_NAME



def connect():

    return sqlite3.connect(DATABASE)





def setup():

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS clubs (

            role_id INTEGER PRIMARY KEY,

            name TEXT NOT NULL,

            logo TEXT,

            color INTEGER,

            squad_size INTEGER DEFAULT 15,

            squad_limit INTEGER DEFAULT 17,

            manager_id INTEGER

        )
        """
    )



    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS transfers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            player_id INTEGER,

            player_name TEXT,

            old_club TEXT,

            manager TEXT,

            new_club TEXT,

            club_id INTEGER,

            status TEXT,

            created TIMESTAMP DEFAULT CURRENT_TIMESTAMP

        )
        """
    )


    conn.commit()
    conn.close()







def load_default_clubs():

    clubs = [

        (
            1520903589931909141,
            "FC Barcelona",
            "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg",
            0xA50044,
            15,
            17
        ),

        (
            1520903596210655252,
            "Real Madrid",
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            0xFEBE10,
            15,
            17
        ),

        (
            1520903250969231430,
            "Bayern Munich",
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg",
            0xDC052D,
            15,
            17
        ),

        (
            1520912782961414154,
            "AC Milan",
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            0x000000,
            15,
            17
        ),

        (
            1520903252961526033,
            "Chelsea",
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            0x034694,
            15,
            17
        ),

        (
            1520903594709352508,
            "Paris Saint-Germain",
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            0x004170,
            15,
            17
        ),

        (
            1520903247945007105,
            "Manchester United",
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            0xDA291C,
            15,
            17
        ),

        (
            1520903245458047007,
            "Manchester City",
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            0x6CABDD,
            15,
            17
        ),

        (
            1520903240000000001,
            "Arsenal",
            "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg",
            0xEF0107,
            15,
            17
        ),

        (
            1520903240000000002,
            "Liverpool",
            "https://upload.wikimedia.org/wikipedia/en/0/0c/Liverpool_FC.svg",
            0xC8102E,
            15,
            17
        ),

        (
            1520903240000000003,
            "Inter Milan",
            "https://upload.wikimedia.org/wikipedia/commons/0/05/FC_Internazionale_Milano_2021.svg",
            0x0068A8,
            15,
            17
        ),

        (
            1520903240000000004,
            "Juventus",
            "https://upload.wikimedia.org/wikipedia/commons/d/d2/Juventus_FC_2017_logo.svg",
            0x000000,
            15,
            17
        ),

        (
            1520903240000000005,
            "Borussia Dortmund",
            "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
            0xFDE100,
            15,
            17
        ),

        (
            1520903240000000006,
            "Atletico Madrid",
            "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",
            0xCB3524,
            15,
            17
        ),

        (
            1520903240000000007,
            "Tottenham Hotspur",
            "https://upload.wikimedia.org/wikipedia/en/b/b4/Tottenham_Hotspur.svg",
            0x132257,
            15,
            17
        ),

        (
            1520903240000000008,
            "Napoli",
            "https://upload.wikimedia.org/wikipedia/commons/2/2d/SSC_Napoli.svg",
            0x12A0D7,
            15,
            17
        )

    ]



    conn = connect()
    cur = conn.cursor()



    for club in clubs:

        cur.execute(
            """
            INSERT OR IGNORE INTO clubs
            (
                role_id,
                name,
                logo,
                color,
                squad_size,
                squad_limit
            )

            VALUES (?, ?, ?, ?, ?, ?)

            """,
            club
        )



    conn.commit()
    conn.close()







def get_club_by_role(role_id: int):

    """
    Detection system:
    Discord role ID -> Club
    """

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT *
        FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    club = cur.fetchone()


    conn.close()


    return club







def get_all_clubs():

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT *
        FROM clubs
        ORDER BY name
        """
    )


    clubs = cur.fetchall()


    conn.close()


    return clubs






def increase_roster(role_id: int):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE clubs

        SET squad_size = squad_size + 1

        WHERE role_id = ?

        """,
        (role_id,)
    )


    conn.commit()
    conn.close()






def add_transfer(
    player_id,
    player_name,
    old_club,
    manager,
    new_club,
    club_id,
    status
):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        INSERT INTO transfers
        (
            player_id,
            player_name,
            old_club,
            manager,
            new_club,
            club_id,
            status
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)

        """,
        (
            player_id,
            player_name,
            old_club,
            manager,
            new_club,
            club_id,
            status
        )
    )


    conn.commit()
    conn.close()