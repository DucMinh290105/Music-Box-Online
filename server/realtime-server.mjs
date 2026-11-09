import http from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3101;
const MAX_MEMBERS = 20;
const MAX_MICS = 3;

// Helper to fetch real video title from YouTube oEmbed (zero API key required)
async function fetchYouTubeTitle(videoId, fallbackTitle) {
  if (fallbackTitle && !fallbackTitle.startsWith('Video (') && !fallbackTitle.startsWith('YouTube (')) {
    return fallbackTitle;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) return String(data.title);
    }
  } catch {
    // Ignore network/oembed errors and use fallback
  }
  return fallbackTitle || `YouTube (${videoId})`;
}

function sanitizeRoomId(raw) {
  const cleaned = String(raw || 'music-box-20')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return cleaned || 'music-box-20';
}

// Multi-room in-memory store (supports shareable links ?room=...)
export const rooms = new Map();

export function getOrCreateRoom(rawRoomId) {
  const roomId = sanitizeRoomId(rawRoomId);
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      adminId: '',
      singerId: '',
      invitedSingerIds: [], // max 2
      members: new Map(), // socketId -> member
      playback: {
        videoId: 'K4DyBUG242c',
        title: 'Cartoon, Jéja - On & On (feat. Daniel Levi) [NCS]',
        playbackStatus: 'paused',
        positionSeconds: 0,
        updatedAt: Date.now(),
        playbackVersion: 1,
        currentSingerId: null,
        masterVolume: 80,
      },
      queue: [
        { id: 'q-1', videoId: 'jfKfPfyJRdk', title: 'Lofi Girl - Chill Lofi Hip Hop Radio', addedBy: 'Music Box', addedAt: Date.now() },
        { id: 'q-2', videoId: 'bM7SZ5SBzyY', title: 'Elektronomia - Sky High [NCS Release]', addedBy: 'Music Box', addedAt: Date.now() },
        { id: 'q-3', videoId: 'FlsCjmMhFmw', title: 'Alan Walker - Fade [NCS Release]', addedBy: 'Music Box', addedAt: Date.now() },
      ],
      history: [],
    });
  }
  return rooms.get(roomId);
}

function serializeRoomState(roomState) {
  return {
    roomId: roomState.roomId,
    adminId: roomState.adminId,
    singerId: roomState.singerId,
    invitedSingerIds: [...roomState.invitedSingerIds],
    members: Array.from(roomState.members.values()),
    playback: { ...roomState.playback },
    queue: [...roomState.queue],
    history: [...roomState.history],
    serverTime: Date.now(),
  };
}

function recalculateRoles(roomState) {
  for (const [id, member] of roomState.members.entries()) {
    let role = 'listener';
    let canPublish = false;

    if (id === roomState.adminId) {
      role = 'admin';
      canPublish = true;
    } else if (id === roomState.singerId) {
      role = 'singer';
      canPublish = true;
    } else if (roomState.invitedSingerIds.includes(id)) {
      role = 'invited_singer';
      canPublish = true;
    }

    member.role = role;
    member.canPublishMic = canPublish;
  }
}

export function attachRealtimeServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  function broadcastState(roomState) {
    io.to(roomState.roomId).emit('room:state', serializeRoomState(roomState));
  }

  io.on('connection', (socket) => {
    const requestedRoom = socket.handshake.query.room || socket.handshake.query.roomId || 'music-box-20';
    const roomState = getOrCreateRoom(requestedRoom);

    if (roomState.members.size >= MAX_MEMBERS) {
      socket.emit('room:error', { code: 'ROOM_FULL', message: 'Phòng đã đạt giới hạn tối đa 20 thành viên.' });
      socket.disconnect(true);
      return;
    }

    socket.join(roomState.roomId);

    const queryName = socket.handshake.query.name || `Khách ${socket.id.substring(0, 4)}`;
    const queryAvatar = socket.handshake.query.avatarId || 'chibi-01';
    const isFirstMember = roomState.members.size === 0;

    // Give each member a slight offset around spawn so multiple players don't stack on exact same spot
    const angle = (roomState.members.size * 1.3) % (Math.PI * 2);
    const radius = isFirstMember ? 0 : 0.75 + (roomState.members.size % 3) * 0.45;
    const spawnX = Number((Math.cos(angle) * radius).toFixed(2));
    const spawnZ = Number((1.6 + Math.sin(angle) * radius * 0.6).toFixed(2));

    const newMember = {
      id: socket.id,
      name: String(queryName).trim().slice(0, 28) || `Khách ${socket.id.substring(0, 4)}`,
      role: isFirstMember ? 'admin' : 'listener',
      isMuted: true,
      audioLevel: 0,
      canPublishMic: isFirstMember,
      joinedAt: Date.now(),
      avatarId: String(queryAvatar),
      x: spawnX,
      y: 0,
      z: spawnZ,
      yaw: Math.PI,
      action: 'idle',
      seated: false,
    };

    roomState.members.set(socket.id, newMember);

    if (isFirstMember) {
      roomState.adminId = socket.id;
      roomState.singerId = socket.id;
      roomState.playback.currentSingerId = socket.id;
    }

    recalculateRoles(roomState);
    socket.emit('room:state', serializeRoomState(roomState));
    broadcastState(roomState);

    console.log(`[Socket][Room:${roomState.roomId}] Member joined: ${newMember.name} (${socket.id}). Total: ${roomState.members.size}`);

    // 1. Clock Sync Ping-Pong
    socket.on('time:ping', (data) => {
      socket.emit('time:pong', {
        clientSentTime: data?.clientSentTime || 0,
        serverTime: Date.now(),
      });
    });

    // 2. Member Profile & 3D Avatar Position Sync
    socket.on('member:update', (patch) => {
      const member = roomState.members.get(socket.id);
      if (!member || !patch) return;
      if (typeof patch.name === 'string' && patch.name.trim()) {
        member.name = patch.name.trim().slice(0, 28);
      }
      if (typeof patch.avatarId === 'string' && patch.avatarId.trim()) {
        member.avatarId = patch.avatarId.trim();
      }
      broadcastState(roomState);
    });

    socket.on('player:move', (pose) => {
      const member = roomState.members.get(socket.id);
      if (!member || !pose) return;
      if (typeof pose.x === 'number') member.x = Number(pose.x.toFixed(3));
      if (typeof pose.y === 'number') member.y = Number(pose.y.toFixed(3));
      if (typeof pose.z === 'number') member.z = Number(pose.z.toFixed(3));
      if (typeof pose.yaw === 'number') member.yaw = Number(pose.yaw.toFixed(3));
      if (typeof pose.action === 'string') member.action = pose.action;
      if (typeof pose.seated === 'boolean') member.seated = pose.seated;
      if (typeof pose.avatarId === 'string') member.avatarId = pose.avatarId;

      socket.to(roomState.roomId).emit('player:moved', {
        id: socket.id,
        x: member.x,
        y: member.y,
        z: member.z,
        yaw: member.yaw,
        action: member.action,
        seated: member.seated,
        avatarId: member.avatarId,
      });
    });

    // 3. Playback Control
    socket.on('playback:control', async (action) => {
      const member = roomState.members.get(socket.id);
      if (!member || !action) return;

      const now = Date.now();
      const pb = roomState.playback;

      switch (action.type) {
        case 'load':
          if (action.videoId) {
            if (pb.videoId && pb.videoId !== action.videoId) {
              roomState.history.unshift({
                id: `hist-${now}`,
                videoId: pb.videoId,
                title: pb.title || action.prevTitle || `YouTube (${pb.videoId})`,
                addedBy: member.name,
                addedAt: now,
              });
              if (roomState.history.length > 20) roomState.history.pop();
            }
            const resolvedTitle = await fetchYouTubeTitle(action.videoId, action.title);
            pb.videoId = action.videoId;
            pb.title = resolvedTitle;
            pb.positionSeconds = 0;
            pb.playbackStatus = 'playing';
            pb.updatedAt = Date.now();
            pb.playbackVersion += 1;
          }
          break;

        case 'play':
          pb.playbackStatus = 'playing';
          pb.positionSeconds = typeof action.positionSeconds === 'number' ? Math.max(0, action.positionSeconds) : pb.positionSeconds;
          pb.updatedAt = now;
          pb.playbackVersion += 1;
          break;

        case 'pause':
          pb.playbackStatus = 'paused';
          pb.positionSeconds = typeof action.positionSeconds === 'number' ? Math.max(0, action.positionSeconds) : pb.positionSeconds;
          pb.updatedAt = now;
          pb.playbackVersion += 1;
          break;

        case 'seek':
          if (typeof action.positionSeconds === 'number') {
            pb.positionSeconds = Math.max(0, action.positionSeconds);
            pb.updatedAt = now;
            pb.playbackVersion += 1;
          }
          break;

        case 'next':
          if (roomState.queue.length > 0) {
            const nextSong = roomState.queue.shift();
            if (pb.videoId) {
              roomState.history.unshift({
                id: `hist-${now}`,
                videoId: pb.videoId,
                title: pb.title || 'Bài hát trước',
                addedBy: member.name,
                addedAt: now,
              });
              if (roomState.history.length > 20) roomState.history.pop();
            }
            pb.videoId = nextSong.videoId;
            pb.title = nextSong.title || `YouTube (${nextSong.videoId})`;
            pb.positionSeconds = 0;
            pb.playbackStatus = 'playing';
            pb.updatedAt = now;
            pb.playbackVersion += 1;
          }
          break;

        case 'back':
          if (roomState.history.length > 0) {
            const prevSong = roomState.history.shift();
            if (pb.videoId) {
              roomState.queue.unshift({
                id: `q-${now}`,
                videoId: pb.videoId,
                title: pb.title || 'Bài hát đang phát',
                addedBy: member.name,
                addedAt: now,
              });
            }
            pb.videoId = prevSong.videoId;
            pb.title = prevSong.title || `YouTube (${prevSong.videoId})`;
            pb.positionSeconds = 0;
            pb.playbackStatus = 'playing';
            pb.updatedAt = now;
            pb.playbackVersion += 1;
          }
          break;

        case 'play_queue_item':
          if (action.itemId) {
            const idx = roomState.queue.findIndex((q) => q.id === action.itemId);
            if (idx !== -1) {
              const [chosen] = roomState.queue.splice(idx, 1);
              if (pb.videoId && pb.videoId !== chosen.videoId) {
                roomState.history.unshift({
                  id: `hist-${now}`,
                  videoId: pb.videoId,
                  title: pb.title || 'Bài hát trước',
                  addedBy: member.name,
                  addedAt: now,
                });
              }
              pb.videoId = chosen.videoId;
              pb.title = chosen.title || `YouTube (${chosen.videoId})`;
              pb.positionSeconds = 0;
              pb.playbackStatus = 'playing';
              pb.updatedAt = now;
              pb.playbackVersion += 1;
            }
          }
          break;

        case 'master_volume':
          if (typeof action.volume === 'number') {
            pb.masterVolume = Math.min(100, Math.max(0, action.volume));
          }
          break;
      }

      broadcastState(roomState);
    });

    // 4. Queue Management
    socket.on('queue:add', async (item) => {
      const member = roomState.members.get(socket.id);
      if (!member || !item?.videoId) return;

      const resolvedTitle = await fetchYouTubeTitle(item.videoId, item.title);
      roomState.queue.push({
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        videoId: item.videoId,
        title: resolvedTitle,
        addedBy: member.name,
        addedAt: Date.now(),
      });
      broadcastState(roomState);
    });

    socket.on('queue:remove', ({ id }) => {
      if (!id) return;
      roomState.queue = roomState.queue.filter((q) => q.id !== id);
      broadcastState(roomState);
    });

    // 5. Role & Mic Management
    socket.on('role:request_mic', () => {
      const member = roomState.members.get(socket.id);
      if (!member || member.canPublishMic) return;

      const currentActiveMics =
        (roomState.adminId ? 1 : 0) +
        (roomState.singerId && roomState.singerId !== roomState.adminId ? 1 : 0) +
        roomState.invitedSingerIds.length;

      if (currentActiveMics < MAX_MICS && !roomState.invitedSingerIds.includes(socket.id)) {
        if (roomState.invitedSingerIds.length < 2) {
          roomState.invitedSingerIds.push(socket.id);
        } else if (roomState.singerId === roomState.adminId) {
          roomState.singerId = socket.id;
          roomState.playback.currentSingerId = socket.id;
        }
        recalculateRoles(roomState);
        broadcastState(roomState);
      } else {
        socket.emit('room:error', {
          code: 'MIC_QUOTA_REACHED',
          message: `Phòng đã đủ ${MAX_MICS} người cầm Mic. Hãy nhờ Chủ phòng nhường hoặc cấp Mic!`,
        });
      }
    });

    socket.on('role:assign_singer', ({ targetId }) => {
      if (socket.id !== roomState.adminId) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Chủ phòng mới có quyền chỉ định Ca sĩ chính.' });
        return;
      }
      if (roomState.members.has(targetId)) {
        roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== targetId);
        roomState.singerId = targetId;
        roomState.playback.currentSingerId = targetId;
        recalculateRoles(roomState);
        broadcastState(roomState);
      }
    });

    socket.on('role:invite_singer', ({ targetId }) => {
      const isAuthorized = socket.id === roomState.adminId || socket.id === roomState.singerId;
      if (!isAuthorized) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Chủ phòng hoặc Ca sĩ chính mới được mời hát cùng.' });
        return;
      }
      if (!roomState.members.has(targetId)) return;
      if (targetId === roomState.singerId || targetId === roomState.adminId) return;

      const currentActiveMics =
        (roomState.adminId ? 1 : 0) +
        (roomState.singerId !== roomState.adminId ? 1 : 0) +
        roomState.invitedSingerIds.length;
      if (currentActiveMics >= MAX_MICS && !roomState.invitedSingerIds.includes(targetId)) {
        socket.emit('room:error', { code: 'MIC_QUOTA_REACHED', message: `Đã đạt giới hạn tối đa ${MAX_MICS} microphone phát cùng lúc.` });
        return;
      }

      if (!roomState.invitedSingerIds.includes(targetId) && roomState.invitedSingerIds.length < 2) {
        roomState.invitedSingerIds.push(targetId);
        recalculateRoles(roomState);
        broadcastState(roomState);
      }
    });

    socket.on('role:revoke_mic', ({ targetId }) => {
      const isSelf = socket.id === targetId;
      const isAuthorized =
        isSelf ||
        socket.id === roomState.adminId ||
        (socket.id === roomState.singerId && targetId !== roomState.adminId);
      if (!isAuthorized) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Không có quyền thu hồi microphone của thành viên này.' });
        return;
      }

      roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== targetId);
      if (targetId === roomState.singerId && targetId !== roomState.adminId) {
        roomState.singerId = roomState.adminId;
        roomState.playback.currentSingerId = roomState.adminId;
      }

      const m = roomState.members.get(targetId);
      if (m) {
        m.isMuted = true;
        m.audioLevel = 0;
      }

      recalculateRoles(roomState);
      broadcastState(roomState);
    });

    // 6. Audio State & WebRTC Voice Signaling (Zero-Config P2P Mesh for Online Singing)
    socket.on('audio:state', ({ isMuted, audioLevel }) => {
      const member = roomState.members.get(socket.id);
      if (member) {
        member.isMuted = !!isMuted;
        member.audioLevel = typeof audioLevel === 'number' ? audioLevel : 0;
        io.to(roomState.roomId).emit('audio:update', {
          id: socket.id,
          isMuted: member.isMuted,
          audioLevel: member.audioLevel,
        });
      }
    });

    socket.on('webrtc:ready', () => {
      socket.to(roomState.roomId).emit('webrtc:peer-ready', { fromId: socket.id });
    });

    socket.on('webrtc:offer', ({ toId, sdp }) => {
      if (!toId || !sdp) return;
      io.to(toId).emit('webrtc:offer', { fromId: socket.id, sdp });
    });

    socket.on('webrtc:answer', ({ toId, sdp }) => {
      if (!toId || !sdp) return;
      io.to(toId).emit('webrtc:answer', { fromId: socket.id, sdp });
    });

    socket.on('webrtc:ice-candidate', ({ toId, candidate }) => {
      if (!toId || !candidate) return;
      io.to(toId).emit('webrtc:ice-candidate', { fromId: socket.id, candidate });
    });

    // Disconnection handler
    socket.on('disconnect', () => {
      console.log(`[Socket][Room:${roomState.roomId}] Member disconnected: ${socket.id}`);
      roomState.members.delete(socket.id);
      roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== socket.id);

      socket.to(roomState.roomId).emit('webrtc:peer-left', { peerId: socket.id });

      if (socket.id === roomState.adminId) {
        const nextAdmin = roomState.members.keys().next().value;
        roomState.adminId = nextAdmin || '';
        if (!roomState.singerId || roomState.singerId === socket.id) {
          roomState.singerId = nextAdmin || '';
          roomState.playback.currentSingerId = nextAdmin || null;
        }
      } else if (socket.id === roomState.singerId) {
        roomState.singerId = roomState.adminId;
        roomState.playback.currentSingerId = roomState.adminId;
      }

      recalculateRoles(roomState);
      broadcastState(roomState);
    });
  });

  return io;
}

// Run standalone if executed directly (`node server/realtime-server.mjs`)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url?.startsWith('/health') || req.url === '/') {
      const defaultRoom = getOrCreateRoom('music-box-20');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'music-box-realtime',
        activeRooms: rooms.size,
        roomId: defaultRoom.roomId,
        members: defaultRoom.members.size,
        maxMembers: MAX_MEMBERS,
        playback: defaultRoom.playback,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  attachRealtimeServer(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================================`);
    console.log(`  Music Box Online - Multi-Room Sync & Voice Server`);
    console.log(`  Listening on: http://0.0.0.0:${PORT}`);
    console.log(`  Max Capacity: ${MAX_MEMBERS} connections/room, Max Mics: ${MAX_MICS}`);
    console.log(`========================================================`);
  });
}
