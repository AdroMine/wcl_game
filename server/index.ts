import express, { Request, Response } from 'express';
import cors from 'cors';
import os from 'os';
import QRCode from 'qrcode';
import { stateStore } from './stateStore';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

app.use(cors());
app.use(express.json());

// Active SSE client connections
interface SseClient {
  id: string;
  res: Response;
  playerId?: string;
}

const sseClients: Map<string, SseClient> = new Map();

function broadcastSync() {
  for (const client of sseClients.values()) {
    try {
      const payload = stateStore.buildSyncPayload(client.playerId);
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      // client likely disconnected
      sseClients.delete(client.id);
    }
  }
}

// 15-second heartbeat ping to keep mobile pub connections alive
setInterval(() => {
  for (const client of sseClients.values()) {
    try {
      client.res.write(`: ping\n\n`);
    } catch {
      sseClients.delete(client.id);
    }
  }
}, 15000);

// Helper to get local network IP
function getLocalNetworkIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Server info & Join URL endpoint
app.get('/api/server-info', async (_req: Request, res: Response) => {
  const ip = getLocalNetworkIp();
  // If running vite dev on 5173, the join URL is typically http://IP:5173
  // If running production, it would be http://IP:PORT
  const clientPort = process.env.CLIENT_PORT || '5174';
  const joinUrl = `http://${ip}:${clientPort}/`;

  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: '#08090c',
        light: '#f4f0e8',
      }
    });

    res.json({
      localIp: ip,
      port: PORT,
      clientPort,
      joinUrl,
      qrDataUrl,
    });
  } catch (err) {
    res.json({
      localIp: ip,
      port: PORT,
      clientPort,
      joinUrl,
      qrDataUrl: null,
    });
  }
});

// SSE Stream endpoint
app.get('/api/events', (req: Request, res: Response) => {
  const playerId = req.query.playerId as string | undefined;
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in proxies/nginx
  res.flushHeaders?.();

  const client: SseClient = { id: clientId, res, playerId };
  sseClients.set(clientId, client);

  // Send initial state snapshot immediately
  const initialPayload = stateStore.buildSyncPayload(playerId);
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

// HTTP Polling fallback endpoint (10-second polling if WebSocket/SSE drops)
app.get('/api/sync', (req: Request, res: Response) => {
  const playerId = req.query.playerId as string | undefined;
  const payload = stateStore.buildSyncPayload(playerId);
  res.json(payload);
});

// Player Join or Reconnect (Immortal session)
app.post('/api/player/join', (req: Request, res: Response) => {
  const { name, playerId } = req.body;
  const player = stateStore.joinOrReconnectPlayer(playerId, name);
  broadcastSync();
  res.json({ success: true, player });
});

// Player Leave Game
app.post('/api/player/leave', (req: Request, res: Response) => {
  const { playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ success: false, error: 'Player ID required' });
  }
  const removed = stateStore.removePlayer(playerId);
  broadcastSync();
  res.json({ success: removed });
});

// Team Formation via 3-char Join Codes
app.post('/api/team/form', (req: Request, res: Response) => {
  const { leaderPlayerId, joinCodes, customName } = req.body;
  if (!leaderPlayerId || !Array.isArray(joinCodes)) {
    return res.status(400).json({ success: false, error: 'Missing leader or joinCodes' });
  }

  const result = stateStore.formTeam(leaderPlayerId, joinCodes, customName);
  if (result.success) {
    broadcastSync();
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// Rename Team
app.post('/api/team/rename', (req: Request, res: Response) => {
  const { teamId, name } = req.body;
  const success = stateStore.renameTeam(teamId, name);
  if (success) {
    broadcastSync();
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, error: 'Could not rename team' });
  }
});

// Submit Round Codeword / Answer
app.post('/api/round/submit', (req: Request, res: Response) => {
  const { playerId, roundId, answer } = req.body;
  if (!playerId || !roundId || !answer) {
    return res.status(400).json({ success: false, message: 'Missing submission parameters' });
  }

  const result = stateStore.submitRoundAnswer(playerId, roundId, answer);
  if (result.success) {
    broadcastSync();
  }
  res.json(result);
});

// Request Round Hint
app.post('/api/round/hint', (req: Request, res: Response) => {
  const { teamId, hintIndex } = req.body;
  if (!teamId || !hintIndex) {
    return res.status(400).json({ success: false, error: 'Missing teamId or hintIndex' });
  }

  const result = stateStore.requestRoundHint(teamId, Number(hintIndex));
  if (result.success) {
    broadcastSync();
  }
  res.json(result);
});

// Admin Authentication Middleware
function checkAdminPasscode(req: Request, res: Response, next: () => void) {
  const provided = req.headers['x-admin-passcode'] || req.body?.admin_passcode;
  if (provided === stateStore.config.admin_passcode) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Invalid Underworld Admin Passcode' });
}

// Admin Routes
app.post('/api/admin/verify', (req: Request, res: Response) => {
  const { passcode } = req.body;
  if (passcode === stateStore.config.admin_passcode) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid Admin Passcode' });
  }
});

app.post('/api/admin/state', checkAdminPasscode, (req: Request, res: Response) => {
  const { state, roundIndex } = req.body;
  stateStore.setGameState(state, roundIndex);
  broadcastSync();
  res.json({ success: true, state: stateStore.state });
});

app.post('/api/admin/timer', checkAdminPasscode, (req: Request, res: Response) => {
  const { action, secondsDelta } = req.body;
  if (action === 'adjust' && typeof secondsDelta === 'number') {
    stateStore.adjustRoundTimer(secondsDelta);
  } else if (action === 'pause') {
    stateStore.togglePauseTimer();
  }
  broadcastSync();
  res.json({
    success: true,
    round_ends_at: stateStore.round_ends_at,
    is_paused: stateStore.round_is_paused
  });
});

app.post('/api/admin/player/role', checkAdminPasscode, (req: Request, res: Response) => {
  const { playerId, roleId } = req.body;
  const player = stateStore.players.get(playerId);
  if (!player) return res.status(404).json({ success: false, error: 'Player not found' });

  player.roleId = roleId;
  stateStore.saveToDisk();
  broadcastSync();
  res.json({ success: true, player });
});

app.post('/api/admin/player/team', checkAdminPasscode, (req: Request, res: Response) => {
  const { playerId, targetTeamId } = req.body;
  const success = stateStore.movePlayerToTeam(playerId, targetTeamId);
  broadcastSync();
  res.json({ success });
});

app.post('/api/admin/player/remove', checkAdminPasscode, (req: Request, res: Response) => {
  const { playerId } = req.body;
  const success = stateStore.removePlayer(playerId);
  broadcastSync();
  res.json({ success });
});

app.post('/api/admin/team/delete', checkAdminPasscode, (req: Request, res: Response) => {
  const { teamId } = req.body;
  const success = stateStore.deleteTeam(teamId);
  broadcastSync();
  res.json({ success });
});

app.post('/api/admin/auto-group', checkAdminPasscode, (_req: Request, res: Response) => {
  const count = stateStore.autoGroupRemainingPlayers();
  broadcastSync();
  res.json({ success: true, count });
});

app.post('/api/admin/spawn-demo-crew', checkAdminPasscode, (_req: Request, res: Response) => {
  const result = stateStore.spawnDemoCrew();
  broadcastSync();
  res.json({ success: true, ...result });
});

app.post('/api/admin/player/add', checkAdminPasscode, (req: Request, res: Response) => {
  const { name, roleId } = req.body;
  const player = stateStore.joinOrReconnectPlayer(undefined, name);
  if (roleId) {
    player.roleId = roleId;
    stateStore.saveToDisk();
  }
  broadcastSync();
  res.json({ success: true, player });
});

app.post('/api/admin/team/score', checkAdminPasscode, (req: Request, res: Response) => {
  const { teamId, delta } = req.body;
  const success = stateStore.adjustTeamScore(teamId, delta);
  broadcastSync();
  res.json({ success });
});

app.post('/api/admin/config', checkAdminPasscode, (req: Request, res: Response) => {
  const { config } = req.body;
  if (config) {
    stateStore.config = config;
    stateStore.saveToDisk();
    broadcastSync();
  }
  res.json({ success: true, config: stateStore.config });
});

app.post('/api/admin/reset', checkAdminPasscode, (_req: Request, res: Response) => {
  stateStore.resetAll();
  broadcastSync();
  res.json({ success: true });
});

// Round 2 Routes
app.post('/api/round2/pair', (req: Request, res: Response) => {
  const { myTeamId, opponentBattleCode } = req.body;
  if (!myTeamId || !opponentBattleCode) {
    return res.status(400).json({ success: false, error: 'Team ID and battle code required.' });
  }
  const result = stateStore.round2PairByCode(myTeamId, opponentBattleCode);
  if (result.success) {
    broadcastSync();
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

app.post('/api/round2/vote', (req: Request, res: Response) => {
  const { matchId, playerId, teamId, vote } = req.body;
  if (!matchId || !playerId || !teamId || !vote) {
    return res.status(400).json({ success: false, error: 'Missing vote parameters.' });
  }
  const result = stateStore.round2CastVote(matchId, playerId, teamId, vote);
  if (result.success) {
    broadcastSync();
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

app.post('/api/round2/advance', (req: Request, res: Response) => {
  const { matchId } = req.body;
  if (!matchId) return res.status(400).json({ success: false, error: 'Match ID required.' });
  const updated = stateStore.round2AdvancePhase(matchId, true);
  broadcastSync();
  res.json({ success: true, match: updated });
});

// Round 2 Admin Routes
app.post('/api/admin/round2/auto-pair', checkAdminPasscode, (_req: Request, res: Response) => {
  const result = stateStore.adminRound2AutoPair();
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/pair', checkAdminPasscode, (req: Request, res: Response) => {
  const { teamAId, teamBId } = req.body;
  const result = stateStore.adminRound2ManualPair(teamAId, teamBId);
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/timer', checkAdminPasscode, (req: Request, res: Response) => {
  const { deltaSeconds } = req.body;
  const result = stateStore.adminRound2AdjustTimer(Number(deltaSeconds) || 0);
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/skip-phase', checkAdminPasscode, (req: Request, res: Response) => {
  const { matchId } = req.body;
  const result = stateStore.adminRound2SkipPhase(matchId);
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/reset', checkAdminPasscode, (_req: Request, res: Response) => {
  const result = stateStore.adminRound2ResetMatches();
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/durations', checkAdminPasscode, (req: Request, res: Response) => {
  const { durations } = req.body;
  const result = stateStore.adminRound2SaveDurations(durations);
  broadcastSync();
  res.json(result);
});

app.post('/api/admin/round2/scoring', checkAdminPasscode, (req: Request, res: Response) => {
  const { scoringMatrix } = req.body;
  const result = stateStore.adminRound2SaveScoring(scoringMatrix);
  broadcastSync();
  res.json(result);
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalNetworkIp();
  console.log(`====================================================`);
  console.log(`⚡ Underworld Engine Backend Server listening on port ${PORT}`);
  console.log(`📱 Local IP: http://${ip}:${PORT}`);
  console.log(`🎮 Game Join URL: http://${ip}:5173/`);
  console.log(`🛡️ Admin Panel: http://${ip}:5173/admin`);
  console.log(`====================================================`);
});
