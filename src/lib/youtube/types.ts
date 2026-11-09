export type YouTubePlayerState =
  | 'UNSTARTED'  // -1
  | 'ENDED'      // 0
  | 'PLAYING'    // 1
  | 'PAUSED'     // 2
  | 'BUFFERING'  // 3
  | 'CUED';      // 5

export interface YouTubePlayerError {
  code: number;
  message: string;
}

export interface PlaybackState {
  videoId: string;
  playbackStatus: 'playing' | 'paused' | 'buffering' | 'ended' | 'idle';
  positionSeconds: number;
  updatedAt: number; // Unix timestamp ms
  playbackVersion: number;
  currentSingerId: string | null;
  masterVolume?: number; // 0 - 100
}

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  addedAt: number;
}
