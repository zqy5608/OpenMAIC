import { collectAudioIdsFromActions } from '@/lib/audio/audio-cleanup';
import type { Action } from '@/lib/types/action';
import { db } from '@/lib/utils/database';

export async function deleteAudioFilesByIds(audioIds: Iterable<string>): Promise<void> {
  const uniqueIds = Array.from(new Set(Array.from(audioIds, (id) => id.trim()))).filter(
    (id) => id.length > 0,
  );
  if (uniqueIds.length === 0) return;

  await db.audioFiles.bulkDelete(uniqueIds);
}

export async function deleteAudioFilesForActions(actions?: Action[]): Promise<void> {
  await deleteAudioFilesByIds(collectAudioIdsFromActions(actions));
}
