export type UserRole = 'admin' | 'host' | 'singer' | 'invited_singer' | 'listener';

export interface RoomMember {
  id: string;
  name: string;
  role: UserRole;
  isSuperAdmin?: boolean;
  isHost?: boolean;
  isMuted: boolean;
  audioLevel: number; // 0 - 100
  canPublishMic: boolean;
  joinedAt: number;
  // 3D Avatar & spatial sync fields
  avatarId?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  action?: string;
  seated?: boolean;
}

export interface PlaybackState {
  videoId: string;
  title?: string;
  playbackStatus: 'playing' | 'paused' | 'buffering' | 'ended' | 'idle';
  positionSeconds: number;
  updatedAt: number; // Server timestamp in ms
  playbackVersion: number;
  currentSingerId: string | null;
  masterVolume: number; // 0 - 100
}

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  addedAt: number;
}

export interface RoomState {
  roomId: string;
  adminId: string;
  hostId: string;
  singerId: string;
  invitedSingerIds: string[];
  roomMuted?: boolean;
  members: RoomMember[];
  playback: PlaybackState;
  queue: QueueItem[];
  history: QueueItem[];
  serverTime: number;
}
