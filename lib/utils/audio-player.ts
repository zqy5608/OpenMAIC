/**
 * Audio Player - Audio player interface
 *
 * Handles audio playback, pause, stop, and other operations
 * Loads pre-generated TTS audio files from IndexedDB
 *
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

/**
 * Audio player implementation
 */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private speechUtterance: SpeechSynthesisUtterance | null = null;
  private speechText: string | null = null;
  private browserSpeechPaused: boolean = false;
  private canceledUtterances = new WeakSet<SpeechSynthesisUtterance>();
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;
  private browserSpeechEnabled: boolean = false;

  /**
   * Enable browser-native speech synthesis fallback when no generated audio exists.
   */
  public setBrowserSpeechEnabled(enabled: boolean): void {
    this.browserSpeechEnabled = enabled;
    if (!enabled) this.stopBrowserSpeech();
  }

  /**
   * Play audio (from URL or IndexedDB pre-generated cache)
   * @param audioId Audio ID
   * @param audioUrlOrOptions Optional server-generated audio URL, or browser fallback options
   * @returns true if audio started playing, false if no audio (TTS disabled or not generated)
   */
  public async play(
    audioId: string,
    audioUrlOrOptions?: string | { fallbackText?: string },
  ): Promise<boolean> {
    try {
      if (typeof audioUrlOrOptions === 'string' && audioUrlOrOptions) {
        this.stop();

        const audio = new Audio();
        this.audio = audio;
        audio.src = audioUrlOrOptions;
        if (this.muted) audio.volume = 0;
        else audio.volume = this.volume;
        audio.defaultPlaybackRate = this.playbackRate;
        audio.playbackRate = this.playbackRate;

        const currentAudio = audio;
        const cleanup = () => {
          if (this.audio === currentAudio) {
            this.audio = null;
          }
        };
        audio.addEventListener('ended', () => {
          cleanup();
          this.onEndedCallback?.();
        });
        audio.addEventListener('error', cleanup, { once: true });

        await audio.play();
        audio.playbackRate = this.playbackRate;
        return true;
      }

      // Get audio from database
      const audioRecord = audioId ? await db.audioFiles.get(audioId) : undefined;

      if (!audioRecord) {
        const fallbackText =
          typeof audioUrlOrOptions === 'object' ? audioUrlOrOptions.fallbackText : undefined;
        if (fallbackText && this.browserSpeechEnabled) {
          return this.speakWithBrowser(fallbackText);
        }

        // Pre-generated audio does not exist (generation failed), skip silently
        return false;
      }

      return this.playBlob(audioRecord.blob);
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  public async playBlob(blob: Blob): Promise<boolean> {
    this.stop();

    const audio = new Audio();
    this.audio = audio;

    const blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    if (this.muted) audio.volume = 0;
    else audio.volume = this.volume;

    audio.defaultPlaybackRate = this.playbackRate;
    audio.playbackRate = this.playbackRate;
    const currentAudio = audio;
    const cleanup = () => {
      URL.revokeObjectURL(blobUrl);
      if (this.audio === currentAudio) {
        this.audio = null;
      }
    };

    audio.addEventListener('ended', () => {
      cleanup();
      this.onEndedCallback?.();
    });
    audio.addEventListener('error', cleanup, { once: true });

    await audio.play();
    // Re-apply after play() - some browsers reset during load
    audio.playbackRate = this.playbackRate;
    return true;
  }

  private speakWithBrowser(text: string): boolean {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      !('SpeechSynthesisUtterance' in window)
    ) {
      return false;
    }

    this.stop();
    this.speechText = text;
    this.browserSpeechPaused = false;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.inferLanguage(text);
    utterance.rate = this.playbackRate;
    utterance.volume = this.muted ? 0 : this.volume;

    utterance.onend = () => {
      if (this.speechUtterance === utterance) {
        this.speechUtterance = null;
        this.speechText = null;
        this.browserSpeechPaused = false;
      }
      if (!this.canceledUtterances.has(utterance)) {
        this.onEndedCallback?.();
      }
    };

    utterance.onerror = (event) => {
      if (this.speechUtterance === utterance) {
        this.speechUtterance = null;
        this.speechText = null;
        this.browserSpeechPaused = false;
      }
      if (!this.canceledUtterances.has(utterance)) {
        log.error('Browser speech synthesis failed:', event.error);
        this.onEndedCallback?.();
      }
    };

    this.speechUtterance = utterance;
    this.resumeBrowserSpeechIfPaused();
    window.speechSynthesis.speak(utterance);
    return true;
  }

  private inferLanguage(text: string): string {
    const cjkCount = (
      text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []
    ).length;
    return cjkCount > text.length * 0.3 ? 'zh-CN' : 'en-US';
  }

  private stopBrowserSpeech(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && this.speechUtterance) {
      this.canceledUtterances.add(this.speechUtterance);
      window.speechSynthesis.cancel();
      this.resumeBrowserSpeechIfPaused();
      this.speechUtterance = null;
      this.speechText = null;
      this.browserSpeechPaused = false;
    }
  }

  private resumeBrowserSpeechIfPaused(): void {
    if (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis.paused
    ) {
      window.speechSynthesis.resume();
    }
  }

  private restartBrowserSpeechIfActive(): void {
    if (!this.speechUtterance || this.browserSpeechPaused || !this.speechText) return;
    this.speakWithBrowser(this.speechText);
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
    if (this.speechUtterance && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.browserSpeechPaused = true;
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
      }
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.stopBrowserSpeech();
    // Note: onEndedCallback intentionally NOT cleared here because play()
    // calls stop() internally — clearing would break the callback chain.
    // Stale callbacks are harmless: engine mode check prevents processNext().
  }

  /**
   * Resume playback
   */
  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => {
        log.error('Failed to resume audio:', error);
      });
      return;
    }
    if (this.speechUtterance && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (this.browserSpeechPaused && this.speechText) {
        this.browserSpeechPaused = false;
        window.speechSynthesis.resume();
      } else if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  }

  /**
   * Get current playback status (actively playing, not paused)
   */
  public isPlaying(): boolean {
    if (this.audio !== null && !this.audio.paused) return true;
    if (this.browserSpeechPaused) return false;
    if (this.speechUtterance && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return window.speechSynthesis.speaking && !window.speechSynthesis.paused;
    }
    return false;
  }

  /**
   * Whether there is active audio (playing or paused, but not ended)
   * Used to decide whether to resume playback or skip to the next line
   */
  public hasActiveAudio(): boolean {
    return this.audio !== null || this.speechUtterance !== null;
  }

  /**
   * Get current playback time (milliseconds)
   */
  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Get audio duration (milliseconds)
   */
  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  /**
   * Set playback ended callback
   */
  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  /**
   * Set mute state (takes effect immediately on currently playing audio)
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
    if (this.speechUtterance) {
      this.speechUtterance.volume = muted ? 0 : this.volume;
      this.restartBrowserSpeechIfActive();
    }
  }

  /**
   * Set volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
    if (this.speechUtterance && !this.muted) {
      this.speechUtterance.volume = this.volume;
      this.restartBrowserSpeechIfActive();
    }
  }

  /**
   * Set playback speed (takes effect immediately on currently playing audio)
   */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) {
      this.audio.playbackRate = this.playbackRate;
    }
    if (this.speechUtterance) {
      this.speechUtterance.rate = this.playbackRate;
      this.restartBrowserSpeechIfActive();
    }
  }

  /**
   * Destroy the player
   */
  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

/**
 * Create an audio player instance
 */
export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
