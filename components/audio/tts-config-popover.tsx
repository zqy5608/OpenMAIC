'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { Volume2, Play, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { getTTSVoices } from '@/lib/audio/constants';

const TTS_PREVIEW_TEXT =
  '\u4f60\u597d\uff0c\u6b22\u8fce\u6765\u5230AI\u8bfe\u5802\uff01\u8ba9\u6211\u4eec\u4e00\u8d77\u5b66\u4e60\u5427\u3002';

/** Extract the English name from voice name format "ChineseName (English)" */
function getVoiceDisplayName(name: string, lang: string): string {
  if (lang === 'en-US') {
    const match = name.match(/\(([^)]+)\)/);
    return match ? match[1] : name;
  }
  return name;
}

export function TtsConfigPopover() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTTSEnabled = useSettingsStore((s) => s.setTTSEnabled);
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);

  const voices = getTTSVoices(ttsProviderId);
  const localizedVoices = useMemo(
    () =>
      voices.map((v) => ({
        ...v,
        displayName: getVoiceDisplayName(v.name, locale),
      })),
    [voices, locale],
  );

  const pillCls =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap border';

  const handlePreview = useCallback(async () => {
    if (previewing) {
      audioRef.current?.pause();
      if (ttsProviderId === 'browser-native-tts' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      audioRef.current = null;
      setPreviewing(false);
      return;
    }

    setPreviewing(true);
    try {
      if (ttsProviderId === 'browser-native-tts') {
        if (!('speechSynthesis' in window)) {
          throw new Error('Browser TTS is not supported');
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(TTS_PREVIEW_TEXT);
        utterance.rate = ttsSpeed;
        utterance.lang = locale === 'en-US' ? 'en-US' : 'zh-CN';
        utterance.onend = () => setPreviewing(false);
        utterance.onerror = () => setPreviewing(false);
        window.speechSynthesis.speak(utterance);
        return;
      }

      const providerConfig = ttsProvidersConfig[ttsProviderId];
      const res = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: TTS_PREVIEW_TEXT,
          audioId: 'preview',
          ttsProviderId: ttsProviderId,
          ttsVoice: ttsVoice,
          ttsSpeed,
          ttsApiKey: providerConfig?.apiKey,
          ttsBaseUrl: providerConfig?.baseUrl,
        }),
      });

      if (!res.ok) throw new Error('TTS failed');

      const data = await res.json();
      if (data.base64) {
        const audio = new Audio(`data:audio/${data.format || 'mp3'};base64,${data.base64}`);
        audioRef.current = audio;
        audio.onended = () => {
          setPreviewing(false);
          audioRef.current = null;
        };
        audio.onerror = () => {
          setPreviewing(false);
          audioRef.current = null;
        };
        await audio.play();
      }
    } catch {
      setPreviewing(false);
    }
  }, [ttsProviderId, ttsVoice, ttsSpeed, ttsProvidersConfig, previewing, locale]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                pillCls,
                ttsEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-700/50'
                  : 'border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60',
              )}
            >
              <Volume2 className="size-3.5" />
              {ttsEnabled && (
                <span className="max-w-[60px] truncate">
                  {localizedVoices.find((v) => v.id === ttsVoice)?.displayName || ttsVoice}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('toolbar.ttsHint')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-[280px] p-0">
        {/* Header with toggle */}
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border/40">
          <Volume2
            className={cn(
              'size-4 shrink-0',
              ttsEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
            )}
          />
          <span
            className={cn('flex-1 text-sm font-medium', !ttsEnabled && 'text-muted-foreground')}
          >
            {t('toolbar.ttsTitle')}
          </span>
          <Switch
            checked={ttsEnabled}
            onCheckedChange={setTTSEnabled}
            className="scale-[0.85] origin-right"
          />
        </div>

        {/* Config body */}
        {ttsEnabled && (
          <div className="px-3.5 py-3 space-y-3">
            {/* Voice + Preview row */}
            <div className="flex items-center gap-2">
              <Select value={ttsVoice} onValueChange={setTTSVoice}>
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {localizedVoices.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      {v.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={handlePreview}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all shrink-0',
                  previewing
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {previewing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                {previewing ? t('toolbar.ttsPreviewing') : t('toolbar.ttsPreview')}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
