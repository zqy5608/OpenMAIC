import type { Action } from '@/lib/types/action';

export type SceneWithAudioActions = {
  actions?: Action[];
};

function uniqueAudioIds(audioIds: Iterable<string>): string[] {
  return Array.from(new Set(audioIds));
}

export function collectAudioIdsFromActions(actions?: Action[]): string[] {
  if (!actions?.length) return [];

  return uniqueAudioIds(
    actions
      .filter((action) => action.type === 'speech')
      .map((action) => action.audioId?.trim())
      .filter((audioId): audioId is string => !!audioId),
  );
}

export function collectAudioIdsFromScenes(scenes?: SceneWithAudioActions[]): string[] {
  if (!scenes?.length) return [];

  return uniqueAudioIds(scenes.flatMap((scene) => collectAudioIdsFromActions(scene.actions)));
}

export function collectRemovedAudioIds(
  previousScenes?: SceneWithAudioActions[],
  nextScenes?: SceneWithAudioActions[],
): string[] {
  const nextAudioIds = new Set(collectAudioIdsFromScenes(nextScenes));
  return collectAudioIdsFromScenes(previousScenes).filter((audioId) => !nextAudioIds.has(audioId));
}
