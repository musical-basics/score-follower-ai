// src/services/aiService.ts
// AI-powered anchor prediction using Google Gemini 3 Pro
// Uses Dynamic Few-Shot Learning from past user corrections

import { GoogleGenAI } from '@google/genai'
import { projectService } from './projectService'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ''

const genAI = new GoogleGenAI({ apiKey })

// Helper to convert blob to base64 for Gemini InlineData
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

export const aiService = {
    /**
     * Send audio + MusicXML to Gemini 3 Pro and get predicted anchor mappings.
     * Builds a dynamic few-shot prompt from past user corrections for continuous learning.
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
                historyPrompt += "Below are examples of your previous predictions and how the human corrected them for live performances. "
                historyPrompt += "Learn from these patterns — pay attention to how the user adjusts for fermatas, tempo changes, ritardandos, rubatos, and performance expression:\n\n"
                pastExamples.forEach((ex, i) => {
                    historyPrompt += `Example ${i + 1}: \"${ex.title}\"\n`
                    historyPrompt += `Your Initial Prediction: ${JSON.stringify(ex.ai_anchors)}\n`
                    historyPrompt += `User's Final Correction: ${JSON.stringify(ex.anchors)}\n\n`
                })
                historyPrompt += "Apply these learned correction patterns to your prediction for the new piece below.\n"
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

${historyPrompt}

Output ONLY a valid JSON array in this exact format (no markdown fencing, no explanation):
[
  {"measure": 1, "time": 0.0},
  {"measure": 2, "time": 2.45},
  {"measure": 3, "time": 5.12}
]`

        // Convert audio to base64
        const base64Audio = await fileToBase64(audioFile)
        const mimeType = (audioFile instanceof File ? audioFile.type : audioFile.type) || 'audio/mp3'

        // Call Gemini 3 Pro with multimodal content (audio + text)
        const response = await genAI.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: promptText },
                        {
                            inlineData: {
                                data: base64Audio,
                                mimeType: mimeType,
                            }
                        },
                        { text: `\n\n--- MusicXML Score Content ---\n${xmlText}` }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
                temperature: 0.2, // Low temperature for more deterministic timing predictions
            }
        })

        // Parse the response
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
