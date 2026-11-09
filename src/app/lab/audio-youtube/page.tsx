'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import io, { type Socket } from 'socket.io-client';
import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import YouTubePlayer, { type YouTubePlayerHandle } from './components/YouTubePlayer';
import { extractYouTubeId } from '@/lib/youtube/urlParser';
import type { RoomState, RoomMember, PlaybackState, QueueItem } from '@/lib/types/realtime';
import type { YouTubePlayerError } from '@/lib/youtube/types';
import styles from './lab.module.css';

const DEFAULT_REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3101';
const LIVEKIT_WS_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || '';

export default function AudioYouTubePoCPage() {
  // User Profile
  const [userName, setUserName] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  // Socket.IO Realtime State
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [roundTripTime, setRoundTripTime] = useState<number>(0);

  // YouTube State
  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [currentVideoId, setCurrentVideoId] = useState('dQw4w9WgXcQ');
  const [personalVolume, setPersonalVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Audio Sync Engine (Singer-Reference Sync)
  const [audioSyncOffset, setAudioSyncOffset] = useState<number>(0); // in ms (-1500 to +1500)
  const lastSyncCheckRef = useRef<number>(0);

  // LiveKit State
  const livekitRoomRef = useRef<Room | null>(null);
  const [livekitConnected, setLivekitConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [myAudioLevel, setMyAudioLevel] = useState(0);
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [webrtcStats, setWebrtcStats] = useState({ rtt: 0, jitter: 0, packetLoss: 0 });

  // Current User Role
  const me: RoomMember | undefined = roomState?.members.find((m) => m.id === myId);
  const isAdmin = me?.role === 'admin';
  const isSinger = me?.role === 'singer';
  const canControl = isAdmin || isSinger;
  const canPublishMic = !!me?.canPublishMic;

  // Initialize random name
  useEffect(() => {
    const saved = localStorage.getItem('mb_user_name');
    if (saved) {
      setUserName(saved);
    } else {
      const generated = `Ca Sĩ ${Math.floor(100 + Math.random() * 900)}`;
      setUserName(generated);
    }
  }, []);

  // Connect to Realtime Socket.IO Server
  const connectRealtime = useCallback((name: string) => {
    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(DEFAULT_REALTIME_URL, {
      query: { name },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      setMyId(socket.id || '');
      // Start ping clock sync
      socket.emit('time:ping', { clientSentTime: Date.now() });
    });

    socket.on('time:pong', ({ clientSentTime, serverTime }: { clientSentTime: number; serverTime: number }) => {
      const now = Date.now();
      const rtt = now - clientSentTime;
      const offset = serverTime - (clientSentTime + rtt / 2);
      setRoundTripTime(rtt);
      setServerTimeOffset(offset);
    });

    socket.on('room:state', (state: RoomState) => {
      setRoomState(state);
      if (state.playback?.videoId && state.playback.videoId !== currentVideoId) {
        setCurrentVideoId(state.playback.videoId);
      }
    });

    socket.on('room:error', ({ message }: { message: string }) => {
      alert(`[Thông báo máy chủ]: ${message}`);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socketRef.current = socket;
    setIsJoined(true);
    localStorage.setItem('mb_user_name', name);
  }, [currentVideoId]);

  // Periodic Clock Sync Ping
  useEffect(() => {
    if (!socketConnected || !socketRef.current) return;
    const interval = setInterval(() => {
      socketRef.current?.emit('time:ping', { clientSentTime: Date.now() });
    }, 5000);
    return () => clearInterval(interval);
  }, [socketConnected]);

  // Connect to LiveKit Cloud Room
  const connectLiveKit = async () => {
    setLivekitError(null);
    try {
      const res = await fetch(`/api/livekit-token?room=music-box-poc&username=${encodeURIComponent(userName)}&canPublish=${canPublishMic}`);
      const data = await res.json();

      if (!res.ok) {
        setLivekitError(data.error || 'Không thể lấy token LiveKit. Vui lòng kiểm tra API key.');
        return;
      }

      const wsUrl = LIVEKIT_WS_URL || 'wss://demo.livekit.cloud';
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      room.on(RoomEvent.Connected, () => {
        setLivekitConnected(true);
      });

      room.on(RoomEvent.Disconnected, () => {
        setLivekitConnected(false);
        setMicEnabled(false);
      });

      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.track?.kind === Track.Kind.Audio) {
          setMicEnabled(true);
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, () => {
        setMicEnabled(false);
      });

      await room.connect(wsUrl, data.token);
      livekitRoomRef.current = room;
    } catch (err: any) {
      console.error('LiveKit connection error:', err);
      setLivekitError(err?.message || 'Lỗi kết nối LiveKit Cloud.');
    }
  };

  const toggleMicrophone = async () => {
    const room = livekitRoomRef.current;
    if (!room || !livekitConnected) {
      alert('Vui lòng kết nối vào phòng LiveKit trước khi bật microphone.');
      return;
    }

    if (!canPublishMic) {
      alert('Bạn chưa được cấp quyền phát microphone. Hãy nhờ Admin hoặc Ca sĩ chính mời bạn.');
      return;
    }

    try {
      const nextState = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(nextState);
      setMicEnabled(nextState);
      socketRef.current?.emit('audio:state', { isMuted: !nextState, audioLevel: myAudioLevel });
    } catch (err: any) {
      alert(`Không thể truy cập microphone: ${err?.message || err}`);
    }
  };

  // YouTube Playback Handlers (Dispatches to Socket.IO for sync)
  const handleLoadUrl = () => {
    if (!urlInput.trim()) return;
    const id = extractYouTubeId(urlInput);
    if (!id) {
      alert('URL YouTube không hợp lệ! Hỗ trợ: youtube.com/watch?v=..., youtu.be/..., shorts/..., live/...');
      return;
    }

    if (canControl) {
      socketRef.current?.emit('playback:control', { type: 'load', videoId: id });
      setUrlInput('');
    } else {
      // Listener can add to queue instead
      socketRef.current?.emit('queue:add', { videoId: id, title: `Video (${id})` });
      setUrlInput('');
      alert('Đã gửi bài hát vào Hàng Đợi (Song Queue).');
    }
  };

  const handlePlay = () => {
    if (!canControl) return;
    socketRef.current?.emit('playback:control', { type: 'play', positionSeconds: currentTime });
  };

  const handlePause = () => {
    if (!canControl) return;
    socketRef.current?.emit('playback:control', { type: 'pause', positionSeconds: currentTime });
  };

  const handleSeek = (seconds: number) => {
    if (!canControl) return;
    socketRef.current?.emit('playback:control', { type: 'seek', positionSeconds: seconds });
  };

  const handleNext = () => {
    if (!canControl) return;
    socketRef.current?.emit('playback:control', { type: 'next' });
  };

  const handleBack = () => {
    if (!canControl) return;
    socketRef.current?.emit('playback:control', { type: 'back' });
  };

  // Singer-Reference Sync Effect for Listeners
  useEffect(() => {
    if (!roomState?.playback || canControl) return; // Singer's own player is the reference
    const pb = roomState.playback;
    const now = Date.now() + serverTimeOffset;
    const elapsedSinceUpdate = Math.max(0, (now - pb.updatedAt) / 1000);

    let targetTime = pb.positionSeconds;
    if (pb.playbackStatus === 'playing') {
      targetTime += elapsedSinceUpdate;
    }

    // Apply manual audio sync offset for this listener
    const adjustedTargetTime = Math.max(0, targetTime + (audioSyncOffset / 1000));

    // Throttle check to avoid continuous seeks
    const throttleNow = Date.now();
    if (throttleNow - lastSyncCheckRef.current > 1500) {
      lastSyncCheckRef.current = throttleNow;
      const drift = Math.abs(currentTime - adjustedTargetTime);
      if (drift > 0.45 && duration > 0) {
        // Player is drifting by more than 450ms, gently seek
        playerRef.current?.seekTo(adjustedTargetTime);
      }
    }
  }, [roomState?.playback, canControl, currentTime, duration, audioSyncOffset, serverTimeOffset]);

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className={styles.container}>
      {/* Header Bar */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>🎙️</span>
          <div>
            <h1 className={styles.title}>Music Box Online · Audio &amp; YouTube PoC</h1>
            <p className={styles.subtitle}>Phòng Thử Nghiệm Live Microphone &amp; Shared Playback</p>
          </div>
        </div>

        <div className={styles.badges}>
          <div className={styles.statusPill}>
            <span className={`${styles.dot} ${socketConnected ? styles.dotGreen : styles.dotRed}`} />
            <span>Realtime: {socketConnected ? 'Đã kết nối' : 'Mất kết nối'}</span>
          </div>
          <div className={styles.statusPill}>
            <span className={`${styles.dot} ${livekitConnected ? styles.dotGreen : styles.dotYellow}`} />
            <span>LiveKit: {livekitConnected ? 'Phòng thoại mở' : 'Chưa kết nối'}</span>
          </div>
          <div className={styles.statusPill}>
            <span>👥 {roomState?.members.length || 1}/20</span>
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className={styles.mainGrid}>
        {/* Left Column: YouTube Player & Controls */}
        <div>
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>YOUTUBE SHARED PLAYER</span>
              <span style={{ fontSize: 11, color: '#38bdf8' }}>
                {roomState?.playback.playbackStatus?.toUpperCase()} · Phiên bản #{roomState?.playback.playbackVersion || 1}
              </span>
            </div>

            {/* YouTube Player IFrame */}
            <YouTubePlayer
              videoId={currentVideoId}
              personalVolume={personalVolume}
              isMuted={isMuted}
              onStateChange={(state) => {
                if (canControl && state === 'ENDED') handleNext();
              }}
              onError={(err) => setPlayerError(err ? err.message : null)}
              onTimeUpdate={(cur, dur) => {
                setCurrentTime(cur);
                setDuration(dur);
              }}
            />

            {/* URL Input */}
            <div className={styles.urlRow}>
              <input
                type="text"
                className={styles.input}
                placeholder="Dán link YouTube (watch, shorts, youtu.be, live)..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadUrl()}
              />
              <button className={styles.btn} onClick={handleLoadUrl}>
                {canControl ? 'Phát Video' : '+ Thêm bài'}
              </button>
            </div>

            {/* Playback Controls */}
            <div className={styles.controlBar}>
              <input
                type="range"
                className={styles.seekBar}
                min={0}
                max={duration || 100}
                value={currentTime}
                disabled={!canControl}
                onChange={(e) => handleSeek(Number(e.target.value))}
              />

              <div className={styles.timeDisplay}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className={styles.buttonsRow}>
                <div className={styles.btnGroup}>
                  <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleBack} disabled={!canControl} title="Bài trước">
                    ⏮
                  </button>
                  {roomState?.playback.playbackStatus === 'playing' ? (
                    <button className={styles.btn} onClick={handlePause} disabled={!canControl}>
                      ⏸ Tạm dừng
                    </button>
                  ) : (
                    <button className={`${styles.btn} ${styles.btnSuccess}`} onClick={handlePlay} disabled={!canControl}>
                      ▶ Tiếp tục phát
                    </button>
                  )}
                  <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleNext} disabled={!canControl} title="Bài tiếp">
                    ⏭
                  </button>
                </div>

                {/* Personal Volume Controls */}
                <div className={styles.volumeRow}>
                  <button
                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                    onClick={() => setIsMuted((s) => !s)}
                  >
                    {isMuted ? '🔇 Bật tiếng' : '🔊 Tắt tiếng'}
                  </button>
                  <span>Âm lượng cá nhân:</span>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={100}
                    value={isMuted ? 0 : personalVolume}
                    onChange={(e) => {
                      setPersonalVolume(Number(e.target.value));
                      if (isMuted) setIsMuted(false);
                    }}
                    style={{ width: 90 }}
                  />
                  <span style={{ width: 28, fontFamily: 'monospace' }}>{isMuted ? 0 : personalVolume}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Singer-Reference Audio Sync Engine */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>ĐỒNG BỘ GIỌNG HÁT &amp; NHẠC (SINGER-REFERENCE SYNC)</span>
              <span className={styles.syncValue}>
                {audioSyncOffset > 0 ? `+${audioSyncOffset}` : audioSyncOffset} ms
              </span>
            </div>

            <div className={styles.syncBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>-1500 ms</span>
                <input
                  type="range"
                  className={styles.seekBar}
                  min={-1500}
                  max={1500}
                  step={50}
                  value={audioSyncOffset}
                  onChange={(e) => setAudioSyncOffset(Number(e.target.value))}
                />
                <span style={{ fontSize: 12, color: '#94a3b8' }}>+1500 ms</span>
                <button
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                  onClick={() => setAudioSyncOffset(0)}
                >
                  Reset 0ms
                </button>
              </div>

              <p className={styles.syncHelp}>
                💡 <strong>Nguyên lý:</strong> Ca sĩ chính dùng timeline YouTube trên máy mình làm chuẩn. Khi bạn là người nghe, giọng hát ca sĩ đến qua WebRTC còn video phát trên máy bạn. Tăng (+) nếu giọng hát đến chậm hơn nhạc, giảm (-) nếu giọng hát đến sớm hơn nhạc.
              </p>
            </div>
          </div>

          {/* Song Queue */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>HÀNG ĐỢI BÀI HÁT ({roomState?.queue.length || 0})</span>
            </div>
            <div className={styles.queueList}>
              {roomState?.queue.length === 0 ? (
                <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Hàng đợi trống. Hãy dán link YouTube để thêm bài.</p>
              ) : (
                roomState?.queue.map((item, idx) => (
                  <div key={item.id} className={styles.queueItem}>
                    <span>#{idx + 1} {item.title}</span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>bởi {item.addedBy}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Microphone, Members & Diagnostics */}
        <div>
          {/* Join / User Profile Card */}
          {!isJoined ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>THAM GIA PHÒNG THỬ NGHIỆM</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Nhập tên hiển thị của bạn..."
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && userName && connectRealtime(userName)}
                />
                <button
                  className={styles.btn}
                  onClick={() => userName && connectRealtime(userName)}
                >
                  Vào Phòng
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.card}>
              <div className={styles.cardTitle}>
                <span>BẠN: <strong>{me?.name}</strong></span>
                <span className={`${styles.roleBadge} ${me?.role === 'admin' ? styles.roleAdmin : me?.role === 'singer' ? styles.roleSinger : me?.role === 'invited_singer' ? styles.roleInvited : styles.roleListener}`}>
                  {me?.role === 'admin' ? '👑 Admin' : me?.role === 'singer' ? '🎤 Ca sĩ chính' : me?.role === 'invited_singer' ? '🎶 Ca sĩ mời' : '🎧 Người nghe'}
                </span>
              </div>

              {/* Microphone Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {!livekitConnected ? (
                  <button className={`${styles.btn} ${styles.btnSuccess}`} onClick={connectLiveKit}>
                    🎙️ Kết nối phòng thoại LiveKit
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={`${styles.btn} ${micEnabled ? styles.btnDanger : styles.btnSuccess}`}
                      onClick={toggleMicrophone}
                      disabled={!canPublishMic}
                      style={{ flex: 1 }}
                    >
                      {micEnabled ? '🔴 Tắt Microphone' : '🎙️ Bật Microphone'}
                    </button>
                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => livekitRoomRef.current?.disconnect()}
                    >
                      Rời thoại
                    </button>
                  </div>
                )}

                {/* Mic Status & Level Meter */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Tín hiệu mic:</span>
                    <span>{micEnabled ? 'Đang phát sóng' : canPublishMic ? 'Đã tắt tiếng' : 'Chưa được cấp mic'}</span>
                  </div>
                  <div className={styles.audioMeter}>
                    <div className={styles.audioMeterFill} style={{ width: `${micEnabled ? 65 : 0}%` }} />
                  </div>
                </div>

                {livekitError && (
                  <p style={{ fontSize: 11, color: '#f87171', margin: '4px 0 0' }}>
                    ⚠️ {livekitError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Members List & Roles (Quota: Max 3 Mics) */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>THÀNH VIÊN TRONG PHÒNG ({roomState?.members.length || 0}/20)</span>
              <span style={{ fontSize: 11, color: '#a78bfa' }}>
                Mics: {roomState?.members.filter((m) => m.canPublishMic).length || 0}/3
              </span>
            </div>

            <div className={styles.memberList}>
              {roomState?.members.map((member) => {
                const isMemberAdmin = member.id === roomState.adminId;
                const isMemberSinger = member.id === roomState.singerId;

                return (
                  <div key={member.id} className={styles.memberItem}>
                    <div>
                      <div className={styles.memberName}>
                        {member.name} {member.id === myId && '(Bạn)'}
                      </div>
                      <span className={`${styles.roleBadge} ${member.role === 'admin' ? styles.roleAdmin : member.role === 'singer' ? styles.roleSinger : member.role === 'invited_singer' ? styles.roleInvited : styles.roleListener}`}>
                        {member.role === 'admin' ? '👑 Admin' : member.role === 'singer' ? '🎤 Ca sĩ chính' : member.role === 'invited_singer' ? '🎶 Ca sĩ mời' : '🎧 Người nghe'}
                      </span>
                    </div>

                    {/* Admin / Singer Management Actions */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {isAdmin && member.id !== myId && !isMemberSinger && (
                        <button
                          className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                          onClick={() => socketRef.current?.emit('role:assign_singer', { targetId: member.id })}
                          title="Giao vai trò Ca sĩ chính"
                        >
                          🎤 Chọn làm ca sĩ
                        </button>
                      )}

                      {canControl && member.id !== myId && !isMemberSinger && !isMemberAdmin && (
                        <>
                          {!member.canPublishMic ? (
                            <button
                              className={`${styles.btn} ${styles.btnSuccess} ${styles.btnSm}`}
                              onClick={() => socketRef.current?.emit('role:invite_singer', { targetId: member.id })}
                              title="Mời hát cùng (Cấp slot mic)"
                            >
                              + Mời mic
                            </button>
                          ) : (
                            <button
                              className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                              onClick={() => socketRef.current?.emit('role:revoke_mic', { targetId: member.id })}
                              title="Thu hồi quyền mic"
                            >
                              ✕ Thu mic
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Diagnostic Info */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>THÔNG SỐ KỸ THUẬT &amp; CHẨN ĐOÁN</span>
            </div>

            <div className={styles.diagGrid}>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Server RTT:</span>
                <span className={styles.diagVal}>{roundTripTime} ms</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Clock Offset:</span>
                <span className={styles.diagVal}>{serverTimeOffset} ms</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Playback Version:</span>
                <span className={styles.diagVal}>v{roomState?.playback.playbackVersion || 1}</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Audio Sync Offset:</span>
                <span className={styles.diagVal}>{audioSyncOffset} ms</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Current Singer:</span>
                <span className={styles.diagVal}>{roomState?.members.find((m) => m.id === roomState.singerId)?.name || 'Chưa có'}</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagLabel}>Active Mic Slots:</span>
                <span className={styles.diagVal}>{roomState?.members.filter((m) => m.canPublishMic).length || 0} / 3</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
