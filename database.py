import sqlite3


DB = "clubs.db"


def setup():

    conn = sqlite3.connect(DB)
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clubs (

        name TEXT PRIMARY KEY,
        role_id INTEGER UNIQUE,
        logo TEXT,
        banner TEXT,
        color INTEGER,
        coach_id INTEGER,
        roster INTEGER DEFAULT 0,
        max_roster INTEGER DEFAULT 17

    )
    """)

    conn.commit()
    conn.close()



def add_club(
    name,
    role_id,
    logo,
    banner,
    color,
    coach_id=0,
    roster=0,
    max_roster=17
):

    conn = sqlite3.connect(DB)
    cursor = conn.cursor()


    cursor.execute(
        """
        INSERT OR REPLACE INTO clubs
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            role_id,
            logo,
            banner,
            color,
            coach_id,
            roster,
            max_roster
        )
    )


    conn.commit()
    conn.close()



def get_club_by_role(role_id):

    conn = sqlite3.connect(DB)
    cursor = conn.cursor()


    cursor.execute(
        """
        SELECT *
        FROM clubs
        WHERE role_id = ?
        """,
        (role_id,)
    )


    club = cursor.fetchone()


    conn.close()


    return club



def get_all_clubs():

    conn = sqlite3.connect(DB)
    cursor = conn.cursor()


    cursor.execute(
        "SELECT * FROM clubs"
    )


    clubs = cursor.fetchall()


    conn.close()


    return clubs




def load_default_clubs():

    clubs = [

        (
            "FC Barcelona",
            1520903589931909141,
            "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg",
            "https://wallpapercave.com/wp/wp1929448.jpg",
            0xA50044
        ),

        (
            "Real Madrid",
            1520903596210655252,
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            "https://wallpapercave.com/wp/wp1929450.jpg",
            0xFFFFFF
        ),

        (
            "Bayern Munich",
            1520903250969231430,
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_München_logo_%282017%29.svg",
            "https://wallpapercave.com/wp/wp1929470.jpg",
            0xDC052D
        ),

        (
            "AC Milan",
            1520912782961414154,
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            "https://wallpapercave.com/wp/wp1929460.jpg",
            0xFF0000
        ),

        (
            "Chelsea",
            1520903252961526033,
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            "https://wallpapercave.com/wp/wp1929465.jpg",
            0x034694
        ),

        (
            "Paris Saint-Germain",
            1520903594709352508,
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            "https://wallpapercave.com/wp/wp1929455.jpg",
            0x004170
        ),

        (
            "Manchester United",
            1520903247945007105,
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            "https://wallpapercave.com/wp/wp1929475.jpg",
            0xDA291C
        ),

        (
            "Manchester City",
            1520903245458047007,
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            "https://wallpapercave.com/wp/wp1929480.jpg",
            0x6CABDD
        ),

        (
            "Liverpool",
            1520903242815639612,
            "https://upload.wikimedia.org/wikipedia/en/0/0c/Liverpool_FC.svg",
            "https://wallpapercave.com/wp/wp1929485.jpg",
            0xC8102E
        ),

        (
            "Juventus",
            1520904237016547438,
            "https://upload.wikimedia.org/wikipedia/commons/1/15/Juventus_FC_2017_logo.svg",
            "https://wallpapercave.com/wp/wp1929490.jpg",
            0x000000
        ),

        (
            "Borussia Dortmund",
            1520903587612459189,
            "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
            "https://wallpapercave.com/wp/wp1929495.jpg",
            0xFDE100
        ),

        (
            "Brazil",
            1520908994024050728,
            "https://upload.wikimedia.org/wikipedia/en/0/05/Brazil_national_football_team_logo.svg",
            "https://wallpapercave.com/wp/wp1929500.jpg",
            0x009C3B
        ),

        (
            "Santos FC",
            1520908986319241457,
            "https://upload.wikimedia.org/wikipedia/en/3/35/Santos_FC_logo.svg",
            "https://wallpapercave.com/wp/wp1929505.jpg",
            0x000000
        ),

        (
            "Atletico Madrid",
            1520908990068953170,
            "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",
            "https://wallpapercave.com/wp/wp1929510.jpg",
            0xCB3524
        ),

        (
            "Inter Milan",
            1520908992430346250,
            "https://upload.wikimedia.org/wikipedia/commons/0/05/FC_Internazionale_Milano_2021.svg",
            "https://wallpapercave.com/wp/wp1929515.jpg",
            0x0068A8
        ),

        (
            "Newcastle",
            1520903592331186346,
            "https://upload.wikimedia.org/wikipedia/en/5/56/Newcastle_United_Logo.svg",
            "https://wallpapercave.com/wp/wp1929520.jpg",
            0x241F20
        )

    ]


    for club in clubs:

        add_club(
            club[0],
            club[1],
            club[2],
            club[3],
            club[4]
        )



if __name__ == "__main__":

    setup()

    load_default_clubs()

    print("Database setup complete.")