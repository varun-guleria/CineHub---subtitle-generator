import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './SubtitleGenerator.css'

const formatTime = (seconds, format = 'srt') => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  const sep = format === 'vtt' ? '.' : ','
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`
}

const mergeSubtitles = (existing = [], incoming = []) => {
  const unique = new Map()
  for (const subtitle of [...existing, ...incoming]) {
    const start = Number(subtitle?.start)
    const end = Number(subtitle?.end)
    const text = String(subtitle?.text || '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue
    unique.set(`${start}|${end}|${text}`, { start, end, text })
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

const getAudioTrackLabel = (track) => {
  const language = audioLanguageNames[String(track?.language || 'und').toLowerCase()] || track?.language || 'Unknown language'
  const details = [track?.codec, track?.isDefault ? 'Default' : null].filter(Boolean).join(' · ')
  return details ? `${language} (${details})` : language
}

const SubtitleGenerator = () => {
  const [file, setFile] = useState(null)
  const [mediaUrl, setMediaUrl] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
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
  const [preparedStream, setPreparedStream] = useState(null)
  const [isPreparingStream, setIsPreparingStream] = useState(false)
  const [audioTracks, setAudioTracks] = useState([])
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0)
  const [isBrowsing, setIsBrowsing] = useState(false)

  const fileInputRef = useRef(null)
  const localVideoInputRef = useRef(null)
  const mediaRef = useRef(null)
  const videoWrapperRef = useRef(null)
  const abortControllerRef = useRef(null)
  const stopRequestedRef = useRef(false)
  const shouldFocusPreviewRef = useRef(false)

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
    '.aac',
    '.aiff',
    '.avi',
    '.flac',
    '.m4a',
    '.m4v',
    '.mkv',
    '.mov',
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpg',
    '.ogg',
    '.wav',
    '.webm',
    '.wma',
  ]

  const supportedVideoExtensions = [
    '.avi',
    '.m4v',
    '.mkv',
    '.mov',
    '.mp4',
    '.mpeg',
    '.mpg',
    '.webm',
  ]

  const isSupportedVideoPath = (path) => {
    if (!path || typeof path !== 'string') return false
    const lower = path.trim().toLowerCase()
    return supportedVideoExtensions.some((extension) => lower.endsWith(extension))
  }

  const isSupportedMediaFile = (selectedFile) => {
    if (!selectedFile) return false

    const mimeType = selectedFile.type || ''
    const fileName = selectedFile.name.toLowerCase()

    return (
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      supportedMediaExtensions.some((extension) => fileName.endsWith(extension))
    )
  }

  const isVideoFile = (selectedFile) => {
    if (!selectedFile) return false

    const mimeType = selectedFile.type || ''
    const fileName = selectedFile.name.toLowerCase()

    return (
      mimeType.startsWith('video/') ||
      supportedVideoExtensions.some((extension) => fileName.endsWith(extension))
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
      return () => {
        URL.revokeObjectURL(url)
      }
    }

    if (file) {
      const url = URL.createObjectURL(file)
      setMediaUrl(url)
      return () => {
        URL.revokeObjectURL(url)
      }
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

    return () => {
      URL.revokeObjectURL(url)
    }
  }, [subtitles])

  const handleMediaMetadata = () => {
    if (mediaRef.current && mediaRef.current.duration) {
      setTotalDuration(mediaRef.current.duration)
    }
  }

  const makeMediaAudible = () => {
    if (mediaRef.current) {
      mediaRef.current.muted = false
      mediaRef.current.volume = 1.0
    }
  }

  const handleMediaPlaybackError = () => {
    console.warn('Media element encountered a playback error.')
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

      if (active && document.fullscreenElement === mediaRef.current) {
        setIsDirectVideoFullscreen(true)
      } else {
        setIsDirectVideoFullscreen(false)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
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
    e.preventDefault()

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
          headers: {
            'Content-Type': 'multipart/form-data',
          },
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
          headers: {
            'Content-Type': 'application/json',
          },
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
                setSubtitles((prev) => {
                  return mergeSubtitles(prev || [], parsed.subtitles)
                })
              }
              if (parsed.sessionId) {
                setSubtitleSessionId(parsed.sessionId)
              }
              if (typeof parsed.bufferedUntil === 'number') {
                setBufferedUntil(parsed.bufferedUntil)
              }

              if (parsed.initialBufferReady) {
                setStreamBuffering(false)
                setStreamingStatus(`Live subtitles active! Buffered through ${formatTime(parsed.bufferedUntil)}`)
                if (mediaRef.current && mediaRef.current.paused) {
                  mediaRef.current.play().catch(() => {})
                }
              } else {
                setStreamingStatus(`Generating the next subtitle chunk in the background. Buffered through ${formatTime(parsed.bufferedUntil)}`)
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
        const isConnectionFailure =
          err instanceof TypeError ||
          String(err.message || '').toLowerCase().includes('failed to fetch') ||
          String(err.message || '').toLowerCase().includes('network')
        setError(
          isConnectionFailure
            ? 'Cannot reach the subtitle server. Start both apps with "npm run dev" from the project folder, then try again.'
            : err.message || 'Failed to stream subtitles'
        )
        console.error('Streaming error:', err)
      }
    } finally {
      if (reader) {
        try {
          await reader.cancel()
        } catch {}
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
      element.setAttribute('download', 'subtitles.srt')
      element.style.display = 'none'
      document.body.appendChild(element)
      element.click()
      document.body.removeChild(element)
      return
    }

    let content = ''
    let filename = `subtitles.${format}`

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
      filename = `subtitles.vtt`
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
      mediaRef.current.play().catch(() => {})
    }
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

  return (
    <div className="subtitle-generator">
      <div className="container">
        <div className="header full-width-header">
          <div className="header-left">
            <div className="header-brand-badge">
              <span className="badge-pulse"></span>
              <span className="badge-text">AI Subtitle Studio</span>
            </div>
            <div className="header-title-row">
              <div className="brand-logo-mark" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <rect x="1" y="1" width="34" height="34" rx="10" stroke="url(#cinesub-border)" strokeWidth="1.5" fill="rgba(0, 212, 160, 0.08)" />
                  <path d="M11 12H25C26.1 12 27 12.9 27 14V22C27 23.1 26.1 24 25 24H11C9.9 24 9 23.1 9 22V14C9 12.9 9.9 12 11 12Z" stroke="#00d4a0" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13 17H18M13 20.5H23" stroke="#f2f2f2" strokeWidth="1.75" strokeLinecap="round"/>
                  <circle cx="22" cy="15.5" r="1.5" fill="#00d4a0"/>
                  <defs>
                    <linearGradient id="cinesub-border" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#00d4a0" stopOpacity="0.8"/>
                      <stop offset="1" stopColor="#00d4a0" stopOpacity="0.2"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h1 className="brand-title">
                <span className="brand-cine">Cine</span><span className="brand-sub">Hub</span>
                <span className="brand-glow-dot"></span>
              </h1>
            </div>
            <p className="header-tagline">
              Transform video or audio into multilingual subtitles with cinematic AI precision
            </p>
          </div>
          <div className="header-right-badges">
            <div className="studio-pill">
              <span className="studio-pill-dot green"></span>
              <span>Whisper Engine</span>
            </div>
            <div className="studio-pill">
              <span className="studio-pill-dot cyan"></span>
              <span>Live Sync</span>
            </div>
            <div className="studio-pill">
              <span className="studio-pill-dot amber"></span>
              <span>Multilingual</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="generator-form full-width-workspace">
          <div className="studio-workspace-grid">
            {/* Left Column: Theatre Media Stage & Source Ingestion */}
            <div className="stage-media-column">
              {/* Media Preview Player (if loaded) */}
              {mediaUrl && (
                <div className="media-preview-container">
                  <div className="media-preview-header">
                    <h3>Media Preview Player</h3>
                    <div className="media-preview-header-actions">
                      {isStreaming && (
                        <div className="live-stream-badge">
                          <span className="live-stream-dot"></span>
                          {streamBuffering ? 'Buffering Initial Subtitles...' : 'Live Subtitles Streaming'}
                        </div>
                      )}
                      {isCurrentMediaVideo && (
                        <button
                          type="button"
                          className="fullscreen-toggle-btn"
                          onClick={handleToggleFullscreen}
                          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        >
                          {isFullscreen ? '🗗 Exit Fullscreen' : '⛶ Fullscreen'}
                        </button>
                      )}
                    </div>
                  </div>
                  {isCurrentMediaVideo ? (
                    <div ref={videoWrapperRef} className="video-player-wrapper">
                      <video
                        ref={mediaRef}
                        src={mediaUrl}
                        controls
                        crossOrigin="anonymous"
                        onLoadedMetadata={handleMediaMetadata}
                        onPlay={makeMediaAudible}
                        onError={handleMediaPlaybackError}
                        onTimeUpdate={() => setCurrentTime(mediaRef.current?.currentTime || 0)}
                        onDoubleClick={handleToggleFullscreen}
                        className="media-player"
                      >
                        {vttUrl && (
                          <track
                            key={vttUrl}
                            kind="subtitles"
                            label="Live Subtitles"
                            src={vttUrl}
                            default
                            onLoad={handleTrackLoad}
                          />
                        )}
                      </video>
                      {activeSubtitle && !isDirectVideoFullscreen && (
                        <div className="video-subtitle-overlay">
                          <span>{activeSubtitle.text}</span>
                        </div>
                      )}
                      {isFullscreen && (
                        <button
                          type="button"
                          className="floating-fullscreen-exit-btn"
                          onClick={handleToggleFullscreen}
                          title="Exit Fullscreen (Esc)"
                        >
                          ✕ Exit Fullscreen
                        </button>
                      )}
                    </div>
                  ) : (
                    <audio
                      ref={mediaRef}
                      src={mediaUrl}
                      controls
                      onLoadedMetadata={handleMediaMetadata}
                      onPlay={makeMediaAudible}
                      onError={handleMediaPlaybackError}
                      onTimeUpdate={() => setCurrentTime(mediaRef.current?.currentTime || 0)}
                      className="media-player audio-player"
                    />
                  )}

                  {/* Live Subtitle Buffer Progress Bar */}
                  {(isStreaming || bufferedUntil > 0) && (
                    <div className="stream-buffer-panel">
                      <div className="stream-buffer-meta">
                        <div className="stream-buffer-status">
                          <span className="stream-buffer-icon">{isStreaming ? '⚡' : '✓'}</span>
                          <span className="stream-buffer-text">
                            {streamingStatus || `Subtitles buffered through ${formatTime(bufferedUntil)}`}
                          </span>
                        </div>
                        <span className="stream-buffer-time">
                          Playback: {formatTime(currentTime)} / Subtitles: {formatTime(bufferedUntil)}
                        </span>
                      </div>
                      <div className="stream-buffer-track">
                        <div
                          className="stream-buffer-fill"
                          style={{
                            width: totalDuration > 0
                              ? `${Math.min(100, Math.round((bufferedUntil / totalDuration) * 100))}%`
                              : bufferedUntil > 0 ? '100%' : '20%'
                          }}
                          title={`Buffered until ${formatTime(bufferedUntil)}`}
                        />
                        <div
                          className="stream-playback-marker"
                          style={{
                            left: totalDuration > 0
                              ? `${Math.min(100, Math.round((currentTime / totalDuration) * 100))}%`
                              : '0%'
                          }}
                          title={`Current playback: ${formatTime(currentTime)}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source Ingestion Suite */}
              <div className="media-ingest-suite">
                {/* Upload Section */}
                <div className="upload-section">
                  <div
                    className="upload-area"
                    onDrop={handleDragDrop}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.add('drag-over')
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                    onClick={() => fileInputRef.current.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,video/*,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.webm"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    <div className="upload-icon">🎬</div>
                    <div className="upload-text">
                      {file ? (
                        <>
                          <p className="success">✓ {file.name}</p>
                          <p className="file-size">
                            {file.size > 1024 * 1024 * 1024
                              ? `${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                              : `${(file.size / 1024 / 1024).toFixed(2)} MB`}
                          </p>
                          <p className="subtitle">Media selected. Ready to play or generate subtitles.</p>
                        </>
                      ) : (
                        <>
                          <p>Drag & drop your audio or video file here</p>
                          <p className="subtitle">or click to browse media</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Local Video Path & Fast Disk Extraction */}
                <div className="extract-section">
                  <div className="extract-header">
                    <div className="extract-header-title-row">
                      <h2>Direct Disk / Fast Audio Extraction</h2>
                      <span className="extract-badge">Fast I/O</span>
                    </div>
                    <p>Browse to play and generate subtitles, or paste a full local path to extract audio directly without upload overhead.</p>
                  </div>

                  <div className="video-path-section">
                    <label htmlFor="video-path">Video file or local path</label>
                    <div className="path-picker-row">
                      <input
                        ref={localVideoInputRef}
                        type="file"
                        accept="video/*,.avi,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.webm"
                        onChange={handleLocalVideoPick}
                        style={{ display: 'none' }}
                      />
                      <input
                        id="video-path"
                        type="text"
                        value={videoPath}
                        onChange={(e) => {
                          setVideoPath(e.target.value)
                          setFile(null)
                          setLocalVideoFile(null)
                          setLocalVideoDetails(null)
                          setSelectedVideoName('')
                        }}
                        placeholder="Click Browse or paste a local file path…"
                      />
                      <button
                        type="button"
                        className="browse-button"
                        onClick={handleBrowseLocalFile}
                        disabled={isBrowsing}
                        title={isBrowsing ? 'File browser is open — choose a file…' : 'Browse local files'}
                      >
                        {isBrowsing ? '⏳ Choosing file…' : '📂 Browse'}
                      </button>
                    </div>
                    {selectedVideoName && (
                      <p className="picked-file-hint">
                        <strong>Selected video:</strong> {selectedVideoName} — ready to preview and generate subtitles.
                      </p>
                    )}
                    {localVideoDetails ? (
                      <p className="picked-file-hint">
                        📁 <strong>{localVideoDetails.fileName}</strong> ({localVideoDetails.sizeGB >= 1 ? `${localVideoDetails.sizeGB} GB` : `${localVideoDetails.sizeMB} MB`}) — <span style={{ color: '#34d399', fontWeight: 600 }}>⚡ Local file selected (fast disk extraction, no upload needed)</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="extract-actions">
                    <button
                      type="button"
                      className="extract-button"
                      onClick={handleExtractAudio}
                      disabled={extracting || (!videoPath.trim() && !file && !localVideoFile)}
                    >
                      {extracting ? 'Extracting audio...' : 'Extract Audio Track'}
                    </button>
                  </div>

                  {extractError && <div className="error-message">{extractError}</div>}

                  {extractResult && (
                    <div className="extract-result">
                      <p><strong>Audio extracted:</strong> {extractResult.audioFileName}</p>
                      <p>Size: {extractResult.audioSizeMB} MB</p>
                      <div className="extract-buttons-row">
                        <button type="button" className="download-btn" onClick={() => downloadExtractedAudio(extractResult)}>
                          Download Extracted Audio
                        </button>
                        <button
                          type="button"
                          className="download-btn"
                          onClick={() => useExtractedAudioForSubtitles(extractResult)}
                          disabled={useExtractedLoading}
                        >
                          {useExtractedLoading ? 'Generating...' : 'Generate Subtitles from Extracted Audio'}
                        </button>
                      </div>
                      {useExtractedError && <div className="error-message">{useExtractedError}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Studio Control Deck */}
            <div className="stage-controls-column">
              {/* Language & Model Selection */}
              <div className="control-deck-card">
                <div className="control-deck-card-header">
                  <span className="control-deck-badge">STAGE 01</span>
                  <h3>Translation & Model</h3>
                </div>

                <div className="language-section">
                  <div className="language-group">
                    <label htmlFor="source-lang">Source Language</label>
                    <select
                      id="source-lang"
                      value={sourceLanguage}
                      onChange={(e) => setSourceLanguage(e.target.value)}
                    >
                      {languages.map(lang => (
                        <option key={lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="arrow">→</div>

                  <div className="language-group">
                    <label htmlFor="target-lang">Target Language</label>
                    <select
                      id="target-lang"
                      value={targetLanguage}
                      onChange={(e) => setTargetLanguage(e.target.value)}
                    >
                      {languages.filter(lang => lang.code !== 'auto').map(lang => (
                        <option key={lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="language-group model-group">
                    <label htmlFor="translation-model">Translation Model</label>
                    {modelLoading ? (
                      <p className="subtitle">Loading available models...</p>
                    ) : modelError ? (
                      <p className="error-message">{modelError}</p>
                    ) : (
                      <select
                        id="translation-model"
                        value={translationModel}
                        onChange={(e) => setTranslationModel(e.target.value)}
                      >
                        {translationModels.map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons Group */}
              <div className="control-deck-card action-deck-card">
                <div className="control-deck-card-header">
                  <span className="control-deck-badge">STAGE 02</span>
                  <h3>Processing Engine</h3>
                </div>

                {error && (
                  <div className="error-message">
                    ⚠️ {error}
                  </div>
                )}

                <div className="action-buttons-group">
                  <button
                    type="button"
                    className="stream-watch-button"
                    onClick={handleStartStreaming}
                    disabled={loading || isStreaming || (!file && !localVideoFile && !videoPath.trim())}
                  >
                    {isStreaming ? (
                      <>
                        <span className="loader"></span>
                        {streamBuffering ? 'Buffering Initial Subtitles...' : 'Streaming Live Subtitles...'}
                      </>
                    ) : (
                      '▶ Play & Generate Live Subtitles'
                    )}
                  </button>

                  {isStreaming ? (
                    <button
                      type="button"
                      className="stop-stream-button"
                      onClick={handleStopStreaming}
                    >
                      ⏹ Stop Live Stream
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="submit-button batch-button"
                      disabled={loading || isStreaming || (!file && !localVideoFile && !videoPath.trim())}
                    >
                      {loading ? (
                        <>
                          <span className="loader"></span>
                          Processing Batch...
                        </>
                      ) : (
                        '📥 Batch Generate SRT'
                      )}
                    </button>
                  )}

                  {(file || localVideoFile || videoPath.trim() || (subtitles && subtitles.length > 0)) && !loading && !isStreaming && (
                    <button
                      type="button"
                      className="download-btn reset-btn"
                      onClick={handleReset}
                      title="Clear current selection and subtitles to start fresh"
                    >
                      🔄 Reset / New Media
                    </button>
                  )}
                </div>
              </div>

              {/* Session Status / Telemetry */}
              <div className="control-deck-card telemetry-card">
                <div className="control-deck-card-header">
                  <span className="control-deck-badge">TELEMETRY</span>
                  <h3>Session Status</h3>
                </div>
                <div className="telemetry-grid">
                  <div className="telemetry-stat">
                    <span className="telemetry-label">Active Media</span>
                    <span className="telemetry-value" title={selectedVideoName || (file ? file.name : (localVideoFile ? localVideoFile.name : (videoPath ? videoPath.split(/[\/\\]/).pop() : 'None selected')))}>
                      {selectedVideoName || (file ? file.name : (localVideoFile ? localVideoFile.name : (videoPath ? videoPath.split(/[\/\\]/).pop() : 'None selected')))}
                    </span>
                  </div>
                  <div className="telemetry-stat">
                    <span className="telemetry-label">Engine Mode</span>
                    <span className="telemetry-value highlight">
                      {isStreaming ? '⚡ Live Sync Streaming' : (loading ? '⏳ Batch Processing' : 'Idle / Ready')}
                    </span>
                  </div>
                  <div className="telemetry-stat">
                    <span className="telemetry-label">Language Route</span>
                    <span className="telemetry-value mono">
                      {sourceLanguage.toUpperCase()} → {targetLanguage.toUpperCase()}
                    </span>
                  </div>
                  <div className="telemetry-stat">
                    <span className="telemetry-label">Subtitles</span>
                    <span className="telemetry-value mono">
                      {subtitles ? `${subtitles.length} lines` : '0 lines'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Subtitles Preview */}
        {subtitles && subtitles.length > 0 && (
          <div className="subtitles-section full-width-subtitles">
            <div className="subtitles-header">
              <div className="subtitles-header-info">
                <h2>Generated Subtitles</h2>
                <span className="subtitles-count-badge">{subtitles.length} lines</span>
              </div>
              <div className="download-buttons">
                <button onClick={() => downloadSubtitles('srt')} className="download-btn">
                  📥 Download SRT
                </button>
                <button onClick={() => downloadSubtitles('vtt')} className="download-btn">
                  📥 Download VTT
                </button>
              </div>
            </div>
            <p className="subtitle-hint">Click on any timestamp card to jump the media player to that point.</p>
            <div className="subtitles-preview subtitles-grid-view">
              {subtitles.map((subtitle, index) => {
                const isActive = currentTime >= subtitle.start && currentTime <= subtitle.end
                return (
                  <div 
                    key={index} 
                    className={`subtitle-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSeek(subtitle.start)}
                    style={{ cursor: mediaUrl ? 'pointer' : 'default' }}
                  >
                    <div className="subtitle-item-header">
                      <span className="subtitle-index">#{index + 1}</span>
                      <span className="timestamp">{formatTime(subtitle.start)} → {formatTime(subtitle.end)}</span>
                    </div>
                    <p className="text">{subtitle.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SubtitleGenerator
