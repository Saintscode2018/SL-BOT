"""
Super League S5 Database
"""

import sqlite3

import config


DATABASE = config.DATABASE_NAME


ClubRow = tuple



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

            squad_size INTEGER DEFAULT 0,

            squad_limit INTEGER DEFAULT 17

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
            1520903594709352508,
            "Paris Saint-Germain",
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            0x004170,
            0,
            17
        ),


        (
            1520903245458047007,
            "Manchester City",
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            0x6CABDD,
            0,
            17
        ),


        (
            1520903247945007105,
            "Manchester United",
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            0xDA291C,
            0,
            17
        ),


        (
            1520903249000000001,
            "Arsenal",
            "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg",
            0xEF0107,
            0,
            17
        ),


        (
            1520903249000000002,
            "Liverpool",
            "https://upload.wikimedia.org/wikipedia/en/0/0c/Liverpool_FC.svg",
            0xC8102E,
            0,
            17
        ),


        (
            1520903250969231430,
            "Bayern Munich",
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg",
            0xDC052D,
            0,
            17
        ),


        (
            1520903589931909141,
            "FC Barcelona",
            "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg",
            0xA50044,
            0,
            17
        ),


        (
            1520903596210655252,
            "Real Madrid",
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            0xFEBE10,
            0,
            17
        ),


        (
            1520912782961414154,
            "AC Milan",
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            0x000000,
            0,
            17
        ),


        (
            1520903249000000003,
            "Inter Milan",
            "https://upload.wikimedia.org/wikipedia/commons/0/05/FC_Internazionale_Milano_2021.svg",
            0x00529F,
            0,
            17
        ),


        (
            1520903249000000004,
            "Juventus",
            "https://upload.wikimedia.org/wikipedia/commons/1/15/Juventus_FC_2017_logo.svg",
            0x000000,
            0,
            17
        ),


        (
            1520903249000000005,
            "Borussia Dortmund",
            "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
            0xFDE100,
            0,
            17
        ),


        (
            1520903249000000006,
            "Atletico Madrid",
            "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",
            0xCB3524,
            0,
            17
        ),


        (
            1520903249000000007,
            "Tottenham Hotspur",
            "https://upload.wikimedia.org/wikipedia/en/b/b4/Tottenham_Hotspur.svg",
            0x132257,
            0,
            17
        ),


        (
            1520903249000000008,
            "Napoli",
            "https://upload.wikimedia.org/wikipedia/commons/2/2d/S.S.C._Napoli_logo.svg",
            0x008CD2,
            0,
            17
        ),


        (
            1520903249000000009,
            "Chelsea",
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            0x034694,
            0,
            17
        )

    ]



    conn = connect()

    cur = conn.cursor()



    for club in clubs:


        cur.execute(

            """
            INSERT OR REPLACE INTO clubs
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









def get_all_clubs():

    conn = connect()

    cur = conn.cursor()


    cur.execute(
        "SELECT * FROM clubs"
    )


    result = cur.fetchall()


    conn.close()


    return result







def get_club_by_role(role_id):

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


    result = cur.fetchone()


    conn.close()


    return result







def increase_roster(role_id):

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