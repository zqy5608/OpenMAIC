import { describe, expect, it } from 'vitest';

import {
  collectAudioIdsFromActions,
  collectAudioIdsFromScenes,
  collectRemovedAudioIds,
} from '@/lib/audio/audio-cleanup';
import type { Action } from '@/lib/types/action';

const speech = (id: string, audioId?: string): Action => ({
  id,
  type: 'speech',
  text: `Speech ${id}`,
  audioId,
});

describe('audio cleanup helpers', () => {
  it('collects unique audio IDs only from speech actions', () => {
    const actions: Action[] = [
      speech('a', 'tts_a'),
      { id: 'spotlight-a', type: 'spotlight', elementId: 'shape-a' },
      speech('b', 'tts_b'),
      speech('c', 'tts_a'),
      speech('d', '  '),
    ];

    expect(collectAudioIdsFromActions(actions)).toEqual(['tts_a', 'tts_b']);
  });

  it('collects audio IDs across scenes', () => {
    expect(
      collectAudioIdsFromScenes([
        { actions: [speech('a', 'tts_a')] },
        { actions: [speech('b', 'tts_b'), speech('c', 'tts_a')] },
      ]),
    ).toEqual(['tts_a', 'tts_b']);
  });

  it('returns audio IDs that are no longer referenced', () => {
    const previousScenes = [
      { actions: [speech('a', 'tts_a'), speech('b', 'tts_b')] },
      { actions: [speech('c', 'tts_c')] },
    ];
    const nextScenes = [{ actions: [speech('a', 'tts_a'), speech('d', 'tts_d')] }];

    expect(collectRemovedAudioIds(previousScenes, nextScenes)).toEqual(['tts_b', 'tts_c']);
  });
});
