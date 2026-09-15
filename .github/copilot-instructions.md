# AI Subtitle Generator - Setup Instructions

## ✅ Project Setup Complete!

Your AI-powered subtitle generator web app is ready to use. Follow these steps to get started.

### 1️⃣ Configure OpenAI API Key

The app requires an OpenAI API key to work. Here's how to get one:

**Step-by-step:**
1. Go to https://platform.openai.com/api-keys
2. Sign in with your OpenAI account (create one if needed)
3. Click "Create new secret key"
4. Copy the key
5. Open `backend/.env` file and replace `your_openai_api_key_here` with your actual key

**Important:** Never share or commit your API key to version control!

### 2️⃣ Start the Backend Server

**Terminal 1:**
```powershell
cd backend
npm run dev
```

You should see: `Server running on http://localhost:5000`

### 3️⃣ Start the Frontend Development Server

**Terminal 2:**
```powershell
cd frontend
npm run dev
```

You should see: `Local: http://localhost:5173`

### 4️⃣ Open the App

Open your browser and go to: **http://localhost:5173**

## 🎯 How to Use

1. **Upload Audio**: Drag & drop or click to select an audio file
2. **Select Languages**: Choose source language (auto-detect available) and target language
3. **Generate**: Click "Generate Subtitles" button
4. **Download**: Choose SRT or VTT format

## 📊 Project Structure

```
├── backend/                    # Node.js + Express API
│   ├── server.js              # Main server file
│   ├── .env                   # API keys (configure this!)
│   └── package.json
│
├── frontend/                  # React + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── GradientBackground.jsx     # Animated gradients
│   │   │   └── SubtitleGenerator.jsx      # Main app
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
└── README.md                  # Full documentation
```

## 🚀 Features Included

✨ **Dynamic UI**
- Animated gradient background with particle effects
- Smooth transitions and hover effects
- Modern, eye-catching design

🎵 **Audio Processing**
- Support for MP3, WAV, M4A, and more formats
- Large file support (up to 500MB)
- Real-time processing with progress feedback

🌍 **Multilingual**
- 14+ language support
- Auto language detection
- High-quality AI translations

📥 **Export Options**
- Download as SRT subtitle format
- Download as VTT subtitle format
- Preview subtitles before downloading

## ⚙️ API Endpoints

### POST `/generate-subtitles`
```bash
# Example using curl:
curl -X POST http://localhost:5000/generate-subtitles \
  -F "file=@audio.mp3" \
  -F "sourceLanguage=auto" \
  -F "targetLanguage=en"
```

### GET `/health`
Check if server is running:
```bash
curl http://localhost:5000/health
```

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| "OPENAI_API_KEY not set" | Add your API key to `backend/.env` |
| Port 5000/5173 already in use | Change port in `.env` or close other apps |
| Module not found error | Run `npm install` in the problematic folder |
| Audio won't process | Check file is valid, try a smaller file |
| Blank white screen | Check console for errors, restart frontend |

## 💰 Cost Estimation

- Whisper API: ~$0.006 per minute of audio
- GPT-3.5 Turbo: ~$0.0005 per 1K tokens for translation
- Costs vary by audio length

## 📚 Technology Stack

**Frontend:** React 18 + Vite + Framer Motion
**Backend:** Node.js + Express + OpenAI API
**UI Effects:** Canvas animations + CSS gradients

## 🔗 Useful Links

- OpenAI API Docs: https://platform.openai.com/docs
- Whisper API: https://platform.openai.com/docs/guides/speech-to-text
- React Docs: https://react.dev
- Vite Docs: https://vitejs.dev

## 📝 Next Steps (Optional)

1. **Customize Colors**: Edit gradient colors in `GradientBackground.jsx`
2. **Add More Languages**: Update language array in `SubtitleGenerator.jsx`
3. **Deploy**: See README.md for deployment instructions
4. **Add Features**: Connect database, user auth, history, etc.

---

**Happy subtitle generating! 🎬✨**
