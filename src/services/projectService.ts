import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// Initialize client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL or Key missing. Save/Load features will not work.')
}

// 1. The Workbench Client (Your existing one)
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseKey || 'placeholder-key'
)

// 2. The Bridge Client (Connects to Piano Studio)
export const pianoStudioClient = createClient(
    import.meta.env.VITE_PIANO_STUDIO_URL || 'https://placeholder.supabase.co',
    import.meta.env.VITE_PIANO_STUDIO_KEY || 'placeholder-key'
)

// 3. Cloudflare R2 Client (S3-compatible storage for media)
const r2AccountId = import.meta.env.VITE_R2_ACCOUNT_ID || ''
const r2Client = new S3Client({
    region: 'auto',
    endpoint: r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : undefined,
    credentials: {
        accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID || '',
        secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY || '',
    },
})
const R2_BUCKET = import.meta.env.VITE_R2_BUCKET_NAME || 'master-performances'
const R2_PUBLIC_DOMAIN = import.meta.env.VITE_R2_PUBLIC_DOMAIN || ''

// Function to clean filename for storage
const cleanFileName = (fileName: string) => {
    return fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
}

/**
 * Upload a file to Cloudflare R2.
 * @param file - The file to upload
 * @param folder - Subfolder in the bucket (e.g. 'audio', 'video')
 * @returns The full public URL of the uploaded file
 */
async function uploadToR2(file: File, folder: string): Promise<string> {
    const cleanName = cleanFileName(file.name)
    const key = `${folder}/${Date.now()}_${cleanName}`

    const arrayBuffer = await file.arrayBuffer()

    await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: new Uint8Array(arrayBuffer),
        ContentType: file.type,
    }))

    return `${R2_PUBLIC_DOMAIN}/${key}`
}

export interface Project {
    id: string
    title: string
    audio_url: string
    xml_url: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anchors: any[]
    // Level 2 Beat Mapping (nullable for backwards compatibility)
    beat_anchors?: { measure: number; beat: number; time: number }[] | null
    subdivision?: number | null
    is_level2?: boolean | null
    // AI Anchor Mapping (stores Gemini's initial predictions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai_anchors?: any[] | null
    created_at: string
    updated_at: string
}

export const projectService = {
    // Upload a file to 'scores' bucket and return public URL
    async uploadFile(file: File): Promise<string> {
        const timestamp = Date.now()
        const cleanName = cleanFileName(file.name)
        const fileName = `${timestamp}_${cleanName}`

        const { error: uploadError } = await supabase.storage
            .from('scores')
            .upload(fileName, file)

        if (uploadError) throw uploadError

        // Get public URL
        const { data } = supabase.storage
            .from('scores')
            .getPublicUrl(fileName)

        return data.publicUrl
    },

    // Save project metadata to DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async saveProject(
        title: string, audioFile: File, xmlFile: File, anchors: any[],
        beatAnchors?: { measure: number; beat: number; time: number }[],
        subdivision?: number, isLevel2?: boolean,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aiAnchors?: any[]
    ) {
        // 1. Upload files
        console.log('[ProjectService] Uploading audio...')
        const audioUrl = await this.uploadFile(audioFile)

        console.log('[ProjectService] Uploading XML...')
        const xmlUrl = await this.uploadFile(xmlFile)

        // 2. Insert row
        console.log('[ProjectService] Saving project metadata...')
        const { data, error } = await supabase
            .from('projects')
            .insert({
                title,
                audio_url: audioUrl,
                xml_url: xmlUrl,
                anchors: anchors,
                beat_anchors: beatAnchors || [],
                subdivision: subdivision ?? 4,
                is_level2: isLevel2 ?? false,
                ai_anchors: aiAnchors || [],
                updated_at: new Date().toISOString()
            })
            .select()

        if (error) throw error
        return data[0]
    },

    // Update existing project (anchors + beat data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async updateProject(
        id: string, anchors: any[],
        beatAnchors?: { measure: number; beat: number; time: number }[],
        subdivision?: number, isLevel2?: boolean,
        title?: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aiAnchors?: any[]
    ) {
        console.log(`[ProjectService] Updating project ${id}...`)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates: any = {
            anchors: anchors,
            beat_anchors: beatAnchors || [],
            subdivision: subdivision ?? 4,
            is_level2: isLevel2 ?? false,
            updated_at: new Date().toISOString()
        }

        if (title) {
            updates.title = title
        }
        if (aiAnchors) {
            updates.ai_anchors = aiAnchors
        }

        const { data, error } = await supabase
            .from('projects')
            .update(updates)
            .eq('id', id)
            .select()

        if (error) throw error
        return data[0]
    },

    // Fetch all projects
    async getProjects(): Promise<Project[]> {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false })

        if (error) throw error
        return data || []
    },

    // Fetch projects that have AI predictions (for few-shot learning context)
    async getProjectsWithCorrections(): Promise<Project[]> {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .not('ai_anchors', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(3) // Only pull the last 3 to save context tokens

        if (error) throw error
        // Filter out projects where ai_anchors is empty array
        return (data || []).filter(p => p.ai_anchors && p.ai_anchors.length > 0)
    },

    // Fetch a single project by ID
    async getProjectById(id: string): Promise<Project | null> {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('id', id)
            .single()

        if (error) {
            console.warn('Could not fetch project:', error)
            return null
        }
        return data
    },

    /**
     * PUBLISH TO PIANO STUDIO
     * Uploads media to Cloudflare R2, then updates the Piano Studio DB.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async publishToPiece(pieceId: string, audioFile: File, projectData: any, videoFile?: File | null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {
            reference_anchors: projectData.anchors,
            reference_beat_anchors: projectData.beat_anchors || [],
            reference_subdivision: projectData.subdivision ?? 4,
            reference_is_level2: projectData.is_level2 ?? false
        }

        // A. Upload Audio to R2
        if (audioFile) {
            console.log('[Publish] Uploading Master Audio to R2...')
            const audioUrl = await uploadToR2(audioFile, 'audio')
            updatePayload.reference_audio_url = audioUrl
            console.log('[Publish] Audio uploaded:', audioUrl)
        }

        // B. Upload Video to R2 (if recorded)
        if (videoFile) {
            console.log('[Publish] Uploading Master Video to R2...')
            const videoUrl = await uploadToR2(videoFile, 'video')
            updatePayload.reference_video_url = videoUrl
            console.log('[Publish] Video uploaded:', videoUrl)
        }

        // C. Update the 'pieces' table in PIANO STUDIO
        console.log('[Publish] Syncing Data to Piano Studio DB...')
        const { error } = await pianoStudioClient
            .from('pieces')
            .update(updatePayload)
            .eq('id', pieceId)

        if (error) throw error

        return { success: true }
    }
}
