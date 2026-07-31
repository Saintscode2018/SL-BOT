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

        squad_limit INTEGER DEFAULT 17,

        manager_id INTEGER,

        assistant_manager_id INTEGER

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



    cur.execute("""
    CREATE TABLE IF NOT EXISTS matches (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        home_team TEXT NOT NULL,

        away_team TEXT NOT NULL,

        home_role_id INTEGER,

        away_role_id INTEGER,

        referee_id INTEGER,

        broadcaster_id INTEGER,

        commentator_id INTEGER,

        result TEXT,

        status TEXT DEFAULT 'SCHEDULED',

        created TIMESTAMP DEFAULT CURRENT_TIMESTAMP

    )
    """)



    try:
        cur.execute(
            "ALTER TABLE clubs ADD COLUMN manager_id INTEGER"
        )
    except sqlite3.OperationalError:
        pass



    try:
        cur.execute(
            "ALTER TABLE clubs ADD COLUMN assistant_manager_id INTEGER"
        )
    except sqlite3.OperationalError:
        pass



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
            1520903245458047005,
            "Manchester United",
            "",
            0xDA291C,
            0,
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
                squad_limit,
                manager_id,
                assistant_manager_id
            )

            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)

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




def decrease_roster(role_id):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE clubs

        SET squad_size = MAX(squad_size - 1,0)

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




def set_team_manager(role_id, manager_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE clubs

        SET manager_id = ?

        WHERE role_id = ?

        """,
        (
            manager_id,
            role_id
        )
    )


    conn.commit()
    conn.close()




def get_team_manager(role_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT manager_id
        FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    result = cur.fetchone()

    conn.close()


    return result[0] if result else None




def set_assistant_manager(role_id, assistant_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE clubs

        SET assistant_manager_id = ?

        WHERE role_id = ?

        """,
        (
            assistant_id,
            role_id
        )
    )


    conn.commit()
    conn.close()




def get_assistant_manager(role_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT assistant_manager_id
        FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    result = cur.fetchone()

    conn.close()


    return result[0] if result else None




def add_club(
    role_id,
    name,
    logo="",
    color=0
):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        INSERT INTO clubs

        (
            role_id,
            name,
            logo,
            color
        )

        VALUES (?, ?, ?, ?)

        """,
        (
            role_id,
            name,
            logo,
            color
        )
    )


    conn.commit()
    conn.close()




def remove_club(role_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        DELETE FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    conn.commit()
    conn.close()




# Schedule System


def add_match(
    home_team,
    away_team,
    home_role_id,
    away_role_id
):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        INSERT INTO matches

        (
            home_team,
            away_team,
            home_role_id,
            away_role_id
        )

        VALUES (?, ?, ?, ?)

        """,
        (
            home_team,
            away_team,
            home_role_id,
            away_role_id
        )
    )


    conn.commit()

    match_id = cur.lastrowid

    conn.close()

    return match_id




def update_match_staff(
    match_id,
    referee_id=None,
    broadcaster_id=None,
    commentator_id=None
):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE matches

        SET

        referee_id = ?,

        broadcaster_id = ?,

        commentator_id = ?

        WHERE id = ?

        """,

        (
            referee_id,
            broadcaster_id,
            commentator_id,
            match_id
        )
    )


    conn.commit()
    conn.close()




def get_match(match_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT *
        FROM matches
        WHERE id = ?
        """,
        (match_id,)
    )


    match = cur.fetchone()

    conn.close()

    return match