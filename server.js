const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PHASE_TIMERS = {
  roleReveal: 4500,
  toDay: 3800,
  toNight: 3500,
  nightEvent: 8200,
  nightEmpty: 1500,
  morningDeath: 4800,
  morningRat: 4800,
  exile: 7500,
  toResult: 2500
};

const COLORS = [
  { id: 0,  name: 'レッド',     hex: '#e53935', light: '#ff8a80' },
  { id: 1,  name: 'ブルー',     hex: '#1e88e5', light: '#82b1ff' },
  { id: 2,  name: 'グリーン',   hex: '#43a047', light: '#b9f6ca' },
  { id: 3,  name: 'イエロー',   hex: '#fdd835', light: '#ffff8d' },
  { id: 4,  name: 'オレンジ',   hex: '#fb8c00', light: '#ffd180' },
  { id: 5,  name: 'パープル',   hex: '#8e24aa', light: '#ea80fc' },
  { id: 6,  name: 'ピンク',     hex: '#ec407a', light: '#ff80ab' },
  { id: 7,  name: 'シアン',     hex: '#00acc1', light: '#84ffff' },
  { id: 8,  name: 'ライム',     hex: '#7cb342', light: '#ccff90' },
  { id: 9,  name: 'ブラウン',   hex: '#6d4c41', light: '#bcaaa4' },
  { id: 10, name: 'ホワイト',   hex: '#eceff1', light: '#ffffff' },
  { id: 11, name: 'ブラック',   hex: '#37474f', light: '#90a4ae' },
  { id: 12, name: 'インディゴ', hex: '#3949ab', light: '#8c9eff' }
];

const N = {
  imp: 'インポスター',
  rat: 'ねずみ',
  inv: 'インベスティゲーター',
  pol: 'ポリス',
  trap: 'トラッパー',
  look: 'ルックアウト',
  trk: 'トラッカー',
  prov: '挑発者',
  doc: 'ドクター',
  fool: 'バカ',
  blm: 'ブレイマー',
  cln: 'クリーナー',
  sk: 'シリアルキラー',
  mag: '魔術師',
  gho: 'ゴースト',
  bom: 'ボマー',
  thf: 'シーフ',
  sur: 'サバイバー'
};

const CN = { g: '緑', r: '赤', b: '青' };
const G = ['rat', 'inv', 'pol', 'trap', 'look', 'trk', 'prov', 'doc'];
const R = ['blm', 'cln'];
const B = ['sk', 'mag', 'gho', 'bom', 'thf', 'sur'];
const TG = ['rat', 'inv', 'pol', 'trap', 'look', 'trk', 'prov', 'doc', 'blm', 'cln', 'sk', 'bom', 'thf'];
const LIM = {
  rat: 1,
  trap: 2,
  prov: 2,
  blm: 2,
  thf: 1,
  sur: 3
};
const GUESS = ['imp', ...G, 'fool', ...R, ...G.map(r => 'r:' + r), ...B];

const META = { COLORS, N, CN, G, R, B, TG, LIM, GUESS };

const BOT_NAMES = [
  'ボット太郎', 'ボット花子', 'ボット次郎', 'ボット美咲', 'ボット健太',
  'ボット翔太', 'ボット陽菜', 'ボット大輔', 'ボット結衣', 'ボット拓海',
  'ボットさくら', 'ボット蓮', 'ボット葵', 'ボット湊', 'ボット凛',
  'ボット樹', 'ボット芽依', 'ボット悠真', 'ボット紬', 'ボット律'
];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function slotLabel(c, role) {
  if (!role) return `${CN[c]}ランダム`;
  if (c === 'r' && G.includes(role)) return `赤${N[role]}`;
  return N[role] || role;
}

function roleLabel(c, role) {
  if (role === 'unknown') return '???';
  if (c === 'r' && role === 'imp') return N.imp;
  if (c === 'r' && G.includes(role)) return `赤${N[role]}`;
  return N[role] || role;
}

const room = {
  mode: 'lobby',
  hostUid: null,
  users: [],
  totalPlayers: 6,
  slots: [
    { c: 'g', role: 'pol' },
    { c: 'g', role: 'trap' },
    { c: 'g', role: 'doc' },
    { c: 'g', role: 'inv' },
    { c: 'r', role: 'blm' },
    { c: 'b', role: 'sk' }
  ],
  game: null
};

let transitionTimers = [];

function clearTransitionTimers() {
  transitionTimers.forEach(t => clearTimeout(t));
  transitionTimers = [];
}

function scheduleTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  transitionTimers.push(t);
  return t;
}

function validateSlots() {
  const errs = [];
  const n = room.slots.length;
  if (n < 3) errs.push('総人数は3人以上にしてください。');
  if (n > 20) errs.push('総人数は20人以下にしてください。');
  const rCount = room.slots.filter(s => s.c === 'r').length;
  const bKillCount = room.slots.filter(
    s => s.c === 'b' && (s.role === 'sk' || s.role === 'mag' || s.role === 'bom' || !s.role)
  ).length;
  if (rCount === 0 && bKillCount === 0) {
    errs.push('赤陣営またはキル能力を持つ第三陣営を1人以上入れてください。');
  }
  return errs;
}

function getAvailableColor(preferredColor, excludeUid = null) {
  const taken = new Set(room.users.filter(u => u.uid !== excludeUid).map(u => u.color));
  if (typeof preferredColor === 'number' && preferredColor >= 0 && preferredColor < COLORS.length && !taken.has(preferredColor)) {
    return preferredColor;
  }
  for (let i = 0; i < COLORS.length; i++) {
    if (!taken.has(i)) return i;
  }
  return 0;
}

function resolveRandomSlot(slot) {
  if (slot.role) {
    return { c: slot.c, role: slot.role };
  }
  if (slot.c === 'g') {
    const pool = [...G, 'fool'];
    return { c: 'g', role: rand(pool) };
  }
  if (slot.c === 'r') {
    const pool = [...R, ...G];
    return { c: 'r', role: rand(pool) };
  }
  if (slot.c === 'b') {
    return { c: 'b', role: rand(B) };
  }
  return { c: 'g', role: 'rat' };
}

function startNewGame() {
  clearTransitionTimers();
  const onlineUsers = room.users.filter(u => u.online);
  const total = room.slots.length;
  const players = [];
  const usedColors = new Set();

  onlineUsers.slice(0, total).forEach((u, idx) => {
    usedColors.add(u.color);
    players.push({
      id: idx,
      uid: u.uid,
      isBot: false,
      name: u.name,
      color: u.color,
      alive: true,
      exiled: false,
      isAsh: false,
      bombed: false,
      bombPlanted: false,
      blamed: false,
      cleaned: false,
      shieldActive: false,
      extraVotes: 0,
      uses: {},
      last: {},
      nightEvents: [],
      privateLogs: [],
      pendingPrivateLogs: [],
      thiefNotice: null,
      roleHistory: []
    });
  });

  const availBotNames = shuffle(BOT_NAMES);
  let botNameIdx = 0;
  while (players.length < total) {
    let col = 0;
    for (let c = 0; c < COLORS.length; c++) {
      if (!usedColors.has(c)) {
        col = c;
        break;
      }
    }
    usedColors.add(col);
    const id = players.length;
    players.push({
      id,
      uid: `bot_${id}`,
      isBot: true,
      name: availBotNames[botNameIdx % availBotNames.length],
      color: col,
      alive: true,
      exiled: false,
      isAsh: false,
      bombed: false,
      bombPlanted: false,
      blamed: false,
      cleaned: false,
      shieldActive: false,
      extraVotes: 0,
      uses: {},
      last: {},
      nightEvents: [],
      privateLogs: [],
      pendingPrivateLogs: [],
      thiefNotice: null,
      roleHistory: []
    });
    botNameIdx++;
  }

  const shuffledSlots = shuffle(room.slots);
  const resolvedRoles = shuffledSlots.map(s => resolveRandomSlot(s));

  players.forEach((p, idx) => {
    const res = resolvedRoles[idx];
    p.rc = res.c;
    p.trueRole = res.role;
    if (res.role === 'fool') {
      const fakePool = G.filter(r => r !== 'prov');
      p.camp = 'g';
      p.er = rand(fakePool);
    } else {
      p.camp = res.c;
      p.er = res.role;
    }
    p.sur = (res.role === 'sur');
    p.roleHistory.push({ c: p.rc, role: p.trueRole });
  });

  const gid = Date.now();
  room.mode = 'game';
  room.game = {
    gid,
    day: 1,
    ph: 'day',
    phaseTransition: 'roleReveal',
    showResult: false,
    over: null,
    winners: [],
    players,
    roleBarBase: room.slots.map(s => ({ c: s.c, role: s.role || null })),
    publicLogs: [],
    votes: {},
    nightActions: {},
    lastExile: null,
    newDeaths: [],
    morningDeathIdx: 0,
    morningRats: [],
    morningRatIdx: 0,
    pendingMorningRats: []
  };

  broadcastState();

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;
    room.game.phaseTransition = null;
    submitBotDayVotes();
    broadcastState();
  }, PHASE_TIMERS.roleReveal);
}

function addPublicLog(day, icons) {
  if (!room.game) return;
  room.game.publicLogs.push({ day, scope: 'public', icons });
}

// 個人ログは演出が終わったタイミングで公開されるよう、イベントインデックス付きでキューに入れる
function queuePrivateLog(player, day, icons, afterEventIdx) {
  if (!player) return;
  player.pendingPrivateLogs.push({
    day,
    scope: 'private',
    icons,
    afterEventIdx: typeof afterEventIdx === 'number' ? afterEventIdx : 0
  });
}

function flushPrivateLogsUpTo(player, maxEventIdx) {
  if (!player || !player.pendingPrivateLogs.length) return false;
  const ready = [];
  const remain = [];
  player.pendingPrivateLogs.forEach(item => {
    if (item.afterEventIdx <= maxEventIdx) {
      ready.push({ day: item.day, scope: 'private', icons: item.icons });
    } else {
      remain.push(item);
    }
  });
  if (ready.length > 0) {
    player.privateLogs.push(...ready);
    player.pendingPrivateLogs = remain;
    return true;
  }
  return false;
}

function flushAllPendingPrivateLogs() {
  if (!room.game) return;
  room.game.players.forEach(p => {
    if (p.pendingPrivateLogs.length > 0) {
      p.pendingPrivateLogs.forEach(item => {
        p.privateLogs.push({ day: item.day, scope: 'private', icons: item.icons });
      });
      p.pendingPrivateLogs = [];
    }
  });
}

function submitBotDayVotes() {
  const g = room.game;
  if (!g || g.ph !== 'day' || g.phaseTransition || g.over) return;
  const alive = g.players.filter(p => p.alive);
  alive.forEach(p => {
    if (p.isBot && g.votes[p.id] === undefined) {
      if (g.day === 1) {
        g.votes[p.id] = -1;
      } else {
        const candidates = alive.filter(x => x.id !== p.id);
        if (candidates.length > 0 && Math.random() < 0.72) {
          g.votes[p.id] = rand(candidates).id;
        } else {
          g.votes[p.id] = -1;
        }
      }
    }
  });
  checkDayComplete();
}

function submitBotNightActions() {
  const g = room.game;
  if (!g || g.ph !== 'night' || g.phaseTransition || g.over) return;
  const alive = g.players.filter(p => p.alive);
  alive.forEach(p => {
    if (!p.isBot || g.nightActions[p.id] !== undefined) return;
    const others = alive.filter(x => x.id !== p.id);
    if (!others.length) {
      g.nightActions[p.id] = {};
      return;
    }

    if (p.sur && (p.uses.sur || 0) < 3 && Math.random() < 0.55) {
      g.nightActions[p.id] = { sh: 1 };
      return;
    }

    if (p.er === 'bom') {
      const plantedCount = g.players.filter(x => x.alive && x.bombPlanted).length;
      if (plantedCount >= 2 || (plantedCount >= 1 && Math.random() < 0.5)) {
        g.nightActions[p.id] = { det: 1 };
        return;
      }
    }

    if (p.rc === 'r') {
      const nonMates = others.filter(x => x.rc !== 'r');
      const targetPool = nonMates.length ? nonMates : others;
      const limit = LIM[p.er];
      const used = p.uses[p.er] || 0;
      const canSub = TG.includes(p.er) && (!limit || used < limit);
      if (canSub && Math.random() < 0.35) {
        const noRepeat = ['doc', 'pol', 'trk'].includes(p.er);
        const valid = targetPool.filter(x => !noRepeat || p.last[p.er] !== x.id);
        if (valid.length) {
          g.nightActions[p.id] = { t: rand(valid).id };
          return;
        }
      }
      g.nightActions[p.id] = { t: rand(targetPool).id, kill: 1 };
      return;
    }

    if (p.er === 'mag') {
      if (Math.random() < 0.5) {
        const target = rand(others);
        g.nightActions[p.id] = { t: target.id, guess: rand(GUESS) };
      } else {
        g.nightActions[p.id] = {};
      }
      return;
    }

    const limit = LIM[p.er];
    const used = p.uses[p.er] || 0;
    if (TG.includes(p.er) && (!limit || used < limit)) {
      const noRepeat = ['doc', 'pol', 'trk'].includes(p.er);
      const valid = others.filter(x => !noRepeat || p.last[p.er] !== x.id);
      if (valid.length) {
        g.nightActions[p.id] = { t: rand(valid).id };
        return;
      }
    }

    g.nightActions[p.id] = {};
  });
  checkNightComplete();
}

function getVoteTally(g) {
  const tally = {};
  let skipCount = 0;
  g.players.forEach(p => {
    if (p.alive && p.extraVotes > 0) {
      tally[p.id] = (tally[p.id] || 0) + p.extraVotes;
    }
  });
  Object.entries(g.votes).forEach(([voterIdStr, targetId]) => {
    const voter = g.players.find(p => p.id === Number(voterIdStr));
    if (!voter || !voter.alive) return;
    if (targetId === -1) {
      skipCount++;
    } else {
      const target = g.players.find(p => p.id === targetId);
      if (target && target.alive) {
        tally[target.id] = (tally[target.id] || 0) + 1;
      }
    }
  });
  return { tally, skipCount };
}

function checkDayComplete() {
  const g = room.game;
  if (!g || g.ph !== 'day' || g.phaseTransition || g.over) return;
  const alive = g.players.filter(p => p.alive);
  const votedCount = alive.filter(p => g.votes[p.id] !== undefined).length;
  if (votedCount >= alive.length) {
    resolveDayPhase();
  }
}

function resolveDayPhase() {
  const g = room.game;
  if (!g) return;
  const gid = g.gid;
  const alive = g.players.filter(p => p.alive);

  if (g.day === 1) {
    g.players.forEach(p => { p.extraVotes = 0; });
    transitionToNight(gid);
    return;
  }

  const { tally } = getVoteTally(g);
  const majority = Math.floor(alive.length / 2) + 1;
  let exiledPlayer = null;
  let maxVotes = 0;

  alive.forEach(p => {
    const v = tally[p.id] || 0;
    if (v >= majority && v > maxVotes) {
      maxVotes = v;
      exiledPlayer = p;
    }
  });

  g.players.forEach(p => { p.extraVotes = 0; });

  if (!exiledPlayer) {
    transitionToNight(gid);
    return;
  }

  // 投票で吊られた後は死体を残さない（exiled: true）
  exiledPlayer.alive = false;
  exiledPlayer.exiled = true;
  exiledPlayer.rev = {
    c: exiledPlayer.rc,
    role: exiledPlayer.trueRole,
    t: roleLabel(exiledPlayer.rc, exiledPlayer.trueRole)
  };

  let ghostVictimId = null;
  if (exiledPlayer.trueRole === 'gho') {
    exiledPlayer.ghostWon = true;
    const votersForGhost = alive.filter(p => p.id !== exiledPlayer.id && g.votes[p.id] === exiledPlayer.id);
    if (votersForGhost.length > 0) {
      const victim = rand(votersForGhost);
      victim.alive = false;
      victim.rev = {
        c: victim.rc,
        role: victim.trueRole,
        t: roleLabel(victim.rc, victim.trueRole)
      };
      ghostVictimId = victim.id;
    }
  }

  g.lastExile = {
    id: exiledPlayer.id,
    name: exiledPlayer.name,
    c: exiledPlayer.rc,
    role: exiledPlayer.trueRole,
    roleText: roleLabel(exiledPlayer.rc, exiledPlayer.trueRole),
    ghostVictimId
  };

  const logIcons = [
    { type: 'kick' },
    { type: 'char', id: exiledPlayer.id },
    { type: 'role', c: exiledPlayer.rc, role: exiledPlayer.trueRole }
  ];
  if (ghostVictimId !== null) {
    logIcons.push({ type: 'ghost' }, { type: 'char', id: ghostVictimId });
  }
  addPublicLog(g.day, logIcons);

  g.phaseTransition = 'exile';
  broadcastState();

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;
    if (checkGameOver()) {
      triggerToResult(gid);
      return;
    }
    transitionToNight(gid);
  }, PHASE_TIMERS.exile);
}

function transitionToNight(gid) {
  const g = room.game;
  if (!g || g.gid !== gid) return;
  g.ph = 'night';
  g.votes = {};
  g.nightActions = {};
  g.lastExile = null;
  g.players.forEach(p => {
    p.thiefNotice = null;
    p.nightEvents = [];
  });
  g.phaseTransition = 'toNight';
  broadcastState();

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;
    g.phaseTransition = null;
    submitBotNightActions();
    broadcastState();
  }, PHASE_TIMERS.toNight);
}

function checkNightComplete() {
  const g = room.game;
  if (!g || g.ph !== 'night' || g.phaseTransition || g.over) return;
  const alive = g.players.filter(p => p.alive);
  const doneCount = alive.filter(p => g.nightActions[p.id] !== undefined).length;
  if (doneCount >= alive.length) {
    resolveNightPhase();
  }
}

function resolveNightPhase() {
  const g = room.game;
  if (!g) return;
  const gid = g.gid;

  const aliveAtNightStart = new Set(g.players.filter(p => p.alive).map(p => p.id));

  g.players.forEach(p => {
    p.nightEvents = [];
    p.shieldActive = false;
    p.cleaned = false;
    p.blamed = false;
  });

  const actions = {};
  g.players.forEach(p => {
    if (aliveAtNightStart.has(p.id)) {
      actions[p.id] = g.nightActions[p.id] || {};
    }
  });

  const visitedTargets = new Map();
  const recordVisit = (actorId, targetId) => {
    if (!visitedTargets.has(actorId)) visitedTargets.set(actorId, new Set());
    visitedTargets.get(actorId).add(targetId);
  };

  const pendingKills = new Map();
  const addPendingKill = (targetId, info) => {
    if (!pendingKills.has(targetId)) pendingKills.set(targetId, []);
    pendingKills.get(targetId).push(info);
  };

  const docSavedTargets = new Set();
  const blockedPlayers = new Set();
  const pendingThiefCopies = [];

  // サバイバーシールド有効化
  g.players.forEach(p => {
    if (!p.alive) return;
    const act = actions[p.id];
    if (act && act.sh && p.sur && (p.uses.sur || 0) < 3) {
      p.uses.sur = (p.uses.sur || 0) + 1;
      p.shieldActive = true;
      p.nightEvents.push({ kind: 'self_act', actor: p.id, role: 'sur' });
    }
  });

  // 【第1段階】シリアルキラー (sk) & 魔術師 (mag)（ポリス・トラッパーより先に実行）
  const fastestActors = shuffle(
    g.players.filter(p => p.alive && (p.trueRole === 'sk' || p.trueRole === 'mag'))
  );

  fastestActors.forEach(actor => {
    if (!actor.alive) return;
    const act = actions[actor.id];
    if (!act || act.t === undefined || act.t === null) return;
    const target = g.players.find(x => x.id === act.t);
    if (!target || !aliveAtNightStart.has(target.id) || target.id === actor.id) return;

    recordVisit(actor.id, target.id);

    if (actor.trueRole === 'sk') {
      target.alive = false;
      target.killedByUnknown = true;
      addPendingKill(target.id, {
        killer: actor,
        role: 'sk',
        camp: 'b',
        isThief: false,
        forceUnknown: true,
        priority: 1
      });
    } else if (actor.trueRole === 'mag' && act.guess) {
      const targetActualCode = target.rc === 'r' && G.includes(target.trueRole)
        ? `r:${target.trueRole}`
        : target.trueRole;
      const isCorrect = (act.guess === targetActualCode);

      if (isCorrect) {
        addPendingKill(target.id, {
          killer: actor,
          role: 'mag',
          camp: 'b',
          isThief: false,
          forceUnknown: false,
          priority: 1
        });
      } else {
        actor.alive = false;
        actor.isAsh = true;
        const evIdx1 = actor.nightEvents.push({
          kind: 'act', actor: actor.id, target: target.id, role: 'mag', camp: 'b', result: 'fail'
        }) - 1;
        actor.nightEvents.push({
          kind: 'self_ash', target: actor.id
        });
        queuePrivateLog(actor, g.day, [
          { type: 'role', c: 'b', role: 'mag' },
          { type: 'char', id: target.id },
          { type: 'mark', val: 'fail' }
        ], evIdx1);
      }
    }
  });

  // 【第2段階】ポリス & トラッパー
  g.players.forEach(p => {
    if (!p.alive || p.trueRole !== 'fool') return;
    const act = actions[p.id];
    if (!act || act.t === undefined || act.t === null) return;
    if (p.er === 'pol' || p.er === 'trap') {
      p.last[p.er] = act.t;
      const evIdx = p.nightEvents.push({
        kind: 'act', actor: p.id, target: act.t, role: p.er, camp: 'g', result: 'fail'
      }) - 1;
      queuePrivateLog(p, g.day, [
        { type: 'role', c: 'g', role: p.er },
        { type: 'char', id: act.t },
        { type: 'mark', val: 'fail' }
      ], evIdx);
    }
  });

  const activeTrappers = [];
  g.players.forEach(p => {
    if (!p.alive || p.trueRole !== 'trap') return;
    const act = actions[p.id];
    if (!act || act.t === undefined || act.t === null || act.kill) return;
    const used = p.uses.trap || 0;
    if (used >= (LIM.trap || 2)) return;
    const target = g.players.find(x => x.id === act.t);
    if (!target || !aliveAtNightStart.has(target.id) || target.id === p.id) return;
    activeTrappers.push({
      player: p,
      targetId: target.id,
      stoppedByPolice: false,
      triggeredByVisitor: false
    });
  });

  const activePolices = [];
  g.players.forEach(p => {
    if (!p.alive || p.trueRole !== 'pol') return;
    const act = actions[p.id];
    if (!act || act.t === undefined || act.t === null || act.kill) return;
    if (p.last.pol === act.t) return;
    const target = g.players.find(x => x.id === act.t);
    if (!target || !aliveAtNightStart.has(target.id) || target.id === p.id) return;
    activePolices.push({
      player: p,
      targetId: target.id
    });
  });

  const trapperIdSet = new Set(activeTrappers.map(tr => tr.player.id));
  const sortedPolices = [
    ...shuffle(activePolices.filter(po => trapperIdSet.has(po.targetId))),
    ...shuffle(activePolices.filter(po => !trapperIdSet.has(po.targetId)))
  ];

  // まずトラッパーの「置きに行く演出」を先に登録しておく（かかった場合の演出がその後に来るように）
  const activeHouseTraps = new Map();
  activeTrappers.forEach(tr => {
    if (!tr.player.alive) return;
    const stoppedByPol = sortedPolices.some(po => po.player.alive && po.targetId === tr.player.id);
    if (stoppedByPol) {
      tr.stoppedByPolice = true;
      return;
    }
    tr.player.uses.trap = (tr.player.uses.trap || 0) + 1;
    recordVisit(tr.player.id, tr.targetId);

    const placeIdx = tr.player.nightEvents.push({
      kind: 'trap_place', actor: tr.player.id, target: tr.targetId
    }) - 1;
    tr.placeEventIdx = placeIdx;

    if (!activeHouseTraps.has(tr.targetId)) activeHouseTraps.set(tr.targetId, []);
    activeHouseTraps.get(tr.targetId).push(tr);
  });

  sortedPolices.forEach(po => {
    const polPlayer = po.player;
    if (!polPlayer.alive || blockedPlayers.has(polPlayer.id)) return;
    const targetId = po.targetId;
    polPlayer.last.pol = targetId;

    const traps = activeHouseTraps.get(targetId);
    if (traps && traps.length > 0) {
      const trapEntry = traps.shift();
      trapEntry.triggeredByVisitor = true;
      blockedPlayers.add(polPlayer.id);
      recordVisit(polPlayer.id, targetId);

      // 訪問者側＆トラッパー側両方にトラップ発動演出を追加
      const polTrigIdx = polPlayer.nightEvents.push({
        kind: 'trap_triggered', trapperId: trapEntry.player.id, visitorId: polPlayer.id, house: targetId
      }) - 1;
      const trapTrigIdx = trapEntry.player.nightEvents.push({
        kind: 'trap_triggered', trapperId: trapEntry.player.id, visitorId: polPlayer.id, house: targetId
      }) - 1;

      queuePrivateLog(trapEntry.player, g.day, [
        { type: 'char', id: trapEntry.player.id },
        { type: 'role', c: 'g', role: 'trap' },
        { type: 'grayChar' }
      ], trapTrigIdx);
      queuePrivateLog(polPlayer, g.day, [
        { type: 'role', c: 'g', role: 'trap' },
        { type: 'mark', val: 'fail' }
      ], polTrigIdx);
      return;
    }

    const targetPlayer = g.players.find(x => x.id === targetId);
    if (targetPlayer && (targetPlayer.trueRole === 'sk' || targetPlayer.trueRole === 'mag')) {
      const evIdx = polPlayer.nightEvents.push({
        kind: 'act', actor: polPlayer.id, target: targetId, role: 'pol', camp: polPlayer.camp, result: 'fail'
      }) - 1;
      queuePrivateLog(polPlayer, g.day, [
        { type: 'role', c: polPlayer.camp, role: 'pol' },
        { type: 'char', id: targetId },
        { type: 'mark', val: 'fail' }
      ], evIdx);
      return;
    }

    blockedPlayers.add(targetId);

    const evIdx = polPlayer.nightEvents.push({
      kind: 'act', actor: polPlayer.id, target: targetId, role: 'pol', camp: polPlayer.camp, result: 'ok'
    }) - 1;
    queuePrivateLog(polPlayer, g.day, [
      { type: 'role', c: polPlayer.camp, role: 'pol' },
      { type: 'char', id: targetId },
      { type: 'mark', val: 'ok' }
    ], evIdx);

    if (targetPlayer && targetPlayer.alive) {
      const blkIdx = targetPlayer.nightEvents.push({
        kind: 'blocked_pol', target: targetId
      }) - 1;
      queuePrivateLog(targetPlayer, g.day, [
        { type: 'role', c: 'g', role: 'pol' },
        { type: 'mark', val: 'fail' }
      ], blkIdx);
    }
  });

  // 【第3段階】ボマー起爆＆その他役職
  const checkAndTriggerHouseTrap = (visitor, targetId) => {
    const traps = activeHouseTraps.get(targetId);
    if (traps && traps.length > 0) {
      const trapEntry = traps.shift();
      trapEntry.triggeredByVisitor = true;
      blockedPlayers.add(visitor.id);

      const visTrigIdx = visitor.nightEvents.push({
        kind: 'trap_triggered', trapperId: trapEntry.player.id, visitorId: visitor.id, house: targetId
      }) - 1;
      const trapTrigIdx = trapEntry.player.nightEvents.push({
        kind: 'trap_triggered', trapperId: trapEntry.player.id, visitorId: visitor.id, house: targetId
      }) - 1;

      queuePrivateLog(trapEntry.player, g.day, [
        { type: 'char', id: trapEntry.player.id },
        { type: 'role', c: 'g', role: 'trap' },
        { type: 'grayChar' }
      ], trapTrigIdx);
      queuePrivateLog(visitor, g.day, [
        { type: 'role', c: 'g', role: 'trap' },
        { type: 'mark', val: 'fail' }
      ], visTrigIdx);
      return true;
    }
    return false;
  };

  // ボマー起爆
  g.players.forEach(p => {
    if (!p.alive || p.trueRole !== 'bom') return;
    if (blockedPlayers.has(p.id)) return;
    const act = actions[p.id];
    if (act && act.det) {
      const bombTargets = g.players.filter(x => aliveAtNightStart.has(x.id) && x.bombPlanted).map(x => x.id);
      if (bombTargets.length > 0) {
        const killedTargets = [];
        const blastEv = { kind: 'bomb_blast', targets: bombTargets, killedTargets };
        g.players.forEach(pl => pl.nightEvents.push(blastEv));

        bombTargets.forEach(tid => {
          const tPlayer = g.players.find(x => x.id === tid);
          if (tPlayer && aliveAtNightStart.has(tPlayer.id)) {
            tPlayer.bombPlanted = false;
            tPlayer.bombed = true;
            if (!tPlayer.shieldActive) {
              tPlayer.alive = false;
              killedTargets.push(tid);
              const tIdx = tPlayer.nightEvents.length - 1;
              queuePrivateLog(tPlayer, g.day, [
                { type: 'grayChar' },
                { type: 'role', c: 'b', role: 'bom' },
                { type: 'char', id: tPlayer.id }
              ], tIdx);
            }
          }
        });
        const bomIdx = p.nightEvents.length - 1;
        queuePrivateLog(p, g.day, [
          { type: 'role', c: 'b', role: 'bom' },
          ...bombTargets.map(tid => ({ type: 'char', id: tid })),
          { type: 'mark', val: 'ok' }
        ], bomIdx);
      }
    }
  });

  const remainingActors = shuffle(
    g.players.filter(p => p.alive && !['sk', 'mag', 'pol', 'trap'].includes(p.trueRole))
  );

  const infoChecks = [];

  remainingActors.forEach(actor => {
    if (!actor.alive || blockedPlayers.has(actor.id)) return;
    const act = actions[actor.id];
    if (!act || act.t === undefined || act.t === null) return;
    const target = g.players.find(x => x.id === act.t);
    if (!target || !aliveAtNightStart.has(target.id) || target.id === actor.id) return;

    recordVisit(actor.id, target.id);

    if (checkAndTriggerHouseTrap(actor, target.id)) {
      return;
    }

    if (actor.trueRole === 'fool') {
      if (['doc', 'trk'].includes(actor.er)) actor.last[actor.er] = target.id;
      if (['inv', 'rat', 'look', 'trk'].includes(actor.er)) {
        infoChecks.push({ actor, target, isFool: true });
      } else {
        const evIdx = actor.nightEvents.push({
          kind: 'act', actor: actor.id, target: target.id, role: actor.er, camp: 'g', result: 'fail'
        }) - 1;
        queuePrivateLog(actor, g.day, [
          { type: 'role', c: 'g', role: actor.er },
          { type: 'char', id: target.id },
          { type: 'mark', val: 'fail' }
        ], evIdx);
      }
      return;
    }

    if (actor.rc === 'r' && act.kill) {
      addPendingKill(target.id, {
        killer: actor,
        role: actor.trueRole,
        camp: 'r',
        isThief: false,
        forceUnknown: false,
        priority: 2
      });
      return;
    }

    const r = actor.trueRole;

    if (r === 'doc') {
      if (actor.last.doc === target.id) return;
      actor.last.doc = target.id;
      docSavedTargets.add(target.id);
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'doc', camp: actor.camp, result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'doc' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
    } else if (r === 'prov') {
      if ((actor.uses.prov || 0) >= (LIM.prov || 2)) return;
      actor.uses.prov = (actor.uses.prov || 0) + 1;
      target.extraVotes += 2;
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'prov', camp: actor.camp, result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'prov' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
    } else if (r === 'blm') {
      if ((actor.uses.blm || 0) >= (LIM.blm || 2)) return;
      actor.uses.blm = (actor.uses.blm || 0) + 1;
      target.blamed = true;
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'blm', camp: 'r', result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: 'r', role: 'blm' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
    } else if (r === 'cln') {
      target.cleaned = true;
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'cln', camp: 'r', result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: 'r', role: 'cln' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
    } else if (r === 'bom') {
      target.bombPlanted = true;
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'bom', camp: 'b', result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: 'b', role: 'bom' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
    } else if (r === 'thf') {
      if ((actor.uses.thf || 0) >= (LIM.thf || 1)) return;
      actor.uses.thf = (actor.uses.thf || 0) + 1;
      addPendingKill(target.id, {
        killer: actor,
        role: 'thf',
        camp: 'b',
        isThief: true,
        forceUnknown: false,
        priority: 2
      });
    } else if (['inv', 'rat', 'look', 'trk'].includes(r)) {
      if (r === 'trk') {
        if (actor.last.trk === target.id) return;
        actor.last.trk = target.id;
      }
      if (r === 'rat') {
        if ((actor.uses.rat || 0) >= (LIM.rat || 1)) return;
        actor.uses.rat = (actor.uses.rat || 0) + 1;
      }
      infoChecks.push({ actor, target, isFool: false });
    }
  });

  // 誰にもかからなかったトラッパーの個人ログを登録
  activeTrappers.forEach(tr => {
    if (!tr.stoppedByPolice && !tr.triggeredByVisitor && tr.placeEventIdx !== undefined) {
      queuePrivateLog(tr.player, g.day, [
        { type: 'char', id: tr.player.id },
        { type: 'role', c: 'g', role: 'trap' }
      ], tr.placeEventIdx);
    }
  });

  // 【第4段階】重複キル・ドクター蘇生・サバイバーシールド精算
  pendingKills.forEach((rawKillList, targetId) => {
    const target = g.players.find(x => x.id === targetId);
    if (!target) return;

    const killList = rawKillList.slice().sort((a, b) => (a.priority || 2) - (b.priority || 2));

    if (target.shieldActive) {
      killList.forEach(k => {
        const kIdx = k.killer.nightEvents.push({
          kind: 'act', actor: k.killer.id, target: target.id, role: k.role, camp: k.camp, result: 'ok'
        }) - 1;
        queuePrivateLog(k.killer, g.day, [
          { type: 'role', c: k.camp, role: k.role },
          { type: 'char', id: target.id },
          { type: 'mark', val: 'ok' }
        ], kIdx);
      });
      return;
    }

    killList.forEach(k => {
      const kIdx = k.killer.nightEvents.push({
        kind: 'act', actor: k.killer.id, target: target.id, role: k.role, camp: k.camp, result: 'ok'
      }) - 1;
      queuePrivateLog(k.killer, g.day, [
        { type: 'role', c: k.camp, role: k.role },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], kIdx);

      // インポスターに殺された時は役職がバレないようにドクロアイコンにする
      const isImpostorKill = (k.camp === 'r');
      const tKillIdx = target.nightEvents.push({
        kind: 'killed',
        target: target.id,
        role: isImpostorKill ? '' : k.role,
        camp: isImpostorKill ? 'n' : k.camp
      }) - 1;

      const causeIcon = isImpostorKill
        ? { type: 'skull' }
        : { type: 'role', c: k.camp, role: k.role };
      queuePrivateLog(target, g.day, [
        { type: 'grayChar' },
        causeIcon,
        { type: 'char', id: target.id }
      ], tKillIdx);
    });

    if (docSavedTargets.has(target.id)) {
      target.alive = true;
      target.killedByUnknown = false;
      const tRevIdx = target.nightEvents.push({
        kind: 'revived', target: target.id, saved: true
      }) - 1;
      queuePrivateLog(target, g.day, [
        { type: 'grayChar' },
        { type: 'role', c: 'g', role: 'doc' },
        { type: 'char', id: target.id }
      ], tRevIdx);
      return;
    }

    target.alive = false;
    if (killList.some(k => k.forceUnknown || k.role === 'sk')) {
      target.killedByUnknown = true;
    }

    killList.forEach(k => {
      if (k.isThief) {
        pendingThiefCopies.push({ thief: k.killer, victim: target });
      }
    });
  });

  pendingThiefCopies.forEach(({ thief, victim }) => {
    if (!thief.alive) return;
    thief.rc = victim.rc;
    thief.trueRole = victim.trueRole;
    if (victim.trueRole === 'fool') {
      thief.camp = 'g';
      thief.er = rand(G.filter(r => r !== 'prov'));
    } else {
      thief.camp = victim.rc;
      thief.er = victim.trueRole;
    }
    if (victim.trueRole === 'sur') thief.sur = true;
    thief.roleHistory.push({ c: thief.rc, role: thief.trueRole });
    thief.thiefNotice = { label: roleLabel(thief.camp, thief.er) };
  });

  // 【第5段階】情報系役職
  const nextMorningRats = [];

  infoChecks.forEach(({ actor, target, isFool }) => {
    if (!actor.alive) return;
    const r = actor.er;
    if (r === 'inv') {
      const allPool = [
        ...G.map(x => ({ c: 'g', role: x })),
        { c: 'g', role: 'fool' },
        ...R.map(x => ({ c: 'r', role: x })),
        ...B.map(x => ({ c: 'b', role: x }))
      ];
      let realChoice;
      if (target.blamed) {
        realChoice = { c: 'r', role: rand(R) };
      } else {
        realChoice = { c: target.rc, role: target.trueRole };
      }
      const decoyPool = allPool.filter(x => !(x.c === realChoice.c && x.role === realChoice.role));
      const decoy1 = rand(decoyPool);
      const decoy2 = rand(decoyPool.filter(x => !(x.c === decoy1.c && x.role === decoy1.role))) || decoy1;
      const choiceIcons = isFool
        ? shuffle([decoy1, decoy2])
        : shuffle([realChoice, decoy1]);

      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'inv', camp: actor.camp, result: 'ok', choiceIcons
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'inv' },
        { type: 'char', id: target.id },
        ...choiceIcons.map(ic => ({ type: 'role', c: ic.c, role: ic.role }))
      ], evIdx);
    } else if (r === 'rat') {
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'rat', camp: actor.camp, result: 'ok'
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'rat' },
        { type: 'char', id: target.id },
        { type: 'mark', val: 'ok' }
      ], evIdx);
      nextMorningRats.push({ actor: actor.id, target: target.id, isFool });
    } else if (r === 'look') {
      let visitorIds = [];
      if (!isFool) {
        visitedTargets.forEach((tSet, vId) => {
          if (vId !== actor.id && tSet.has(target.id)) {
            visitorIds.push(vId);
          }
        });
      }
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'look', camp: actor.camp, result: visitorIds.length ? 'ok' : 'fail', visitorIds
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'look' },
        { type: 'char', id: target.id },
        ...(visitorIds.length
          ? visitorIds.map(vid => ({ type: 'char', id: vid }))
          : [{ type: 'mark', val: 'fail' }])
      ], evIdx);
    } else if (r === 'trk') {
      let destIds = [];
      if (!isFool && visitedTargets.has(target.id)) {
        destIds = Array.from(visitedTargets.get(target.id));
      }
      const evIdx = actor.nightEvents.push({
        kind: 'act', actor: actor.id, target: target.id, role: 'trk', camp: actor.camp, result: destIds.length ? 'ok' : 'fail', destIds
      }) - 1;
      queuePrivateLog(actor, g.day, [
        { type: 'role', c: actor.camp, role: 'trk' },
        { type: 'char', id: target.id },
        ...(destIds.length
          ? destIds.map(did => ({ type: 'char', id: did }))
          : [{ type: 'mark', val: 'fail' }])
      ], evIdx);
    }
  });

  // 【第6段階】新規死亡者リスト作成＆夜の演出再生フェーズ開始
  const newlyDead = [];
  g.players.forEach(p => {
    if (!p.alive && !p.rev) {
      const hideRole = p.cleaned || p.killedByUnknown;
      const revC = hideRole ? 'u' : (p.blamed ? 'r' : p.rc);
      const revRole = hideRole ? 'unknown' : (p.blamed ? 'imp' : p.trueRole);
      const revText = roleLabel(revC, revRole);
      p.rev = { c: revC, role: revRole, t: revText };
      newlyDead.push({
        id: p.id,
        name: p.name,
        c: revC,
        role: revRole,
        roleText: revText
      });
    }
  });

  g.newDeaths = newlyDead;
  g.morningDeathIdx = 0;
  g.pendingMorningRats = nextMorningRats;
  g.morningRats = [];
  g.morningRatIdx = 0;

  const maxEvents = Math.max(0, ...g.players.map(p => p.nightEvents.length));
  const nightAnimMs = maxEvents > 0
    ? maxEvents * PHASE_TIMERS.nightEvent
    : PHASE_TIMERS.nightEmpty;

  g.phaseTransition = 'nightAction';
  broadcastState();

  // 各夜のイベント演出が終わるタイミングごとに個人ログを公開して再配信
  for (let idx = 0; idx < maxEvents; idx++) {
    scheduleTimer(() => {
      if (!room.game || room.game.gid !== gid) return;
      let anyUpdated = false;
      room.game.players.forEach(pl => {
        if (flushPrivateLogsUpTo(pl, idx)) anyUpdated = true;
      });
      if (anyUpdated) broadcastState();
    }, (idx + 1) * PHASE_TIMERS.nightEvent - 200);
  }

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;
    flushAllPendingPrivateLogs();
    startMorningSequence(gid);
  }, nightAnimMs);
}

function startMorningSequence(gid) {
  const g = room.game;
  if (!g || g.gid !== gid) return;

  g.day += 1;
  g.ph = 'day';
  g.votes = {};
  g.nightActions = {};
  g.phaseTransition = 'toDay';
  broadcastState();

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;

    const validRats = (g.pendingMorningRats || []).filter(r => {
      const actor = g.players.find(p => p.id === r.actor);
      const target = g.players.find(p => p.id === r.target);
      return actor && actor.alive && target;
    });

    if (validRats.length > 0) {
      g.morningRats = validRats.map(r => ({ actor: r.actor, target: r.target }));
      playMorningRats(gid, 0);
      return;
    }

    playMorningDeaths(gid, 0);
  }, PHASE_TIMERS.toDay);
}

function playMorningRats(gid, idx) {
  const g = room.game;
  if (!g || g.gid !== gid) return;

  if (idx < g.morningRats.length) {
    const rInfo = g.morningRats[idx];
    g.phaseTransition = 'morningRat';
    g.morningRatIdx = idx;
    addPublicLog(g.day, [
      { type: 'role', c: 'g', role: 'rat' },
      { type: 'char', id: rInfo.actor },
      { type: 'char', id: rInfo.target }
    ]);
    broadcastState();

    scheduleTimer(() => {
      if (!room.game || room.game.gid !== gid) return;
      playMorningRats(gid, idx + 1);
    }, PHASE_TIMERS.morningRat);
    return;
  }

  playMorningDeaths(gid, 0);
}

function playMorningDeaths(gid, idx) {
  const g = room.game;
  if (!g || g.gid !== gid) return;

  if (idx < g.newDeaths.length) {
    g.phaseTransition = 'morningDeaths';
    g.morningDeathIdx = idx;
    broadcastState();

    scheduleTimer(() => {
      if (!room.game || room.game.gid !== gid) return;
      const deathInfo = g.newDeaths[idx];
      if (deathInfo) {
        addPublicLog(g.day, [
          { type: 'skull' },
          { type: 'char', id: deathInfo.id },
          { type: 'role', c: deathInfo.c, role: deathInfo.role }
        ]);
      }
      playMorningDeaths(gid, idx + 1);
    }, PHASE_TIMERS.morningDeath);
    return;
  }

  if (checkGameOver()) {
    triggerToResult(gid);
    return;
  }

  g.phaseTransition = null;
  submitBotDayVotes();
  broadcastState();
}

function checkGameOver() {
  const g = room.game;
  if (!g) return false;
  const alive = g.players.filter(p => p.alive);
  const aliveR = alive.filter(p => p.rc === 'r');
  const aliveSK = alive.filter(p => p.trueRole === 'sk');
  const aliveMag = alive.filter(p => p.trueRole === 'mag');
  const aliveBom = alive.filter(p => p.trueRole === 'bom');
  const aliveG = alive.filter(p => p.rc === 'g');

  if (alive.length === 0) {
    const winners = g.players.filter(p => p.ghostWon).map(p => p.id);
    g.over = winners.length ? 'ゴースト勝利！' : '引き分け（全滅）';
    g.winners = winners;
    return true;
  }

  if (aliveSK.length > 0 && alive.length <= 2 && aliveR.length === 0 && aliveMag.length === 0 && aliveBom.length === 0) {
    const winners = new Set(aliveSK.map(p => p.id));
    alive.filter(p => p.sur).forEach(p => winners.add(p.id));
    g.players.filter(p => p.ghostWon).forEach(p => winners.add(p.id));
    g.over = 'シリアルキラー陣営の勝利！';
    g.winners = Array.from(winners);
    return true;
  }

  if (aliveR.length === 0 && aliveSK.length === 0 && alive.length <= 2) {
    if (aliveMag.length > 0 && aliveBom.length === 0) {
      const winners = new Set(aliveMag.map(p => p.id));
      alive.filter(p => p.sur).forEach(p => winners.add(p.id));
      g.players.filter(p => p.ghostWon).forEach(p => winners.add(p.id));
      g.over = '魔術師の勝利！';
      g.winners = Array.from(winners);
      return true;
    }
    if (aliveBom.length > 0 && aliveMag.length === 0) {
      const winners = new Set(aliveBom.map(p => p.id));
      alive.filter(p => p.sur).forEach(p => winners.add(p.id));
      g.players.filter(p => p.ghostWon).forEach(p => winners.add(p.id));
      g.over = 'ボマーの勝利！';
      g.winners = Array.from(winners);
      return true;
    }
  }

  if (aliveR.length > 0 && aliveSK.length === 0 && aliveMag.length === 0 && aliveBom.length === 0) {
    const nonR = alive.length - aliveR.length;
    if (aliveR.length >= nonR) {
      const winners = new Set(g.players.filter(p => p.rc === 'r').map(p => p.id));
      alive.filter(p => p.sur).forEach(p => winners.add(p.id));
      g.players.filter(p => p.ghostWon).forEach(p => winners.add(p.id));
      g.over = '赤陣営（インポスター）の勝利！';
      g.winners = Array.from(winners);
      return true;
    }
  }

  if (aliveR.length === 0 && aliveSK.length === 0 && aliveMag.length === 0 && aliveBom.length === 0 && aliveG.length > 0) {
    const winners = new Set(g.players.filter(p => p.rc === 'g').map(p => p.id));
    alive.filter(p => p.sur).forEach(p => winners.add(p.id));
    g.players.filter(p => p.ghostWon).forEach(p => winners.add(p.id));
    g.over = '緑陣営（イノセント）の勝利！';
    g.winners = Array.from(winners);
    return true;
  }

  return false;
}

function triggerToResult(gid) {
  const g = room.game;
  if (!g || g.gid !== gid) return;
  g.phaseTransition = 'toResult';
  broadcastState();

  scheduleTimer(() => {
    if (!room.game || room.game.gid !== gid) return;
    g.phaseTransition = null;
    g.showResult = true;
    broadcastState();
  }, PHASE_TIMERS.toResult);
}

function buildPlayerView(uid) {
  const g = room.game;
  if (!g) return null;

  let mePlayer = g.players.find(p => p.uid === uid);
  if (!mePlayer) mePlayer = g.players[0];

  const { tally, skipCount } = getVoteTally(g);
  const aliveCount = g.players.filter(p => p.alive).length;
  const majorityNeeded = Math.floor(aliveCount / 2) + 1;

  const timeline = [...g.publicLogs, ...mePlayer.privateLogs].sort((a, b) => a.day - b.day);

  // 自分が死亡しているかどうか（殺された場合は次の昼以降、吊られた場合は即座に全員の役職を見られる）
  const isMeDead = !mePlayer.alive && !(g.phaseTransition === 'nightAction');

  const playersView = g.players.map(p => {
    const isMate = (mePlayer.rc === 'r' && p.rc === 'r' && p.id !== mePlayer.id);
    const fullRoleData = g.showResult
      ? {
          text: p.roleHistory.map(rh => roleLabel(rh.c, rh.role)).join(' ➔ '),
          icons: p.roleHistory.map(rh => ({ c: rh.c, role: rh.role }))
        }
      : null;

    // 死んだ人目線用の真の役職情報
    const deadReveal = isMeDead
      ? { c: p.rc, role: p.trueRole, t: roleLabel(p.rc, p.trueRole) }
      : null;

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      alive: p.alive,
      exiled: !!p.exiled,
      isAsh: p.isAsh,
      bombed: p.bombed,
      mate: isMate,
      rev: p.rev || null,
      deadReveal,
      fullRoleData
    };
  });

  let mySlotIdx = g.roleBarBase.findIndex(
    slot => slot.c === mePlayer.camp && slot.role === mePlayer.er
  );
  if (mySlotIdx === -1) {
    mySlotIdx = g.roleBarBase.findIndex(
      slot => slot.c === mePlayer.camp && slot.role === null
    );
  }
  const otherSlots = [];
  let mySlotItem = null;
  g.roleBarBase.forEach((slot, idx) => {
    if (idx === mySlotIdx) {
      mySlotItem = { c: slot.c, role: slot.role, isMe: true };
    } else {
      otherSlots.push({ c: slot.c, role: slot.role, isMe: false });
    }
  });
  const roleBar = mySlotItem ? [...otherSlots, mySlotItem] : otherSlots;

  const bombsCount = g.players.filter(x => x.alive && x.bombPlanted).length;

  return {
    gid: g.gid,
    day: g.day,
    ph: g.ph,
    over: g.over,
    winners: g.winners,
    me: {
      id: mePlayer.id,
      name: mePlayer.name,
      color: mePlayer.color,
      alive: mePlayer.alive,
      isAsh: mePlayer.isAsh,
      camp: mePlayer.camp,
      rc: mePlayer.rc,
      er: mePlayer.er,
      label: roleLabel(mePlayer.camp, mePlayer.er),
      uses: mePlayer.uses,
      last: mePlayer.last,
      bombs: bombsCount,
      sur: mePlayer.sur,
      thiefNotice: mePlayer.thiefNotice
    },
    players: playersView,
    timeline,
    tally,
    skipCount,
    majorityNeeded,
    myVote: g.votes[mePlayer.id],
    roleBar,
    myNightEvents: mePlayer.nightEvents || [],
    newDeaths: g.newDeaths || [],
    morningDeathIdx: g.morningDeathIdx || 0,
    morningRats: g.morningRats || [],
    morningRatIdx: g.morningRatIdx || 0,
    lastExile: g.lastExile
  };
}

function broadcastState() {
  const errors = validateSlots();
  const slotsWithLabel = room.slots.map(s => ({
    c: s.c,
    role: s.role || null,
    label: slotLabel(s.c, s.role)
  }));

  room.users.forEach(u => {
    if (!u.online || !u.socketId) return;
    const sock = io.sockets.sockets.get(u.socketId);
    if (!sock) return;

    let progress = { done: 0, total: 0 };
    let submitted = false;
    let myNightAction = null;

    if (room.mode === 'game' && room.game) {
      const g = room.game;
      const alive = g.players.filter(p => p.alive);
      const meP = g.players.find(p => p.uid === u.uid);
      if (g.ph === 'day') {
        progress = {
          done: alive.filter(p => g.votes[p.id] !== undefined).length,
          total: alive.length
        };
        submitted = meP ? (g.votes[meP.id] !== undefined) : false;
      } else {
        progress = {
          done: alive.filter(p => g.nightActions[p.id] !== undefined).length,
          total: alive.length
        };
        submitted = meP ? (g.nightActions[meP.id] !== undefined) : false;
        myNightAction = meP ? (g.nightActions[meP.id] || null) : null;
      }
    }

    sock.emit('state', {
      mode: room.mode,
      hostUid: room.hostUid,
      users: room.users.map(x => ({
        uid: x.uid,
        name: x.name,
        color: x.color,
        online: x.online
      })),
      totalPlayers: room.slots.length,
      slots: slotsWithLabel,
      errors,
      showResult: room.game ? room.game.showResult : false,
      phaseTransition: room.game ? room.game.phaseTransition : null,
      submitted,
      myNightAction,
      progress,
      view: room.mode === 'game' ? buildPlayerView(u.uid) : null,
      meta: META
    });
  });
}

io.on('connection', (socket) => {
  let currentUid = null;

  socket.on('join', ({ uid, name, preferredColor }) => {
    if (!uid) return;
    currentUid = uid;
    const cleanName = String(name || 'プレイヤー').trim().slice(0, 12) || 'プレイヤー';

    let user = room.users.find(u => u.uid === uid);
    if (!user) {
      if (room.mode === 'game') {
        socket.emit('spectator');
        return;
      }
      user = {
        uid,
        name: cleanName,
        color: getAvailableColor(preferredColor),
        online: true,
        socketId: socket.id
      };
      room.users.push(user);
    } else {
      user.name = cleanName;
      user.online = true;
      user.socketId = socket.id;
      if (room.mode === 'lobby' && typeof preferredColor === 'number') {
        user.color = getAvailableColor(preferredColor, uid);
      }
    }

    if (!room.hostUid || !room.users.some(u => u.uid === room.hostUid && u.online)) {
      room.hostUid = uid;
    }

    broadcastState();
  });

  socket.on('transferHost', (targetUid) => {
    if (currentUid !== room.hostUid) return;
    const target = room.users.find(u => u.uid === targetUid && u.online);
    if (target) {
      room.hostUid = target.uid;
      broadcastState();
    }
  });

  socket.on('kickUser', (targetUid) => {
    if (currentUid !== room.hostUid || targetUid === currentUid) return;
    const idx = room.users.findIndex(u => u.uid === targetUid);
    if (idx >= 0) {
      const [kicked] = room.users.splice(idx, 1);
      if (kicked.socketId) {
        const s = io.sockets.sockets.get(kicked.socketId);
        if (s) s.emit('kicked');
      }
      broadcastState();
    }
  });

  socket.on('selectColor', (colorId) => {
    if (room.mode !== 'lobby') return;
    const user = room.users.find(u => u.uid === currentUid);
    if (!user) return;
    const isTaken = room.users.some(u => u.uid !== currentUid && u.color === colorId);
    if (!isTaken && colorId >= 0 && colorId < COLORS.length) {
      user.color = colorId;
      broadcastState();
    }
  });

  socket.on('updateConfig', ({ totalPlayers, slots }) => {
    if (room.mode !== 'lobby' || currentUid !== room.hostUid) return;
    if (Array.isArray(slots)) {
      room.slots = slots.slice(0, 20).map(s => ({
        c: ['g', 'r', 'b'].includes(s.c) ? s.c : 'g',
        role: s.role || null
      }));
      room.totalPlayers = room.slots.length;
    } else if (typeof totalPlayers === 'number') {
      const clamped = Math.max(3, Math.min(20, Math.floor(totalPlayers)));
      while (room.slots.length < clamped) {
        room.slots.push({ c: 'g', role: null });
      }
      while (room.slots.length > clamped) {
        room.slots.pop();
      }
      room.totalPlayers = clamped;
    }
    broadcastState();
  });

  socket.on('startGame', () => {
    if (room.mode !== 'lobby' || currentUid !== room.hostUid) return;
    if (validateSlots().length > 0) return;
    startNewGame();
  });

  socket.on('submitAction', (payload) => {
    if (room.mode !== 'game' || !room.game || room.game.phaseTransition || room.game.over) return;
    const g = room.game;
    const me = g.players.find(p => p.uid === currentUid);
    if (!me || !me.alive) return;

    if (g.ph === 'day') {
      if (g.votes[me.id] !== undefined) return;
      const targetId = Number(payload);
      if (targetId === -1 || g.players.some(p => p.id === targetId && p.alive)) {
        g.votes[me.id] = targetId;
        broadcastState();
        checkDayComplete();
      }
    } else if (g.ph === 'night') {
      g.nightActions[me.id] = (payload && typeof payload === 'object') ? payload : {};
      broadcastState();
      checkNightComplete();
    }
  });

  socket.on('cancelNightAction', () => {
    if (room.mode !== 'game' || !room.game || room.game.ph !== 'night' || room.game.phaseTransition) return;
    const g = room.game;
    const me = g.players.find(p => p.uid === currentUid);
    if (!me || !me.alive) return;
    delete g.nightActions[me.id];
    broadcastState();
  });

  socket.on('forceAdvance', () => {
    if (room.mode !== 'game' || !room.game || currentUid !== room.hostUid) return;
    const g = room.game;
    if (g.phaseTransition || g.over) return;
    if (g.ph === 'day') {
      g.players.forEach(p => {
        if (p.alive && g.votes[p.id] === undefined) g.votes[p.id] = -1;
      });
      resolveDayPhase();
    } else {
      g.players.forEach(p => {
        if (p.alive && g.nightActions[p.id] === undefined) g.nightActions[p.id] = {};
      });
      resolveNightPhase();
    }
  });

  socket.on('backToLobby', () => {
    if (currentUid !== room.hostUid) return;
    clearTransitionTimers();
    room.mode = 'lobby';
    room.game = null;
    room.users = room.users.filter(u => u.online);
    broadcastState();
  });

  socket.on('disconnect', () => {
    if (!currentUid) return;
    const user = room.users.find(u => u.uid === currentUid && u.socketId === socket.id);
    if (user) {
      user.online = false;
      user.socketId = null;
      if (room.hostUid === currentUid) {
        const nextHost = room.users.find(u => u.online);
        if (nextHost) room.hostUid = nextHost.uid;
      }
      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mask Village server running on port ${PORT}`);
});