interface Anchor {
    measure: number
    time: number
}

interface AnchorSidebarProps {
    anchors: Anchor[]
    darkMode: boolean
    upsertAnchor?: (measure: number, time: number) => void
    handleDelete?: (measure: number) => void
    handleRestamp?: (measure: number) => void
    handleJumpToMeasure: (time: number) => void
    handleTap: () => void
    handleReset: () => void
    mode: 'PLAYBACK' | 'RECORD'
    currentMeasure: number
    audioCurrentTime?: number // Optional for restamp logic availability
    // New Props for restoring functionality
    handleAudioSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
    handleXmlSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
    toggleMode?: () => void
    // Level 2
    isLevel2Mode?: boolean
    toggleLevel2?: () => void
    regenerateBeats?: () => void
    beatAnchors?: { measure: number, beat: number, time: number }[]
    upsertBeatAnchor?: (measure: number, beat: number, time: number) => void
    subdivision?: number // NEW
    setSubdivision?: (val: number) => void // NEW
    // AI Anchor Mapping
    handleAIPredict?: () => void
    handleTeachAI?: () => void
    isAILoading?: boolean
    hasAIPredictions?: boolean
}

// Note: I'm adding functional props here (upsert, delete, etc.) to ensure it actually works 
// like the original sidebar, not just a display.
export function AnchorSidebar({
    anchors, darkMode, upsertAnchor, handleDelete, handleRestamp,
    handleJumpToMeasure, handleTap, handleReset, mode, currentMeasure,
    handleAudioSelect, handleXmlSelect, toggleMode,
    isLevel2Mode, toggleLevel2, regenerateBeats, beatAnchors = [], upsertBeatAnchor,
    subdivision, setSubdivision,
    handleAIPredict, handleTeachAI, isAILoading, hasAIPredictions
}: AnchorSidebarProps) {

    // Derived state for rendering ghost measures
    const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map(a => a.measure)) : 0
    const rows = []

    for (let m = 1; m <= maxMeasure; m++) {
        const anchor = anchors.find(a => a.measure === m)
        const isActive = m === currentMeasure

        if (anchor) {
            rows.push(
                <div key={m}
                    className={`flex items-center justify-between p-2 rounded text-xs border ${isActive ? (darkMode ? 'bg-orange-900/30 border-orange-600 ring-1 ring-orange-500/30' : 'bg-orange-50 border-orange-300 ring-1 ring-orange-200') : (darkMode ? 'bg-[#222222] border-slate-700' : 'bg-white border-gray-200')}`}
                    onClick={() => handleJumpToMeasure(anchor.time)}
                >
                    <span className={`font-mono font-bold ${isActive ? 'text-orange-500' : (darkMode ? 'text-slate-300' : 'text-slate-500')}`}>M{m}</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="number" step="0.01"
                            value={anchor.time.toFixed(2)}
                            onChange={(e) => upsertAnchor && upsertAnchor(m, parseFloat(e.target.value))}
                            disabled={mode !== 'RECORD' || m === 1}
                            className={`w-16 text-right border rounded px-1 font-mono ${darkMode ? 'bg-slate-800 border-slate-600 text-emerald-400' : 'bg-white border-gray-300'}`}
                            onClick={e => e.stopPropagation()}
                        />
                        {m !== 1 && mode === 'RECORD' && handleDelete && (
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(m) }} className={`${darkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}>×</button>
                        )}
                    </div>
                </div>
            )

            // LEVEL 2 BEATS rendering
            if (isLevel2Mode && beatAnchors && beatAnchors.length > 0) {
                const beats = beatAnchors.filter(b => b.measure === m).sort((a, b) => a.beat - b.beat)
                if (beats.length > 0) {
                    rows.push(
                        <div key={`${m}-beats`} className={`pl-8 pr-2 pb-2 text-xs border-b border-x ${darkMode ? 'bg-[#1a1a1a] border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {beats.map(b => (
                                    <div key={`${b.measure}-${b.beat}`} className="flex items-center gap-1 justify-end">
                                        <span className={`text-[9px] font-bold ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>B{b.beat}</span>
                                        <input
                                            type="number" step="0.01"
                                            value={b.time.toFixed(2)}
                                            onChange={(e) => upsertBeatAnchor && upsertBeatAnchor(b.measure, b.beat, parseFloat(e.target.value))}
                                            className={`w-14 text-right text-[10px] border rounded px-1 font-mono focus:outline-none focus:ring-1 focus:ring-yellow-400 ${darkMode
                                                ? 'bg-slate-800 border-slate-600 text-yellow-500'
                                                : 'bg-yellow-50 border-yellow-200 text-slate-700 focus:bg-white'
                                                }`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                }
            }
        } else {
            rows.push(
                <div key={m} className={`flex items-center justify-between p-2 rounded text-xs border border-dashed opacity-60 ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                    <span className={`font-mono ${darkMode ? 'text-red-400' : 'text-red-400'}`}>M{m} (Ghost)</span>
                    {mode === 'RECORD' && handleRestamp && (
                        <button onClick={() => handleRestamp(m)} className={`text-[10px] px-2 py-0.5 rounded ${darkMode ? 'bg-red-900/50 text-red-400' : 'bg-red-100 text-red-600'}`}>Fix</button>
                    )}
                </div>
            )
        }
    }

    return (
        <aside className={`w-[320px] border-l flex flex-col shadow-xl z-30 transition-colors duration-300 ${darkMode ? 'bg-[#1a1a1a] border-slate-800' : 'bg-white border-gray-300'}`}>

            {/* Playback Controls / Mode Toggle */}
            <div className={`p-4 border-b flex items-center gap-2 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-gray-50'}`}>
                {toggleMode && (
                    <button
                        onClick={toggleMode}
                        className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'RECORD'
                            ? 'bg-red-500 text-white shadow-red-500/20'
                            : 'bg-emerald-500 text-white shadow-emerald-500/20'
                            }`}
                    >
                        {mode === 'RECORD' ? '🔴 REC Mode' : '▶️ PLAY Mode'}
                    </button>
                )}
            </div>

            {/* Inputs */}
            <div className={`p-4 border-b space-y-3 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-gray-50'}`}>
                {handleAudioSelect && (
                    <div>
                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>Audio Source</label>
                        <input type="file" accept="audio/*" onChange={handleAudioSelect} className={`text-xs w-full ${darkMode ? 'text-slate-300' : ''}`} />
                    </div>
                )}
                {handleXmlSelect && (
                    <div>
                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>Score XML</label>
                        <input type="file" accept=".xml,.musicxml" onChange={handleXmlSelect} className={`text-xs w-full ${darkMode ? 'text-slate-300' : ''}`} />
                    </div>
                )}
            </div>

            {/* AI Assistant Section */}
            {(handleAIPredict || handleTeachAI) && (
                <div className={`p-4 border-b space-y-2 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-indigo-100 bg-indigo-50/50'}`}>
                    <h2 className={`font-bold text-[10px] uppercase tracking-wide mb-2 flex items-center gap-1 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                        ✨ Gemini AI Assistant
                    </h2>
                    {handleAIPredict && (
                        <button
                            onClick={handleAIPredict}
                            disabled={isAILoading || mode !== 'RECORD'}
                            className={`w-full py-2 rounded text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 ${isAILoading || mode !== 'RECORD'
                                    ? 'bg-indigo-300 dark:bg-indigo-900/50 cursor-not-allowed opacity-70 text-white/70'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                                }`}
                        >
                            {isAILoading ? '🧠 Analyzing Audio & XML...' : '🪄 AI Anchor Map'}
                        </button>
                    )}
                    {handleTeachAI && hasAIPredictions && (
                        <button
                            onClick={handleTeachAI}
                            disabled={mode !== 'RECORD'}
                            className={`w-full py-2 rounded text-xs font-bold transition-all border shadow-sm ${darkMode
                                    ? 'border-indigo-500/50 text-indigo-400 hover:bg-indigo-900/30'
                                    : 'border-indigo-300 text-indigo-700 hover:bg-indigo-100 bg-white'
                                }`}
                        >
                            🎓 Teach AI Fixed Mappings
                        </button>
                    )}
                </div>
            )}

            <div className={`p-4 border-b ${darkMode ? 'border-slate-800' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                    <h2 className={`font-bold text-sm uppercase tracking-wide ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Sync Anchors</h2>
                    {toggleLevel2 && (
                        <button
                            onClick={toggleLevel2}
                            className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${isLevel2Mode
                                ? 'bg-yellow-500 text-white shadow-md'
                                : (darkMode ? 'bg-slate-700 text-slate-400 hover:bg-slate-600' : 'bg-gray-200 text-gray-500 hover:bg-gray-300')
                                }`}
                        >
                            {isLevel2Mode ? 'L2: ON' : 'L2: OFF'}
                        </button>
                    )}
                </div>

                {/* Subdivision Input */}
                {isLevel2Mode && setSubdivision && (
                    <div className="flex items-center justify-between mt-2 pl-1">
                        <span className={`text-[10px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Beat Subdivision:</span>
                        <input
                            type="number" min="2" max="16"
                            value={subdivision}
                            onChange={(e) => setSubdivision(parseInt(e.target.value) || 4)}
                            className={`w-12 text-right text-xs border rounded px-1 ${darkMode ? 'bg-slate-800 border-slate-600 text-yellow-400' : 'bg-white border-gray-300'}`}
                        />
                    </div>
                )}

                <div className="flex justify-between items-end mt-2">
                    <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{anchors.length} measures</p>
                    {isLevel2Mode && (
                        <span className="text-[10px] text-yellow-500 font-mono">
                            {beatAnchors?.length || 0} beats
                        </span>
                    )}
                </div>

                {isLevel2Mode && regenerateBeats && (
                    <button
                        onClick={regenerateBeats}
                        className={`mt-3 w-full text-[11px] font-bold py-1.5 rounded border transition-colors shadow-sm ${darkMode
                            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-400 hover:bg-emerald-800 hover:text-white'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            }`}
                    >
                        {beatAnchors && beatAnchors.length > 0 ? '↻ Regenerate Beats' : '▶ Generate Beats'}
                    </button>
                )}
            </div>

            <div className={`flex-1 overflow-y-auto p-2 space-y-1 ${darkMode ? 'bg-[#1a1a1a]' : 'bg-slate-50'}`}>
                {rows}
            </div>

            {/* Footer with Tap/Clear */}
            <div className={`p-4 border-t grid grid-cols-2 gap-2 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-white'}`}>
                <button onClick={handleReset} disabled={mode !== 'RECORD'} className={`py-2 rounded border text-xs font-bold ${darkMode ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Clear All</button>
                <button onClick={handleTap} disabled={mode !== 'RECORD'} className="py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-500/20">TAP (A)</button>
            </div>
        </aside>
    )
}
