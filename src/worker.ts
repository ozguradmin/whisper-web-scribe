import { pipeline, env } from '@huggingface/transformers';

class PipelineSingleton {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny';
    static device = 'wasm';
    static instance: any = null;

    static async getInstance(progress_callback: Function, model: string, device: string) {
        if (this.instance === null || this.model !== model || this.device !== device) {
            this.model = model;
            this.device = device;
            try {
                this.instance = await pipeline(this.task as any, this.model, {
                    progress_callback,
                    device: this.device as any
                });
            } catch (err) {
                console.warn("Requested device failed, falling back to wasm", err);
                this.device = 'wasm';
                this.instance = await pipeline(this.task as any, this.model, {
                    progress_callback,
                    device: 'wasm'
                });
            }
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { audio, model, language, device } = event.data;

    try {
        const transcriber = await PipelineSingleton.getInstance((x: any) => {
            self.postMessage(x);
        }, model || 'Xenova/whisper-tiny', device || 'wasm');

        const output = await transcriber(audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word',
            language: language || 'english',
            task: 'transcribe'
        });

        self.postMessage({ status: 'complete', output });
    } catch (error: any) {
        self.postMessage({ status: 'error', error: error.message });
    }
});
