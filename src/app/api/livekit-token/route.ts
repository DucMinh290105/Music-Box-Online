import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const room = searchParams.get('room') || 'music-box-poc';
  const username = searchParams.get('username') || `User-${Math.random().toString(36).substring(2, 6)}`;
  const canPublish = searchParams.get('canPublish') === 'true';

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      {
        error: 'Chưa cấu hình LIVEKIT_API_KEY hoặc LIVEKIT_API_SECRET trong biến môi trường server.',
        needsConfig: true,
      },
      { status: 400 }
    );
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: username,
      ttl: '2h',
    });

    at.addGrant({
      room,
      roomJoin: true,
      canPublish: canPublish, // Server strictly enforces canPublish
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token, username, room, canPublish });
  } catch (error: any) {
    console.error('Error generating LiveKit token:', error);
    return NextResponse.json(
      { error: 'Lỗi khi tạo LiveKit Access Token: ' + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}
