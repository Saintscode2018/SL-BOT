"""SQLite persistence for clubs, rosters, and transfer history."""
from __future__ import annotations
import sqlite3
from typing import Any
import config
ClubRow = tuple[Any, ...]
DATABASE = config.DATABASE_NAME
def connect() -> sqlite3.Connection:
    """Return a new SQLite connection."""
    return sqlite3.connect(DATABASE)


def setup() -> None:
    """Create database tables if they do not exist."""
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS clubs (
            role_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            logo TEXT,
            color INTEGER,
            country TEXT,
            coach TEXT,
            squad_size INTEGER DEFAULT 0,
            squad_limit INTEGER DEFAULT 17,
            manager_id INTEGER DEFAULT NULL
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
            club_role INTEGER,
            status TEXT,
            created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()
    conn.close()


def load_default_clubs() -> None:
    """Seed the 16 Super League clubs when missing from the database."""
    clubs = [
        (
            1520903589931909141,
            "FC Barcelona",
            "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg",
            0xA50044,
            "Spain",
            "Unknown",
            15,
            17,
        ),
        (
            1520903596210655252,
            "Real Madrid",
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            0xFEBE10,
            "Spain",
            "Unknown",
            15,
            17,
        ),
        (
            1520903250969231430,
            "Bayern Munich",
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg",
            0xDC052D,
            "Germany",
            "Unknown",
            15,
            17,
        ),
        (
            1520912782961414154,
            "AC Milan",
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            0x000000,
            "Italy",
            "Unknown",
            15,
            17,
        ),
        (
            1520903252961526033,
            "Chelsea",
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            0x034694,
            "England",
            "Unknown",
            15,
            17,
        ),
        (
            1520903594709352508,
            "Paris Saint-Germain",
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            0x004170,
            "France",
            "Unknown",
            15,
            17,
        ),
        (
            1520903247945007105,
            "Manchester United",
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            0xDA291C,
            "England",
            "Unknown",
            15,
            17,
        ),
        (
            1520903245458047007,
            "Manchester City",
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            0x6CABDD,
            "England",
            "Unknown",
            15,
            17,
        ),
        (