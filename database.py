import sqlite3


DATABASE = "clubs.db"



def setup():

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()


    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clubs (

        role_id INTEGER PRIMARY KEY,

        name TEXT,

        logo TEXT,

        banner TEXT,

        color INTEGER,

        country TEXT,

        stadium TEXT,

        coach TEXT,

        roster INTEGER,

        max_roster INTEGER

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
            "https://wallpapercave.com/wp/wp3383594.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
            "https://wallpapercave.com/wp/wp1812867.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg",
            "https://wallpapercave.com/wp/wp1850130.jpg",
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
            "https://upload.wikimedia.org/wikipedia/commons/d/d0/Logo_of_AC_Milan.svg",
            "https://wallpapercave.com/wp/wp1851065.jpg",
            0x000000,
            "Italy",
            "San Siro",
            "Unknown",
            15,
            17
        ),



        (
            1520903252961526033,
            "Chelsea",
            "https://upload.wikimedia.org/wikipedia/en/c/cc/Chelsea_FC.svg",
            "https://wallpapercave.com/wp/wp2025937.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
            "https://wallpapercave.com/wp/wp2563308.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
            "https://wallpapercave.com/wp/wp1817736.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
            "https://wallpapercave.com/wp/wp2757874.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/0/0c/Liverpool_FC.svg",
            "https://wallpapercave.com/wp/wp1850531.jpg",
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
            "https://upload.wikimedia.org/wikipedia/commons/1/15/Juventus_FC_2017_logo.svg",
            "https://wallpapercave.com/wp/wp1817708.jpg",
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
            "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
            "https://wallpapercave.com/wp/wp1875891.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/0/05/Brazil_national_football_team_logo.svg",
            "https://wallpapercave.com/wp/wp1833631.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/3/35/Santos_FC_logo.svg",
            "https://wallpapercave.com/wp/wp1833626.jpg",
            0x000000,
            "Brazil",
            "Vila Belmiro",
            "Unknown",
            15,
            17
        ),



        (
            1520908990068953170,
            "Atletico Madrid",
            "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",
            "https://wallpapercave.com/wp/wp1833547.jpg",
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
            "https://upload.wikimedia.org/wikipedia/commons/0/05/FC_Internazionale_Milano_2021.svg",
            "https://wallpapercave.com/wp/wp1833516.jpg",
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
            "https://upload.wikimedia.org/wikipedia/en/5/56/Newcastle_United_Logo.svg",
            "https://wallpapercave.com/wp/wp1817751.jpg",
            0x241F20,
            "England",
            "St James Park",
            "Unknown",
            15,
            17
        )

    ]



    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()



    for club in clubs:

        cursor.execute(
            """
            INSERT OR REPLACE INTO clubs
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            club
        )



    conn.commit()

    conn.close()





def get_club_by_role(role_id):

    conn = sqlite3.connect(DATABASE)

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