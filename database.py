# database.py

import sqlite3

DB = "teams.db"


def connect():
    return sqlite3.connect(DB)


def setup():
    conn = connect()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        team TEXT NOT NULL
    )
    """)

    conn.commit()
    conn.close()


def set_team(user_id: int, team: str):
    conn = connect()
    cur = conn.cursor()

    cur.execute("""
    INSERT INTO users (user_id, team)
    VALUES (?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET team=excluded.team
    """, (user_id, team))

    conn.commit()
    conn.close()


def get_team(user_id: int):
    conn = connect()
    cur = conn.cursor()

    cur.execute(
        "SELECT team FROM users WHERE user_id=?",
        (user_id,)
    )

    result = cur.fetchone()
    conn.close()

    if result:
        return result[0]

    return None