// src/services/aiService.ts
// AI-powered anchor prediction using Google Gemini 3 Pro
// Uses Dynamic Few-Shot Learning from past user corrections

import { GoogleGenAI } from '@google/genai'
import { projectService } from './projectService'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ''

const genAI = new GoogleGenAI({ apiKey })

// Max size for inline base64 (15 MB). Larger files use the File API.
const MAX_INLINE_SIZE = 15 * 1024 * 1024

// Helper to convert blob to base64 for Gemini InlineData (small files only)
const fileToBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const base64 = result.split(',')[1]
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

// Strict JSON Schema for the response — forces Gemini to output exactly this structure
const anchorArraySchema = {
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            measure: { type: "integer" as const, description: "The measure number (1-indexed)" },
            time: { type: "number" as const, description: "Start time in seconds (to 0.01 precision)" }
        },
        required: ["measure", "time"]
    }
}

export const aiService = {
    /**
     * Send audio + MusicXML to Gemini 3 Pro and get predicted anchor mappings.
     * - Uses File API for large audio, inlineData for small
     * - Uses responseSchema for bulletproof JSON output
     * - Builds dynamic few-shot prompt with contextual guidance
     */
    async predictAnchors(audioFile: File | Blob, xmlText: string): Promise<{ measure: number; time: number }[]> {
        if (!apiKey) throw new Error("Missing VITE_GEMINI_API_KEY in your .env.local file.")

        // --- DYNAMIC FEW-SHOT LEARNING ---
        // Fetch past projects where AI was used and user corrected the mapping
        let historyPrompt = ""
        try {
            const pastExamples = await projectService.getProjectsWithCorrections()
            if (pastExamples && pastExamples.length > 0) {
                historyPrompt = "\n\n--- LEARNING FROM PAST CORRECTIONS ---\n"
                historyPrompt += "Below are examples of your previous predictions vs the human's final corrections. "
                historyPrompt += "Use these ONLY to understand the user's general latency bias and timing preferences "
                historyPrompt += "(e.g., the user consistently places anchors 0.1s earlier, or prefers fermatas held 1.5x longer). "
                historyPrompt += "Do NOT blindly copy timing offsets — each piece has different musical content. "
                historyPrompt += "Rely ONLY on the current audio waveform and MusicXML for musical cues like fermatas, ritardandos, and tempo changes.\n\n"
                pastExamples.forEach((ex, i) => {
                    historyPrompt += `Example ${i + 1}: \"${ex.title}\"\n`
                    historyPrompt += `Your Initial Prediction: ${JSON.stringify(ex.ai_anchors)}\n`
                    historyPrompt += `User's Final Correction: ${JSON.stringify(ex.anchors)}\n\n`
                })
                historyPrompt += "--- END LEARNING EXAMPLES ---\n\n"
            }
        } catch (err) {
            console.warn('[AI] Could not fetch past corrections for few-shot learning:', err)
        }

        const promptText = `You are an expert musician and audio-to-score alignment AI.
Your task is to analyze the provided live audio performance and the corresponding MusicXML score.
Generate a JSON array of anchor points mapping each measure number to its start time in seconds in the audio.

Instructions:
1. Listen carefully to the audio waveform. Identify when each measure begins based on the musical content.
2. Read the MusicXML score thoroughly. The XML contains critical performance information:
   - <time> tags tell you the time signature (beats per measure)
   - <fermata> tags mean the performer will hold that note/rest longer than written — the measure will take more time
   - <words> tags may contain "rit.", "accel.", "rubato", "a tempo" — these affect timing
   - <direction> tags contain dynamics and expression marks
   - <repeat> and <ending> tags indicate structural repeats
3. For live performances, tempos are NOT constant. Use your musical intuition along with the audio to determine exact timestamps.
4. Measure 1 ALWAYS starts at time 0.0.
5. Be precise — timestamps should be accurate to the nearest 0.01 seconds.

${historyPrompt}`

        const mimeType = audioFile.type || 'audio/mp3'

        // --- BUILD AUDIO PART ---
        // Use File API for large files (>15MB), inlineData for small ones
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let audioPart: any

        if (audioFile.size > MAX_INLINE_SIZE) {
            // Large file: upload via Gemini File API to avoid base64 bloat / 413 errors
            console.log(`[AI] Audio file is ${(audioFile.size / 1024 / 1024).toFixed(1)}MB — using File API upload`)
            const uploadResult = await genAI.files.upload({
                file: audioFile,
                config: { mimeType }
            })
            audioPart = {
                fileData: {
                    fileUri: uploadResult.uri,
                    mimeType: mimeType,
                }
            }
        } else {
            // Small file: inline base64 is fine
            const base64Audio = await fileToBase64(audioFile)
            audioPart = {
                inlineData: {
                    data: base64Audio,
                    mimeType: mimeType,
                }
            }
        }

        // Call Gemini 3 Pro with multimodal content (audio + text)
        // Uses responseSchema for bulletproof structured output
        const response = await genAI.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: promptText },
                        audioPart,
                        { text: `\n\n--- MusicXML Score Content ---\n${xmlText}` }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseJsonSchema: anchorArraySchema,
                temperature: 0.2, // Low temperature for more deterministic timing predictions
            }
        })

        // Parse the response (schema guarantees valid JSON, but we still validate)
        const responseText = response.text || ''
        try {
            const parsed = JSON.parse(responseText)
            if (!Array.isArray(parsed)) {
                throw new Error("Response is not an array")
            }
            return parsed.map((p: { measure: number; time: number }) => ({
                measure: Number(p.measure),
                time: Number(p.time)
            }))
        } catch (e) {
            console.error("[AI] Failed to parse Gemini output:", responseText)
            throw new Error("AI returned invalid JSON. Please try again.")
        }
    }
}
