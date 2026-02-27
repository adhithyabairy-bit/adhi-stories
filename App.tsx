
import React, { useState, useRef, useEffect } from 'react';
import { Button } from './components/Button';
import { generateStory, generateStoryImage, generateSpeech } from './services/geminiService';
import { StoryGenre, StoryResponse, ImageStyle } from './services/types';

const LANGUAGES = [
  "English", "Hindi", "Bengali", "Telugu", "Marathi", "Tamil", "Gujarati",
  "Kannada", "Malayalam", "Punjabi", "Odia", "Assamese", "Spanish",
  "French", "German", "Japanese", "Chinese", "Arabic", "Russian", "Portuguese"
];

const GENRES = Object.values(StoryGenre);
const IMAGE_STYLES = Object.values(ImageStyle);

const VOICES = [
  { name: 'Kore', label: 'Male - Bold' },
  { name: 'Puck', label: 'Female - Cheerful' },
  { name: 'Charon', label: 'Male - Calm' },
  { name: 'Fenrir', label: 'Male - Deep' },
  { name: 'Zephyr', label: 'Female - Friendly' }
];

// Audio utilities for PCM decoding
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper to create a WAV header for raw PCM data
function createWavHeader(dataLength: number, sampleRate: number, numChannels: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // file length
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // length of fmt chunk
  view.setUint16(20, 1, true); // format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
  view.setUint16(32, numChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true);
  return header;
}

const App: React.FC = () => {
  const [elements, setElements] = useState<string>('');
  const [language, setLanguage] = useState<string>('English');
  const [genre, setGenre] = useState<StoryGenre>(StoryGenre.FANTASY);
  const [imageStyle, setImageStyle] = useState<ImageStyle>(ImageStyle.CARTOON);
  const [selectedVoice, setSelectedVoice] = useState<string>('Kore');

  const [loading, setLoading] = useState<boolean>(false);
  const [loadingImages, setLoadingImages] = useState<boolean>(false);
  const [loadingAudio, setLoadingAudio] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [story, setStory] = useState<StoryResponse | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Clear audio cache if voice changes
  useEffect(() => {
    setAudioBase64(null);
    stopAudio();
  }, [selectedVoice]);

  const handleGenerate = async () => {
    if (!elements.trim()) {
      setError("Please provide some elements for the story!");
      return;
    }

    stopAudio();
    setLoading(true);
    setLoadingImages(true);
    setError(null);
    setImages([]);
    setStory(null);
    setAudioBase64(null);

    try {
      const elementList = elements.split(',').map(e => e.trim()).filter(e => e.length > 0);

      // 1. Generate Story Text
      let generatedStory: StoryResponse;
      try {
        generatedStory = await generateStory({
          elements: elementList,
          language,
          genre,
          imageStyle
        });
        setStory(generatedStory);
      } catch (err) {
        console.error("Story generation failed:", err);
        setError("Failed to weave the story text. The weaver might be tired, please try again.");
        setLoading(false);
        setLoadingImages(false);
        return;
      }

      setLoading(false);

      // 2. Generate Images (Sequential to avoid 429 Rate Limits)
      const imagePrompts = [
        `Title: ${generatedStory.title}. Scene: The beginning. Elements: ${elements}`,
        `Title: ${generatedStory.title}. Scene: A key moment. Elements: ${elements}`,
        `Title: ${generatedStory.title}. Scene: The climax. Elements: ${elements}`,
        `Title: ${generatedStory.title}. Scene: The setting atmosphere. Elements: ${elements}`,
        `Title: ${generatedStory.title}. Scene: The conclusion. Elements: ${elements}`,
      ];

      const generatedImages: string[] = [];
      for (let i = 0; i < imagePrompts.length; i++) {
        try {
          const img = await generateStoryImage(imagePrompts[i], imageStyle);
          if (img) {
            generatedImages.push(img);
            // Update UI as images come in for better UX
            setImages([...generatedImages]);
          }
        } catch (err) {
          console.error(`Image ${i + 1} failed:`, err);
          // Continue with next images even if one fails
        }
      }

      if (generatedImages.length === 0) {
        console.warn("No images could be generated.");
      }
    } catch (err) {
      console.error("General generation error:", err);
      setError("Something went wrong with the magic. Please try one more time.");
    } finally {
      setLoading(false);
      setLoadingImages(false);
    }
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const fetchAudio = async (): Promise<string | null> => {
    if (audioBase64) return audioBase64;
    if (!story) return null;

    setLoadingAudio(true);
    try {
      const fullText = `${story.title}. ${story.summary}. ${story.parts.map(p => `${p.subtitle}. ${p.content}`).join(' ')}`;
      const base64 = await generateSpeech(fullText, selectedVoice);
      setAudioBase64(base64);
      return base64;
    } catch (err) {
      console.error("Speech generation failed:", err);
      return null;
    } finally {
      setLoadingAudio(false);
    }
  };

  const handlePlayAudio = async () => {
    if (isPlaying) {
      stopAudio();
      return;
    }

    const base64 = await fetchAudio();
    if (!base64) {
      setError("Could not play the story voice.");
      return;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const audioData = decodeBase64(base64);
      const audioBuffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsPlaying(false);

      sourceNodeRef.current = source;
      source.start(0);
      setIsPlaying(true);
    } catch (err) {
      console.error("Audio playback error:", err);
      setError("Audio playback failed.");
    }
  };

  const handleDownloadAudio = async () => {
    const base64 = await fetchAudio();
    if (!base64) {
      setError("Audio generation failed for download.");
      return;
    }

    const pcmData = decodeBase64(base64);
    const wavHeader = createWavHeader(pcmData.length, 24000, 1);
    const wavBlob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
    const url = URL.createObjectURL(wavBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${story?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getFormattedStoryText = () => {
    if (!story) return "";
    const parts = story.parts.map(p => `${p.subtitle.toUpperCase()}\n\n${p.content}`).join('\n\n---\n\n');
    return `${story.title}\n\nSummary: ${story.summary}\n\n${parts}\n\nTAKEAWAY:\n${story.moralOrTakeaway}`;
  };

  const handleCopy = async () => {
    const text = getFormattedStoryText();
    try {
      await navigator.clipboard.writeText(text);
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  const handleDownloadText = () => {
    const text = getFormattedStoryText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${story?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadImage = (base64Data: string, index: number) => {
    const a = document.createElement('a');
    a.href = base64Data;
    a.download = `adhi_story_art_${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 no-print">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-200">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.992 0 3.823.707 5.25 1.886V4.533ZM12.75 20.636A8.214 8.214 0 0 1 18 18.75c1.057 0 2.05.2 2.956.562a.75.75 0 0 0 1-.708V4.354a.75.75 0 0 0-.5-.708A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533V20.636Z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Adhi Stories</h1>
          </div>
          <div className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            Storytelling & Art AI
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Input Panel */}
        <aside className="lg:col-span-4 space-y-6 no-print">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Story Elements</label>
              <textarea
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all min-h-[100px]"
                placeholder="Ex: magic carpet, talking parrot, ancient city..."
                value={elements}
                onChange={(e) => setElements(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Language</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Genre</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value as StoryGenre)}
                >
                  {GENRES.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Illustration Style</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value as ImageStyle)}
                >
                  {IMAGE_STYLES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Narrator Voice</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {VOICES.map(v => (
                    <option key={v.name} value={v.name}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleGenerate}
              isLoading={loading || loadingImages}
            >
              Weave Magic
            </Button>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100">
                {error}
              </div>
            )}
          </section>

          <section className="bg-amber-600 p-6 rounded-2xl text-white shadow-lg shadow-amber-100 hidden lg:block">
            <h3 className="font-bold text-lg mb-2">Adhi Stories Art</h3>
            <p className="text-amber-100 text-sm leading-relaxed">
              We generate 5 custom illustrations and professional narration with your choice of male or female voices.
            </p>
          </section>
        </aside>

        {/* Story Display Panel */}
        <div className="lg:col-span-8 space-y-8">
          {!story && !loading && (
            <div className="h-[400px] flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-slate-200 rounded-2xl bg-white/50 no-print">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800">Your Story Canvas</h2>
              <p className="text-slate-500 mt-2 max-w-sm">
                Enter your elements to generate a full structured story, 5 custom illustrations, and professional narration.
              </p>
            </div>
          )}

          {(loading || loadingImages) && !story && (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
              <div className="h-10 bg-slate-100 rounded-lg animate-pulse w-3/4" />
              <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
              <div className="space-y-4 pt-6">
                <div className="h-32 bg-slate-100 rounded animate-pulse w-full" />
              </div>
              <div className="text-center text-sm text-slate-400 font-medium">
                {loading ? "Writing your story..." : "Painting the scenes..."}
              </div>
            </div>
          )}

          {story && (
            <article className="bg-white p-8 lg:p-12 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-500 print-article">
              <div className="mb-8 pb-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                  <span className="inline-block px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-full uppercase tracking-wider mb-4 no-print">
                    {genre} • {story.language}
                  </span>
                  <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight mb-4 tracking-tight serif-text">
                    {story.title}
                  </h1>
                </div>
                <div className="no-print flex items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={handlePlayAudio}
                    isLoading={loadingAudio}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full h-14 w-14 flex items-center justify-center p-0 shadow-lg shadow-indigo-200"
                    title={isPlaying ? "Stop Voice" : "Listen to Story"}
                  >
                    {isPlaying ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 translate-x-0.5">
                        <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
                      </svg>
                    )}
                  </Button>
                </div>
              </div>

              <div className="mb-8">
                <p className="text-lg text-slate-600 italic leading-relaxed font-medium">
                  "{story.summary}"
                </p>
              </div>

              <div className="space-y-10">
                {story.parts.map((part, idx) => (
                  <section key={idx} className="group">
                    <h3 className="text-sm font-bold text-amber-600 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                      <span className="w-6 h-px bg-amber-200 no-print" />
                      Section {idx + 1}: {part.subtitle}
                    </h3>
                    <div className="text-lg text-slate-700 leading-relaxed serif-text whitespace-pre-wrap">
                      {part.content}
                    </div>
                  </section>
                ))}
              </div>

              {/* Art Gallery Section */}
              <div className="mt-16 pt-8 border-t border-slate-100">
                <h3 className="text-2xl font-bold text-slate-900 serif-text mb-6">Visual Journey</h3>

                {loadingImages && images.length === 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="aspect-square bg-slate-100 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group rounded-xl overflow-hidden shadow-sm border border-slate-200 hover:shadow-lg transition-all">
                        <img src={img} alt={`Art ${idx + 1}`} className="w-full aspect-square object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 no-print">
                          <button
                            onClick={() => handleDownloadImage(img, idx)}
                            className="p-2 bg-white rounded-full text-slate-900 hover:bg-amber-50 transition-colors shadow-lg"
                            title="Download PNG"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 12l4.5 4.5m0 0 4.5-4.5M12 3v13.5" />
                            </svg>
                          </button>
                        </div>
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-white font-bold no-print">
                          Scene {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {images.length === 0 && !loadingImages && (
                  <p className="text-slate-400 text-sm italic">Images could not be generated for this story.</p>
                )}
              </div>

              <footer className="mt-12 pt-8 border-t-2 border-slate-100">
                <div className="bg-slate-50 p-6 rounded-xl border-l-4 border-amber-500">
                  <h4 className="text-sm font-bold text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                    </svg>
                    Wisdom of the Tale
                  </h4>
                  <p className="text-slate-800 font-medium leading-relaxed italic">
                    {story.moralOrTakeaway}
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-2 sm:flex sm:justify-end gap-3 no-print">
                  <Button variant="outline" onClick={handleCopy} className="text-sm border-slate-300 text-slate-600 hover:bg-slate-50">
                    {copying ? '✓ Copied!' : 'Copy Text'}
                  </Button>
                  <Button variant="outline" onClick={handleDownloadText} className="text-sm border-slate-300 text-slate-600 hover:bg-slate-50">
                    Save Text
                  </Button>
                  <Button variant="outline" onClick={handleDownloadAudio} isLoading={loadingAudio} className="text-sm border-slate-300 text-slate-600 hover:bg-slate-50">
                    Save Audio
                  </Button>
                  <Button variant="outline" onClick={() => window.print()} className="text-sm border-slate-300 text-slate-600 hover:bg-slate-50">
                    Print PDF
                  </Button>
                  <Button variant="primary" onClick={() => { stopAudio(); setStory(null); setImages([]); setAudioBase64(null); }} className="text-sm bg-amber-600 hover:bg-amber-700 col-span-2 sm:col-span-1">
                    Start New Story
                  </Button>
                </div>
              </footer>
            </article>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-10 no-print mt-auto">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-600 rounded-lg flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.992 0 3.823.707 5.25 1.886V4.533ZM12.75 20.636A8.214 8.214 0 0 1 18 18.75c1.057 0 2.05.2 2.956.562a.75.75 0 0 0 1-.708V4.354a.75.75 0 0 0-.5-.708A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533V20.636Z" />
              </svg>
            </div>
            <span className="font-bold text-white tracking-tight">Adhi Stories</span>
          </div>
          <div className="text-sm">
            © {new Date().getFullYear()} Adhi Stories AI. All images and text AI-generated.
          </div>
          <div className="flex gap-6 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }
          main { display: block !important; padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
          aside { display: none !important; }
          .lg\\:col-span-8 { width: 100% !important; margin: 0 !important; }
          header, footer { display: none !important; }
          article.print-article { border: none !important; box-shadow: none !important; padding: 0 !important; width: 100% !important; }
          img { break-inside: avoid; margin-bottom: 20px; }
          .serif-text { color: black !important; }
          @page { margin: 1.5cm; }
        }
      `}} />
    </div>
  );
};

export default App;
