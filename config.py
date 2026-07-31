# config.py

# ==========================
# DISCORD BOT
# ==========================

TOKEN = os.getenv("DISCORD_TOKEN")


# ==========================
# CHANNELS
# ==========================

# Channel where completed transfers are announced
TRANSFER_CHANNEL_ID = 1519210891596398745



# ==========================
# STAFF ROLES
# ==========================

TEAM_MANAGER_ROLE = 1520900719799042088

ASSISTANT_TEAM_MANAGER_ROLE = 1520899851393437797

PLAYER_MANAGER_ROLE = 1521309945851547780



# Roles allowed to create transfers

ALLOWED_ROLES = [

    TEAM_MANAGER_ROLE,

    ASSISTANT_TEAM_MANAGER_ROLE,

    PLAYER_MANAGER_ROLE

]



# Roles that cannot receive transfer offers

MANAGER_ROLES = [

    TEAM_MANAGER_ROLE,

    ASSISTANT_TEAM_MANAGER_ROLE,

    PLAYER_MANAGER_ROLE

]



# ==========================
# DATABASE
# ==========================

DATABASE_NAME = "superleague.db"



# ==========================
# EMBED DESIGN
# ==========================

BOT_NAME = "🏆 Super League S5 Transfer Market"


FOOTER_TEXT = (
    "Super League S5 • Official Transfer System"
)



# Colors

COLOR_DEFAULT = 0x3498DB

COLOR_SUCCESS = 0x2ECC71

COLOR_ERROR = 0xE74C3C

COLOR_WARNING = 0xF1C40F



# ==========================
# TRANSFER SETTINGS
# ==========================

# Offer expires after 24 hours

OFFER_TIMEOUT = 86400



# ==========================
# FEATURES
# ==========================

ENABLE_LOGGING = True

ENABLE_TRANSFER_HISTORY = True

ENABLE_ROSTER_TRACKING = True

SHOW_ROBLOX_NAMES = True