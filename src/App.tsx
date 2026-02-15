import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

import { ScrollView, type BeatAnchor } from './components/views/ScrollView'
import { ScoreControls } from './components/controls/ScoreControls'
import { AnchorSidebar } from './components/controls/AnchorSidebar'
import { WaveformTimeline } from './components/controls/WaveformTimeline'
import { PublishModal } from './components/controls/PublishModal'
import { useRecorder } from './hooks/use-recorder'
import { projectService, type Project } from './services/projectService'
import { aiService } from './services/aiService'
export interface Anchor {
  measure: number
  time: number
}

export type AppMode = 'PLAYBACK' | 'RECORD'

// Measure 1 always starts at 0:00
const INITIAL_ANCHORS: Anchor[] = [{ measure: 1, time: 0 }]
export const DEFAULT_AUDIO = '/c-major-scale.mp3'
const DEFAULT_XML = '/c-major-exercise.musicxml'

function App() {
  const { isRecording, startRecording, stopRecording } = useRecorder()
  const [recordedVideo, setRecordedVideo] = useState<File | null>(null)
  const [revealMode, setRevealMode] = useState<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')
  const [popEffect, setPopEffect] = useState(false)
  const [jumpEffect, setJumpEffect] = useState(true)
  const [glowEffect, setGlowEffect] = useState(true)
  const [isLocked, setIsLocked] = useState(true)
  const [curtainLookahead, setCurtainLookahead] = useState(0.25) // 0-1, controls curtain gap
  const [darkMode, setDarkMode] = useState(false)
  const [highlightNote, setHighlightNote] = useState(true)
  const [cursorPosition, setCursorPosition] = useState(0.2)
  const [showCursor, setShowCursor] = useState(true)
  const [isIslandMode, setIsIslandMode] = useState(false)


  const [anchors, setAnchors] = useState<Anchor[]>(INITIAL_ANCHORS)
  const [mode, setMode] = useState<AppMode>('PLAYBACK')
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [currentProjectTitle, setCurrentProjectTitle] = useState<string | null>(null)
  const [_isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [_isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  // AI Anchor Mapping state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aiAnchors, setAiAnchors] = useState<any[]>([])
  const [isAILoading, setIsAILoading] = useState(false)

  // File State
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [xmlFile, setXmlFile] = useState<File | null>(null)

  // URL State (drives the player/viewer)
  const [audioUrl, setAudioUrl] = useState<string>(DEFAULT_AUDIO)
  const [xmlUrl, setXmlUrl] = useState<string | undefined>(undefined)

  const [currentMeasure, setCurrentMeasure] = useState<number>(1)
  const [duration, setDuration] = useState(0)

  // Level 2: Beat Mapping
  const [beatAnchors, setBeatAnchors] = useState<BeatAnchor[]>([])
  const [isLevel2Mode, setIsLevel2Mode] = useState(false)
  const [subdivision, setSubdivision] = useState(4) // DEFAULT SUBDIVISION

  const audioRef = useRef<HTMLAudioElement>(null)

  // Helper: Find measure based on time
  const getCurrentMeasure = useCallback((time: number) => {
    if (anchors.length === 0) return 1
    const sorted = [...anchors].sort((a, b) => a.time - b.time)
    const anchor = sorted.reverse().find(a => a.time <= time)
    return anchor ? anchor.measure : 1
  }, [anchors])

  // Load projects on mount
  useEffect(() => {
    const init = async () => {
      try {
        const list = await projectService.getProjects()
        setProjects(list)
        const lastId = localStorage.getItem('lastProjectId')
        if (lastId) {
          console.log('Restoring last session:', lastId)
          const lastProject = await projectService.getProjectById(lastId)
          if (lastProject) {
            loadProjectState(lastProject)
          }
        }
      } catch (err) {
        console.error('Initialization failed:', err)
      }
    }
    init()
  }, [])

  // Handle File Selections
  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
      setCurrentProjectId(null)
      setCurrentProjectTitle(null)
    }
  }

  const handleXmlSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setXmlFile(file)
      setXmlUrl(URL.createObjectURL(file))
      setCurrentProjectId(null)
      setCurrentProjectTitle(null)
    }
  }

  const fetchFileFromUrl = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type })
  }

  // Save Project
  const handleSaveAs = async () => {
    if (!audioFile && !audioUrl) {
      alert("No audio to save.")
      return
    }

    const title = window.prompt('Enter new project name:')
    if (!title) return

    try {
      let finalAudioFile = audioFile
      let finalXmlFile = xmlFile

      if (!finalAudioFile) {
        console.log('Fetching audio from URL:', audioUrl)
        finalAudioFile = await fetchFileFromUrl(audioUrl, 'audio.mp3')
      }

      if (!finalXmlFile) {
        const urlToFetch = xmlUrl || DEFAULT_XML
        console.log('Fetching XML from URL:', urlToFetch)
        finalXmlFile = await fetchFileFromUrl(urlToFetch, 'score.xml')
      }

      const newProject = await projectService.saveProject(
        title, finalAudioFile, finalXmlFile, anchors,
        beatAnchors, subdivision, isLevel2Mode, aiAnchors
      )
      alert('New project created!')
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)

      setCurrentProjectId(newProject.id)
      setCurrentProjectTitle(newProject.title)
      localStorage.setItem('lastProjectId', newProject.id)
      setIsSaveModalOpen(false)
    } catch (err) {
      console.error(err)
      alert('Failed to create new project. Check console.')
    }
  }

  const handleSave = async () => {
    if (!currentProjectId) return
    try {
      await projectService.updateProject(
        currentProjectId, anchors,
        beatAnchors, subdivision, isLevel2Mode, undefined, aiAnchors
      )
      alert('Project saved!')
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)
    } catch (err) {
      console.error(err)
      alert('Failed to update project.')
    }
  }

  const loadProjectState = useCallback((project: Project) => {
    setAudioFile(null)
    setXmlFile(null)
    setAudioUrl(project.audio_url)
    setXmlUrl(project.xml_url)
    setAnchors(project.anchors)
    // Restore Level 2 beat mapping state
    setBeatAnchors(project.beat_anchors || [])
    setSubdivision(project.subdivision ?? 4)
    setIsLevel2Mode(project.is_level2 ?? false)
    // Restore AI state
    setAiAnchors(project.ai_anchors || [])
    setCurrentProjectId(project.id)
    setCurrentProjectTitle(project.title)
    setMode('RECORD')
    if (audioRef.current) {
      audioRef.current.currentTime = 0
    }
    localStorage.setItem('lastProjectId', project.id)
  }, [])

  const handleLoadClick = (project: Project) => {
    if (confirm(`Load project "${project.title}" ? Unsaved changes will be lost.`)) {
      loadProjectState(project)
      setIsLoadModalOpen(false)
    }
  }

  const handleNewProject = useCallback(() => {
    if (!confirm('Create a new empty project? Unsaved changes will be lost.')) return
    setAudioFile(null)
    setXmlFile(null)
    setAudioUrl(DEFAULT_AUDIO)
    setXmlUrl(undefined)
    setAnchors(INITIAL_ANCHORS)
    setBeatAnchors([])
    setSubdivision(4)
    setIsLevel2Mode(false)
    setAiAnchors([])
    setCurrentProjectId(null)
    setCurrentProjectTitle(null)
    setMode('RECORD')
    if (audioRef.current) {
      audioRef.current.currentTime = 0
    }
    localStorage.removeItem('lastProjectId')
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePublish = async (pieceId: string) => {
    // FIX: If we have a URL but no File object (because we loaded a saved project),
    // we need to re-fetch the blob to create a file for upload.
    let fileToUpload = audioFile

    if (!fileToUpload && audioUrl) {
      setIsPublishing(true)
      try {
        console.log("Fetching audio blob from URL...")
        const response = await fetch(audioUrl)
        const blob = await response.blob()
        fileToUpload = new File([blob], "master_recording.mp3", { type: "audio/mp3" })
      } catch (err) {
        console.error("Failed to fetch audio from URL", err)
        alert("Could not prepare audio for upload. Please re-upload the MP3 manually.")
        setIsPublishing(false)
        return
      }
    }

    if (!fileToUpload) {
      alert("No audio file loaded! You need a master recording.")
      return
    }

    setIsPublishing(true)
    try {
      await projectService.publishToPiece(pieceId, fileToUpload, {
        anchors: anchors,
        beat_anchors: beatAnchors,
        subdivision: subdivision,
        is_level2: isLevel2Mode
      }, recordedVideo)
      alert("✅ Successfully Published to Classroom!")
      setIsPublishModalOpen(false)
    } catch (e: any) {
      alert("Error publishing: " + e.message)
      console.error(e)
    } finally {
      setIsPublishing(false)
    }
  }

  const upsertAnchor = (measure: number, time: number) => {
    setAnchors(prev => {
      const filtered = prev.filter(a => a.measure !== measure)
      const newAnchors = [...filtered, { measure, time }]
      return newAnchors.sort((a, b) => a.measure - b.measure)
    })
  }

  const handleDelete = (measureToDelete: number) => {
    if (measureToDelete === 1) {
      alert("Cannot delete the start of the song (Measure 1).")
      return
    }
    setAnchors(prev => prev.filter(a => a.measure !== measureToDelete))
  }

  const handleRestamp = (measureToStamp: number) => {
    if (!audioRef.current) return
    upsertAnchor(measureToStamp, audioRef.current.currentTime)
  }

  const handleTap = useCallback(() => {
    if (mode !== 'RECORD') return
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime
      setAnchors(prev => [...prev, { measure: prev.length + 1, time: currentTime }])
    }
  }, [mode])

  // --- BEAT MAPPING HELPERS ---
  // REVISED: Generate Beat Anchors using Subdivision
  const generateBeatAnchors = useCallback(() => {
    if (anchors.length < 2) return
    const newBeats: BeatAnchor[] = []
    const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)

    for (let i = 0; i < sortedAnchors.length; i++) {
      const currentA = sortedAnchors[i]
      const nextA = (i + 1 < sortedAnchors.length) ? sortedAnchors[i + 1] : null

      // Priority: Use Subdivision Input first, fallback to detected beat count (if mapped), else 4
      const beatsToGenerate = subdivision

      if (nextA) {
        const duration = nextA.time - currentA.time
        const timePerBeat = duration / beatsToGenerate

        for (let b = 2; b <= beatsToGenerate; b++) {
          newBeats.push({
            measure: currentA.measure,
            beat: b,
            time: currentA.time + (timePerBeat * (b - 1))
          })
        }
      }
    }
    setBeatAnchors(newBeats)
  }, [anchors, subdivision])

  const toggleLevel2 = useCallback(() => {
    setIsLevel2Mode(prev => {
      const nextState = !prev
      // REMOVED AUTO-GENERATION to allow user to set subdivision first
      return nextState
    })
  }, [])

  const upsertBeatAnchor = (measure: number, beat: number, time: number) => {
    setBeatAnchors(prev => {
      const filtered = prev.filter(b => !(b.measure === measure && b.beat === beat))
      const newBeats = [...filtered, { measure, beat, time }]
      return newBeats.sort((a, b) => {
        if (a.measure !== b.measure) return a.measure - b.measure
        return a.beat - b.beat
      })
    })
  }

  const handleJumpToMeasure = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  const handleReset = useCallback(() => {
    setAnchors(INITIAL_ANCHORS)
  }, [])

  const toggleMode = useCallback(() => {
    setMode(prev => prev === 'RECORD' ? 'PLAYBACK' : 'RECORD')
  }, [])

  // --- AI ANCHOR MAPPING ---
  const handleAIPredict = async () => {
    if (!audioFile && !audioUrl) return alert('Please load audio first.')
    if (!xmlFile && !xmlUrl) return alert('Please load XML first.')

    setIsAILoading(true)
    try {
      // Get audio blob
      let fileToAnalyze: File | Blob | null = audioFile
      if (!fileToAnalyze && audioUrl) {
        const res = await fetch(audioUrl)
        fileToAnalyze = await res.blob()
      }

      // Get XML text
      let xmlText = ''
      if (xmlFile) {
        xmlText = await xmlFile.text()
      } else {
        const res = await fetch(xmlUrl || DEFAULT_XML)
        xmlText = await res.text()
      }

      if (!fileToAnalyze || !xmlText) throw new Error('Could not load files for AI')

      const predicted = await aiService.predictAnchors(fileToAnalyze, xmlText)
      if (predicted && Array.isArray(predicted)) {
        const cleanPoints = predicted.map((p: { measure: number; time: number }) => ({
          measure: Number(p.measure),
          time: Number(p.time)
        }))
        setAiAnchors(cleanPoints) // Store AI's original prediction
        setAnchors(cleanPoints)   // Apply to timeline for user to review
        setBeatAnchors([])        // Clear stale beat anchors — they must be recalculated
        alert('\u2705 AI Mapped successfully! Review and adjust the anchors, then click "Teach AI" when done.')
      }
    } catch (err: unknown) {
      console.error(err)
      alert('AI Mapping failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsAILoading(false)
    }
  }

  const handleTeachAI = async () => {
    if (!currentProjectId) {
      alert('Please Save the project first before teaching the AI.')
      return
    }
    try {
      // Save anchors (user's corrections) alongside ai_anchors (AI's original guess)
      await projectService.updateProject(
        currentProjectId, anchors, beatAnchors, subdivision, isLevel2Mode,
        currentProjectTitle || undefined, aiAnchors
      )
      alert('\ud83c\udf93 Taught AI your fixed mappings! It will use this to learn for future pieces.')
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)
    } catch (err) {
      console.error(err)
      alert('Failed to teach AI.')
    }
  }

  const handleSeeked = useCallback(() => {
    if (mode === 'RECORD' && audioRef.current && audioRef.current.currentTime < 0.1 && anchors.length > 1) {
      // Logic removed intentionally
    }
  }, [mode, anchors.length])

  const handleRecordMaster = useCallback(async () => {
    const started = await startRecording()
    if (started) {
      // Wait for UI to hide, then auto-play from start
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = 0
          audioRef.current.play()
        }
      }, 500)
    }
  }, [startRecording])

  const handleEnded = useCallback(async () => {
    if (isRecording) {
      const videoFile = await stopRecording()
      setRecordedVideo(videoFile)
      setIsPublishModalOpen(true)
    }
  }, [isRecording, stopRecording])

  const togglePlayPause = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    // Note: scrollIntoView was handled by refs in the old sidebar code.
    // In new architecture, we might pass a prop or handle it inside AnchorSidebar.
    // For now, removing the direct ref manipulation here as the elements are in child component.
  }, [currentMeasure])


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayPause()
      }
      else if (event.code === 'KeyA') {
        if (mode === 'RECORD') {
          handleTap()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, togglePlayPause, mode])

  return (
    <div className={`flex flex-col h-screen ${darkMode ? 'bg-[#222222] text-[#e0e0e0]' : 'bg-white text-slate-900'}`}>

      {/* 1. MAIN HEADER (Global App Controls) */}
      {/* data-studio-hide: hidden during recording */}
      <div data-studio-hide className="flex items-center justify-between px-6 py-3 bg-slate-900 text-white border-b border-slate-800 z-50">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            Score Follower
          </h1>

          {/* Project Name Badge */}
          <div className="flex items-center px-3 py-1 bg-slate-800 rounded border border-slate-700 text-xs">
            <span className="text-slate-500 mr-2 uppercase tracking-wider font-bold">Project:</span>
            <span className="font-mono text-emerald-400">{currentProjectTitle || 'Untitled'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">

          {/* Import XML Button */}
          <button
            onClick={() => document.getElementById('hidden-xml-input')?.click()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-bold transition-all flex items-center gap-2"
          >
            📂 Import XML
          </button>
          <input
            id="hidden-xml-input"
            type="file"
            accept=".xml,.musicxml,.mxl"
            onChange={handleXmlSelect}
            className="hidden"
          />

          {/* New Project Button */}
          <button
            onClick={handleNewProject}
            className="px-3 py-1.5 bg-slate-700 hover:bg-cyan-600 rounded text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-600"
          >
            ✨ New
          </button>

          {/* Load/Save Group */}
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => {
                if (currentProjectId) {
                  handleSave()
                } else {
                  handleSaveAs()
                }
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 rounded-l text-xs font-bold transition-all border-r border-slate-600"
            >
              Save
            </button>
            <button
              onClick={() => handleSaveAs()}
              className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-r text-xs font-bold transition-all"
              title="Save As..."
            >
              ▼
            </button>
          </div>

          {/* Publish Button */}
          <button
            onClick={() => setIsPublishModalOpen(true)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-bold transition-all ml-1 border border-emerald-500 shadow-lg shadow-emerald-900/20"
          >
            🚀 Publish
          </button>

          {/* Record Master Button */}
          <button
            onClick={handleRecordMaster}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-2
              ${isRecording ? 'bg-red-600 animate-pulse text-white' : 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'}`}
          >
            {isRecording ? '🔴 Recording...' : '🎥 Record Master'}
          </button>

          {/* Load Select */}
          <select
            className="bg-slate-700 text-white px-3 py-1 rounded text-sm border border-slate-600 focus:outline-none focus:border-blue-500 max-w-[150px]"
            onChange={(e) => {
              const proj = projects.find(p => p.id === e.target.value)
              if (proj) handleLoadClick(proj)
              e.target.value = ""
            }}
          >
            <option value="">Load Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

        </div>
      </div>

      {/* 2. CONTROLS (Toolbar or Island) — hidden during recording */}
      <div data-studio-hide>
        <ScoreControls
          isIslandMode={isIslandMode}
          setIsIslandMode={setIsIslandMode}
          revealMode={revealMode}
          setRevealMode={setRevealMode}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          isLocked={isLocked}
          setIsLocked={setIsLocked}
          highlightNote={highlightNote}
          setHighlightNote={setHighlightNote}
          glowEffect={glowEffect}
          setGlowEffect={setGlowEffect}
          popEffect={popEffect}
          setPopEffect={setPopEffect}
          jumpEffect={jumpEffect}
          setJumpEffect={setJumpEffect}
          cursorPosition={cursorPosition}
          setCursorPosition={setCursorPosition}
          curtainLookahead={curtainLookahead}
          setCurtainLookahead={setCurtainLookahead}
          showCursor={showCursor}
          setShowCursor={setShowCursor}
        />
      </div>

      {/* 3. MAIN CONTENT */}
      <div data-studio-main className="flex-1 flex overflow-hidden">

        {/* Score Area */}
        {/* Score Area */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <ScrollView
            audioRef={audioRef}
            anchors={anchors}
            mode={mode}
            musicXmlUrl={xmlUrl || DEFAULT_XML}
            revealMode={revealMode}
            popEffect={popEffect}
            darkMode={darkMode}
            glowEffect={glowEffect}
            jumpEffect={jumpEffect}
            highlightNote={highlightNote}
            cursorPosition={cursorPosition}
            isLocked={isLocked}
            curtainLookahead={curtainLookahead}
            showCursor={showCursor}
            duration={duration}                             // NEW
            onUpdateAnchor={upsertAnchor}
            beatAnchors={isLevel2Mode ? beatAnchors : []}   // NEW: Pass explicit empty array if off to disable interpolation
            onUpdateBeatAnchor={upsertBeatAnchor}           // NEW
          // onBeatMapLoaded={setMeasureBeatCounts} // Unused
          />

          {/* MODULAR ISLAND (Float) */}
          {isIslandMode && (
            <ScoreControls
              isIslandMode={isIslandMode}
              setIsIslandMode={setIsIslandMode}
              revealMode={revealMode}
              setRevealMode={setRevealMode}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              isLocked={isLocked}
              setIsLocked={setIsLocked}
              highlightNote={highlightNote}
              setHighlightNote={setHighlightNote}
              glowEffect={glowEffect}
              setGlowEffect={setGlowEffect}
              popEffect={popEffect}
              setPopEffect={setPopEffect}
              jumpEffect={jumpEffect}
              setJumpEffect={setJumpEffect}
              cursorPosition={cursorPosition}
              setCursorPosition={setCursorPosition}
              curtainLookahead={curtainLookahead}
              setCurtainLookahead={setCurtainLookahead}
              showCursor={showCursor}
              setShowCursor={setShowCursor}
            />
          )}


        </div>

        {/* Sidebar (Sync Anchors) */}
        <AnchorSidebar
          anchors={anchors}
          beatAnchors={isLevel2Mode ? beatAnchors : []}
          isLevel2Mode={isLevel2Mode}
          toggleLevel2={toggleLevel2}
          regenerateBeats={generateBeatAnchors}
          upsertBeatAnchor={upsertBeatAnchor}
          subdivision={subdivision}
          setSubdivision={setSubdivision}
          darkMode={darkMode}
          upsertAnchor={upsertAnchor}
          handleDelete={handleDelete}
          handleRestamp={handleRestamp}
          handleJumpToMeasure={handleJumpToMeasure}
          handleTap={handleTap}
          handleReset={handleReset}
          mode={mode}
          currentMeasure={currentMeasure}
          handleAudioSelect={handleAudioSelect}
          handleXmlSelect={handleXmlSelect}
          toggleMode={toggleMode}
          handleAIPredict={handleAIPredict}
          handleTeachAI={handleTeachAI}
          isAILoading={isAILoading}
          hasAIPredictions={aiAnchors && aiAnchors.length > 0}
        />

      </div>

      {/* WAVEFORM TIMELINE — hidden during recording */}
      {
        !isRecording && (mode === 'RECORD' || mode === 'PLAYBACK') && audioUrl && (
          <WaveformTimeline
            audioUrl={audioUrl}
            anchors={anchors}
            beatAnchors={isLevel2Mode ? beatAnchors : []} // FIX: Pass beat anchors
            onUpdateAnchor={upsertAnchor}
            onUpdateBeatAnchor={upsertBeatAnchor}         // FIX: Pass update handler
            audioRef={audioRef}
            onSeek={(time) => {
              if (audioRef.current) audioRef.current.currentTime = time
            }}
          />
        )
      }

      {/* Global Footer (Audio Player) — hidden during recording */}
      <footer data-studio-hide className="bg-slate-900 border-t border-slate-800 p-3 z-50">
        <audio
          ref={audioRef} controls src={audioUrl}
          className="w-full h-8"
          onSeeked={handleSeeked}
          onEnded={handleEnded}
          onTimeUpdate={() => {
            if (audioRef.current && anchors.length > 0) {
              const m = getCurrentMeasure(audioRef.current.currentTime)
              if (m !== currentMeasure) setCurrentMeasure(m)
            }
          }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} // NEW: Capture duration
        />
      </footer>

      {/* Publish Modal */}
      <PublishModal
        isOpen={isPublishModalOpen}
        onClose={() => { setIsPublishModalOpen(false); setRecordedVideo(null) }}
        onPublish={handlePublish}
        isPublishing={isPublishing}
        videoFile={recordedVideo}
      />
    </div >
  )
}

export default App
