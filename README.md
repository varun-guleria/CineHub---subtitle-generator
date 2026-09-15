# AI Subtitle Generator

A modern, AI-powered web application that converts audio files into multilingual subtitles with stunning dynamic UI animations.

![React](https://img.shields.io/badge/React-18.2-blue?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)
![Groq](https://img.shields.io/badge/Groq-Whisper%20API-orange?style=flat-square)

## 🌟 Features

- **🎵 Multi-Format Audio Support**: Works with MP3, WAV, M4A, and more audio formats
- **📦 Large File Handling**: Automatically splits large uploads into smaller chunks and merges the subtitles
- **🌍 40+ Language Support**: Auto-detect source language and translate to any supported language
- **✨ Dynamic UI**: Animated gradient background with particle effects
- **⚡ Real-time Processing**: Fast audio transcription and translation powered by Groq
- **📥 Multiple Export Formats**: Download subtitles in SRT or VTT format
- **📱 Responsive Design**: Fully optimized for desktop, tablet, and mobile devices
- **🎨 Modern UI/UX**: Eye-catching design with smooth animations and transitions

## 🚀 Quick Start

- **📥 Multiple Export Formats**: Download subtitles in SRT or VTT format
- **📱 Responsive Design**: Fully optimized for desktop, tablet, and mobile devices
- **🎨 Modern UI/UX**: Eye-catching design with smooth animations and transitions

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Groq API Key** (Get it from [console.groq.com/keys](https://console.groq.com/keys))

### Installation

1. **Install dependencies for all workspaces**:
   ```bash
   npm run install:all
   ```

2. **Configure Backend Environment**:
   Create a `.env` file in the `backend` folder:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
   GROQ_TRANSLATION_MODEL=qwen/qwen3.6-27b
   AUDIO_CHUNK_SECONDS=2400
   PORT=5000
   NODE_ENV=development
│   ├── src/
│   │   ├── components/
│   │   │   ├── GradientBackground.jsx     # Animated gradient component
│   │   │   ├── GradientBackground.css
│   │   │   ├── SubtitleGenerator.jsx      # Main app component
│   │   │   └── SubtitleGenerator.css
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── server.js                          # Express server & API routes
│   ├── package.json
│   ├── .env                               # API configuration
│   ├── .env.example
│   └── uploads/                           # Temporary audio files
│
└── README.md
```

## 🔌 API Endpoints

### POST `/generate-subtitles`
Generate subtitles from an audio file

**Request:**
- `Content-Type`: multipart/form-data
- `file`: Audio file (required)
- `sourceLanguage`: Source language code (default: 'auto')
- `targetLanguage`: Target language code (default: 'en')

**Response:**
```json
{
  "subtitles": [
    {
      "start": 0,
      "end": 2.5,
      "text": "Translated subtitle text"
    }
  ]
}
```

### GET `/health`
Health check endpoint

## 🌐 Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Russian (ru)
- Japanese (ja)
- Chinese (zh)
- Hindi (hi)
- Arabic (ar)
- Turkish (tr)
- Korean (ko)
- And more via auto-detect

## 🔑 Getting Your Groq API Key

1. Visit [console.groq.com/keys](https://console.groq.com/keys)
2. Sign up or log in to your account
3. Navigate to "API keys" section
4. Click "Create new secret key"
5. Copy the key and paste it into your `.env` file

**Note**: Keep your API key private and never commit it to version control!

## 📊 Cost Considerations

The app uses Groq's:
- **Whisper Large V3 Turbo** for audio transcription
- **Llama 3.3 70B Versatile** for translation

Groq has a free tier with rate limits. Usage and pricing can change, so check Groq's dashboard before production use.

## 🛠️ Technology Stack

**Frontend:**
- React 18.2
- Vite (build tool)
- Framer Motion (animations)
- Axios (HTTP client)
- CSS3 (animations & gradients)

**Backend:**
- Node.js with Express
- Groq API (Whisper Large V3 Turbo + Llama 3.3 70B Versatile)
- Multer (file uploads)
- CORS (cross-origin requests)

## 🐛 Troubleshooting

**"GROQ_API_KEY is not set"**
- Make sure you created `.env` file in the `backend` folder
- Verify the API key is correctly copied from Groq Console

**"Cannot find module" error**
- Run `npm install` in both frontend and backend folders
- Delete `node_modules` and `package-lock.json`, then reinstall

**Audio processing fails**
- Ensure the audio file is valid and not corrupted
- Large files are split automatically; if a generated chunk still exceeds 25MB, lower `AUDIO_CHUNK_SECONDS`
- Verify your Groq account has available rate limit/quota

**CORS errors**
- Make sure backend is running on port 5000
- Check that the proxy in `vite.config.js` is correct

## 📝 Environment Variables

### Backend (.env)

| Variable | Description | Required |
|----------|-------------|----------|
| `GROQ_API_KEY` | Your Groq API key | Yes |
| `GROQ_TRANSCRIPTION_MODEL` | Speech-to-text model (default: `whisper-large-v3-turbo`) | No |
| `GROQ_TRANSLATION_MODEL` | Translation chat model (default: `llama-3.3-70b-versatile`) | No |
| `AUDIO_CHUNK_SECONDS` | Length of each generated audio chunk (default: `600`) | No |
| `PORT` | Server port (default: 5000) | No |
| `NODE_ENV` | Environment (development/production) | No |

## 🚀 Deployment

### Deploying to Vercel (Frontend)
```bash
npm run build
# Use Vercel to deploy the dist folder
```

### Deploying Backend

Backend can be deployed to:
- Heroku
- Railway
- Render
- DigitalOcean
- AWS

Update the proxy URL in `frontend/vite.config.js` to your deployed backend URL.

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Feel free to submit pull requests or open issues.

## 💬 Support

For issues, questions, or suggestions, please open an issue on GitHub or contact the maintainer.

---

**Made with ❤️ for language lovers and content creators**
