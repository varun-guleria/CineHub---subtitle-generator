import React, { useState, useRef, useEffect, useMemo } from 'react'
import axios from 'axios'
import './SubtitleGenerator.css'

const formatTime = (seconds, format = 'srt') => {
  const num = Number(seconds)
  if (!Number.isFinite(num) || num < 0) return format === 'vtt' ? '00:00:00.000' : '00:00:00,000'
  const hours = Math.floor(num / 3600)
  const minutes = Math.floor((num % 3600) / 60)
  const secs = Math.floor(num % 60)
  const ms = Math.floor((num % 1) * 1000)
  const sep = format === 'vtt' ? '.' : ','
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`
}

const parseTimeToSeconds = (str) => {
  if (!str) return 0
  const normalized = str.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0
    const m = parseFloat(parts[1]) || 0
    const s = parseFloat(parts[2]) || 0
    return h * 3600 + m * 60 + s
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0
    const s = parseFloat(parts[1]) || 0
    return m * 60 + s
  }
  return parseFloat(normalized) || 0
}

const mergeSubtitles = (existing = [], incoming = []) => {
  const unique = new Map()
  for (const subtitle of [...existing, ...incoming]) {
    const start = Number(subtitle?.start)
    const end = Number(subtitle?.end)
    const text = String(subtitle?.text || '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue
    unique.set(`${start.toFixed(3)}|${end.toFixed(3)}|${text}`, { start, end, text })
  }
  return [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end)
}

const audioLanguageNames = {
  ara: 'Arabic', ar: 'Arabic',
  deu: 'German', de: 'German',
  eng: 'English', en: 'English',
  fra: 'French', fr: 'French',
  hin: 'Hindi', hi: 'Hindi',
  ita: 'Italian', it: 'Italian',
  jpn: 'Japanese', ja: 'Japanese',
  kor: 'Korean', ko: 'Korean',
  por: 'Portuguese', pt: 'Portuguese',
  rus: 'Russian', ru: 'Russian',
  spa: 'Spanish', es: 'Spanish',
  tur: 'Turkish', tr: 'Turkish',
  urd: 'Urdu', ur: 'Urdu',
  zho: 'Chinese', chi: 'Chinese', zh: 'Chinese',
  und: 'Unknown language'
}

const SubtitleGenerator = () => {
  // Media & State
  const [file, setFile] = useState(null)
  const [mediaUrl, setMediaUrl] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [aspectRatio, setAspectRatio] = useState('16:9') // '16:9', '9:16', '1:1'
  const [subtitleStyle, setSubtitleStyle] = useState('standard') // 'standard', 'yellow', 'boxed'

  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [videoPath, setVideoPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [useExtractedLoading, setUseExtractedLoading] = useState(false)
  const [subtitles, setSubtitles] = useState(null)
  const [extractResult, setExtractResult] = useState(null)
  const [error, setError] = useState(null)
  const [extractError, setExtractError] = useState(null)
  const [useExtractedError, setUseExtractedError] = useState(null)

  const [translationModels, setTranslationModels] = useState([])
  const [translationModel, setTranslationModel] = useState('')
  const [modelLoading, setModelLoading] = useState(true)
  const [modelError, setModelError] = useState(null)

  const [localVideoFile, setLocalVideoFile] = useState(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffering, setStreamBuffering] = useState(false)
  const [streamingStatus, setStreamingStatus] = useState(null)
  const [bufferedUntil, setBufferedUntil] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isDirectVideoFullscreen, setIsDirectVideoFullscreen] = useState(false)
  const [vttUrl, setVttUrl] = useState(null)
  const [localVideoDetails, setLocalVideoDetails] = useState(null)
  const [selectedVideoName, setSelectedVideoName] = useState('')
  const [subtitleSessionId, setSubtitleSessionId] = useState(null)
  const [isBrowsing, setIsBrowsing] = useState(false)

  // Editor Filter & View Options
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('editor') // 'editor', 'extract', 'settings'
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [editingSegmentIndex, setEditingSegmentIndex] = useState(null)

  // Refs
  const fileInputRef = useRef(null)
  const localVideoInputRef = useRef(null)
  const mediaRef = useRef(null)
  const videoWrapperRef = useRef(null)
  const activeSubtitleRef = useRef(null)
  const subtitleListRef = useRef(null)
  const abortControllerRef = useRef(null)
  const stopRequestedRef = useRef(false)

  const languages = [
    { code: 'auto', name: 'Auto Detect' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'zh', name: 'Chinese' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ar', name: 'Arabic' },
    { code: 'tr', name: 'Turkish' },
    { code: 'ko', name: 'Korean' },
  ]

  const supportedMediaExtensions = [
    '.aac', '.aiff', '.avi', '.flac', '.m4a', '.m4v', '.mkv',
    '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.ogg', '.wav', '.webm', '.wma'
  ]

  const supportedVideoExtensions = [
    '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm'
  ]

  const isSupportedVideoPath = (path) => {
    if (!path || typeof path !== 'string') return false
    const lower = path.trim().toLowerCase()
    return supportedVideoExtensions.some((ext) => lower.endsWith(ext))
  }

  const isSupportedMediaFile = (selectedFile) => {
    if (!selectedFile) return false
    const mimeType = selectedFile.type || ''
    const fileName = selectedFile.name.toLowerCase()
    return (
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      supportedMediaExtensions.some((ext) => fileName.endsWith(ext))
    )
  }

  const isVideoFile = (selectedFile) => {
    if (!selectedFile) return false
    const mimeType = selectedFile.type || ''
    const fileName = selectedFile.name.toLowerCase()
    return (
      mimeType.startsWith('video/') ||
      supportedVideoExtensions.some((ext) => fileName.endsWith(ext))
    )
  }

  const isCurrentMediaVideo =
    isVideoFile(file) ||
    isVideoFile(localVideoFile) ||
    Boolean(localVideoDetails) ||
    Boolean(videoPath.trim() && supportedVideoExtensions.some(ext => videoPath.trim().toLowerCase().endsWith(ext)))

  useEffect(() => {
    if (videoPath && isSupportedVideoPath(videoPath)) {
      setMediaUrl(`/api/stream-local-video?path=${encodeURIComponent(videoPath.trim())}`)
      return
    }

    if (localVideoFile && isVideoFile(localVideoFile)) {
      const url = URL.createObjectURL(localVideoFile)
      setMediaUrl(url)
      return () => URL.revokeObjectURL(url)
    }

    if (file) {
      const url = URL.createObjectURL(file)
      setMediaUrl(url)
      return () => URL.revokeObjectURL(url)
    }

    setMediaUrl(null)
  }, [file, localVideoFile, videoPath])

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/translation-models')
        if (response.data.success && response.data.models) {
          setTranslationModels(response.data.models)
          if (response.data.models.length > 0) {
            setTranslationModel(response.data.models[0].value)
          }
        }
      } catch (err) {
        console.error('Failed to fetch translation models:', err)
        setModelError('Failed to load translation models')
      } finally {
        setModelLoading(false)
      }
    }

    fetchModels()
  }, [])

  useEffect(() => {
    if (!subtitles || subtitles.length === 0) {
      if (vttUrl) {
        URL.revokeObjectURL(vttUrl)
        setVttUrl(null)
      }
      return
    }

    let vttContent = 'WEBVTT\n\n'
    subtitles.forEach((item) => {
      vttContent += `${formatTime(item.start, 'vtt')} --> ${formatTime(item.end, 'vtt')}\n`
      vttContent += `${item.text}\n\n`
    })

    const blob = new Blob([vttContent], { type: 'text/vtt' })
    const url = URL.createObjectURL(blob)
    setVttUrl(url)

    return () => URL.revokeObjectURL(url)
  }, [subtitles])

  // Keyboard Navigation & Studio Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger hotkeys if typing in input/textarea/select
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return
      }

      if (e.code === 'Space' && mediaRef.current) {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'ArrowLeft' && mediaRef.current) {
        e.preventDefault()
        seekRelative(-5)
      } else if (e.key === 'ArrowRight' && mediaRef.current) {
        e.preventDefault()
        seekRelative(5)
      } else if (e.key === ',' && mediaRef.current) {
        e.preventDefault()
        seekRelative(-0.04) // Frame back
      } else if (e.key === '.' && mediaRef.current) {
        e.preventDefault()
        seekRelative(0.04) // Frame forward
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowShortcuts((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mediaUrl, isPlaying])

  const handleMediaMetadata = () => {
    if (mediaRef.current && mediaRef.current.duration) {
      setTotalDuration(mediaRef.current.duration)
    }
  }

  const makeMediaAudible = () => {
    if (mediaRef.current) {
      mediaRef.current.muted = false
      mediaRef.current.volume = 1.0
      setIsPlaying(true)
    }
  }

  const togglePlayPause = () => {
    if (!mediaRef.current) return
    if (mediaRef.current.paused) {
      mediaRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      mediaRef.current.pause()
      setIsPlaying(false)
    }
  }

  const seekRelative = (seconds) => {
    if (!mediaRef.current) return
    const newTime = Math.max(0, Math.min(totalDuration || Infinity, mediaRef.current.currentTime + seconds))
    mediaRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handlePlaybackSpeedChange = (speed) => {
    setPlaybackSpeed(speed)
    if (mediaRef.current) {
      mediaRef.current.playbackRate = speed
    }
  }

  const handleToggleFullscreen = () => {
    if (!videoWrapperRef.current) return

    if (!document.fullscreenElement) {
      videoWrapperRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch((err) => {
        console.warn('Error entering fullscreen:', err)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch((err) => {
        console.warn('Error exiting fullscreen:', err)
      })
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      setIsDirectVideoFullscreen(active && document.fullscreenElement === mediaRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0]
    if (selectedFile) {
      if (!isSupportedMediaFile(selectedFile)) {
        setError('Unsupported format. Please select an audio or video file.')
        return
      }

      setFile(selectedFile)
      setLocalVideoFile(null)
      setVideoPath('')
      setLocalVideoDetails(null)
      setSelectedVideoName(selectedFile.name)
      setError(null)
      setSubtitles(null)
      setSubtitleSessionId(null)
      setExtractResult(null)
    }
  }

  const handleDragDrop = (e) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      if (!isSupportedMediaFile(droppedFile)) {
        setError('Unsupported format. Please select an audio or video file.')
        return
      }

      setFile(droppedFile)
      setLocalVideoFile(null)
      setVideoPath('')
      setLocalVideoDetails(null)
      setSelectedVideoName(droppedFile.name)
      setError(null)
      setSubtitles(null)
      setSubtitleSessionId(null)
      setExtractResult(null)
    }
  }

  const handleLocalVideoPick = (e) => {
    const selectedFile = e.target.files[0]
    if (selectedFile) {
      setLocalVideoFile(selectedFile)
      setFile(null)
      setSelectedVideoName(selectedFile.name)

      if (selectedFile.path) {
        setVideoPath(selectedFile.path)
        setLocalVideoDetails({
          fileName: selectedFile.name,
          filePath: selectedFile.path,
          sizeMB: (selectedFile.size / 1024 / 1024).toFixed(2),
          sizeGB: (selectedFile.size / 1024 / 1024 / 1024).toFixed(2),
        })
      } else {
        setVideoPath('')
        setLocalVideoDetails({
          fileName: selectedFile.name,
          filePath: null,
          sizeMB: (selectedFile.size / 1024 / 1024).toFixed(2),
          sizeGB: (selectedFile.size / 1024 / 1024 / 1024).toFixed(2),
        })
      }

      setError(null)
      setSubtitles(null)
      setSubtitleSessionId(null)
      setExtractResult(null)
    }
  }

  const handleBrowseLocalFile = async () => {
    setIsBrowsing(true)
    try {
      const response = await axios.post('/api/browse-local-file')
      if (response.data.success && response.data.filePath) {
        const path = response.data.filePath
        setVideoPath(path)
        setFile(null)
        setLocalVideoFile(null)
        setSelectedVideoName(response.data.fileName || path.split(/[\/\\]/).pop())
        setLocalVideoDetails({
          fileName: response.data.fileName || path.split(/[\/\\]/).pop(),
          filePath: path,
          sizeMB: response.data.sizeMB,
          sizeGB: response.data.sizeGB,
        })
        setError(null)
        setSubtitles(null)
        setSubtitleSessionId(null)
        setExtractResult(null)
      }
    } catch (err) {
      if (localVideoInputRef.current) {
        localVideoInputRef.current.click()
      }
    } finally {
      setIsBrowsing(false)
    }
  }

  const handleExtractAudio = async () => {
    if (!videoPath.trim() && !file && !localVideoFile) {
      setExtractError('Please select a file or provide a video path first')
      return
    }

    setExtracting(true)
    setExtractError(null)
    setExtractResult(null)

    try {
      let response
      if (videoPath.trim()) {
        response = await axios.post('/api/extract-audio', { videoPath: videoPath.trim() })
      } else if (file || localVideoFile) {
        const formData = new FormData()
        formData.append('file', file || localVideoFile)
        response = await axios.post('/api/extract-audio', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      if (response && response.data.success) {
        setExtractResult(response.data)
      } else {
        setExtractError(response?.data?.error || 'Extraction failed')
      }
    } catch (err) {
      setExtractError(err.response?.data?.error || err.message || 'Failed to extract audio')
    } finally {
      setExtracting(false)
    }
  }

  const downloadExtractedAudio = (result) => {
    if (!result || !result.audioFileName) return
    const element = document.createElement('a')
    element.href = `/api/download-extracted-audio?file=${encodeURIComponent(result.audioFileName)}`
    element.setAttribute('download', result.audioFileName)
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  const useExtractedAudioForSubtitles = async (result) => {
    if (!result || !result.audioFileName) return

    setUseExtractedLoading(true)
    setUseExtractedError(null)

    try {
      const response = await axios.post('/api/generate-subtitles-from-extracted', {
        audioFileName: result.audioFileName,
        sourceLanguage,
        targetLanguage,
        model: translationModel,
      })

      if (response.data.success) {
        setSubtitles(response.data.subtitles)
        if (response.data.sessionId) setSubtitleSessionId(response.data.sessionId)
      } else {
        setUseExtractedError(response.data.error || 'Failed to generate subtitles')
      }
    } catch (err) {
      setUseExtractedError(err.response?.data?.error || err.message || 'Failed to generate subtitles')
    } finally {
      setUseExtractedLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()

    if (!file && !localVideoFile && !videoPath.trim()) {
      setError('Please select an audio/video file or enter a local video path.')
      return
    }

    setLoading(true)
    setError(null)
    setSubtitles(null)
    setSubtitleSessionId(null)

    try {
      let response
      if (videoPath.trim()) {
        response = await axios.post('/api/generate-subtitles-path', {
          videoPath: videoPath.trim(),
          sourceLanguage,
          targetLanguage,
          model: translationModel,
        })
      } else {
        const formData = new FormData()
        formData.append('file', file || localVideoFile)
        formData.append('sourceLanguage', sourceLanguage)
        formData.append('targetLanguage', targetLanguage)
        formData.append('model', translationModel)

        response = await axios.post('/api/generate-subtitles', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      if (response.data.success) {
        setSubtitles(response.data.subtitles)
        if (response.data.sessionId) setSubtitleSessionId(response.data.sessionId)
      } else {
        setError(response.data.error || 'Failed to generate subtitles.')
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'An error occurred during subtitle generation.')
    } finally {
      setLoading(false)
    }
  }

  const handleStartStreaming = async () => {
    if (!file && !localVideoFile && !videoPath.trim()) {
      setError('Please select an audio/video file or enter a local video path.')
      return
    }

    setIsStreaming(true)
    setStreamBuffering(true)
    setStreamingStatus('Initializing live subtitle generator...')
    setError(null)
    setSubtitles(null)
    setBufferedUntil(0)
    setSubtitleSessionId(null)
    stopRequestedRef.current = false

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    let reader = null

    try {
      let response
      if (videoPath.trim()) {
        response = await fetch('/api/stream-subtitles-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: videoPath.trim(),
            sourceLanguage,
            targetLanguage,
            model: translationModel,
          }),
          signal: abortController.signal,
        })
      } else {
        const formData = new FormData()
        formData.append('file', file || localVideoFile)
        formData.append('sourceLanguage', sourceLanguage)
        formData.append('targetLanguage', targetLanguage)
        formData.append('model', translationModel)

        response = await fetch('/api/stream-subtitles', {
          method: 'POST',
          body: formData,
          signal: abortController.signal,
        })
      }

      if (!response.ok) {
        let errMessage = 'Failed to start live stream'
        try {
          const errData = await response.json()
          errMessage = errData.error || errData.message || errMessage
        } catch {}
        throw new Error(errMessage)
      }

      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          if (!block.trim()) continue

          let eventType = 'message'
          let dataStr = ''

          const lines = block.split('\n')
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.replace('event:', '').trim()
            } else if (line.startsWith('data:')) {
              dataStr += line.replace('data:', '').trim()
            }
          }

          if (!dataStr) continue

          try {
            const parsed = JSON.parse(dataStr)

            if (eventType === 'session') {
              const sessionId = parsed.sessionId || null
              setSubtitleSessionId(sessionId)
              if (sessionId) {
                window.localStorage.setItem('subtitle-generator:last-session-id', sessionId)
              }
              if (parsed.compatibleMediaUrl && isCurrentMediaVideo) {
                setMediaUrl(parsed.compatibleMediaUrl)
              }
            } else if (eventType === 'status') {
              setStreamingStatus(parsed.message || 'Processing live subtitles...')
              if (parsed.totalDuration) {
                setTotalDuration(parsed.totalDuration)
              }
            } else if (eventType === 'subtitles') {
              if (Array.isArray(parsed.subtitles) && parsed.subtitles.length > 0) {
                setSubtitles((prev) => mergeSubtitles(prev || [], parsed.subtitles))
              }
              if (parsed.sessionId) setSubtitleSessionId(parsed.sessionId)
              if (typeof parsed.bufferedUntil === 'number') setBufferedUntil(parsed.bufferedUntil)

              if (parsed.initialBufferReady) {
                setStreamBuffering(false)
                setStreamingStatus(`Live subtitles active! Buffered through ${formatTime(parsed.bufferedUntil)}`)
                if (mediaRef.current && mediaRef.current.paused) {
                  mediaRef.current.play().catch(() => {})
                }
              } else {
                setStreamingStatus(`Generating next subtitle chunk... Buffered through ${formatTime(parsed.bufferedUntil)}`)
              }
            } else if (eventType === 'done') {
              setStreamingStatus('Complete! All subtitles generated.')
              setIsStreaming(false)
              setStreamBuffering(false)
            } else if (eventType === 'error') {
              if (!stopRequestedRef.current && !abortController.signal.aborted) {
                setError(parsed.message || 'Error occurred during streaming')
              }
              setIsStreaming(false)
              setStreamBuffering(false)
            }
          } catch (parseErr) {
            console.warn('Could not parse SSE message:', dataStr, parseErr)
          }
        }
      }
    } catch (err) {
      const isAborted =
        stopRequestedRef.current ||
        abortController.signal.aborted ||
        err.name === 'AbortError' ||
        String(err.message || '').toLowerCase().includes('abort') ||
        String(err.message || '').toLowerCase().includes('cancel')

      if (isAborted) {
        setStreamingStatus('Live subtitle stream stopped.')
        setError(null)
      } else {
        setError(err.message || 'Failed to stream subtitles')
        console.error('Streaming error:', err)
      }
    } finally {
      if (reader) {
        try { await reader.cancel() } catch {}
      }
      setIsStreaming(false)
      setStreamBuffering(false)
      stopRequestedRef.current = false
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
    }
  }

  const handleStopStreaming = () => {
    stopRequestedRef.current = true
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
    setStreamBuffering(false)
    setStreamingStatus('Live streaming stopped.')
    setError(null)
    if (mediaRef.current && !mediaRef.current.paused) {
      mediaRef.current.pause()
    }
  }

  const downloadSubtitles = (format = 'srt') => {
    if (!subtitles) return

    if (format === 'srt' && subtitleSessionId) {
      const element = document.createElement('a')
      element.href = `/api/subtitle-sessions/${encodeURIComponent(subtitleSessionId)}/srt`
      element.setAttribute('download', `${selectedVideoName || 'subtitles'}.srt`)
      element.style.display = 'none'
      document.body.appendChild(element)
      element.click()
      document.body.removeChild(element)
      return
    }

    let content = ''
    let filename = `${selectedVideoName || 'subtitles'}.${format}`

    if (format === 'srt') {
      subtitles.forEach((item, index) => {
        content += `${index + 1}\n`
        content += `${formatTime(item.start, 'srt')} --> ${formatTime(item.end, 'srt')}\n`
        content += `${item.text}\n\n`
      })
    } else if (format === 'vtt') {
      content = 'WEBVTT\n\n'
      subtitles.forEach((item) => {
        content += `${formatTime(item.start, 'vtt')} --> ${formatTime(item.end, 'vtt')}\n`
        content += `${item.text}\n\n`
      })
    } else if (format === 'txt') {
      subtitles.forEach((item) => {
        content += `${item.text}\n`
      })
      filename = `${selectedVideoName || 'transcript'}.txt`
    }

    const element = document.createElement('a')
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content))
    element.setAttribute('download', filename)
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  const handleSeek = (startTime) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = startTime
      setCurrentTime(startTime)
      mediaRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
    }
  }

  const handleUpdateSubtitleText = (index, newText) => {
    setSubtitles((prev) => {
      if (!prev) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], text: newText }
      return updated
    })
  }

  const handleUpdateSubtitleTime = (index, field, value) => {
    const seconds = parseTimeToSeconds(value)
    setSubtitles((prev) => {
      if (!prev) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: seconds }
      return updated.sort((a, b) => a.start - b.start)
    })
  }

  const handleDeleteSegment = (index) => {
    setSubtitles((prev) => {
      if (!prev) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setFile(null)
    setLocalVideoFile(null)
    setVideoPath('')
    setLocalVideoDetails(null)
    setSelectedVideoName('')
    setSubtitles(null)
    setMediaUrl(null)
    setCurrentTime(0)
    setBufferedUntil(0)
    setStreamingStatus(null)
    setIsStreaming(false)
    setStreamBuffering(false)
    setSubtitleSessionId(null)
    setExtractResult(null)
    setError(null)
    setExtractError(null)
    setUseExtractedError(null)
    window.localStorage.removeItem('subtitle-generator:last-session-id')
  }

  const activeSubtitle = subtitles?.find(
    (sub) => currentTime >= sub.start && currentTime <= sub.end
  )

  // Filtered Subtitles for Search
  const filteredSubtitles = useMemo(() => {
    if (!subtitles) return []
    if (!searchQuery.trim()) return subtitles
    const q = searchQuery.toLowerCase()
    return subtitles.filter(
      (sub) =>
        sub.text.toLowerCase().includes(q) ||
        formatTime(sub.start).includes(q) ||
        formatTime(sub.end).includes(q)
    )
  }, [subtitles, searchQuery])

  // Scroll active subtitle into view
  useEffect(() => {
    if (activeSubtitle && activeSubtitleRef.current && subtitleListRef.current) {
      activeSubtitleRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [activeSubtitle])

  return (
    <div className="subtitle-generator studio-workspace">
      {/* ───────────────────────────────────────────────────────────
         STUDIO COMMAND BAR (Compact Top App Bar)
         ─────────────────────────────────────────────────────────── */}
      <header className="studio-topbar">
        <div className="topbar-left">
          <div className="studio-brand-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
              <path d="M7 10h5M7 13h10" stroke="#00d4a0" />
            </svg>
            <span className="studio-brand-name">CineHub Studio</span>
          </div>

          <div className="topbar-divider" />

          <div className="topbar-media-spec">
            <span className={`spec-dot ${mediaUrl ? 'active' : ''}`} />
            <span className="spec-filename" title={selectedVideoName || 'No media loaded'}>
              {selectedVideoName || (videoPath ? videoPath.split(/[\/\\]/).pop() : 'No Media File Loaded')}
            </span>
            {totalDuration > 0 && (
              <span className="spec-duration">{formatTime(totalDuration)}</span>
            )}
          </div>
        </div>

        <div className="topbar-center">
          <div className="topbar-mode-switcher">
            <button
              type="button"
              className={`mode-btn ${activeTab === 'editor' ? 'active' : ''}`}
              onClick={() => setActiveTab('editor')}
            >
              <span>🎬 Studio Editor</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${activeTab === 'extract' ? 'active' : ''}`}
              onClick={() => setActiveTab('extract')}
            >
              <span>⚡ Audio Extract</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <span>⚙ Settings</span>
            </button>
          </div>
        </div>

        <div className="topbar-right">
          {subtitles && subtitles.length > 0 && (
            <div className="topbar-export-group">
              <button
                type="button"
                className="topbar-btn secondary"
                onClick={() => downloadSubtitles('srt')}
                title="Export SRT Format"
              >
                Export .SRT
              </button>
              <button
                type="button"
                className="topbar-btn secondary"
                onClick={() => downloadSubtitles('vtt')}
                title="Export VTT Format"
              >
                Export .VTT
              </button>
            </div>
          )}

          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard Shortcuts (?)"
          >
            ⌨ Hotkeys
          </button>
        </div>
      </header>

      {/* ───────────────────────────────────────────────────────────
         STUDIO MAIN WORKBENCH GRID
         ─────────────────────────────────────────────────────────── */}
      <main className="studio-workbench">
        {activeTab === 'editor' && (
          <div className="workbench-editor-layout">
            {/* Left Pane: Media Monitor Stage */}
            <section className="workbench-stage-pane">
              <div className="stage-header">
                <div className="stage-title">
                  <span className="stage-badge">MONITOR</span>
                  <h3>Video Preview Stage</h3>
                </div>
                <div className="stage-controls-mini">
                  {/* Aspect Ratio Toggle */}
                  <div className="mini-segmented">
                    <button
                      type="button"
                      className={aspectRatio === '16:9' ? 'active' : ''}
                      onClick={() => setAspectRatio('16:9')}
                      title="Landscape 16:9"
                    >
                      16:9
                    </button>
                    <button
                      type="button"
                      className={aspectRatio === '9:16' ? 'active' : ''}
                      onClick={() => setAspectRatio('9:16')}
                      title="Shorts/Reels 9:16"
                    >
                      9:16
                    </button>
                    <button
                      type="button"
                      className={aspectRatio === '1:1' ? 'active' : ''}
                      onClick={() => setAspectRatio('1:1')}
                      title="Square 1:1"
                    >
                      1:1
                    </button>
                  </div>

                  {/* Subtitle Style Switcher */}
                  <select
                    className="mini-select"
                    value={subtitleStyle}
                    onChange={(e) => setSubtitleStyle(e.target.value)}
                    title="Overlay Subtitle Style"
                  >
                    <option value="standard">Standard Subtitle</option>
                    <option value="yellow">Cinema Yellow</option>
                    <option value="boxed">Solid Dark Box</option>
                  </select>

                  {isCurrentMediaVideo && (
                    <button
                      type="button"
                      className="stage-fullscreen-btn"
                      onClick={handleToggleFullscreen}
                      title="Fullscreen (F)"
                    >
                      ⛶
                    </button>
                  )}
                </div>
              </div>

              {/* Video Player Display Container */}
              <div className={`video-stage-viewport aspect-${aspectRatio}`}>
                {mediaUrl ? (
                  isCurrentMediaVideo ? (
                    <div ref={videoWrapperRef} className="video-player-wrapper">
                      <video
                        ref={mediaRef}
                        src={mediaUrl}
                        controls
                        crossOrigin="anonymous"
                        onLoadedMetadata={handleMediaMetadata}
                        onPlay={makeMediaAudible}
                        onPause={() => setIsPlaying(false)}
                        onTimeUpdate={() => setCurrentTime(mediaRef.current?.currentTime || 0)}
                        onDoubleClick={handleToggleFullscreen}
                        className="media-player video-player"
                      >
                        {vttUrl && (
                          <track
                            key={vttUrl}
                            kind="subtitles"
                            label="Studio Subtitles"
                            src={vttUrl}
                            default
                          />
                        )}
                      </video>

                      {/* Studio Interactive Subtitle Overlay */}
                      {activeSubtitle && !isDirectVideoFullscreen && (
                        <div className={`studio-subtitle-overlay style-${subtitleStyle}`}>
                          <span>{activeSubtitle.text}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="audio-stage-wrapper">
                      <div className="audio-waveform-visualizer">
                        <div className="waveform-bar" style={{ height: '40%' }}></div>
                        <div className="waveform-bar" style={{ height: '70%' }}></div>
                        <div className="waveform-bar" style={{ height: '100%' }}></div>
                        <div className="waveform-bar" style={{ height: '60%' }}></div>
                        <div className="waveform-bar" style={{ height: '85%' }}></div>
                        <div className="waveform-bar" style={{ height: '30%' }}></div>
                        <div className="waveform-bar" style={{ height: '90%' }}></div>
                      </div>
                      <audio
                        ref={mediaRef}
                        src={mediaUrl}
                        controls
                        onLoadedMetadata={handleMediaMetadata}
                        onPlay={makeMediaAudible}
                        onPause={() => setIsPlaying(false)}
                        onTimeUpdate={() => setCurrentTime(mediaRef.current?.currentTime || 0)}
                        className="media-player audio-player"
                      />
                      {activeSubtitle && (
                        <div className={`studio-subtitle-overlay style-${subtitleStyle}`}>
                          <span>{activeSubtitle.text}</span>
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="empty-stage-placeholder" onClick={() => fileInputRef.current?.click()}>
                    <div className="empty-stage-icon">🎬</div>
                    <h4>No Media File Loaded</h4>
                    <p>Click to browse audio/video or drag and drop a file into the studio</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,video/*,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.webm"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>

              {/* Studio Transport Control Deck */}
              {mediaUrl && (
                <div className="studio-transport-deck">
                  <div className="transport-timecode-display">
                    <span className="time-current">{formatTime(currentTime)}</span>
                    <span className="time-separator">/</span>
                    <span className="time-total">{formatTime(totalDuration)}</span>
                  </div>

                  <div className="transport-center-controls">
                    <button
                      type="button"
                      className="transport-btn"
                      onClick={() => seekRelative(-5)}
                      title="Rewind 5s (←)"
                    >
                      ↺ 5s
                    </button>
                    <button
                      type="button"
                      className="transport-btn"
                      onClick={() => seekRelative(-0.04)}
                      title="Frame Back (,)"
                    >
                      ⏮ Frame
                    </button>
                    <button
                      type="button"
                      className="transport-btn play-btn"
                      onClick={togglePlayPause}
                      title="Play/Pause (Space)"
                    >
                      {isPlaying ? '⏸ Pause' : '▶ Play'}
                    </button>
                    <button
                      type="button"
                      className="transport-btn"
                      onClick={() => seekRelative(0.04)}
                      title="Frame Forward (.)"
                    >
                      Frame ⏭
                    </button>
                    <button
                      type="button"
                      className="transport-btn"
                      onClick={() => seekRelative(5)}
                      title="Forward 5s (→)"
                    >
                      5s ↻
                    </button>
                  </div>

                  <div className="transport-speed-selector">
                    <span className="speed-label">Speed:</span>
                    {[0.5, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        className={`speed-btn ${playbackSpeed === rate ? 'active' : ''}`}
                        onClick={() => handlePlaybackSpeedChange(rate)}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Buffer Streaming Progress Bar */}
              {(isStreaming || bufferedUntil > 0) && (
                <div className="studio-buffer-bar">
                  <div className="buffer-meta">
                    <span className="buffer-status-badge">{isStreaming ? '⚡ STREAMING' : '✓ SYNCED'}</span>
                    <span className="buffer-status-text">
                      {streamingStatus || `Buffered through ${formatTime(bufferedUntil)}`}
                    </span>
                  </div>
                  <div className="buffer-track-bg">
                    <div
                      className="buffer-fill"
                      style={{
                        width: totalDuration > 0
                          ? `${Math.min(100, (bufferedUntil / totalDuration) * 100)}%`
                          : '100%',
                      }}
                    />
                    <div
                      className="buffer-playhead"
                      style={{
                        left: totalDuration > 0
                          ? `${Math.min(100, (currentTime / totalDuration) * 100)}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Engine Trigger & Controls */}
              <div className="studio-engine-dock">
                <div className="engine-selectors">
                  <div className="engine-field">
                    <label>Source Language</label>
                    <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
                      {languages.map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="engine-field">
                    <label>Target Language</label>
                    <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
                      {languages.filter((l) => l.code !== 'auto').map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="engine-field">
                    <label>AI Model Engine</label>
                    <select
                      value={translationModel}
                      onChange={(e) => setTranslationModel(e.target.value)}
                      disabled={modelLoading}
                    >
                      {translationModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {error && <div className="studio-error-banner">⚠️ {error}</div>}

                <div className="engine-actions-row">
                  <button
                    type="button"
                    className="studio-btn primary-live"
                    onClick={handleStartStreaming}
                    disabled={loading || isStreaming || (!file && !localVideoFile && !videoPath.trim())}
                  >
                    {isStreaming ? '⚡ Streaming Subtitles...' : '▶ Stream Live Subtitles'}
                  </button>

                  <button
                    type="button"
                    className="studio-btn secondary-batch"
                    onClick={handleSubmit}
                    disabled={loading || isStreaming || (!file && !localVideoFile && !videoPath.trim())}
                  >
                    {loading ? '⏳ Processing Batch...' : '📥 Batch Transcribe SRT'}
                  </button>

                  {isStreaming && (
                    <button type="button" className="studio-btn danger" onClick={handleStopStreaming}>
                      ⏹ Stop Stream
                    </button>
                  )}

                  {(file || localVideoFile || videoPath.trim()) && !loading && !isStreaming && (
                    <button type="button" className="studio-btn text-only" onClick={handleReset}>
                      🔄 Clear Media
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Right Pane: Subtitle Track Timeline & Editor */}
            <section className="workbench-editor-pane">
              <div className="editor-pane-header">
                <div className="editor-title">
                  <span className="stage-badge">TIMELINE</span>
                  <h3>Subtitles & Track Editor</h3>
                  <span className="subtitle-count-badge">{subtitles ? subtitles.length : 0} Segments</span>
                </div>

                <div className="editor-search-box">
                  <input
                    type="text"
                    placeholder="Search subtitles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button type="button" className="clear-search" onClick={() => setSearchQuery('')}>
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive Timeline Track Overview */}
              {subtitles && subtitles.length > 0 && totalDuration > 0 && (
                <div className="studio-timeline-scrubber">
                  <div className="timeline-track">
                    {subtitles.map((sub, idx) => {
                      const leftPct = (sub.start / totalDuration) * 100
                      const widthPct = Math.max(0.5, ((sub.end - sub.start) / totalDuration) * 100)
                      const isActive = currentTime >= sub.start && currentTime <= sub.end
                      return (
                        <div
                          key={idx}
                          className={`timeline-segment-block ${isActive ? 'active' : ''}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          onClick={() => handleSeek(sub.start)}
                          title={`${formatTime(sub.start)}: ${sub.text}`}
                        />
                      )
                    })}
                    <div
                      className="timeline-playhead-line"
                      style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Segment List Editor */}
              <div ref={subtitleListRef} className="studio-subtitle-list">
                {filteredSubtitles && filteredSubtitles.length > 0 ? (
                  filteredSubtitles.map((subtitle, index) => {
                    const isActive = currentTime >= subtitle.start && currentTime <= subtitle.end
                    const duration = Math.max(0.1, subtitle.end - subtitle.start)
                    const charCount = subtitle.text.length
                    const cps = (charCount / duration).toFixed(1)
                    const isCpsHigh = cps > 20

                    return (
                      <div
                        key={index}
                        ref={isActive ? activeSubtitleRef : null}
                        className={`subtitle-editor-card ${isActive ? 'active' : ''}`}
                      >
                        <div className="card-top-row">
                          <span className="segment-index">#{index + 1}</span>

                          <div className="timecode-inputs">
                            <input
                              type="text"
                              className="timecode-input"
                              value={formatTime(subtitle.start)}
                              onChange={(e) => handleUpdateSubtitleTime(index, 'start', e.target.value)}
                              title="Start timecode"
                            />
                            <span className="time-arrow">→</span>
                            <input
                              type="text"
                              className="timecode-input"
                              value={formatTime(subtitle.end)}
                              onChange={(e) => handleUpdateSubtitleTime(index, 'end', e.target.value)}
                              title="End timecode"
                            />
                            <span className="duration-tag">{duration.toFixed(2)}s</span>
                          </div>

                          <div className="card-actions-row">
                            <span className={`cps-badge ${isCpsHigh ? 'warning' : ''}`} title="Characters per second (CPS)">
                              {cps} cps
                            </span>
                            <button
                              type="button"
                              className="card-action-btn seek"
                              onClick={() => handleSeek(subtitle.start)}
                              title="Jump player to segment start"
                            >
                              ▶ Jump
                            </button>
                            <button
                              type="button"
                              className="card-action-btn delete"
                              onClick={() => handleDeleteSegment(index)}
                              title="Delete segment"
                            >
                              🗑
                            </button>
                          </div>
                        </div>

                        <div className="card-body-row">
                          <textarea
                            className="subtitle-text-editor"
                            value={subtitle.text}
                            rows={Math.max(1, Math.ceil(subtitle.text.length / 45))}
                            onChange={(e) => handleUpdateSubtitleText(index, e.target.value)}
                            placeholder="Type subtitle line..."
                          />
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="empty-subtitles-state">
                    <div className="empty-sub-icon">📝</div>
                    <h4>No Subtitle Track Generated Yet</h4>
                    <p>Select your media file on the left and click <strong>Stream Live Subtitles</strong> or <strong>Batch Transcribe</strong> to generate subtitles.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* Audio Extraction Tab */}
        {activeTab === 'extract' && (
          <div className="tab-pane-container">
            <div className="extract-panel-card">
              <div className="panel-header">
                <h3>⚡ Direct Fast Audio Extraction</h3>
                <p>Extract uncompressed/high-quality audio from any local video file without uploading over HTTP.</p>
              </div>

              <div className="path-input-group">
                <label>Video File Path</label>
                <div className="path-row">
                  <input
                    type="text"
                    value={videoPath}
                    onChange={(e) => setVideoPath(e.target.value)}
                    placeholder="Enter or browse local video path..."
                  />
                  <button type="button" className="studio-btn secondary" onClick={handleBrowseLocalFile} disabled={isBrowsing}>
                    {isBrowsing ? '📂 Browsing...' : '📂 Browse File'}
                  </button>
                </div>
              </div>

              <div className="extract-actions-bar">
                <button
                  type="button"
                  className="studio-btn primary"
                  onClick={handleExtractAudio}
                  disabled={extracting || (!videoPath.trim() && !file && !localVideoFile)}
                >
                  {extracting ? '⏳ Extracting Audio...' : '⚡ Extract Audio Track'}
                </button>
              </div>

              {extractError && <div className="studio-error-banner">{extractError}</div>}

              {extractResult && (
                <div className="extract-success-card">
                  <h4>✓ Audio Extraction Complete</h4>
                  <p><strong>File Name:</strong> {extractResult.audioFileName}</p>
                  <p><strong>Size:</strong> {extractResult.audioSizeMB} MB</p>

                  <div className="extract-btn-group">
                    <button type="button" className="studio-btn secondary" onClick={() => downloadExtractedAudio(extractResult)}>
                      📥 Download Audio (.WAV)
                    </button>
                    <button
                      type="button"
                      className="studio-btn primary"
                      onClick={() => {
                        useExtractedAudioForSubtitles(extractResult)
                        setActiveTab('editor')
                      }}
                      disabled={useExtractedLoading}
                    >
                      {useExtractedLoading ? 'Generating Subtitles...' : '🎬 Generate Subtitles & Edit'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="tab-pane-container">
            <div className="settings-panel-card">
              <h3>⚙ Studio Settings & System Telemetry</h3>
              <div className="settings-grid">
                <div className="setting-item">
                  <label>Default Source Language</label>
                  <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="setting-item">
                  <label>Default Target Language</label>
                  <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
                    {languages.filter((l) => l.code !== 'auto').map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="setting-item">
                  <label>Translation Engine Model</label>
                  <select value={translationModel} onChange={(e) => setTranslationModel(e.target.value)}>
                    {translationModels.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="shortcuts-modal-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⌨ Studio Keyboard Shortcuts</h3>
              <button type="button" className="close-btn" onClick={() => setShowShortcuts(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="shortcut-row"><kbd>Space</kbd> <span>Play / Pause Media</span></div>
              <div className="shortcut-row"><kbd>←</kbd> / <kbd>→</kbd> <span>Seek Rewind / Forward 5 seconds</span></div>
              <div className="shortcut-row"><kbd>,</kbd> / <kbd>.</kbd> <span>Frame Step Backward / Forward (0.04s)</span></div>
              <div className="shortcut-row"><kbd>?</kbd> <span>Toggle Keyboard Shortcuts menu</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SubtitleGenerator
