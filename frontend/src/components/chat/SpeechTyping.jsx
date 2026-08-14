import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Languages } from "lucide-react";
import { toast } from "sonner";

export default function SpeechTyping({ onSpeechResult, currentText = "" }) {
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("hi-IN"); // Default Hindi
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        const newText = currentText ? `${currentText} ${transcript}` : transcript;
        onSpeechResult(newText);
      }
    };

    recognition.onerror = (event) => {
      setListening(false);
      if (event.error !== "no-speech") {
        toast.error(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [lang, onSpeechResult, currentText]);

  if (!supported) return <span className="text-[11px] text-slate-500" role="status">Voice typing unavailable; text and voice messages still work.</span>;

  const toggleListening = (e) => {
    e.preventDefault();
    if (!recognitionRef.current) return;

    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      try {
        recognitionRef.current.lang = lang;
        recognitionRef.current.start();
        setListening(true);
        toast.info(lang === "hi-IN" ? "हिंदी में बोलें..." : "Speak now in English...");
      } catch (err) {
        setListening(false);
      }
    }
  };

  const toggleLang = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextLang = lang === "hi-IN" ? "en-IN" : "hi-IN";
    setLang(nextLang);
    toast.success(`Speech language: ${nextLang === "hi-IN" ? "Hindi (हिंदी)" : "English"}`);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={listening ? "Stop voice typing" : "Voice typing in Hindi or English"}
        onClick={toggleListening}
        title={listening ? "Stop voice typing" : "बोलकर लिखें / Voice typing"}
        className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1 transition-all ${
          listening
            ? "bg-rose-500 text-white border-rose-600 animate-pulse"
            : "bg-white text-slate-700 border-slate-300 hover:border-teal-700 hover:bg-slate-50"
        }`}
      >
        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-teal-800" />}
        <span className="hidden sm:inline">{listening ? "सुन रहा है..." : "बोलें"}</span>
      </button>

      <button
        type="button"
        aria-label="Change speech recognition language"
        onClick={toggleLang}
        title="Change speech language"
        className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 text-[10px] font-bold"
      >
        {lang === "hi-IN" ? "HI" : "EN"}
      </button>
    </div>
  );
}
