import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Play, Pause, Loader2, FileAudio, RefreshCw, Info, Copy, Check, Code, AlignLeft, X, Globe, Terminal, Mic, Square, Download, MonitorPlay, Cpu, Zap, Video, PlayCircle, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Define the types for the worker messages
interface ProgressMessage {
  status: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

interface WordTimestamp {
  text?: string;
  word?: string;
  timestamp?: [number, number];
  start?: number;
  end?: number;
  speaker?: string;
}

interface TranscriptionOutput {
  text: string;
  chunks: WordTimestamp[];
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [language, setLanguage] = useState('english');
  const [model, setModel] = useState('Xenova/whisper-tiny');
  const [device, setDevice] = useState('wasm');
  const [showInfo, setShowInfo] = useState(false);
  const [activeTab, setActiveTab] = useState<'transcript' | 'karaoke' | 'json'>('transcript');
  const [copied, setCopied] = useState(false);
  
  // New states for advanced features
  const [isRecording, setIsRecording] = useState(false);
  const [downloadStats, setDownloadStats] = useState({ speed: 0, loaded: 0, total: 0, timeRemaining: 0 });
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const downloadsRef = useRef<Record<string, { loaded: number, total: number }>>({});
  const globalProgressRef = useRef({ time: Date.now(), loaded: 0, speed: 0, percentage: 0 });
  const karaokeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    const cached = localStorage.getItem('downloadedModels');
    if (cached) {
      try { setDownloadedModels(JSON.parse(cached)); } catch(e) {}
    }
  }, []);

  const createWorker = useCallback(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.addEventListener('message', (event) => {
      const data = event.data;

      if (data.status === 'init') {
        downloadsRef.current = {};
        globalProgressRef.current = { time: Date.now(), loaded: 0, speed: 0, percentage: 0 };
        setDownloadStats({ speed: 0, loaded: 0, total: 0, timeRemaining: 0 });
        setProgress(data);
      } else if (data.status === 'initiate') {
        downloadsRef.current[data.file] = { loaded: 0, total: 0 };
        setProgress({ status: 'progress', file: data.file, progress: globalProgressRef.current.percentage });
      } else if (data.status === 'progress') {
        downloadsRef.current[data.file] = { loaded: data.loaded, total: data.total };
        
        let globalLoaded = 0;
        let globalTotal = 0;
        Object.values(downloadsRef.current).forEach(file => {
          globalLoaded += file.loaded || 0;
          globalTotal += file.total || 0;
        });
        
        const now = Date.now();
        const timeDiff = (now - globalProgressRef.current.time) / 1000;
        
        let speed = globalProgressRef.current.speed;
        if (timeDiff > 0.5) {
          const loadedDiff = globalLoaded - globalProgressRef.current.loaded;
          speed = Math.max(0, loadedDiff / timeDiff);
          globalProgressRef.current.time = now;
          globalProgressRef.current.loaded = globalLoaded;
          globalProgressRef.current.speed = speed;
        }
        
        const remainingBytes = Math.max(0, globalTotal - globalLoaded);
        const timeRemaining = speed > 0 ? remainingBytes / speed : 0;
        const percentage = globalTotal > 0 ? Math.min(100, (globalLoaded / globalTotal) * 100) : 0;
        
        globalProgressRef.current.percentage = percentage;
        
        setDownloadStats({
          speed: speed / (1024 * 1024),
          loaded: globalLoaded / (1024 * 1024),
          total: globalTotal / (1024 * 1024),
          timeRemaining
        });
        
        setProgress({ status: 'progress', file: data.file, progress: percentage });
      } else if (data.status === 'done') {
        if (downloadsRef.current[data.file]) {
          downloadsRef.current[data.file].loaded = downloadsRef.current[data.file].total;
        }
        setProgress({ status: 'progress', file: data.file, progress: globalProgressRef.current.percentage });
      } else if (data.status === 'ready') {
        setProgress(data);
        setDownloadedModels(prev => {
          const currentModel = modelRef.current;
          if (!prev.includes(currentModel)) {
            const next = [...prev, currentModel];
            localStorage.setItem('downloadedModels', JSON.stringify(next));
            return next;
          }
          return prev;
        });
      } else if (data.status === 'complete') {
        // Heuristic Diarization (Pause-based)
        let currentSpeaker = 1;
        const processedChunks = data.output.chunks.map((chunk: any, i: number, arr: any[]) => {
          if (i > 0) {
            const prevEnd = arr[i-1].timestamp[1];
            const currentStart = chunk.timestamp[0];
            if (currentStart - prevEnd > 1.5) { // 1.5s pause means new speaker
              currentSpeaker = currentSpeaker === 1 ? 2 : 1;
            }
          }
          return { ...chunk, speaker: `Speaker ${currentSpeaker}` };
        });
        
        data.output.chunks = processedChunks;
        setTranscription(data.output);
        setIsProcessing(false);
        setProgress(null);
      } else if (data.status === 'error') {
        setError(data.error);
        setIsProcessing(false);
        setProgress(null);
      }
    });

    return worker;
  }, []);

  // Initialize the Web Worker
  useEffect(() => {
    workerRef.current = createWorker();
    return () => {
      workerRef.current?.terminate();
    };
  }, [createWorker]);

  // Karaoke Auto-scroll
  useEffect(() => {
    if (activeTab === 'karaoke' && karaokeRef.current) {
      const activeElement = karaokeRef.current.querySelector('.active-word');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, activeTab]);

  // Handle audio time update
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  // Handle word click to seek
  const handleWordClick = (start: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = start;
      if (!isPlaying) {
        audioRef.current.play();
      }
    }
  };

  // Decode audio/video file to Float32Array
  const decodeAudio = async (file: File): Promise<Float32Array> => {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer.getChannelData(0);
  };

  const cancelProcessing = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    workerRef.current = createWorker();
    setIsProcessing(false);
    setProgress(null);
    setError("Processing cancelled by user.");
  };

  const startTranscription = async () => {
    if (!file) return;
    setError(null);
    setIsProcessing(true);
    setProgress({ status: 'init', name: 'Preparing media...' });

    try {
      const audioData = await decodeAudio(file);
      
      // Send data to worker
      workerRef.current?.postMessage({
        audio: audioData,
        model: model,
        language: language,
        device: device
      });
    } catch (err: any) {
      setError(`Failed to process media: ${err.message}`);
      setIsProcessing(false);
    }
  };

  const handleFileSelection = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('audio/') && !selectedFile.type.startsWith('video/')) {
      setError('Please upload a valid audio or video file (e.g., WAV, MP3, MP4, WebM).');
      return;
    }

    setFile(selectedFile);
    setAudioUrl(URL.createObjectURL(selectedFile));
    setTranscription(null);
    setError(null);
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) handleFileSelection(selectedFile);
  };

  // Handle Microphone Recording
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const recordingFile = new File([audioBlob], "live_recording.webm", { type: 'audio/webm' });
          handleFileSelection(recordingFile);
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        setError("Microphone access denied or not available.");
      }
    }
  };

  // Export SRT / VTT
  const formatTimestamp = (seconds: number, isSRT: boolean) => {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return isSRT ? `${hh}:${mm}:${ss},${ms}` : `${hh}:${mm}:${ss}.${ms}`;
  };

  const exportSubs = (format: 'srt' | 'vtt') => {
    if (!transcription) return;
    let content = format === 'vtt' ? 'WEBVTT\n\n' : '';
    
    transcription.chunks.forEach((chunk, i) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? start + 1;
      const text = chunk.text ?? chunk.word ?? '';
      
      content += format === 'srt' ? `${i + 1}\n` : '';
      content += `${formatTimestamp(start, format === 'srt')} --> ${formatTimestamp(end, format === 'srt')}\n`;
      content += `${text.trim()}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript.${format}`;
    a.click();
  };

  const resetApp = () => {
    setFile(null);
    setAudioUrl(null);
    setTranscription(null);
    setError(null);
    setProgress(null);
    setIsProcessing(false);
    setCurrentTime(0);
    setIsPlaying(false);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--primary)] selection:text-[var(--primary-foreground)]">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-[var(--background)]/80 border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <FileAudio className="w-5 h-5" />
            <span>Word Timestamp Tester</span>
          </div>
          <nav className="flex items-center gap-4">
            <button 
              onClick={() => setShowInfo(true)} 
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors p-2 rounded-md hover:bg-[var(--secondary)]"
              title="How it Works"
            >
              <Info className="w-5 h-5" />
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-16 flex flex-col items-center">
        {/* Hero Section */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="text-center space-y-6 mb-12 w-full"
        >
          <h1 className="text-4xl md:text-6xl font-bold tracking-tighter">
            Audio & Video to Text, <span className="text-[var(--muted-foreground)]">Locally.</span>
          </h1>
          <p className="text-[var(--muted-foreground)] max-w-2xl mx-auto text-lg md:text-xl leading-relaxed">
            Browser-based Speech-to-Text with accurate word-level timestamps, diarization, and WebGPU support. 100% private.
          </p>
        </motion.section>

        {/* Content Area */}
        <div className="w-full max-w-4xl">
          <AnimatePresence mode="wait">
            {/* Upload State */}
            {!file && !isProcessing && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-8 shadow-sm"
              >
                {/* Settings Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Language</label>
                    <div className="flex items-center gap-2 bg-[var(--secondary)] px-3 py-2.5 rounded-lg border border-[var(--border)]">
                      <Globe className="w-4 h-4 text-[var(--muted-foreground)]" />
                      <select 
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="bg-transparent border-none text-sm font-medium text-[var(--foreground)] focus:ring-0 outline-none cursor-pointer w-full"
                      >
                        <option value="english" className="bg-[var(--card)] text-[var(--foreground)]">English</option>
                        <option value="turkish" className="bg-[var(--card)] text-[var(--foreground)]">Türkçe</option>
                        <option value="spanish" className="bg-[var(--card)] text-[var(--foreground)]">Español</option>
                        <option value="french" className="bg-[var(--card)] text-[var(--foreground)]">Français</option>
                        <option value="german" className="bg-[var(--card)] text-[var(--foreground)]">Deutsch</option>
                        <option value="italian" className="bg-[var(--card)] text-[var(--foreground)]">Italiano</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Model Size</label>
                    <div className="flex items-center gap-2 bg-[var(--secondary)] px-3 py-2.5 rounded-lg border border-[var(--border)]">
                      <Cpu className="w-4 h-4 text-[var(--muted-foreground)]" />
                      <select 
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="bg-transparent border-none text-sm font-medium text-[var(--foreground)] focus:ring-0 outline-none cursor-pointer w-full"
                      >
                        <option value="Xenova/whisper-tiny" className="bg-[var(--card)] text-[var(--foreground)]">Tiny (~73MB) - Fast {downloadedModels.includes('Xenova/whisper-tiny') ? '(Ready)' : ''}</option>
                        <option value="Xenova/whisper-base" className="bg-[var(--card)] text-[var(--foreground)]">Base (~145MB) - Balanced {downloadedModels.includes('Xenova/whisper-base') ? '(Ready)' : ''}</option>
                        <option value="Xenova/whisper-small" className="bg-[var(--card)] text-[var(--foreground)]">Small (~483MB) - Accurate {downloadedModels.includes('Xenova/whisper-small') ? '(Ready)' : ''}</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Compute Device</label>
                    <div className="flex items-center gap-2 bg-[var(--secondary)] px-3 py-2.5 rounded-lg border border-[var(--border)]">
                      <Zap className="w-4 h-4 text-[var(--muted-foreground)]" />
                      <select 
                        value={device}
                        onChange={(e) => setDevice(e.target.value)}
                        className="bg-transparent border-none text-sm font-medium text-[var(--foreground)] focus:ring-0 outline-none cursor-pointer w-full"
                      >
                        <option value="wasm" className="bg-[var(--card)] text-[var(--foreground)]">WASM (CPU)</option>
                        <option value="webgpu" className="bg-[var(--card)] text-[var(--foreground)]">WebGPU (Experimental)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <motion.div 
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2 }}
                    className="relative group cursor-pointer h-full"
                  >
                    <input
                      type="file"
                      accept="audio/*,video/mp4,video/webm,video/ogg"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="h-full border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] p-12 text-center transition-all duration-200 group-hover:border-[var(--foreground)] group-hover:bg-[var(--secondary)]/50 flex flex-col items-center justify-center">
                      <div className="w-14 h-14 bg-[var(--secondary)] rounded-full flex items-center justify-center mx-auto mb-5 group-hover:scale-110 transition-transform duration-200">
                        <Upload className="w-6 h-6 text-[var(--foreground)]" />
                      </div>
                      <h3 className="text-lg font-medium mb-2">Upload Media</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">WAV, MP3, MP4, WebM</p>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2 }}
                    onClick={toggleRecording}
                    className={`h-full border-2 border-dashed rounded-[var(--radius)] p-12 text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center
                      ${isRecording 
                        ? 'border-red-500/50 bg-red-500/10 hover:bg-red-500/20' 
                        : 'border-[var(--border)] hover:border-[var(--foreground)] hover:bg-[var(--secondary)]/50'}`}
                  >
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 transition-transform duration-200
                      ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-[var(--secondary)] text-[var(--foreground)] hover:scale-110'}`}>
                      {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-6 h-6" />}
                    </div>
                    <h3 className="text-lg font-medium mb-2">{isRecording ? 'Recording...' : 'Live Record'}</h3>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {isRecording ? 'Click to stop and transcribe' : 'Use your microphone'}
                    </p>
                  </motion.div>
                </div>
              </motion.div>
            )}

            {/* Start UI */}
            {file && !isProcessing && !transcription && (
              <motion.div
                key="start-ui"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-12 shadow-sm text-center"
              >
                <div className="w-16 h-16 bg-[var(--secondary)] rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileAudio className="w-8 h-8 text-[var(--foreground)]" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight mb-2 truncate max-w-md mx-auto">{file.name}</h2>
                <p className="text-[var(--muted-foreground)] mb-8">
                  Ready to transcribe using <strong>{model.split('/')[1]}</strong> on <strong>{device.toUpperCase()}</strong>
                </p>
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={resetApp}
                    className="px-6 py-3 bg-[var(--secondary)] text-[var(--foreground)] rounded-xl font-medium hover:bg-[var(--border)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={startTranscription}
                    className="px-6 py-3 bg-[var(--foreground)] text-[var(--background)] rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg shadow-[var(--foreground)]/10"
                  >
                    <PlayCircle className="w-5 h-5" />
                    Start Transcription
                  </button>
                </div>
              </motion.div>
            )}

            {/* Processing State */}
            {isProcessing && progress && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-12 shadow-sm text-center flex flex-col items-center"
              >
                <Loader2 className="w-10 h-10 animate-spin text-[var(--foreground)] mb-6" />
                <h3 className="text-xl font-medium tracking-tight mb-2">
                  {progress.status === 'init' ? 'Initializing Model...' : 
                   progress.status === 'progress' ? 'Downloading Model Weights...' : 
                   progress.status === 'ready' ? 'Transcribing Media...' : 'Processing...'}
                </h3>
                
                {progress.status === 'progress' && progress.progress !== undefined && (
                  <div className="w-full max-w-lg mt-6">
                    <div className="flex justify-between text-sm text-[var(--muted-foreground)] mb-3">
                      <span className="truncate max-w-[200px]">{progress.file || 'Loading...'}</span>
                      <div className="flex gap-4 font-mono items-center">
                        {downloadStats.speed > 0 && (
                          <span className="flex items-center gap-1 text-[var(--foreground)]">
                            <Zap className="w-3.5 h-3.5 text-yellow-500" />
                            {downloadStats.speed.toFixed(1)} MB/s
                          </span>
                        )}
                        <span>{downloadStats.loaded.toFixed(1)} / {downloadStats.total.toFixed(1)} MB</span>
                        <span>{Math.round(progress.progress)}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-[var(--secondary)] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--foreground)] transition-all duration-300 ease-out"
                        style={{ width: `${progress.progress}%` }}
                      />
                    </div>
                    {downloadStats.timeRemaining > 0 && (
                      <p className="text-xs text-[var(--muted-foreground)] mt-3 font-mono">
                        Estimated time remaining: {formatETA(downloadStats.timeRemaining)}
                      </p>
                    )}
                  </div>
                )}
                
                {progress.status === 'ready' && (
                  <p className="text-[var(--muted-foreground)] text-sm mt-4">This might take a moment depending on your device and model size...</p>
                )}

                <button
                  onClick={cancelProcessing}
                  className="mt-8 px-4 py-2 bg-red-950/30 text-red-400 border border-red-900/50 rounded-lg text-sm font-medium hover:bg-red-900/50 transition-colors flex items-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Cancel Processing
                </button>
              </motion.div>
            )}

            {/* Error State */}
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-red-950/30 border border-red-900/50 rounded-[var(--radius)] p-8 text-center"
              >
                <p className="text-red-400 font-medium mb-6">{error}</p>
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={resetApp}
                  className="px-6 py-2.5 bg-red-900/50 text-red-200 rounded-lg font-medium hover:bg-red-900/70 transition-colors"
                >
                  Try Again
                </motion.button>
              </motion.div>
            )}

            {/* Results State */}
            {transcription && file && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="space-y-6"
              >
                {/* Audio Player Card */}
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5 flex items-center gap-5 shadow-sm">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      if (audioRef.current) {
                        if (isPlaying) audioRef.current.pause();
                        else audioRef.current.play();
                      }
                    }}
                    className="w-12 h-12 flex-shrink-0 bg-[var(--foreground)] text-[var(--background)] rounded-full flex items-center justify-center hover:opacity-90 transition-opacity"
                  >
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                  </motion.button>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-[var(--foreground)]">{file.name}</p>
                    <p className="text-sm text-[var(--muted-foreground)] font-mono mt-0.5">
                      {audioRef.current ? formatTime(currentTime) : '0:00'} / {audioRef.current ? formatTime(audioRef.current.duration || 0) : '0:00'}
                    </p>
                  </div>
                  
                  <audio
                    ref={audioRef}
                    src={audioUrl || ''}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onTimeUpdate={handleTimeUpdate}
                    className="hidden"
                  />

                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={resetApp}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--foreground)] bg-[var(--secondary)] rounded-lg hover:bg-[var(--border)] transition-colors"
                  >
                    <RefreshCw size={16} />
                    <span className="hidden sm:inline">New File</span>
                  </motion.button>
                </div>

                {/* Transcription Card */}
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden shadow-sm">
                  <div className="flex border-b border-[var(--border)] bg-[var(--background)]/50 overflow-x-auto custom-scrollbar">
                    <button
                      onClick={() => setActiveTab('transcript')}
                      className={`flex-1 py-4 px-6 text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'transcript' ? 'text-[var(--foreground)] border-b-2 border-[var(--foreground)] bg-[var(--card)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]/50'}`}
                    >
                      <AlignLeft size={18} />
                      Interactive Transcript
                    </button>
                    <button
                      onClick={() => setActiveTab('karaoke')}
                      className={`flex-1 py-4 px-6 text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'karaoke' ? 'text-[var(--foreground)] border-b-2 border-[var(--foreground)] bg-[var(--card)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]/50'}`}
                    >
                      <MonitorPlay size={18} />
                      Karaoke Mode
                    </button>
                    <button
                      onClick={() => setActiveTab('json')}
                      className={`flex-1 py-4 px-6 text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'json' ? 'text-[var(--foreground)] border-b-2 border-[var(--foreground)] bg-[var(--card)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]/50'}`}
                    >
                      <Code size={18} />
                      JSON Output
                    </button>
                  </div>

                  <div className="p-8">
                    {activeTab === 'transcript' && (
                      <div className="text-lg leading-loose font-sans text-[var(--foreground)]">
                        {transcription.chunks?.map((chunk, index) => {
                          const start = chunk.timestamp?.[0] ?? 0;
                          const end = chunk.timestamp?.[1] ?? start + 1;
                          const wordText = chunk.text ?? chunk.word ?? '';
                          const speaker = chunk.speaker;
                          
                          const isActive = currentTime >= start && currentTime <= end;
                          const isPast = currentTime > end;
                          
                          // Show speaker label if it changed
                          const prevSpeaker = index > 0 ? transcription.chunks[index-1].speaker : null;
                          const showSpeaker = speaker && speaker !== prevSpeaker;
                          
                          return (
                            <React.Fragment key={index}>
                              {showSpeaker && (
                                <div className="mt-6 mb-2 text-sm font-bold text-[var(--primary)] uppercase tracking-wider flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-[var(--primary)]"></div>
                                  {speaker}
                                </div>
                              )}
                              <span
                                onClick={() => handleWordClick(start)}
                                className={`
                                  inline-block px-1.5 py-0.5 mx-0.5 rounded-md cursor-pointer transition-all duration-150
                                  ${isActive ? 'bg-[var(--foreground)] text-[var(--background)] font-medium shadow-sm scale-105' : ''}
                                  ${isPast && !isActive ? 'text-[var(--foreground)]' : ''}
                                  ${!isPast && !isActive ? 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]' : ''}
                                `}
                                title={`[${start.toFixed(2)}s - ${end.toFixed(2)}s]`}
                              >
                                {wordText}
                              </span>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}

                    {activeTab === 'karaoke' && (
                      <div 
                        ref={karaokeRef}
                        className="h-[400px] overflow-y-auto custom-scrollbar flex flex-col items-center py-32 px-4 scroll-smooth"
                      >
                        <div className="text-3xl md:text-5xl font-bold leading-tight text-center max-w-3xl space-y-4">
                          {transcription.chunks?.map((chunk, index) => {
                            const start = chunk.timestamp?.[0] ?? 0;
                            const end = chunk.timestamp?.[1] ?? start + 1;
                            const wordText = chunk.text ?? chunk.word ?? '';
                            
                            const isActive = currentTime >= start && currentTime <= end;
                            const isPast = currentTime > end;
                            
                            return (
                              <span
                                key={index}
                                onClick={() => handleWordClick(start)}
                                className={`
                                  inline-block mx-2 my-2 transition-all duration-300 cursor-pointer
                                  ${isActive ? 'text-[var(--foreground)] scale-110 active-word drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]' : ''}
                                  ${isPast && !isActive ? 'text-[var(--muted-foreground)]' : ''}
                                  ${!isPast && !isActive ? 'text-[var(--border)]' : ''}
                                `}
                              >
                                {wordText}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeTab === 'json' && (
                      <div className="relative">
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button
                            onClick={() => exportSubs('srt')}
                            className="p-2 bg-[var(--secondary)] text-[var(--foreground)] rounded-lg hover:bg-[var(--border)] transition-colors flex items-center gap-2 text-sm font-medium border border-[var(--border)]"
                          >
                            <Download size={16} /> SRT
                          </button>
                          <button
                            onClick={() => exportSubs('vtt')}
                            className="p-2 bg-[var(--secondary)] text-[var(--foreground)] rounded-lg hover:bg-[var(--border)] transition-colors flex items-center gap-2 text-sm font-medium border border-[var(--border)]"
                          >
                            <Download size={16} /> VTT
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(transcription, null, 2));
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="p-2 bg-[var(--secondary)] text-[var(--foreground)] rounded-lg hover:bg-[var(--border)] transition-colors flex items-center gap-2 text-sm font-medium border border-[var(--border)]"
                          >
                            {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                            {copied ? 'Copied!' : 'Copy JSON'}
                          </button>
                        </div>
                        <pre className="bg-[#09090b] text-[#d4d4d8] p-6 rounded-xl overflow-x-auto text-sm font-mono max-h-[500px] overflow-y-auto border border-[var(--border)] custom-scrollbar">
                          <code>{JSON.stringify(transcription, null, 2)}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8 mt-auto bg-[var(--background)]">
        <div className="max-w-5xl mx-auto px-6 text-center text-sm text-[var(--muted-foreground)]">
          Developed by <a href="https://github.com/ozguradmin" target="_blank" rel="noopener noreferrer" className="text-[var(--foreground)] font-medium hover:underline">@ozguradmin</a>
        </div>
      </footer>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowInfo(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-8 max-w-lg w-full shadow-2xl relative"
            >
              <button 
                onClick={() => setShowInfo(false)}
                className="absolute top-4 right-4 p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] bg-[var(--secondary)] rounded-full transition-colors"
              >
                <X size={18} />
              </button>
              
              <div className="w-12 h-12 bg-[var(--secondary)] text-[var(--foreground)] rounded-xl flex items-center justify-center mb-6 border border-[var(--border)]">
                <Terminal size={24} />
              </div>
              
              <h3 className="text-xl font-semibold tracking-tight text-[var(--foreground)] mb-4">How it Works & API</h3>
              
              <div className="space-y-4 text-[var(--muted-foreground)] text-sm leading-relaxed max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                <p>
                  This application runs entirely in your browser using <strong>Transformers.js</strong> and <strong>WebAssembly (WASM) / WebGPU</strong>.
                </p>
                <p>
                  Your audio/video files are never sent to any external server. The processing is done locally using your device's CPU/GPU, ensuring 100% privacy.
                </p>
                
                <h4 className="font-semibold text-[var(--foreground)] mt-4 mb-2">New Features</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Model Selection:</strong> Choose between Tiny, Base, and Small models for better accuracy.</li>
                  <li><strong>WebGPU:</strong> Experimental support for hardware acceleration in supported browsers.</li>
                  <li><strong>Video Support:</strong> Upload MP4/WebM videos directly.</li>
                  <li><strong>Live Record:</strong> Transcribe directly from your microphone.</li>
                  <li><strong>Export:</strong> Download subtitles in SRT or VTT formats from the JSON tab.</li>
                  <li><strong>Diarization:</strong> Heuristic speaker detection based on pauses.</li>
                </ul>

                <div className="mt-6 pt-6 border-t border-[var(--border)]">
                  <h4 className="font-semibold text-[var(--foreground)] mb-2">API Integration</h4>
                  <p className="mb-3">
                    This system also includes a built-in REST API. Note: The API currently only supports WAV files, while the browser UI supports Video/MP3/WAV.
                  </p>
                  
                  <div className="bg-[#09090b] text-[#d4d4d8] p-4 rounded-xl text-xs font-mono overflow-x-auto mb-3 border border-[var(--border)]">
                    <p className="text-zinc-500 mb-1"># Example cURL request</p>
                    <code>
                      curl -X POST {window.location.origin}/api/transcribe \<br/>
                      &nbsp;&nbsp;-H "Accept: application/json" \<br/>
                      &nbsp;&nbsp;-F "audio=@/path/to/your/audio.wav" \<br/>
                      &nbsp;&nbsp;-F "language=english"
                    </code>
                  </div>

                  <p className="mb-2 text-[var(--foreground)] font-medium">Parameters:</p>
                  <ul className="list-disc pl-5 space-y-1 mb-4">
                    <li><code>audio</code>: The audio file (WAV format recommended for API)</li>
                    <li><code>language</code>: (Optional) english, turkish, spanish, etc.</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper to format seconds to M:SS
function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatETA(seconds: number): string {
  if (!seconds || seconds === Infinity) return 'Calculating...';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
