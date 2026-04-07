/**
 * Browser Native TTS (Text-to-Speech) Hook
 * Uses Web Speech API for client-side text-to-speech
 * Completely free, no API key required
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Note: Window.SpeechSynthesis declaration is already in the global scope

export interface UseBrowserTTSOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  rate?: number; // 0.1 to 10
  pitch?: number; // 0 to 2
  volume?: number; // 0 to 1
  lang?: string; // e.g., 'zh-CN', 'en-US'
}

export function useBrowserTTS(options: UseBrowserTTSOptions = {}) {
  const {
    onStart,
    onEnd,
    onError,
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    lang = 'zh-CN',
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentSpeechRef = useRef<{ text: string; voiceURI?: string } | null>(null);
  const pausedRef = useRef(false);
  const canceledUtterancesRef = useRef(new WeakSet<SpeechSynthesisUtterance>());
  const availableVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const callbacksRef = useRef({ onStart, onEnd, onError });

  useEffect(() => {
    callbacksRef.current = { onStart, onEnd, onError };
  }, [onStart, onEnd, onError]);

  // Load available voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      availableVoicesRef.current = voices;
      setAvailableVoices(voices);
    };

    loadVoices();

    // Some browsers load voices asynchronously
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const speak = useCallback(
    (text: string, voiceURI?: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        callbacksRef.current.onError?.('Browser does not support Web Speech API');
        return;
      }

      // Cancel any ongoing speech
      if (utteranceRef.current) {
        canceledUtterancesRef.current.add(utteranceRef.current);
      }
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      currentSpeechRef.current = { text, voiceURI };
      pausedRef.current = false;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      utterance.lang = lang;

      // Set voice if specified
      if (voiceURI) {
        const voice = availableVoicesRef.current.find((v) => v.voiceURI === voiceURI);
        if (voice) {
          utterance.voice = voice;
        }
      }

      utterance.onstart = () => {
        if (canceledUtterancesRef.current.has(utterance)) return;
        setIsSpeaking(true);
        setIsPaused(false);
        pausedRef.current = false;
        callbacksRef.current.onStart?.();
      };

      utterance.onend = () => {
        if (canceledUtterancesRef.current.has(utterance)) return;
        if (utteranceRef.current === utterance) {
          setIsSpeaking(false);
          setIsPaused(false);
          utteranceRef.current = null;
          currentSpeechRef.current = null;
          pausedRef.current = false;
        }
        callbacksRef.current.onEnd?.();
      };

      utterance.onerror = (event) => {
        if (canceledUtterancesRef.current.has(utterance)) return;
        if (utteranceRef.current === utterance) {
          setIsSpeaking(false);
          setIsPaused(false);
          utteranceRef.current = null;
          currentSpeechRef.current = null;
          pausedRef.current = false;
        }
        callbacksRef.current.onError?.(event.error);
      };

      utterance.onpause = () => {
        pausedRef.current = true;
        setIsPaused(true);
      };

      utterance.onresume = () => {
        pausedRef.current = false;
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [rate, pitch, volume, lang],
  );

  const pause = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
      pausedRef.current = true;
      setIsPaused(true);
      window.speechSynthesis.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      if (pausedRef.current && currentSpeechRef.current) {
        const current = currentSpeechRef.current;
        speak(current.text, current.voiceURI);
        return;
      }
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  }, [speak]);

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      if (utteranceRef.current) {
        canceledUtterancesRef.current.add(utteranceRef.current);
      }
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
      currentSpeechRef.current = null;
      pausedRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!utteranceRef.current || pausedRef.current || !currentSpeechRef.current) return;
    const current = currentSpeechRef.current;
    speak(current.text, current.voiceURI);
  }, [rate, pitch, volume, lang, speak]);

  return {
    speak,
    pause,
    resume,
    cancel,
    isSpeaking,
    isPaused,
    availableVoices,
  };
}
