import sqlite3
import config


DATABASE = config.DATABASE_NAME



def connect():
    return sqlite3.connect(DATABASE)





def setup():

    conn = connect()
    cur = conn.cursor()


    cur.execute("""
    CREATE TABLE IF NOT EXISTS clubs (

        role_id INTEGER PRIMARY KEY,

        name TEXT NOT NULL,

        logo TEXT,

        color INTEGER,

        squad_size INTEGER DEFAULT 0,

        squad_limit INTEGER DEFAULT 17

    )
    """)



    cur.execute("""
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
    """)


    conn.commit()
    conn.close()







def load_default_clubs():

    clubs = [

        (
            1520903594709352508,
            "Paris Saint-Germain",
            "https://cdn.discordapp.com/emojis/1519397324668014632.png",
            0x004170,
            0,
            17
        ),


        (
            1520903245458047007,
            "Manchester City",
            "https://cdn.discordapp.com/emojis/1519397319202836572.png",
            0x6CABDD,
            0,
            17
        ),


        (
            1520903247945007105,
            "Manchester United",
            "https://cdn.discordapp.com/emojis/1520907262783127784.png",
            0xDA291C,
            0,
            17
        ),


        (
            1520903249000000001,
            "Arsenal",
            "",
            0xEF0107,
            0,
            17
        ),


        (
            1520903249000000002,
            "Liverpool",
            "https://cdn.discordapp.com/emojis/1520907988133744692.png",
            0xC8102E,
            0,
            17
        ),


        (
            1520903250969231430,
            "Bayern Munich",
            "https://cdn.discordapp.com/emojis/1519397326316371988.png",
            0xDC052D,
            0,
            17
        ),


        (
            1520903589931909141,
            "FC Barcelona",
            "https://cdn.discordapp.com/emojis/1519397322306355231.png",
            0xA50044,
            0,
            17
        ),


        (
            1520903596210655252,
            "Real Madrid",
            "https://cdn.discordapp.com/emojis/1519397321023033364.png",
            0xFEBE10,
            0,
            17
        ),


        (
            1520912782961414154,
            "AC Milan",
            "https://cdn.discordapp.com/emojis/1519397318124765194.png",
            0x000000,
            0,
            17
        ),


        (
            1520903249000000003,
            "Inter Milan",
            "https://cdn.discordapp.com/emojis/1520916422795202682.png",
            0x00529F,
            0,
            17
        ),


        (
            1520903249000000004,
            "Juventus",
            "https://cdn.discordapp.com/emojis/1520907534108725399.png",
            0x000000,
            0,
            17
        ),


        (
            1520903249000000005,
            "Borussia Dortmund",
            "https://cdn.discordapp.com/emojis/1520908303285223505.png",
            0xFDE100,
            0,
            17
        ),


        (
            1520903249000000006,
            "Atletico Madrid",
            "https://cdn.discordapp.com/emojis/1520909585232171018.png",
            0xCB3524,
            0,
            17
        ),


        (
            1520903249000000007,
            "Tottenham Hotspur",
            "",
            0x132257,
            0,
            17
        ),


        (
            1520903249000000008,
            "Napoli",
            "",
            0x008CD2,
            0,
            17
        ),


        (
            1520903249000000009,
            "Chelsea",
            "https://cdn.discordapp.com/emojis/1519397330120343592.png",
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


    club = cur.fetchone()


    conn.close()


    return club








def get_all_clubs():

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        "SELECT * FROM clubs"
    )


    clubs = cur.fetchall()


    conn.close()


    return clubs







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