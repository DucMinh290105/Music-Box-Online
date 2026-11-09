import http from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3101;
const MAX_MEMBERS = 20;
const MAX_MICS = 3;
// Secret key for Admin login (can be customized via ADMIN_SECRET_KEY env var on Render)
const ADMIN_SECRET_KEY = (process.env.ADMIN_SECRET_KEY || '290105').trim();

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

// Enforce 4-digit Room ID (0000 - 9999), fallback to '1234'
function sanitizeRoomId(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length === 4) return digits;
  if (digits.length > 0) return digits.padStart(4, '0');
  return '1234';
}

// Multi-room in-memory store (any 4-digit room can be opened anytime by 1+ Guest or Admin)
export const rooms = new Map();

export function getOrCreateRoom(rawRoomId) {
  const roomId = sanitizeRoomId(rawRoomId);
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      adminId: '', // Super Admin (with Admin Key)
      hostId: '',  // Room Owner: Always Admin if present, otherwise first Guest
      singerId: '',
      invitedSingerIds: [], // max 2
      roomMuted: false,
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
      messages: [],
    });
  }
  return rooms.get(roomId);
}

function serializeRoomState(roomState) {
  return {
    roomId: roomState.roomId,
    adminId: roomState.adminId,
    hostId: roomState.hostId,
    singerId: roomState.singerId,
    invitedSingerIds: [...roomState.invitedSingerIds],
    roomMuted: !!roomState.roomMuted,
    members: Array.from(roomState.members.values()),
    playback: { ...roomState.playback },
    queue: [...roomState.queue],
    history: [...roomState.history],
    messages: [...(roomState.messages || [])],
    serverTime: Date.now(),
  };
}

/**
 * Recalculate hostId & roles:
 * - If a verified Admin (isSuperAdmin) is in the room, Admin is ALWAYS the Host (hostId & adminId).
 * - When no Admin is in the room, the earliest joined Guest in the room is the Host (hostId).
 */
function recalculateRoles(roomState) {
  let superAdminId = '';
  for (const [id, m] of roomState.members.entries()) {
    if (m.isSuperAdmin) {
      superAdminId = id;
      break;
    }
  }
  roomState.adminId = superAdminId;

  if (superAdminId) {
    roomState.hostId = superAdminId;
  } else {
    if (!roomState.hostId || !roomState.members.has(roomState.hostId)) {
      const firstGuestId = roomState.members.keys().next().value || '';
      roomState.hostId = firstGuestId;
    }
  }

  if (!roomState.singerId || !roomState.members.has(roomState.singerId)) {
    roomState.singerId = roomState.hostId || '';
    roomState.playback.currentSingerId = roomState.singerId || null;
  }

  for (const [id, member] of roomState.members.entries()) {
    const isHost = id === roomState.hostId;
    member.isHost = isHost;

    let role = 'listener';
    let canPublish = false;

    if (member.isSuperAdmin) {
      role = 'admin';
      canPublish = true;
    } else if (isHost) {
      role = 'host';
      canPublish = !roomState.roomMuted;
    } else if (id === roomState.singerId) {
      role = 'singer';
      canPublish = !roomState.roomMuted;
    } else if (roomState.invitedSingerIds.includes(id)) {
      role = 'invited_singer';
      canPublish = !roomState.roomMuted;
    }

    member.role = role;
    member.canPublishMic = canPublish;
    if (roomState.roomMuted && !member.isSuperAdmin) {
      member.isMuted = true;
      member.audioLevel = 0;
    }
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
    const requestedRoom = socket.handshake.query.room || socket.handshake.query.roomId || '1234';
    const providedAdminKey = String(socket.handshake.query.adminKey || '').trim();
    const wantsAdmin = socket.handshake.query.loginMode === 'admin';

    // If user selected Admin login mode, verify Admin Key strictly
    if (wantsAdmin && providedAdminKey !== ADMIN_SECRET_KEY) {
      socket.emit('auth:error', {
        code: 'INVALID_ADMIN_KEY',
        message: 'Mã khóa Admin không chính xác! Vui lòng kiểm tra lại hoặc vào với tư cách Guest.',
      });
      socket.disconnect(true);
      return;
    }

    const isSuperAdmin = wantsAdmin && providedAdminKey === ADMIN_SECRET_KEY;
    let roomState = getOrCreateRoom(requestedRoom);

    if (roomState.members.size >= MAX_MEMBERS && !isSuperAdmin) {
      socket.emit('room:error', { code: 'ROOM_FULL', message: 'Phòng đã đạt giới hạn tối đa 20 thành viên.' });
      socket.disconnect(true);
      return;
    }

    socket.join(roomState.roomId);

    const queryName = socket.handshake.query.name || (isSuperAdmin ? 'Admin' : `Khách ${socket.id.substring(0, 4)}`);
    const queryAvatar = socket.handshake.query.avatarId || 'chibi-01';
    const isFirstMember = roomState.members.size === 0;

    // Slight offset around spawn so multiple players don't stack on the exact same spot
    const angle = (roomState.members.size * 1.3) % (Math.PI * 2);
    const radius = isFirstMember ? 0 : 0.75 + (roomState.members.size % 3) * 0.45;
    const spawnX = Number((Math.cos(angle) * radius).toFixed(2));
    const spawnZ = Number((1.6 + Math.sin(angle) * radius * 0.6).toFixed(2));

    const newMember = {
      id: socket.id,
      name: String(queryName).trim().slice(0, 28) || `Khách ${socket.id.substring(0, 4)}`,
      role: isSuperAdmin ? 'admin' : isFirstMember ? 'host' : 'listener',
      isSuperAdmin,
      isHost: isSuperAdmin || isFirstMember,
      isMuted: true,
      audioLevel: 0,
      canPublishMic: isSuperAdmin || (isFirstMember && !roomState.roomMuted),
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

    // If Admin joins, Admin ALWAYS becomes Host immediately
    if (isSuperAdmin) {
      roomState.adminId = socket.id;
      roomState.hostId = socket.id;
      if (!roomState.singerId) {
        roomState.singerId = socket.id;
        roomState.playback.currentSingerId = socket.id;
      }
    } else if (isFirstMember) {
      roomState.hostId = socket.id;
      roomState.singerId = socket.id;
      roomState.playback.currentSingerId = socket.id;
    }

    recalculateRoles(roomState);
    socket.emit('auth:success', {
      roomId: roomState.roomId,
      isSuperAdmin,
      isHost: roomState.hostId === socket.id,
    });
    socket.emit('room:state', serializeRoomState(roomState));
    broadcastState(roomState);

    console.log(`[Socket][Room:${roomState.roomId}] ${isSuperAdmin ? 'ADMIN' : 'Guest'} joined: ${newMember.name} (${socket.id}). Total: ${roomState.members.size}`);

    // 1. Clock Sync Ping-Pong
    socket.on('time:ping', (data) => {
      socket.emit('time:pong', {
        clientSentTime: data?.clientSentTime || 0,
        serverTime: Date.now(),
      });
    });

    // 2. Host/Admin Change 4-Digit Room ID (moves everyone in the room to the new 4-digit ID)
    socket.on('room:change_id', ({ newRoomId }) => {
      const member = roomState.members.get(socket.id);
      if (!member) return;
      const isHostOrAdmin = socket.id === roomState.hostId || member.isSuperAdmin;
      if (!isHostOrAdmin) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Chủ phòng hoặc Admin mới có quyền đổi ID phòng 4 chữ số!' });
        return;
      }

      const targetId = sanitizeRoomId(newRoomId);
      if (targetId === roomState.roomId) return;

      const oldRoomId = roomState.roomId;
      // If target room already exists and has members, merge into it; otherwise rename this room
      const existingTarget = rooms.get(targetId);
      if (existingTarget && existingTarget.members.size > 0) {
        for (const [mId, mObj] of roomState.members.entries()) {
          if (existingTarget.members.size < MAX_MEMBERS || mObj.isSuperAdmin) {
            existingTarget.members.set(mId, mObj);
            const s = io.sockets.sockets.get(mId);
            if (s) {
              s.leave(oldRoomId);
              s.join(targetId);
            }
          }
        }
        rooms.delete(oldRoomId);
        roomState = existingTarget;
      } else {
        rooms.delete(oldRoomId);
        roomState.roomId = targetId;
        rooms.set(targetId, roomState);
        for (const mId of roomState.members.keys()) {
          const s = io.sockets.sockets.get(mId);
          if (s) {
            s.leave(oldRoomId);
            s.join(targetId);
          }
        }
      }

      recalculateRoles(roomState);
      io.to(targetId).emit('room:id_changed', { roomId: targetId, by: member.name });
      broadcastState(roomState);
    });

    // 3. Admin Exclusive Controls: Kick Member & Mute Entire Room
    socket.on('admin:kick', ({ targetId }) => {
      const caller = roomState.members.get(socket.id);
      if (!caller || !caller.isSuperAdmin) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Admin (đăng nhập bằng Key) mới có quyền đuổi thành viên!' });
        return;
      }
      if (!targetId || targetId === socket.id) return;
      const targetMember = roomState.members.get(targetId);
      if (!targetMember) return;

      io.to(targetId).emit('room:kicked', {
        message: `Bạn đã bị Admin (${caller.name}) mời ra khỏi phòng #${roomState.roomId}.`,
      });

      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.leave(roomState.roomId);
        targetSocket.disconnect(true);
      }

      roomState.members.delete(targetId);
      roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== targetId);
      io.to(roomState.roomId).emit('webrtc:peer-left', { peerId: targetId });
      recalculateRoles(roomState);
      broadcastState(roomState);
    });

    socket.on('admin:mute_all', ({ muted }) => {
      const caller = roomState.members.get(socket.id);
      if (!caller || !caller.isSuperAdmin) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Admin (đăng nhập bằng Key) mới có quyền tắt tiếng cả phòng!' });
        return;
      }

      roomState.roomMuted = !!muted;
      if (roomState.roomMuted) {
        for (const [mId, mObj] of roomState.members.entries()) {
          if (!mObj.isSuperAdmin) {
            mObj.isMuted = true;
            mObj.audioLevel = 0;
            io.to(mId).emit('admin:force_mute', {
              message: '🔇 Admin đã bật chế độ Im lặng cả phòng (Tắt toàn bộ Mic khách).',
            });
          }
        }
      } else {
        io.to(roomState.roomId).emit('room:notice', {
          message: '🔊 Admin đã mở khóa Mic cho phòng.',
        });
      }

      recalculateRoles(roomState);
      broadcastState(roomState);
    });

    // 4. Member Profile, Room Chat & 3D Avatar Position Sync
    socket.on('chat:send', ({ text }) => {
      const member = roomState.members.get(socket.id);
      if (!member || typeof text !== 'string') return;
      const cleaned = text.trim().slice(0, 300);
      if (!cleaned) return;

      const msg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        senderId: socket.id,
        senderName: member.name,
        role: member.role,
        isSuperAdmin: !!member.isSuperAdmin,
        isHost: !!member.isHost,
        text: cleaned,
        createdAt: Date.now(),
      };

      if (!roomState.messages) roomState.messages = [];
      roomState.messages.push(msg);
      if (roomState.messages.length > 60) {
        roomState.messages.shift();
      }

      io.to(roomState.roomId).emit('chat:message', msg);
    });

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

    // 5. Playback Control
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

    // 6. Queue Management
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

    // 7. Role & Mic Management
    socket.on('role:request_mic', () => {
      const member = roomState.members.get(socket.id);
      if (!member) return;
      if (roomState.roomMuted && !member.isSuperAdmin) {
        socket.emit('admin:force_mute', {
          message: '🔇 Admin đang bật chế độ Im lặng cả phòng. Bạn chưa thể bật Mic lúc này!',
        });
        return;
      }
      if (member.canPublishMic) return;

      const currentActiveMics =
        (roomState.hostId ? 1 : 0) +
        (roomState.singerId && roomState.singerId !== roomState.hostId ? 1 : 0) +
        roomState.invitedSingerIds.length;

      if (currentActiveMics < MAX_MICS && !roomState.invitedSingerIds.includes(socket.id)) {
        if (roomState.invitedSingerIds.length < 2) {
          roomState.invitedSingerIds.push(socket.id);
        } else if (roomState.singerId === roomState.hostId) {
          roomState.singerId = socket.id;
          roomState.playback.currentSingerId = socket.id;
        }
        recalculateRoles(roomState);
        broadcastState(roomState);
      } else {
        socket.emit('room:error', {
          code: 'MIC_QUOTA_REACHED',
          message: `Phòng đã đủ ${MAX_MICS} người cầm Mic. Hãy nhờ Chủ phòng hoặc Admin cấp Mic!`,
        });
      }
    });

    socket.on('role:assign_singer', ({ targetId }) => {
      const caller = roomState.members.get(socket.id);
      const isAuthorized = caller?.isSuperAdmin || socket.id === roomState.hostId;
      if (!isAuthorized) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Chủ phòng hoặc Admin mới có quyền chỉ định Ca sĩ chính.' });
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
      const caller = roomState.members.get(socket.id);
      const isAuthorized = caller?.isSuperAdmin || socket.id === roomState.hostId || socket.id === roomState.singerId;
      if (!isAuthorized) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Chỉ Admin, Chủ phòng hoặc Ca sĩ chính mới được mời hát cùng.' });
        return;
      }
      if (!roomState.members.has(targetId)) return;
      if (targetId === roomState.singerId || targetId === roomState.hostId) return;

      const currentActiveMics =
        (roomState.hostId ? 1 : 0) +
        (roomState.singerId !== roomState.hostId ? 1 : 0) +
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
      const caller = roomState.members.get(socket.id);
      const target = roomState.members.get(targetId);
      if (target?.isSuperAdmin && socket.id !== targetId) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Không thể thu hồi Mic của Admin!' });
        return;
      }
      const isSelf = socket.id === targetId;
      const isAuthorized =
        isSelf ||
        caller?.isSuperAdmin ||
        socket.id === roomState.hostId ||
        (socket.id === roomState.singerId && targetId !== roomState.hostId);
      if (!isAuthorized) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Không có quyền thu hồi microphone của thành viên này.' });
        return;
      }

      roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== targetId);
      if (targetId === roomState.singerId && targetId !== roomState.hostId) {
        roomState.singerId = roomState.hostId;
        roomState.playback.currentSingerId = roomState.hostId;
      }

      if (target) {
        target.isMuted = true;
        target.audioLevel = 0;
        if (!isSelf) {
          io.to(targetId).emit('admin:force_mute', { message: 'Mic của bạn đã được Chủ phòng/Admin tắt.' });
        }
      }

      recalculateRoles(roomState);
      broadcastState(roomState);
    });

    // 8. Audio State & WebRTC Voice Signaling
    socket.on('audio:state', ({ isMuted, audioLevel }) => {
      const member = roomState.members.get(socket.id);
      if (!member) return;
      if (roomState.roomMuted && !member.isSuperAdmin && !isMuted) {
        member.isMuted = true;
        member.audioLevel = 0;
        socket.emit('admin:force_mute', { message: '🔇 Phòng đang ở chế độ Im lặng bởi Admin.' });
        return;
      }
      member.isMuted = !!isMuted;
      member.audioLevel = typeof audioLevel === 'number' ? audioLevel : 0;
      io.to(roomState.roomId).emit('audio:update', {
        id: socket.id,
        isMuted: member.isMuted,
        audioLevel: member.audioLevel,
      });
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

    // Real-time PCM Voice Relay over Socket.IO (100% cross-network & mobile 4G/5G fallback when P2P UDP is blocked)
    socket.on('voice:data', (payload) => {
      const member = roomState.members.get(socket.id);
      if (!member || (roomState.roomMuted && !member.isSuperAdmin)) return;
      if (!payload?.pcm) return;
      socket.volatile.to(roomState.roomId).emit('voice:data', {
        fromId: socket.id,
        pcm: payload.pcm,
        sampleRate: payload.sampleRate || 16000,
      });
    });

    // Disconnection handler
    socket.on('disconnect', () => {
      console.log(`[Socket][Room:${roomState.roomId}] Member disconnected: ${socket.id}`);
      roomState.members.delete(socket.id);
      roomState.invitedSingerIds = roomState.invitedSingerIds.filter((id) => id !== socket.id);

      socket.to(roomState.roomId).emit('webrtc:peer-left', { peerId: socket.id });

      if (socket.id === roomState.hostId) {
        roomState.hostId = '';
      }
      if (socket.id === roomState.adminId) {
        roomState.adminId = '';
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
      const defaultRoom = getOrCreateRoom('1234');
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
    console.log(`  Music Box Online - 4-Digit Room & Admin Key Server`);
    console.log(`  Listening on: http://0.0.0.0:${PORT}`);
    console.log(`  Default Admin Key: ${ADMIN_SECRET_KEY}`);
    console.log(`========================================================`);
  });
}
