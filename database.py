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



def get_club(name):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        "SELECT * FROM clubs WHERE name=?",
        (name,)
    )

    club = cur.fetchone()

    conn.close()

    return club



def add_player(
    discord_id,
    discord_name,
    roblox_name,
    club
):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT OR REPLACE INTO players
        VALUES(?,?,?,?)
        """,
        (
            discord_id,
            discord_name,
            roblox_name,
            club
        )
    )

    conn.commit()
    conn.close()



def update_player_club(
    discord_id,
    club
):

    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE players
        SET club=?
        WHERE discord_id=?
        """,
        (
            club,
            discord_id
        )
    )

    conn.commit()
    conn.close()



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
        INSERT INTO transfers(
        player_discord_id,
        player_discord,
        player_roblox,
        manager_discord,
        manager_roblox,
        club,
        action,
        date
        )
        VALUES(?,?,?,?,?,?,?,?)
        """,
        (
            player_id,
            player_discord,
            player_roblox,
            manager_discord,
            manager_roblox,
            club,
            action,
            datetime.now().strftime(
                "%d/%m/%Y %H:%M"
            )
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



def decrease_roster(role_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE clubs
        SET roster = roster - 1
        WHERE role_id=?
        AND roster > 0
        """,
        (role_id,)
    )


    conn.commit()
    conn.close()



def roster_available(role_id):

    conn = connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT roster,max_roster
        FROM clubs
        WHERE role_id=?
        """,
        (role_id,)
    )


    club = cur.fetchone()

    conn.close()


    if club:
        return club[0] < club[1]

    return False



def get_updated_club(role_id):

    return get_club_by_role(role_id)