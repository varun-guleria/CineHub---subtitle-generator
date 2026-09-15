import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import ffmpegPath from 'ffmpeg-static'
import { OpenAI } from 'openai'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000
const execFileAsync = promisify(execFile)

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// Normalize /api prefix so routes work with or without it
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4)
  }
  next()
})

// Configure multer for file uploads
const uploadDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const extractedAudioDir = path.join(__dirname, 'extracted-audio')
if (!fs.existsSync(extractedAudioDir)) {
  fs.mkdirSync(extractedAudioDir, { recursive: true })
}

const subtitleSessionDir = path.join(__dirname, 'subtitle-sessions')
if (!fs.existsSync(subtitleSessionDir)) {
  fs.mkdirSync(subtitleSessionDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const allowedAudioExtensions = new Set([
  '.aac',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
  '.wma'
])

const allowedVideoExtensions = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.webm'
])

function isSupportedMediaFile(file) {
  if (!file) return false
  const mimeType = file.mimetype || ''
  const extension = path.extname(file.originalname || '').toLowerCase()

  return mimeType.startsWith('audio/') || mimeType.startsWith('video/') || allowedAudioExtensions.has(extension) || allowedVideoExtensions.has(extension)
}

function isSupportedVideoPath(filePath) {
  return allowedVideoExtensions.has(path.extname(filePath || '').toLowerCase())
}

const MAX_FILE_SIZE_GB = Math.max(1, Number(process.env.MAX_FILE_SIZE_GB || 15))
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_GB * 1024 * 1024 * 1024

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES }, // 15GB limit by default (supports full movies)
  fileFilter: (req, file, cb) => {
    if (isSupportedMediaFile(file)) {
      cb(null, true)
      return
    }

    cb(new Error('Please upload a supported audio or video file.'))
  }
})

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_API_KEY_ALT = process.env.GROQ_API_KEY_ALT || ''
const GROQ_TRANSCRIPTION_MODEL = process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo'
const GROQ_TRANSLATION_MODEL = process.env.GROQ_TRANSLATION_MODEL || 'openai/gpt-oss-20b'
const GROQ_TRANSLATION_MODEL_ALT = process.env.GROQ_TRANSLATION_MODEL_ALT || 'groq/compound-mini'
const GROQ_MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TARGET_AUDIO_BITRATE = process.env.AUDIO_BITRATE || '64k'
const TARGET_AUDIO_SAMPLE_RATE = process.env.AUDIO_SAMPLE_RATE || '16000'
const CHUNK_SECONDS = Math.max(60, Number(process.env.AUDIO_CHUNK_SECONDS || 2400))
const STREAMING_CHUNK_SECONDS = Math.max(30, Number(process.env.STREAMING_CHUNK_SECONDS || 75))
const INITIAL_SUBTITLE_BUFFER_SECONDS = Math.max(STREAMING_CHUNK_SECONDS, Number(process.env.INITIAL_SUBTITLE_BUFFER_SECONDS || 180))
const TRANSCRIPTION_CONCURRENCY = Math.max(1, Number(process.env.TRANSCRIPTION_CONCURRENCY || 3))
const TRANSLATION_CONCURRENCY = Math.max(1, Number(process.env.TRANSLATION_CONCURRENCY || 2))
const TRANSLATION_BATCH_SIZE = Math.max(1, Number(process.env.TRANSLATION_BATCH_SIZE || 6))
const TRANSLATION_RETRIES = Math.max(1, Number(process.env.TRANSLATION_RETRIES || 3))
const GROQ_TRANSLATION_MAX_TOKENS = Math.max(128, Number(process.env.GROQ_TRANSLATION_MAX_TOKENS || 1024))
const FFMPEG_MAX_BUFFER = 10 * 1024 * 1024
const GROQ_INTERVAL_MS = Math.max(50, Number(process.env.GROQ_INTERVAL_MS || 250))

// In-memory queue to throttle outgoing Groq requests and respect rate limits.
const groqRequestQueue = []
let groqProcessorRunning = false
let groqProcessorTimer = null
const activeStreamMedia = new Map()
const preparedStreamMedia = new Map()
// When set to a future timestamp, the queue processor skips dequeuing until that time.
let queuePausedUntil = 0

function getRetryAfterMs(error) {
  const retryAfterHeader = error?.headers?.['retry-after'] || error?.headers?.get?.('retry-after')
  if (retryAfterHeader) {
    return Number(retryAfterHeader) * 1000
  }
  // Parse "Please try again in X.XXs" from the error message
  const match = String(error?.message || '').match(/try again in ([\d.]+)s/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 500 // add 500ms buffer
  }
  return 0
}

function pauseQueue(ms) {
  const until = Date.now() + ms
  if (until > queuePausedUntil) {
    queuePausedUntil = until
    console.warn(`⏸  Groq rate limit hit — pausing queue for ${(ms / 1000).toFixed(1)}s`)
  }
}

function enqueueGroqCall(fn) {
  return new Promise((resolve, reject) => {
    groqRequestQueue.push({ fn, resolve, reject })
    if (!groqProcessorRunning) startGroqProcessor()
  })
}

function startGroqProcessor() {
  if (groqProcessorRunning) return
  groqProcessorRunning = true

  const scheduleNext = (delay = GROQ_INTERVAL_MS) => {
    groqProcessorTimer = setTimeout(processNext, delay)
  }

  const processNext = async () => {
    groqProcessorTimer = null

    if (groqRequestQueue.length === 0) {
      groqProcessorRunning = false
      return
    }

    // Respect a server-provided rate-limit pause before taking another request.
    const pauseRemaining = queuePausedUntil - Date.now()
    if (pauseRemaining > 0) {
      scheduleNext(pauseRemaining)
      return
    }

    const item = groqRequestQueue.shift()
    try {
      const result = await item.fn()
      item.resolve(result)
    } catch (err) {
      // Requeue rate-limited calls when the API says when to retry. Other calls
      // reject normally so the caller's own retry policy can decide what to do.
      if (err?.status === 429 || err?.code === 'rate_limit_exceeded') {
        const waitMs = getRetryAfterMs(err)
        if (waitMs > 0) {
          pauseQueue(waitMs)
          groqRequestQueue.unshift(item)
        } else {
          item.reject(err)
        }
      } else {
        item.reject(err)
      }
    }

    if (groqRequestQueue.length === 0) {
      groqProcessorRunning = false
      return
    }

    scheduleNext(Math.max(GROQ_INTERVAL_MS, queuePausedUntil - Date.now(), 0))
  }

  // Start immediately; spacing is applied between subsequent outbound calls.
  scheduleNext(0)
}

const languageNames = {
  auto: 'auto-detect',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Chinese',
  hi: 'Hindi',
  ar: 'Arabic',
  tr: 'Turkish',
  ko: 'Korean'
}

const languageAliases = {
  auto: 'auto',
  autodetect: 'auto',
  'auto-detect': 'auto',
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  japanese: 'ja',
  chinese: 'zh',
  hindi: 'hi',
  arabic: 'ar',
  turkish: 'tr',
  korean: 'ko'
}

// Groq exposes OpenAI-compatible endpoints, so the existing OpenAI SDK can be reused.
const groq = GROQ_API_KEY
  ? new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: 120000
  })
  : null

const groqAlt = GROQ_API_KEY_ALT
  ? new OpenAI({
    apiKey: GROQ_API_KEY_ALT,
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: 120000
  })
  : null

function isQuotaOrRateLimitError(error) {
  return error?.status === 429 || error?.code === 'rate_limit_exceeded'
}

function shouldFailoverToAltGroq(error, usedPrimaryClient) {
  return Boolean(groqAlt && usedPrimaryClient && isQuotaOrRateLimitError(error))
}

async function enqueueGroqCallWithFailover(primaryCall, altCall) {
  try {
    return await enqueueGroqCall(primaryCall)
  } catch (error) {
    if (!altCall || !shouldFailoverToAltGroq(error, true)) {
      throw error
    }

    console.warn('Primary Groq account hit quota or rate limit; retrying with backup account...')
    return enqueueGroqCall(altCall)
  }
}

function logGroqError(label, error) {
  console.error(label, {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    type: error.type,
    cause: error.cause?.message || error.cause
  })
}

function removeUploadedFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (err) {
    console.warn(`[Cleanup] Could not remove uploaded file ${filePath}: ${err.message}`)
  }
}

function removeGeneratedDirectory(dirPath) {
  try {
    const resolvedDir = path.resolve(dirPath)
    const resolvedUploadDir = path.resolve(uploadDir)

    if (!resolvedDir.startsWith(resolvedUploadDir + path.sep)) {
      console.warn(`[Cleanup] Refusing to remove directory outside uploads: ${resolvedDir}`)
      return
    }

    if (fs.existsSync(resolvedDir)) {
      fs.rmSync(resolvedDir, { recursive: true, force: true })
    }
  } catch (err) {
    console.warn(`[Cleanup] Could not remove directory ${dirPath}: ${err.message}`)
  }
}

function cleanLocalPath(localPath) {
  let cleaned = String(localPath || '').trim().replace(/^["']|["']$/g, '')
  if (cleaned) {
    try {
      cleaned = path.normalize(cleaned)
    } catch { }
  }
  return cleaned
}

function getSubtitleSessionPath(sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) {
    return null
  }
  return path.join(subtitleSessionDir, `${sessionId}.json`)
}

function saveSubtitleSession(session) {
  const sessionPath = getSubtitleSessionPath(session?.id)
  if (!sessionPath) return

  session.updatedAt = new Date().toISOString()
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8')
}

function loadSubtitleSession(sessionId) {
  const sessionPath = getSubtitleSessionPath(sessionId)
  if (!sessionPath || !fs.existsSync(sessionPath)) return null

  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
  } catch (error) {
    console.warn(`[Sessions] Could not read subtitle session ${sessionId}: ${error.message}`)
    return null
  }
}

function mergeSessionSubtitles(existing, incoming) {
  const merged = new Map()
  for (const subtitle of [...(existing || []), ...(incoming || [])]) {
    const start = Number(subtitle?.start)
    const end = Number(subtitle?.end)
    const text = String(subtitle?.text || '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue
    merged.set(`${start}|${end}|${text}`, { start, end, text })
  }
  return [...merged.values()].sort((a, b) => a.start - b.start || a.end - b.end)
}

function formatSrtTime(seconds) {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000))
  const hours = Math.floor(totalMilliseconds / 3600000)
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000)
  const secs = Math.floor((totalMilliseconds % 60000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function createSrt(subtitles) {
  return (subtitles || []).map((subtitle, index) => [
    index + 1,
    `${formatSrtTime(subtitle.start)} --> ${formatSrtTime(subtitle.end)}`,
    subtitle.text,
    ''
  ].join('\n')).join('\n')
}

async function getAudioTracks(filePath) {
  if (!ffmpegPath || !filePath || !fs.existsSync(filePath)) return []

  // ffmpeg prints stream metadata to stderr and exits with code 1 when used
  // without an output file, which is expected for this lightweight probe.
  const result = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], { maxBuffer: FFMPEG_MAX_BUFFER })
    .catch((error) => error)
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`
  const tracks = []

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/Stream #\d+:(\d+)(?:\(([^)]+)\))?: Audio:\s*([^,]+)/i)
    if (!match) continue

    tracks.push({
      index: tracks.length,
      streamIndex: Number(match[1]),
      language: String(match[2] || 'und').toLowerCase(),
      codec: String(match[3] || 'unknown').trim(),
      isDefault: /\(default\)/i.test(line)
    })
  }

  return tracks
}

function getSelectedAudioTrackIndex(value, tracks) {
  const requestedIndex = Number.parseInt(value, 10)
  if (Number.isInteger(requestedIndex) && tracks.some((track) => track.index === requestedIndex)) {
    return requestedIndex
  }
  return tracks.find((track) => track.isDefault)?.index ?? tracks[0]?.index ?? 0
}

function streamBrowserCompatibleVideo(inputPath, req, res) {
  if (!ffmpegPath) {
    return res.status(500).json({ error: 'ffmpeg binary is not available. Run npm install in the backend folder.' })
  }

  if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    return res.status(404).json({ error: 'The video for this stream is no longer available' })
  }

  // Most browsers cannot decode AC-3/DTS audio from MKV movies. The video is
  // copied without re-encoding, while only audio is converted to AAC. Fragmented
  // MP4 lets playback begin while ffmpeg continues working in the background.
  const audioTrackIndex = Number.isInteger(Number.parseInt(req.query.audioTrack, 10))
    ? Math.max(0, Number.parseInt(req.query.audioTrack, 10))
    : 0

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', `0:a:${audioTrackIndex}?`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  ], { windowsHide: true })

  let responseStarted = false
  let ffmpegError = ''

  const stopTranscode = () => {
    if (!ffmpeg.killed) ffmpeg.kill('SIGTERM')
  }

  res.on('close', stopTranscode)

  ffmpeg.stderr.on('data', (data) => {
    ffmpegError += data.toString()
  })

  ffmpeg.stdout.on('data', (data) => {
    if (!responseStarted) {
      responseStarted = true
      res.status(200)
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Accept-Ranges', 'none')
    }
    if (!res.writableEnded && !res.destroyed) res.write(data)
  })

  ffmpeg.on('error', (error) => {
    if (!responseStarted && !res.headersSent) {
      res.status(500).json({ error: `Unable to start compatible video playback: ${error.message}` })
    }
  })

  ffmpeg.on('close', (code) => {
    if (!responseStarted && !res.headersSent) {
      res.status(422).json({ error: `Unable to make this video browser-compatible${ffmpegError ? `: ${ffmpegError.trim()}` : ''}` })
      return
    }
    if (!res.writableEnded && !res.destroyed) res.end()
    if (code && code !== 255) {
      console.warn(`[Playback] Compatible media stream exited with code ${code}: ${ffmpegError.trim()}`)
    }
  })
}

function createExtractedAudioPath(videoPath) {
  const parsedPath = path.parse(videoPath)
  const safeBaseName = parsedPath.name
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video'
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)

  return path.join(extractedAudioDir, `${safeBaseName}-${uniqueSuffix}.mp3`)
}

function parseBitrateBytesPerSecond(bitrate) {
  const match = String(bitrate).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([kmg])?$/)
  if (!match) {
    return 8000
  }

  const value = Number(match[1])
  const unit = match[2]
  const bitsPerSecond = unit === 'm'
    ? value * 1000 * 1000
    : unit === 'g'
      ? value * 1000 * 1000 * 1000
      : unit === 'k'
        ? value * 1000
        : value

  return bitsPerSecond / 8
}

function getSafeChunkSeconds() {
  const bytesPerSecond = parseBitrateBytesPerSecond(TARGET_AUDIO_BITRATE)
  const maxSecondsBySize = Math.floor((GROQ_MAX_AUDIO_BYTES * 0.85) / bytesPerSecond)

  return Math.max(60, Math.min(CHUNK_SECONDS, maxSecondsBySize))
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

function normalizeLanguageCode(language) {
  if (!language) {
    return 'auto'
  }

  const normalized = String(language).trim().toLowerCase()
  return languageAliases[normalized] || normalized
}

function getTranscriptionLanguage(transcription, sourceLanguage) {
  const detectedLanguage = transcription.language || transcription.detected_language
  const normalizedDetected = normalizeLanguageCode(detectedLanguage)

  return normalizedDetected === 'auto'
    ? normalizeLanguageCode(sourceLanguage)
    : normalizedDetected
}

function shouldTranslate(transcription, targetLanguage, sourceLanguage) {
  // A single Whisper language label applies to the whole audio chunk, not to
  // every subtitle line. Mixed Hindi/Urdu/English dialogue can therefore be
  // labelled "en" and otherwise bypass translation to English. In auto mode,
  // always send each line to the target-language translator.
  if (normalizeLanguageCode(sourceLanguage) === 'auto') {
    return true
  }

  const sourceCode = getTranscriptionLanguage(transcription, sourceLanguage)
  const targetCode = normalizeLanguageCode(targetLanguage)

  return sourceCode === 'auto' || sourceCode !== targetCode
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function cleanTranslationText(content) {
  let text = String(content || '').trim()
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^translation\s*:\s*/i, '')
    .trim()
}

function extractFirstJsonBlock(content) {
  const text = String(content || '')
  const start = text.search(/[\[{]/)
  if (start === -1) {
    return null
  }

  const stack = []
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      const opener = stack.pop()
      if (!opener) {
        return null
      }

      const isMatchingPair = (opener === '{' && char === '}') || (opener === '[' && char === ']')
      if (!isMatchingPair) {
        return null
      }

      if (stack.length === 0) {
        return text.slice(start, index + 1)
      }
    }
  }

  return null
}

function parseJsonFromModel(content) {
  const cleaned = cleanTranslationText(content)

  try {
    return JSON.parse(cleaned)
  } catch {
    const jsonBlock = extractFirstJsonBlock(cleaned)

    if (!jsonBlock) {
      throw new Error('Translation response did not contain JSON')
    }

    return JSON.parse(jsonBlock)
  }
}

async function translateTextsIndividually(
  texts,
  targetLanguage,
  sourceLanguage = 'auto',
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackModel = GROQ_TRANSLATION_MODEL_ALT,
  retries = TRANSLATION_RETRIES
) {
  const translations = []

  for (const text of texts) {
    translations.push(await translateText(text, targetLanguage, sourceLanguage, translationModel, fallbackModel, retries))
  }

  return translations
}

async function prepareAudioForGroq(filePath, audioTrackIndex = 0) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary is not available. Run npm install in the backend folder.')
  }

  const preparedDir = fs.mkdtempSync(path.join(uploadDir, 'prepared-'))
  const outputPath = path.join(preparedDir, 'audio.mp3')

  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', filePath,
    '-map', `0:a:${Math.max(0, Number(audioTrackIndex) || 0)}?`,
    '-vn',
    '-ac', '1',
    '-ar', TARGET_AUDIO_SAMPLE_RATE,
    '-b:a', TARGET_AUDIO_BITRATE,
    outputPath
  ], { maxBuffer: FFMPEG_MAX_BUFFER })

  return {
    dir: preparedDir,
    path: outputPath,
    size: fs.statSync(outputPath).size
  }
}

async function extractAudioFromVideo(videoPath, audioTrackIndex = 0) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary is not available. Run npm install in the backend folder.')
  }

  const cleanedPath = cleanLocalPath(videoPath)

  if (!cleanedPath) {
    throw new Error('Please enter a local video file path')
  }

  if (!fs.existsSync(cleanedPath)) {
    throw new Error('Video file was not found at that path')
  }

  const stat = fs.statSync(cleanedPath)
  if (!stat.isFile()) {
    throw new Error('The video path must point to a file')
  }

  if (!isSupportedVideoPath(cleanedPath)) {
    throw new Error('Please use a supported local video file: MP4, MKV, MOV, M4V, MPEG, MPG, or WEBM')
  }

  const outputPath = createExtractedAudioPath(cleanedPath)

  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', cleanedPath,
    '-map', `0:a:${Math.max(0, Number(audioTrackIndex) || 0)}?`,
    '-vn',
    '-ac', '1',
    '-ar', TARGET_AUDIO_SAMPLE_RATE,
    '-b:a', TARGET_AUDIO_BITRATE,
    outputPath
  ], { maxBuffer: FFMPEG_MAX_BUFFER })

  return {
    inputPath: cleanedPath,
    outputPath,
    size: fs.statSync(outputPath).size
  }
}

async function getAudioDurationInSeconds(filePath) {
  try {
    const res = await execFileAsync(ffmpegPath, ['-i', filePath], { maxBuffer: FFMPEG_MAX_BUFFER }).catch((e) => e)
    const output = (res?.stdout || '') + (res?.stderr || '')
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (match) {
      const hours = parseFloat(match[1])
      const mins = parseFloat(match[2])
      const secs = parseFloat(match[3])
      return hours * 3600 + mins * 60 + secs
    }
  } catch { }
  return 0
}

async function splitAudioIntoChunks(filePath, customChunkSeconds = null) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary is not available. Run npm install in the backend folder.')
  }

  const chunkDir = fs.mkdtempSync(path.join(uploadDir, 'chunks-'))
  const outputPattern = path.join(chunkDir, 'chunk-%03d.mp3')
  const chunkSeconds = customChunkSeconds ? Math.max(30, Number(customChunkSeconds)) : getSafeChunkSeconds()

  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', filePath,
    '-vn',
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', String(chunkSeconds),
    '-reset_timestamps', '1',
    outputPattern
  ], { maxBuffer: FFMPEG_MAX_BUFFER })

  const rawChunkFiles = fs.readdirSync(chunkDir)
    .filter((name) => name.endsWith('.mp3'))
    .sort()

  let currentOffset = 0
  const chunks = []
  for (const name of rawChunkFiles) {
    const chunkPath = path.join(chunkDir, name)
    const duration = await getAudioDurationInSeconds(chunkPath)
    const effectiveDuration = duration > 0 ? duration : chunkSeconds
    chunks.push({
      path: chunkPath,
      offset: currentOffset,
      duration: effectiveDuration,
      name
    })
    currentOffset += effectiveDuration
  }

  if (chunks.length === 0) {
    removeGeneratedDirectory(chunkDir)
    throw new Error('Unable to split audio into processable chunks')
  }

  return { chunkDir, chunks, totalDuration: currentOffset }
}

// Speech-to-text function with retry logic
async function transcribeAudio(filePath, language = 'auto', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const transcription = await enqueueGroqCallWithFailover(
        () => groq.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: GROQ_TRANSCRIPTION_MODEL,
          language: language === 'auto' ? undefined : language,
          response_format: 'verbose_json',
          timestamp_granularities: ['segment']
        }),
        groqAlt
          ? () => groqAlt.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: GROQ_TRANSCRIPTION_MODEL,
            language: language === 'auto' ? undefined : language,
            response_format: 'verbose_json',
            timestamp_granularities: ['segment']
          })
          : null
      )

      return transcription
    } catch (error) {
      logGroqError(`Transcription attempt ${attempt}/${retries} failed`, error)

      if (attempt === retries) {
        throw new Error('Failed to transcribe audio after ' + retries + ' attempts: ' + error.message)
      }
      // 429s are handled by the queue (it pauses and re-queues); rethrow so the queue catches it.
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') throw error

      // For other transient errors, use a short exponential backoff before the next attempt.
      const delayMs = Math.floor(Math.pow(2, attempt - 1) * 1000 * (0.8 + Math.random() * 0.4))
      console.log(`Retrying transcription in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

// Translation function with retry logic
async function translateText(
  text,
  targetLanguage,
  sourceLanguage = 'auto',
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackModel = GROQ_TRANSLATION_MODEL_ALT,
  retries = TRANSLATION_RETRIES
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const sourceCode = normalizeLanguageCode(sourceLanguage)
      const targetCode = normalizeLanguageCode(targetLanguage)

      if (sourceCode === targetCode && sourceCode !== 'auto') {
        return text
      }

      const prompt = sourceCode === 'auto'
        ? `Translate the following text to ${languageNames[targetCode]}: "${text}"`
        : `Translate the following text from ${languageNames[sourceCode]} to ${languageNames[targetCode]}: "${text}"`

      const response = await enqueueGroqCallWithFailover(
        () => groq.chat.completions.create({
          model: translationModel,
          messages: [
            {
              role: 'system',
              content: `You are a professional subtitle translator. Return only natural ${languageNames[targetCode]} text. Translate every non-${languageNames[targetCode]} phrase, including mixed Hindi, Urdu, and English dialogue; keep phrases already in ${languageNames[targetCode]} unchanged.`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: GROQ_TRANSLATION_MAX_TOKENS,
          reasoning_format: 'hidden'
        }),
        groqAlt
          ? () => groqAlt.chat.completions.create({
            model: translationModel,
            messages: [
              {
                role: 'system',
                content: `You are a professional subtitle translator. Return only natural ${languageNames[targetCode]} text. Translate every non-${languageNames[targetCode]} phrase, including mixed Hindi, Urdu, and English dialogue; keep phrases already in ${languageNames[targetCode]} unchanged.`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: GROQ_TRANSLATION_MAX_TOKENS,
            reasoning_format: 'hidden'
          })
          : null
      )

      return response.choices[0].message.content.trim()
    } catch (error) {
      logGroqError(`Translation attempt ${attempt}/${retries} failed on ${translationModel}`, error)

      if (attempt === retries) {
        if (fallbackModel && fallbackModel !== translationModel) {
          console.log(`Primary translation model ${translationModel} failed, retrying with fallback ${fallbackModel}`)
          return translateText(text, targetLanguage, sourceLanguage, fallbackModel, null, retries)
        }
        throw new Error(`Failed to translate text after ${retries} attempts with model ${translationModel}: ${error.message}`)
      }
      // 429s are handled by the queue; rethrow so it can pause and re-queue.
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') throw error

      const delayMs = Math.floor(Math.pow(2, attempt - 1) * 1000 * (0.8 + Math.random() * 0.4))
      console.log(`Retrying translation in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

async function translateTextBatch(
  texts,
  targetLanguage,
  sourceLanguage = 'auto',
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackModel = GROQ_TRANSLATION_MODEL_ALT,
  retries = TRANSLATION_RETRIES
) {
  const sourceCode = normalizeLanguageCode(sourceLanguage)
  const targetCode = normalizeLanguageCode(targetLanguage)

  if (sourceCode === targetCode && sourceCode !== 'auto') {
    return texts
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const sourceDescription = sourceCode === 'auto'
        ? 'auto-detected language'
        : languageNames[sourceCode]

      const response = await enqueueGroqCallWithFailover(
        () => groq.chat.completions.create({
          model: translationModel,
          messages: [
            {
              role: 'system',
              content: `You are a professional subtitle translator. Return valid JSON only, with this shape: {"translations":["..."]}. Preserve input order and length. Each translation must be natural ${languageNames[targetCode]} only: translate every non-${languageNames[targetCode]} phrase, including mixed Hindi, Urdu, and English dialogue.`
            },
            {
              role: 'user',
              content: [
                `Translate each item from ${sourceDescription} to ${languageNames[targetCode]}.`,
                'Return exactly one translated string for each input string.',
                `Input JSON array: ${JSON.stringify(texts)}`
              ].join('\n')
            }
          ],
          temperature: 0.3,
          max_tokens: GROQ_TRANSLATION_MAX_TOKENS,
          response_format: { type: 'json_object' },
          reasoning_format: 'hidden'
        }),
        groqAlt
          ? () => groqAlt.chat.completions.create({
            model: translationModel,
            messages: [
              {
                role: 'system',
                content: `You are a professional subtitle translator. Return valid JSON only, with this shape: {"translations":["..."]}. Preserve input order and length. Each translation must be natural ${languageNames[targetCode]} only: translate every non-${languageNames[targetCode]} phrase, including mixed Hindi, Urdu, and English dialogue.`
              },
              {
                role: 'user',
                content: [
                  `Translate each item from ${sourceDescription} to ${languageNames[targetCode]}.`,
                  'Return exactly one translated string for each input string.',
                  `Input JSON array: ${JSON.stringify(texts)}`
                ].join('\n')
              }
            ],
            temperature: 0.3,
            max_tokens: GROQ_TRANSLATION_MAX_TOKENS,
            response_format: { type: 'json_object' },
            reasoning_format: 'hidden'
          })
          : null
      )

      const modelContent = response.choices[0].message.content || ''
      let parsed

      try {
        parsed = parseJsonFromModel(modelContent)
      } catch (parseError) {
        if (texts.length === 1) {
          const fallbackText = cleanTranslationText(modelContent)
          if (fallbackText) {
            console.warn(`Batch parser fell back to plain text for ${translationModel}`)
            return [fallbackText]
          }
        }

        throw parseError
      }

      const translations = Array.isArray(parsed) ? parsed : parsed.translations

      if (!Array.isArray(translations) || translations.length !== texts.length) {
        if (texts.length === 1) {
          const firstTranslation = Array.isArray(translations) && translations.length > 0 ? String(translations[0]).trim() : cleanTranslationText(modelContent)
          if (firstTranslation) {
            console.warn(`Translation batch response length mismatch for ${translationModel}: expected 1, received ${Array.isArray(translations) ? translations.length : 'non-array'}; using first available translation`)
            return [firstTranslation]
          }
        }

        console.warn(
          `Translation batch response length mismatch for ${translationModel}: expected ${texts.length}, received ${Array.isArray(translations) ? translations.length : 'non-array'}`
        )
        console.log('Falling back to sequential per-segment translation for this batch...')
        return translateTextsIndividually(texts, targetLanguage, sourceLanguage, translationModel, fallbackModel, retries)
      }

      return translations.map((translation) => String(translation).trim())
    } catch (error) {
      logGroqError(`Translation batch attempt ${attempt}/${retries} failed on ${translationModel}`, error)

      if (attempt === retries) {
        if (fallbackModel && fallbackModel !== translationModel) {
          console.log(`Primary batch model ${translationModel} failed, retrying with fallback ${fallbackModel}`)
          return translateTextBatch(texts, targetLanguage, sourceLanguage, fallbackModel, null, retries)
        }
        console.log('Falling back to per-segment translation for this batch...')
        return translateTextsIndividually(texts, targetLanguage, sourceLanguage, translationModel, fallbackModel, retries)
      }
      // 429s are handled by the queue; rethrow so it can pause and re-queue.
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') throw error

      const delayMs = Math.floor(Math.pow(2, attempt - 1) * 1000 * (0.8 + Math.random() * 0.4))
      console.log(`Retrying translation batch in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

async function translateTexts(
  texts,
  targetLanguage,
  sourceLanguage = 'auto',
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackTranslationModel = GROQ_TRANSLATION_MODEL_ALT
) {
  const batches = chunkArray(texts, TRANSLATION_BATCH_SIZE)
  const translatedBatches = await mapWithConcurrency(
    batches,
    TRANSLATION_CONCURRENCY,
    (batch) => translateTextBatch(batch, targetLanguage, sourceLanguage, translationModel, fallbackTranslationModel)
  )

  return translatedBatches.flat()
}

// Format subtitles from transcription
async function formatSubtitles(
  transcription,
  targetLanguage,
  sourceLanguage = 'auto',
  timeOffset = 0,
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackTranslationModel = GROQ_TRANSLATION_MODEL_ALT
) {
  const subtitles = []
  const needsTranslation = shouldTranslate(transcription, targetLanguage, sourceLanguage)
  const effectiveSourceLanguage = getTranscriptionLanguage(transcription, sourceLanguage)

  if (transcription.segments && transcription.segments.length > 0) {
    const segments = transcription.segments
      .map((segment) => ({
        start: segment.start + timeOffset,
        end: segment.end + timeOffset,
        text: String(segment.text || '').trim()
      }))
      .filter((segment) => segment.text && !/^[.\s,!?…-]*$/.test(segment.text))
    const texts = segments.map((segment) => segment.text)
    const outputTexts = needsTranslation && texts.length > 0
      ? await translateTexts(texts, targetLanguage, effectiveSourceLanguage, translationModel, fallbackTranslationModel)
      : texts

    for (const [index, segment] of segments.entries()) {
      const translated = String(outputTexts[index] || '').trim()
      if (translated && !/^[.\s,!?…-]*$/.test(translated)) {
        subtitles.push({
          start: segment.start,
          end: segment.end,
          text: translated
        })
      }
    }
  } else if (transcription.text) {
    // Fallback: split into chunks if no segments
    const words = transcription.text.split(' ')
    const wordsPerSub = 10
    let currentTime = timeOffset

    const textChunks = []
    for (let i = 0; i < words.length; i += wordsPerSub) {
      textChunks.push(words.slice(i, i + wordsPerSub).join(' '))
    }

    const outputTexts = needsTranslation
      ? await translateTexts(textChunks, targetLanguage, effectiveSourceLanguage, translationModel, fallbackTranslationModel)
      : textChunks

    for (const [index, translatedText] of outputTexts.entries()) {
      const chunk = textChunks[index]
      const duration = (chunk.split(' ').length / 140) * 60 // Approximate: 140 words per minute

      subtitles.push({
        start: currentTime,
        end: currentTime + duration,
        text: translatedText
      })

      currentTime += duration
    }
  }

  return subtitles
}

function shouldExtractAudio(file) {
  const mimeType = file.mimetype || ''
  const extension = path.extname(file.originalname || '').toLowerCase()

  return mimeType.startsWith('video/') || ['.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm'].includes(extension)
}

async function generateSubtitlesForAudio(file, sourceLanguage, targetLanguage, translationModel = GROQ_TRANSLATION_MODEL, fallbackTranslationModel = GROQ_TRANSLATION_MODEL_ALT, audioTrackIndex = 0) {
  if (file.size <= GROQ_MAX_AUDIO_BYTES && !shouldExtractAudio(file)) {
    const transcription = await transcribeAudio(file.path, sourceLanguage)
    return formatSubtitles(transcription, targetLanguage, sourceLanguage, 0, translationModel, fallbackTranslationModel)
  }

  const preparationReason = shouldExtractAudio(file) ? 'Video upload detected' : 'Large file detected'
  console.log(`${preparationReason} (${(file.size / 1024 / 1024).toFixed(2)}MB). Preparing compact audio (Track ${audioTrackIndex})...`)

  let preparedDir
  let chunkDir
  try {
    const preparedAudio = await prepareAudioForGroq(file.path, audioTrackIndex)
    preparedDir = preparedAudio.dir
    console.log(`Prepared audio size: ${(preparedAudio.size / 1024 / 1024).toFixed(2)}MB`)

    if (preparedAudio.size <= GROQ_MAX_AUDIO_BYTES) {
      const transcription = await transcribeAudio(preparedAudio.path, sourceLanguage)
      return formatSubtitles(transcription, targetLanguage, sourceLanguage, 0, translationModel, fallbackTranslationModel)
    }

    console.log(`Prepared audio is still too large. Splitting into ${getSafeChunkSeconds()}s chunks...`)

    const splitResult = await splitAudioIntoChunks(preparedAudio.path)
    chunkDir = splitResult.chunkDir

    const subtitleGroups = await mapWithConcurrency(splitResult.chunks, TRANSCRIPTION_CONCURRENCY, async (chunk, index) => {
      const chunkSizeMB = (fs.statSync(chunk.path).size / 1024 / 1024).toFixed(2)
      console.log(`Processing chunk ${index + 1}/${splitResult.chunks.length}: ${chunk.name} (${chunkSizeMB}MB)`)

      if (fs.statSync(chunk.path).size > GROQ_MAX_AUDIO_BYTES) {
        throw new Error(`Generated chunk ${chunk.name} is still larger than 25MB. Try lowering AUDIO_CHUNK_SECONDS in backend/.env.`)
      }

      const transcription = await transcribeAudio(chunk.path, sourceLanguage)
      return formatSubtitles(transcription, targetLanguage, sourceLanguage, chunk.offset, translationModel, fallbackTranslationModel)
    })

    return subtitleGroups.flat().sort((a, b) => a.start - b.start)
  } finally {
    if (chunkDir) {
      removeGeneratedDirectory(chunkDir)
    }
    if (preparedDir) {
      removeGeneratedDirectory(preparedDir)
    }
  }
}

async function generateStreamingSubtitles({
  file,
  audioTrackIndex = 0,
  sourceLanguage = 'auto',
  targetLanguage = 'en',
  translationModel = GROQ_TRANSLATION_MODEL,
  fallbackTranslationModel = GROQ_TRANSLATION_MODEL_ALT,
  onStatus,
  onChunk,
  isCancelled = () => false
}) {
  let preparedDir
  let chunkDir

  try {
    if (isCancelled()) return

    onStatus?.({ stage: 'preparing', message: 'Extracting and preparing compact audio stream...' })
    const preparedAudio = await prepareAudioForGroq(file.path, audioTrackIndex)
    preparedDir = preparedAudio.dir

    if (isCancelled()) return

    onStatus?.({ stage: 'splitting', message: 'Segmenting audio into sequential live playback chunks...' })
    const splitResult = await splitAudioIntoChunks(preparedAudio.path, STREAMING_CHUNK_SECONDS)
    chunkDir = splitResult.chunkDir
    const totalChunks = splitResult.chunks.length
    const initialBufferTarget = Math.min(INITIAL_SUBTITLE_BUFFER_SECONDS, splitResult.totalDuration)
    const initialBufferSubtitles = []
    let initialBufferReady = false

    onStatus?.({
      stage: 'ready',
      message: `Audio ready. Buffering the first ${Math.ceil(initialBufferTarget / 60)} minute(s) before playback...`,
      totalChunks,
      totalDuration: splitResult.totalDuration,
      initialBufferTarget
    })

    for (let i = 0; i < totalChunks; i++) {
      if (isCancelled()) break

      const chunk = splitResult.chunks[i]
      const chunkStartMin = Math.floor(chunk.offset / 60)
      const chunkStartSec = Math.floor(chunk.offset % 60)
      const chunkEndMin = Math.floor((chunk.offset + chunk.duration) / 60)
      const chunkEndSec = Math.floor((chunk.offset + chunk.duration) % 60)
      const timeSpan = `${String(chunkStartMin).padStart(2, '0')}:${String(chunkStartSec).padStart(2, '0')} - ${String(chunkEndMin).padStart(2, '0')}:${String(chunkEndSec).padStart(2, '0')}`

      onStatus?.({
        stage: 'transcribing',
        chunkIndex: i + 1,
        totalChunks,
        message: `Transcribing chunk ${i + 1}/${totalChunks} (${timeSpan})...`,
        bufferedUntil: chunk.offset
      })

      const transcription = await transcribeAudio(chunk.path, sourceLanguage === 'auto' ? undefined : sourceLanguage)

      if (isCancelled()) break

      onStatus?.({
        stage: 'translating',
        chunkIndex: i + 1,
        totalChunks,
        message: `Translating subtitles for chunk ${i + 1}/${totalChunks} (${timeSpan})...`
      })

      const subtitles = await formatSubtitles(
        transcription,
        targetLanguage,
        sourceLanguage === 'auto' ? undefined : sourceLanguage,
        chunk.offset,
        translationModel,
        fallbackTranslationModel
      )

      if (isCancelled()) break

      const bufferedUntil = chunk.offset + chunk.duration
      if (!initialBufferReady) {
        initialBufferSubtitles.push(...subtitles)

        if (bufferedUntil < initialBufferTarget && i < totalChunks - 1) {
          onStatus?.({
            stage: 'buffering',
            chunkIndex: i + 1,
            totalChunks,
            bufferedUntil,
            initialBufferTarget,
            message: `Buffering subtitles through ${Math.floor(bufferedUntil / 60)}:${String(Math.floor(bufferedUntil % 60)).padStart(2, '0')} before playback...`
          })
          continue
        }

        initialBufferReady = true
        onChunk?.({
          chunkIndex: i,
          totalChunks,
          subtitles: initialBufferSubtitles,
          bufferedUntil,
          initialBufferTarget,
          initialBufferReady: true,
          isFirstChunk: true,
          isLastChunk: i === totalChunks - 1
        })
        continue
      }

      onChunk?.({
        chunkIndex: i,
        totalChunks,
        subtitles,
        bufferedUntil,
        initialBufferTarget,
        initialBufferReady: false,
        isFirstChunk: false,
        isLastChunk: i === totalChunks - 1
      })
    }
  } finally {
    if (chunkDir) {
      removeGeneratedDirectory(chunkDir)
    }
    if (preparedDir) {
      removeGeneratedDirectory(preparedDir)
    }
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() })
})

// Native OS file dialog for selecting local video files without browser upload
app.get('/browse-local-file', async (req, res) => {
  try {
    const isWindows = process.platform === 'win32'
    if (!isWindows) {
      return res.json({ supported: false })
    }

    // --- Fast path: wscript.exe + VBScript (no .NET, opens dialog in ~300ms) ---
    // UserAccounts.CommonDialog is a lightweight COM object built into Windows
    // that wraps the standard file picker without loading .NET or WinForms.
    const tmpVbs = path.join(os.tmpdir(), `_pick_video_${Date.now()}.vbs`)
    const vbsScript = [
      'Dim dlg',
      'Set dlg = CreateObject("UserAccounts.CommonDialog")',
      'dlg.Filter = "Video Files|*.mp4;*.mkv;*.mov;*.m4v;*.webm;*.avi;*.mpg;*.mpeg|All Files|*.*"',
      'dlg.FilterIndex = 1',
      'If dlg.ShowOpen Then WScript.Echo dlg.FileName',
    ].join('\r\n')

    let stdout = ''
    let usedFastPath = false
    try {
      fs.writeFileSync(tmpVbs, vbsScript, 'utf8')
      const vbsResult = await execFileAsync('wscript.exe', ['//Nologo', tmpVbs], { timeout: 120000 })
      stdout = vbsResult.stdout
      usedFastPath = true
    } catch (vbsErr) {
      // VBScript COM object unavailable or wscript failed — fall back to PowerShell
      console.warn('wscript fast-path failed, falling back to PowerShell:', vbsErr.message)
    } finally {
      try { fs.unlinkSync(tmpVbs) } catch {}
    }

    // --- Slow fallback: PowerShell + WinForms (~3-5s cold start) ---
    if (!usedFastPath) {
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.Show()
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = 'Video Files (*.mp4;*.mkv;*.mov;*.m4v;*.webm;*.avi;*.mpg;*.mpeg)|*.mp4;*.mkv;*.mov;*.m4v;*.webm;*.avi;*.mpg;*.mpeg|All Files (*.*)|*.*'
$d.Title = 'Select Video File for Local Audio Extraction'
$d.RestoreDirectory = $true
$result = $d.ShowDialog($owner)
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
`.trim()
      const psResult = await execFileAsync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-Command', psScript],
        { timeout: 120000 }
      )
      stdout = psResult.stdout
    }

    const selectedPath = (stdout || '').trim()

    if (!selectedPath) {
      return res.json({ cancelled: true })
    }

    const cleaned = cleanLocalPath(selectedPath)
    if (!cleaned || !fs.existsSync(cleaned)) {
      return res.status(404).json({ error: 'Selected file does not exist' })
    }

    const stat = fs.statSync(cleaned)
    return res.json({
      success: true,
      filePath: cleaned,
      fileName: path.basename(cleaned),
      sizeBytes: stat.size,
      sizeMB: Number((stat.size / 1024 / 1024).toFixed(2)),
      sizeGB: Number((stat.size / (1024 * 1024 * 1024)).toFixed(2))
    })
  } catch (error) {
    console.error('Browse local file error:', error)
    res.status(500).json({ error: error.message || 'Failed to open local file dialog' })
  }
})

// Stream local video by filesystem path for preview playback without uploading
app.get('/stream-local-video', (req, res) => {
  try {
    const rawPath = req.query.path
    const cleaned = cleanLocalPath(rawPath)

    if (!cleaned || !fs.existsSync(cleaned)) {
      return res.status(404).send('Video not found')
    }

    const stat = fs.statSync(cleaned)
    if (!stat.isFile()) {
      return res.status(400).send('Invalid video file')
    }

    const fileSize = stat.size
    const ext = path.extname(cleaned).toLowerCase()
    const mimeTypes = {
      '.avi': 'video/x-msvideo',
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.mpeg': 'video/mpeg',
      '.mpg': 'video/mpeg'
    }
    const contentType = mimeTypes[ext] || 'video/mp4'
    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = (end - start) + 1
      const fileStream = fs.createReadStream(cleaned, { start, end })

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      })
      fileStream.pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      })
      fs.createReadStream(cleaned).pipe(res)
    }
  } catch (error) {
    console.error('Stream local video error:', error)
    res.status(500).send('Unable to stream local video')
  }
})

// Extract audio from a local video file without uploading the video through the browser.
app.post('/extract-audio', upload.single('file'), async (req, res) => {
  const uploadedFilePath = req.file?.path
  try {
    if (req.file && !isSupportedVideoPath(req.file.originalname)) {
      return res.status(400).json({ error: 'Please select a supported video file: MP4, MKV, MOV, M4V, MPEG, MPG, or WEBM' })
    }

    const inputPath = req.file?.path || req.body?.videoPath
    const audioTrackIndex = req.body?.audioTrack ?? 0
    const extractedAudio = await extractAudioFromVideo(inputPath, audioTrackIndex)
    const audioFileName = path.basename(extractedAudio.outputPath)

    res.json({
      message: 'Audio extracted successfully',
      audioFileName,
      downloadUrl: `/api/download-extracted-audio/${encodeURIComponent(audioFileName)}`,
      audioSizeMB: Number((extractedAudio.size / 1024 / 1024).toFixed(2)),
      sourcePath: req.file ? req.file.originalname : extractedAudio.inputPath
    })
  } catch (error) {
    console.error('Audio extraction error:', error)
    res.status(400).json({ error: error.message || 'Unable to extract audio from the video' })
  } finally {
    if (uploadedFilePath) removeUploadedFile(uploadedFilePath)
  }
})

app.get('/download-extracted-audio/:audioName', (req, res) => {
  const audioName = path.basename(req.params.audioName)
  const audioPath = path.join(extractedAudioDir, audioName)
  const resolvedAudioPath = path.resolve(audioPath)
  const resolvedDir = path.resolve(extractedAudioDir)

  if (!resolvedAudioPath.startsWith(resolvedDir + path.sep) && resolvedAudioPath !== resolvedDir) {
    return res.status(400).json({ error: 'Invalid audio file name' })
  }

  if (!fs.existsSync(resolvedAudioPath)) {
    return res.status(404).json({ error: 'Audio file not found' })
  }

  res.download(resolvedAudioPath, audioName)
})

// Generate subtitles endpoint
app.post('/generate-subtitles', upload.single('file'), async (req, res) => {
  let isUploadedFile = false
  try {
    let file = req.file
    if (file) {
      isUploadedFile = true
    } else if (req.body?.videoPath) {
      const cleaned = cleanLocalPath(req.body.videoPath)
      if (cleaned && fs.existsSync(cleaned)) {
        const stat = fs.statSync(cleaned)
        if (stat.isFile()) {
          file = { path: cleaned, size: stat.size, originalname: path.basename(cleaned) }
        }
      }
    }

    if (!file) {
      return res.status(400).json({ error: 'No audio file or valid video path provided' })
    }

    const {
      sourceLanguage = 'auto',
      targetLanguage = 'en',
      translationModel = GROQ_TRANSLATION_MODEL,
      audioTrack = 0
    } = req.body

    // Validate languages
    const validLanguages = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'hi', 'ar', 'tr', 'ko']
    if (!validLanguages.includes(sourceLanguage) || !validLanguages.includes(targetLanguage)) {
      if (isUploadedFile) removeUploadedFile(file.path)
      return res.status(400).json({ error: 'Invalid language code' })
    }

    const allowedTranslationModels = [
      GROQ_TRANSLATION_MODEL,
      GROQ_TRANSLATION_MODEL_ALT,
      'openai/gpt-oss-20b',
      'groq/compound-mini',
      'openai/gpt-oss-120b',
      'qwen/qwen3.6-27b'
    ].filter((model, index, list) => model && list.indexOf(model) === index)

    if (!allowedTranslationModels.includes(translationModel)) {
      if (isUploadedFile) removeUploadedFile(file.path)
      return res.status(400).json({ error: 'Invalid translation model selected' })
    }

    const fallbackTranslationModel = allowedTranslationModels.find((model) => model !== translationModel) || translationModel

    // Check if Groq API key is configured
    if (!GROQ_API_KEY) {
      if (isUploadedFile) removeUploadedFile(file.path)
      return res.status(500).json({ error: 'Groq API key not configured' })
    }

    console.log(`Processing: ${file.originalname || file.path} - Track: ${audioTrack} - Source: ${sourceLanguage}, Target: ${targetLanguage}, Model: ${translationModel}`)

    const subtitles = await generateSubtitlesForAudio(
      file,
      sourceLanguage === 'auto' ? undefined : sourceLanguage,
      targetLanguage,
      translationModel,
      fallbackTranslationModel,
      Number(audioTrack) || 0
    )

    // Clean up uploaded file if it was uploaded
    if (isUploadedFile) removeUploadedFile(file.path)

    res.json({ subtitles })
  } catch (error) {
    if (isUploadedFile && req.file?.path) removeUploadedFile(req.file.path)
    console.error('Error:', error)
    res.status(500).json({ error: error.message || 'An error occurred while processing the audio' })
  }
})

// Saved subtitle sessions make streamed work available after the client stops.
app.get('/subtitle-sessions/:sessionId', (req, res) => {
  const session = loadSubtitleSession(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Subtitle session not found' })
  res.json(session)
})

app.get('/subtitle-sessions/:sessionId/srt', (req, res) => {
  const session = loadSubtitleSession(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Subtitle session not found' })
  if (!Array.isArray(session.subtitles) || session.subtitles.length === 0) {
    return res.status(404).json({ error: 'No generated subtitles are available yet' })
  }

  res.type('text/plain; charset=utf-8')
  res.attachment('subtitles.srt')
  res.send(createSrt(session.subtitles))
})

app.get('/subtitle-sessions/:sessionId/compatible-media', (req, res) => {
  const inputPath = activeStreamMedia.get(req.params.sessionId)
  streamBrowserCompatibleVideo(inputPath, req, res)
})

// Upload (or locate) the media once, inspect its embedded audio tracks, and
// wait for the user to choose one before subtitle generation begins.
app.post('/prepare-stream', upload.single('file'), async (req, res) => {
  const uploadedFilePath = req.file?.path
  try {
    let file = req.file
    let ownsUploadedFile = Boolean(req.file)

    if (!file && req.body?.videoPath) {
      const cleaned = cleanLocalPath(req.body.videoPath)
      if (cleaned && fs.existsSync(cleaned)) {
        const stat = fs.statSync(cleaned)
        if (stat.isFile()) {
          file = { path: cleaned, size: stat.size, originalname: path.basename(cleaned) }
          ownsUploadedFile = false
        }
      }
    }

    if (!file) {
      return res.status(400).json({ error: 'No media file or valid file path provided' })
    }

    const audioTracks = await getAudioTracks(file.path)
    const selectedAudioTrack = getSelectedAudioTrackIndex(undefined, audioTracks)
    const session = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'awaiting-audio-selection',
      completed: false,
      fileName: path.basename(file.originalname || file.path || 'media'),
      audioTracks,
      selectedAudioTrack,
      bufferedUntil: 0,
      subtitles: []
    }

    saveSubtitleSession(session)
    preparedStreamMedia.set(session.id, {
      path: file.path,
      size: file.size,
      originalname: file.originalname || path.basename(file.path),
      ownsUploadedFile,
      audioTracks
    })

    res.json({
      sessionId: session.id,
      audioTracks,
      selectedAudioTrack
    })
  } catch (error) {
    if (uploadedFilePath) removeUploadedFile(uploadedFilePath)
    console.error('Prepare stream error:', error)
    res.status(500).json({ error: error.message || 'Unable to inspect media audio tracks' })
  }
})

// Live streaming subtitles SSE endpoint
app.post('/stream-subtitles', upload.single('file'), async (req, res) => {
  let isCancelled = false
  const uploadedFilePath = req.file?.path
  let subtitleSession = null
  let preparedMedia = null

  const cancelStream = () => {
    isCancelled = true
  }

  req.on('aborted', cancelStream)
  res.on('close', cancelStream)

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (res.flushHeaders) res.flushHeaders()

  // Long videos can take a while to prepare before the first subtitle chunk is
  // ready. Keep reverse proxies and browsers from treating the SSE stream as idle.
  const keepAlive = setInterval(() => {
    if (!res.writableEnded && !res.destroyed && res.writable) {
      res.write(': keepalive\n\n')
    }
  }, 15000)

  const sendSSE = (event, data) => {
    if (res.writableEnded || isCancelled || res.destroyed || !res.writable) return
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      // Client disconnected / socket closed
    }
  }

  try {
    const preparedSessionId = String(req.body?.sessionId || '')
    preparedMedia = preparedSessionId ? preparedStreamMedia.get(preparedSessionId) : null
    let file = preparedMedia
      ? {
          path: preparedMedia.path,
          size: preparedMedia.size,
          originalname: preparedMedia.originalname
        }
      : req.file

    if (!file && req.body?.videoPath) {
      const cleaned = cleanLocalPath(req.body.videoPath)
      if (cleaned && fs.existsSync(cleaned)) {
        const stat = fs.statSync(cleaned)
        if (stat.isFile()) {
          file = { path: cleaned, size: stat.size, originalname: path.basename(cleaned) }
        }
      }
    }

    if (!file) {
      sendSSE('error', { message: 'No media file or valid file path provided' })
      res.end()
      return
    }

    const {
      sourceLanguage = 'auto',
      targetLanguage = 'en',
      translationModel = GROQ_TRANSLATION_MODEL
    } = req.body

    const validLanguages = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'hi', 'ar', 'tr', 'ko']
    if (!validLanguages.includes(sourceLanguage) || !validLanguages.includes(targetLanguage)) {
      sendSSE('error', { message: 'Invalid language code' })
      res.end()
      return
    }

    const allowedTranslationModels = [
      GROQ_TRANSLATION_MODEL,
      GROQ_TRANSLATION_MODEL_ALT,
      'openai/gpt-oss-20b',
      'groq/compound-mini',
      'openai/gpt-oss-120b',
      'qwen/qwen3.6-27b'
    ].filter((model, index, list) => model && list.indexOf(model) === index)

    const effectiveTranslationModel = allowedTranslationModels.includes(translationModel)
      ? translationModel
      : GROQ_TRANSLATION_MODEL

    const fallbackTranslationModel = allowedTranslationModels.find((model) => model !== effectiveTranslationModel) || effectiveTranslationModel

    if (!GROQ_API_KEY) {
      sendSSE('error', { message: 'Groq API key not configured in .env' })
      res.end()
      return
    }

    const audioTracks = preparedMedia?.audioTracks || await getAudioTracks(file.path)
    const selectedAudioTrack = getSelectedAudioTrackIndex(req.body?.audioTrack, audioTracks)
    subtitleSession = preparedSessionId ? loadSubtitleSession(preparedSessionId) : null
    if (!subtitleSession) {
      subtitleSession = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        fileName: path.basename(file.originalname || file.path || 'media'),
        bufferedUntil: 0,
        subtitles: []
      }
    }
    subtitleSession.updatedAt = new Date().toISOString()
    subtitleSession.status = 'streaming'
    subtitleSession.completed = false
    subtitleSession.sourceLanguage = sourceLanguage
    subtitleSession.targetLanguage = targetLanguage
    subtitleSession.translationModel = effectiveTranslationModel
    subtitleSession.audioTracks = audioTracks
    subtitleSession.selectedAudioTrack = selectedAudioTrack
    saveSubtitleSession(subtitleSession)
    const compatibleMediaUrl = isSupportedVideoPath(file.originalname || file.path)
      ? `/api/subtitle-sessions/${subtitleSession.id}/compatible-media`
      : null
    if (compatibleMediaUrl) {
      activeStreamMedia.set(subtitleSession.id, file.path)
    }

    console.log(`[Streaming] Source: ${sourceLanguage}, Target: ${targetLanguage}, Model: ${effectiveTranslationModel}`)
    sendSSE('session', {
      sessionId: subtitleSession.id,
      compatibleMediaUrl,
      audioTracks,
      selectedAudioTrack
    })
    sendSSE('status', { stage: 'start', message: 'Starting real-time live subtitle stream...' })

    await generateStreamingSubtitles({
      file,
      audioTrackIndex: selectedAudioTrack,
      sourceLanguage: sourceLanguage === 'auto' ? undefined : sourceLanguage,
      targetLanguage,
      translationModel: effectiveTranslationModel,
      fallbackTranslationModel,
      isCancelled: () => isCancelled,
      onStatus: (status) => sendSSE('status', status),
      onChunk: (chunkData) => {
        subtitleSession.subtitles = mergeSessionSubtitles(subtitleSession.subtitles, chunkData.subtitles)
        subtitleSession.bufferedUntil = Math.max(subtitleSession.bufferedUntil, chunkData.bufferedUntil || 0)
        saveSubtitleSession(subtitleSession)
        sendSSE('subtitles', { ...chunkData, sessionId: subtitleSession.id })
      }
    })

    if (!isCancelled) {
      subtitleSession.status = 'complete'
      subtitleSession.completed = true
      saveSubtitleSession(subtitleSession)
      sendSSE('done', { message: 'All live subtitles streamed successfully' })
    }
  } catch (error) {
    if (!isCancelled && !res.destroyed) {
      console.error('Streaming subtitle error:', error)
      sendSSE('error', { message: error.message || 'An error occurred during streaming' })
    } else {
      console.log('[Streaming] Stream stopped by client.')
    }
  } finally {
    if (subtitleSession && !subtitleSession.completed) {
      subtitleSession.status = isCancelled ? 'stopped' : 'failed'
      saveSubtitleSession(subtitleSession)
    }
    clearInterval(keepAlive)
    if (uploadedFilePath) {
      removeUploadedFile(uploadedFilePath)
    }
    if (preparedMedia) {
      preparedStreamMedia.delete(subtitleSession?.id)
      if (preparedMedia.ownsUploadedFile) removeUploadedFile(preparedMedia.path)
    }
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end()
      } catch { }
    }
  }
})


app.get('/translation-models', (req, res) => {
  const models = [
    { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (Ultra Fast & Accurate)' },
    { value: 'groq/compound-mini', label: 'Groq Compound Mini (Fast & Reliable)' },
    { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (High Quality)' },
    { value: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B' }
  ]

  res.json({
    defaultModel: GROQ_TRANSLATION_MODEL || 'openai/gpt-oss-20b',
    models
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err)

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `File is too large (${MAX_FILE_SIZE_GB} GB max). You can also type/paste the local path directly into the field above to extract instantly without uploading.`
      })
    }
    return res.status(400).json({ error: err.message })
  }

  if (err.message === 'Please upload a supported audio or video file') {
    return res.status(400).json({ error: err.message })
  }

  res.status(500).json({ error: 'Internal server error' })
})

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Max upload file size: ${MAX_FILE_SIZE_GB} GB`)
  console.log('Press Ctrl+C to stop the server')

  if (!GROQ_API_KEY) {
    console.warn('\n⚠️  WARNING: GROQ_API_KEY is not set in .env file')
    console.warn('The app will not work without it. Please add your Groq API key to .env\n')
  }
})

// Configure generous timeouts for large video files (movies up to 15GB)
server.timeout = 3600000 // 1 hour
server.keepAliveTimeout = 65000
if (server.requestTimeout !== undefined) {
  server.requestTimeout = 3600000
}
