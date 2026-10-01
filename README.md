# 🤖 TeraBox Full-Movie Telegram Bot (Zero-Database Edition)

Yeh ek standalone, zero-dependency Telegram Bot hai jo kisi bhi TeraBox / TeraShareLink ko resolve karke:
- 🎬 **Full Movie Details** (Title, File Size, Quality)
- ⏱️ **Full Duration** (Pura 2+ Hours, bina 30-sec limit ke)
- ▶️ **Watch Online Button** (In-Browser Video Player)
- 📥 **Fast Download Button** (1-Click Direct MP4 Download)
- ⚡ **VLC / MX Player Link** (Direct M3U8 Stream)
provide karta hai.

---

## 📋 Required Variables (Kya-Kya Dena Hoga)

Bot ko run karne ke liye sirf **1 cheez** zaroori hai:

| Variable | Description | Kahan Milega |
| :--- | :--- | :--- |
| **`BOT_TOKEN`** | Telegram Bot API Token | Telegram par `@BotFather` se free me 1 minute me |
| **`WEB_PLAYER_BASE_URL`** | *(Optional)* Web Player URL | Default `http://localhost:8080` (Aapka local server ya domain) |

---

## 🚀 Setup & Run Kaise Karein (Step-by-Step)

### Step 1: Telegram Bot Token Lelein
1. Telegram open karein aur search karein: **`@BotFather`**
2. Message bhejein: `/newbot`
3. Bot ka ek display name likhein (e.g. `My TeraBox Bot`)
4. Ek unique username likhein jo `bot` par khatam ho (e.g. `my_terabox_play_bot`)
5. BotFather aapko ek **HTTP API Token** dega, jo is tarah dikhta hai:
   `7182938472:AAFlw93kd8s9-Kdjs83...`

---

### Step 2: Token Ko Configuration Me Daalein
File open karein:
👉 [`telegram_bot/config.json`](file:///c:/Users/keshav/Downloads/antygravity/antygravity/iteraplay2.0/iteraplay/telegram_bot/config.json)

Aur apna token wahan paste karein:
```json
{
  "BOT_TOKEN": "7182938472:AAFlw93kd8s9-Kdjs83...",
  "WEB_PLAYER_BASE_URL": "http://localhost:8080",
  "ADMIN_ID": ""
}
```

---

### Step 3: Bot Ko Start Karein

Aap do tarike se start kar sakte hain:

* **Tarika 1 (Double Click):**
  Folder me maujood [`start_bot.bat`](file:///c:/Users/keshav/Downloads/antygravity/antygravity/iteraplay2.0/iteraplay/telegram_bot/start_bot.bat) file par double click karein!

* **Tarika 2 (Terminal Command):**
  Terminal me run karein:
  ```bash
  node telegram_bot/bot.mjs
  ```

Jab bot start ho jayega, screen par aayega:
```
=======================================================
🤖 TeraBox Telegram Bot is LIVE & READY!
👉 Bot Username: @your_bot_name
👉 Web Player URL: http://localhost:8080
👉 Database Mode: ZERO DB (Fast Stateless Testing)
=======================================================
Waiting for incoming messages on Telegram...
```

---

### Step 4: Test Kaise Karein
1. Telegram par apne banaye huye bot ko open karein.
2. `/start` click karein.
3. Koi bhi TeraBox link paste karein, jaise:
   `https://terasharelink.com/s/1vPhwgMunzrSkOExL3AG8dA`
4. Bot 2-3 seconds me movie poster, 2h 06m ka full duration, **Watch Online** aur **Fast Download** buttons ke sath reply kar dega!

---

## ☁️ Koyeb Par Free 24/7 Deploy Kaise Karein (Step-by-Step)

Koyeb par aap is bot ko **Free 24/7 Cloud** par host kar sakte hain:

1. [Koyeb.com](https://www.koyeb.com/) par login karein (GitHub se Sign In karein).
2. **Create Service** par click karein aur **GitHub** select karein.
3. Apna repository select karein: `mindcreative134-creator/terabox-bot`.
4. **Builder:** `Dockerfile` select karein (Repository me Dockerfile already provided hai).
5. **Environment Variables:**
   * Key: `BOT_TOKEN`
   * Value: `7876010393:AAG9n6VlIGjTrDlAkxXnlxvOyGxe34BzS5M`
6. **Port:** `8000` (Health check ke liye).
7. **Deploy** par click karein!
8. 2 minute me aapka bot Koyeb Cloud par 24/7 bina computer on rakhe live ho jayega!

---

## ⚡ 2 GB Direct Video Upload Kaise Activate Karein (MTProto Engine)

Agar aap chahte hain ki bot 500 MB se lekar **2 GB** tak ki poori movie file direct Telegram chat ke andar send kare:

1. [my.telegram.org](https://my.telegram.org) par jayein aur apna Telegram number login karein.
2. **API development tools** par click karke ek app banayein.
3. Wahan se aapko **`api_id`** aur **`api_hash`** mil jayega.
4. Apne Koyeb Dashboard ya `.env` me yeh variables add karein:
   - `API_ID`: `Aapka_api_id`
   - `API_HASH`: `Aapka_api_hash`
5. Bot restart hote hi automatic **2 GB MTProto Uploader** active ho jayega aur movies direct chat me deliver hone lagengi!

