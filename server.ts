import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { pipeline, env } from "@huggingface/transformers";
import wavefile from "wavefile";

const { WaveFile } = wavefile;

// Disable local models for server-side as well
env.allowLocalModels = false;

const upload = multer({ storage: multer.memoryStorage() });

class ServerPipelineSingleton {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny';
    static instance: any = null;

    static async getInstance() {
        if (this.instance === null) {
            this.instance = pipeline(this.task as any, this.model);
        }
        return this.instance;
    }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for transcription
  app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      const language = req.body.language || "english";
      
      // Decode WAV file
      const wav = new WaveFile(req.file.buffer);
      wav.toBitDepth('32f');
      wav.toSampleRate(16000);
      
      let audioData: any = wav.getSamples();
      
      // If stereo, convert to mono
      if (Array.isArray(audioData) || (audioData.length > 0 && audioData[0].length)) {
        if (audioData.length > 1) {
          const mono = new Float32Array(audioData[0].length);
          for (let i = 0; i < audioData[0].length; i++) {
            mono[i] = (audioData[0][i] + audioData[1][i]) / 2;
          }
          audioData = mono;
        } else {
          audioData = audioData[0];
        }
      }
      
      // Ensure it's a Float32Array for Transformers.js
      if (!(audioData instanceof Float32Array)) {
        audioData = new Float32Array(audioData);
      }

      const transcriber = await ServerPipelineSingleton.getInstance();
      
      const output = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
        language: language,
        task: 'transcribe'
      });

      res.json({
        success: true,
        data: output
      });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ error: error.message || "Failed to process audio. Make sure it is a valid WAV file." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files from dist
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
