import sqlite3
from datetime import datetime


DATABASE = "clubs.db"



def connect():

    return sqlite3.connect(
        DATABASE
    )




def setup():

    conn = connect()
    cursor = conn.cursor()


    # Clubs

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clubs (

        role_id INTEGER PRIMARY KEY,

        name TEXT NOT NULL,

        logo TEXT,

        color INTEGER,

        country TEXT,

        stadium TEXT,

        coach TEXT,

        roster INTEGER,

        max_roster INTEGER

    )
    """)



    # Transfers

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transfers (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        player_id INTEGER,

        player_name TEXT,

        old_club TEXT,

        new_club TEXT,

        manager_id INTEGER,

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
            "assets/logos/barcelona.png",
            0xA50044,
            "Spain",
            "Spotify Camp Nou",
            "Unknown",
            15,
            17
        ),


        (
            1520903596210655252,
            "Real Madrid",
            "assets/logos/real_madrid.png",
            0xFFFFFF,
            "Spain",
            "Santiago Bernabéu",
            "Unknown",
            15,
            17
        ),


        (
            1520903250969231430,
            "Bayern Munich",
            "assets/logos/bayern.png",
            0xDC052D,
            "Germany",
            "Allianz Arena",
            "Unknown",
            15,
            17
        ),


        (
            1520912782961414154,
            "AC Milan",
            "assets/logos/ac_milan.png",
            0xB00020,
            "Italy",
            "San Siro",
            "Unknown",
            15,
            17
        ),


        (
            1520903252961526033,
            "Chelsea",
            "assets/logos/chelsea.png",
            0x034694,
            "England",
            "Stamford Bridge",
            "Unknown",
            15,
            17
        ),


        (
            1520903594709352508,
            "Paris Saint-Germain",
            "assets/logos/psg.png",
            0x004170,
            "France",
            "Parc des Princes",
            "Unknown",
            15,
            17
        ),


        (
            1520903247945007105,
            "Manchester United",
            "assets/logos/man_utd.png",
            0xDA291C,
            "England",
            "Old Trafford",
            "Unknown",
            15,
            17
        ),


        (
            1520903245458047007,
            "Manchester City",
            "assets/logos/man_city.png",
            0x6CABDD,
            "England",
            "Etihad Stadium",
            "Unknown",
            15,
            17
        ),


        (
            1520903242815639612,
            "Liverpool",
            "assets/logos/liverpool.png",
            0xC8102E,
            "England",
            "Anfield",
            "Unknown",
            15,
            17
        ),


        (
            1520904237016547438,
            "Juventus",
            "assets/logos/juventus.png",
            0x000000,
            "Italy",
            "Allianz Stadium",
            "Unknown",
            15,
            17
        ),


        (
            1520903587612459189,
            "Borussia Dortmund",
            "assets/logos/dortmund.png",
            0xFDE100,
            "Germany",
            "Signal Iduna Park",
            "Unknown",
            15,
            17
        ),


        (
            1520908994024050728,
            "Brazil",
            "assets/logos/brazil.png",
            0x009C3B,
            "Brazil",
            "Maracanã",
            "Unknown",
            15,
            17
        ),


        (
            1520908986319241457,
            "Santos FC",
            "assets/logos/santos.png",
            0x111111,
            "Brazil",
            "Vila Belmiro",
            "Unknown",
            15,
            17
        ),


        (
            1520908990068953170,
            "Atletico Madrid",
            "assets/logos/atletico.png",
            0xCB3524,
            "Spain",
            "Metropolitano",
            "Unknown",
            15,
            17
        ),


        (
            1520908992430346250,
            "Inter Milan",
            "assets/logos/inter.png",
            0x00529F,
            "Italy",
            "San Siro",
            "Unknown",
            15,
            17
        ),


        (
            1520903592331186346,
            "Newcastle United",
            "assets/logos/newcastle.png",
            0x241F20,
            "England",
            "St James Park",
            "Unknown",
            15,
            17
        )

    ]



    conn = connect()
    cursor = conn.cursor()



    cursor.executemany(
        """
        INSERT OR REPLACE INTO clubs
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        clubs
    )


    conn.commit()
    conn.close()







def get_club_by_role(role_id):

    conn = connect()
    cursor = conn.cursor()


    cursor.execute(
        """
        SELECT *
        FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    result = cursor.fetchone()


    conn.close()


    return result







def increase_roster(role_id):

    conn = connect()
    cursor = conn.cursor()


    cursor.execute(
        """
        UPDATE clubs

        SET roster = roster + 1

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
    new_club,
    manager_id
):

    conn = connect()
    cursor = conn.cursor()


    cursor.execute(
        """
        INSERT INTO transfers
        VALUES (
            NULL,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
        """,

        (
            player_id,
            player_name,
            old_club,
            new_club,
            manager_id,
            datetime.now().strftime(
                "%d/%m/%Y %H:%M"
            )
        )

    )


    conn.commit()
    conn.close()







def get_transfer_history(limit=10):

    conn = connect()
    cursor = conn.cursor()


    cursor.execute(
        """
        SELECT *

        FROM transfers

        ORDER BY id DESC

        LIMIT ?
        """,
        (limit,)
    )


    data = cursor.fetchall()


    conn.close()


    return data