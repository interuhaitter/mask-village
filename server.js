const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ★ クライアント（public/index.html）と1ミリ秒単位で完全一致する遷移時間定数
const PHASE_TIMERS = {
  roleReveal: 4500,    // ゲーム開始時の役職表示
  toDay: 3800,         // 夜 → 朝（広場集合）
  toNight: 3500,       // 昼 → 夜（帰宅入室）
  nightEvent: 8200,    // 夜の役職行動1件あたり（往路・実行・帰還）
  nightEmpty: 1500,    // 夜の役職行動0件時
  morningDeath: 4800,  // 朝の死体発見ズーム1件あたり
  morningRat: 4800,    // 朝のねずみ指さし1件あたり
  exile: 7500,         // 昼の追放演出
  toResult: 2500       // 決着オーバーレイ
};

// ★ ゲームメタデータ（13色・役職定義）
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

const ROLE_NAMES = {
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

const CAMP_NAMES = { g: '緑', r: '赤', b: '青' };
const GREEN_ROLES = ['rat', 'inv', 'pol', 'trap', 'look', 'trk', 'prov', 'doc'];
const GREEN_ALL_ROLES = [...GREEN_ROLES, 'fool'];
const RED_SPECIAL_ROLES = ['blm', 'cln'];
const RED_ALL_ROLES = ['blm', 'cln', ...GREEN_ROLES];
const BLUE_ROLES = ['sk', 'mag', 'gho', 'bom', 'thf', 'sur'];
const TARGET_ROLES = ['rat', 'inv', 'pol', 'trap', 'look', 'trk', 'prov', 'doc', 'blm', 'cln', 'sk', 'bom', 'thf'];
// トラッカー・ルックアウトは回数無制限、ネズミ1回、トラッパー2回、挑発者2回、ブレイマー2回、シーフ1回、サバイバー3回
const ROLE_LIMITS = { rat: 1, trap: 2, prov: 2, blm: 2, thf: 1, sur: 3 };
const GUESS_ROLES = [
  'rat', 'inv', 'pol', 'trap', 'look', 'trk', 'prov', 'doc', 'fool',
  'blm', 'cln',
  'r:rat', 'r:inv', 'r:pol', 'r:trap', 'r:look', 'r:trk', 'r:prov', 'r:doc',
  'sk', 'mag', 'gho', 'bom', 'thf', 'sur'
];

const META = {
  COLORS,
  N: ROLE_NAMES,
  CN: CAMP_NAMES,
  G: GREEN_ROLES,
  GA: GREEN_ALL_ROLES,
  R: RED_SPECIAL_ROLES,
  RA: RED_ALL_ROLES,
  B: BLUE_ROLES,
  TG: TARGET_ROLES,
  LIM: ROLE_LIMITS,
  GUESS: GUESS_ROLES
};

function getSlotLabel(c, role) {
  if (!role) {
    return `${CAMP_NAMES[c] || ''}ランダム`;
  }
  if (c === 'r' && GREEN_ROLES.includes(role)) {
    return `赤${ROLE_NAMES[role] || '不明'}`;
  }
  return ROLE_NAMES[role] || '不明';
}

function getConcreteRoleLabel(c, role) {
  if (c === 'r' && GREEN_ROLES.includes(role)) {
    return `赤${ROLE_NAMES[role] || '不明'}`;
  }
  return ROLE_NAMES[role] || '不明';
}

let users = [];
let hostUid = null;
let totalPlayers = 6;
let slots = [
  { c: 'g', role: 'inv' },
  { c: 'g', role: 'pol' },
  { c: 'g', role: 'doc' },
  { c: 'g', role: null },
  { c: 'r', role: null },
  { c: 'b', role: 'sk' }
];

let mode = 'lobby';
let game = null;
let phaseTimer = null;

function clearPhaseTimer() {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
}

function pickAvailableColor(preferred = null) {
  const used = new Set(users.map(u => u.color));
  if (preferred !== null && preferred >= 0 && preferred < COLORS.length && !used.has(preferred)) {
    return preferred;
  }
  for (let i = 0; i < COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

function validateConfig() {
  const errors = [];
  if (slots.length < 3 || slots.length > 20) {
    errors.push('総人数は3〜20人の間で設定してください。');
  }
  const redCount = slots.filter(s => s.c === 'r').length;
  const killerBlueCount = slots.filter(s => s.c === 'b' && ['sk', 'mag', 'bom'].includes(s.role)).length;
  if (redCount === 0 && killerBlueCount === 0) {
    errors.push('赤陣営（インポスター）またはキル能力を持つ第三陣営を1人以上入れてください。');
  }
  const greenCount = slots.filter(s => s.c === 'g').length;
  if (greenCount === 0) {
    errors.push('緑陣営（イノセント）を1人以上入れてください。');
  }
  return errors;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickFoolApparentRoleFromVillage(playerList, onlyGreen = true) {
  if (onlyGreen) {
    // 挑発者以外の村の中にいる緑の役職の中からランダムに選ぶ
    const greenInVillage = playerList
      .filter(p => p.realCamp === 'g' && GREEN_ROLES.includes(p.realRole) && p.realRole !== 'prov')
      .map(p => p.realRole);
    if (greenInVillage.length > 0) {
      return randItem(greenInVillage);
    }
  } else {
    // シーフがバカを盗んだ場合：村の中にいる真役職（挑発者・バカ以外）からランダムに選ぶ
    const greenInVillage = playerList
      .filter(p => p.alive && p.realCamp === 'g' && GREEN_ROLES.includes(p.realRole) && p.realRole !== 'prov')
      .map(p => p.realRole);
    if (greenInVillage.length > 0) {
      return randItem(greenInVillage);
    }
    const anyGreenAll = playerList
      .filter(p => p.realCamp === 'g' && GREEN_ROLES.includes(p.realRole) && p.realRole !== 'prov')
      .map(p => p.realRole);
    if (anyGreenAll.length > 0) {
      return randItem(anyGreenAll);
    }
  }
  return randItem(GREEN_ROLES.filter(r => r !== 'prov'));
}

function initGame() {
  clearPhaseTimer();
  const gid = Date.now();
  const onlineUsers = users.filter(u => u.online);
  const participants = [];

  onlineUsers.slice(0, slots.length).forEach(u => {
    participants.push({
      uid: u.uid,
      name: u.name,
      color: u.color,
      isBot: false
    });
  });

  const usedColors = new Set(participants.map(p => p.color));
  let botNum = 1;
  while (participants.length < slots.length) {
    let col = 0;
    for (let c = 0; c < COLORS.length; c++) {
      if (!usedColors.has(c)) {
        col = c;
        usedColors.add(c);
        break;
      }
    }
    participants.push({
      uid: `bot_${botNum}`,
      name: `BOT_${botNum}`,
      color: col,
      isBot: true
    });
    botNum++;
  }

  const shuffledSlots = shuffle(slots);
  const roleBarTemplate = slots.map(s => ({
    c: s.c,
    role: s.role ? s.role : '',
    origCamp: s.c,
    origRole: s.role || null
  }));

  // 1段階目：全員の真陣営・真役職を確定（ランダム枠はその陣営の全役職から抽選）
  const baseAssignments = participants.map((pt, idx) => {
    const slot = shuffledSlots[idx];
    const realCamp = slot.c;
    let realRole = slot.role;

    if (!realRole) {
      if (realCamp === 'g') {
        realRole = randItem(GREEN_ALL_ROLES);
      } else if (realCamp === 'r') {
        realRole = randItem(RED_ALL_ROLES);
      } else if (realCamp === 'b') {
        realRole = randItem(BLUE_ROLES);
      }
    }
    return { pt, realCamp, realRole };
  });

  // 2段階目：バカの擬態先を「挑発者以外の村の中にいる緑の役職」から抽選
  const players = baseAssignments.map(({ pt, realCamp, realRole }, idx) => {
    let apparentCamp = realCamp;
    let apparentRole = realRole;
    if (realRole === 'fool') {
      apparentCamp = 'g';
      apparentRole = pickFoolApparentRoleFromVillage(baseAssignments, true);
    }

    return {
      id: idx,
      uid: pt.uid,
      name: pt.name,
      color: pt.color,
      isBot: pt.isBot,
      alive: true,
      isAsh: false,
      bombed: false,
      bombsOnHouse: 0,
      origCamp: realCamp,
      origRole: realRole,
      realCamp,
      realRole,
      apparentCamp,
      apparentRole,
      uses: {},
      last: {},
      provokedVotes: 0,
      paintedRole: null,
      pendingThiefReveal: null,
      thiefRevealedNotice: null,
      rev: null,
      privateLogs: [],
      myNightEvents: [],
      assignedBarIdx: 0
    };
  });

  const assignedSlotSet = new Set();
  players.forEach(p => {
    const found = slots.findIndex((s, i) => !assignedSlotSet.has(i) && s.c === p.origCamp && (s.role || null) === (p.origRole || null));
    if (found >= 0) {
      assignedSlotSet.add(found);
      p.assignedBarIdx = found;
    } else {
      const randomSlot = slots.findIndex((s, i) => !assignedSlotSet.has(i) && s.c === p.origCamp && !s.role);
      if (randomSlot >= 0) {
        assignedSlotSet.add(randomSlot);
        p.assignedBarIdx = randomSlot;
      } else {
        p.assignedBarIdx = 0;
      }
    }
  });

  game = {
    gid,
    day: 1,
    ph: 'day',
    phaseTransition: 'roleReveal',
    showResult: false,
    over: null,
    winners: [],
    players,
    roleBarTemplate,
    publicLogs: [],
    dayVotes: {},
    nightActions: {},
    lastExile: null,
    newDeaths: [],
    morningDeathIdx: 0,
    morningRats: [],
    morningRatIdx: 0
  };

  mode = 'game';
  broadcastState();

  phaseTimer = setTimeout(() => {
    if (!game || mode !== 'game') return;
    game.phaseTransition = null;
    scheduleBotDayVotes();
    broadcastState();
  }, PHASE_TIMERS.roleReveal);
}

function scheduleBotDayVotes() {
  if (!game || game.ph !== 'day' || game.phaseTransition || game.over) return;
  const alivePlayers = game.players.filter(p => p.alive);
  alivePlayers.forEach(p => {
    if (!p.isBot) return;
    if (game.dayVotes[p.id] !== undefined) return;
    if (game.day === 1) {
      game.dayVotes[p.id] = -1;
    } else {
      const candidates = alivePlayers.filter(x => x.id !== p.id);
      if (Math.random() < 0.25 || candidates.length === 0) {
        game.dayVotes[p.id] = -1;
      } else {
        game.dayVotes[p.id] = randItem(candidates).id;
      }
    }
  });
  checkDayComplete();
}

function scheduleBotNightActions() {
  if (!game || game.ph !== 'night' || game.phaseTransition || game.over) return;
  const alivePlayers = game.players.filter(p => p.alive);
  alivePlayers.forEach(p => {
    if (!p.isBot) return;
    if (game.nightActions[p.id] !== undefined) return;

    const others = alivePlayers.filter(x => x.id !== p.id);
    if (others.length === 0) {
      game.nightActions[p.id] = {};
      return;
    }

    const er = p.apparentRole;
    if (p.realCamp === 'r') {
      const nonReds = others.filter(x => x.realCamp !== 'r');
      const targetPool = nonReds.length > 0 ? nonReds : others;
      // 赤陣営が特殊能力を持つ場合、一定確率で能力を使用
      if (er && TARGET_ROLES.includes(er)) {
        const limit = ROLE_LIMITS[er];
        const used = p.uses[er] || 0;
        const canUseAbility = !limit || used < limit;
        if (canUseAbility && Math.random() < 0.35) {
          const noRepeat = ['doc', 'pol', 'trk'].includes(er);
          const validTargets = noRepeat ? others.filter(x => x.id !== p.last[er]) : others;
          if (validTargets.length > 0) {
            game.nightActions[p.id] = { t: randItem(validTargets).id };
            return;
          }
        }
      }
      const target = randItem(targetPool);
      game.nightActions[p.id] = { t: target.id, kill: 1 };
    } else if (er === 'sur') {
      const used = p.uses.sur || 0;
      game.nightActions[p.id] = (used < 3 && Math.random() < 0.5) ? { sh: 1 } : {};
    } else if (er === 'bom') {
      const planted = game.players.filter(x => x.alive && x.bombsOnHouse > 0).length;
      if (planted >= 2 && Math.random() < 0.65) {
        game.nightActions[p.id] = { det: 1 };
      } else {
        const unbombed = others.filter(x => x.bombsOnHouse === 0);
        const target = unbombed.length > 0 ? randItem(unbombed) : randItem(others);
        game.nightActions[p.id] = { t: target.id };
      }
    } else if (er === 'mag') {
      if (Math.random() < 0.45) {
        const target = randItem(others);
        const guess = randItem(GUESS_ROLES);
        game.nightActions[p.id] = { t: target.id, guess };
      } else {
        game.nightActions[p.id] = {};
      }
    } else if (TARGET_ROLES.includes(er)) {
      const limit = ROLE_LIMITS[er];
      const used = p.uses[er] || 0;
      if (limit && used >= limit) {
        game.nightActions[p.id] = {};
        return;
      }
      const noRepeat = ['doc', 'pol', 'trk'].includes(er);
      const validTargets = noRepeat
        ? others.filter(x => x.id !== p.last[er])
        : others;
      if (validTargets.length > 0) {
        game.nightActions[p.id] = { t: randItem(validTargets).id };
      } else {
        game.nightActions[p.id] = {};
      }
    } else {
      game.nightActions[p.id] = {};
    }
  });
  checkNightComplete();
}

function checkWinCondition() {
  if (!game) return false;
  const alive = game.players.filter(p => p.alive);
  const reds = alive.filter(p => p.realCamp === 'r');
  const killerBlues = alive.filter(p => p.realCamp === 'b' && ['sk', 'mag', 'bom'].includes(p.realRole));
  const nonReds = alive.filter(p => p.realCamp !== 'r');

  const extraWinners = game.players
    .filter(p => (p.alive && p.realRole === 'sur') || (!p.alive && p.ghostWon))
    .map(p => p.id);

  if (alive.length === 0) {
    game.over = '引き分け（全滅）';
    game.winners = [...new Set(extraWinners)];
    return true;
  }

  const nonSurAlive = alive.filter(p => p.realRole !== 'sur');
  if (nonSurAlive.length === 1 && nonSurAlive[0].realCamp === 'b' && ['sk', 'mag', 'bom'].includes(nonSurAlive[0].realRole)) {
    const solo = nonSurAlive[0];
    game.over = `${getConcreteRoleLabel(solo.realCamp, solo.realRole)} の勝利！`;
    game.winners = [...new Set([solo.id, ...extraWinners])];
    return true;
  }

  if (reds.length === 0 && killerBlues.length === 0) {
    const greenIds = game.players.filter(p => p.realCamp === 'g').map(p => p.id);
    game.over = 'イノセント陣営（緑）の勝利！';
    game.winners = [...new Set([...greenIds, ...extraWinners])];
    return true;
  }

  if (reds.length > 0 && killerBlues.length === 0 && reds.length >= nonReds.length) {
    const redIds = game.players.filter(p => p.realCamp === 'r').map(p => p.id);
    game.over = 'インポスター陣営（赤）の勝利！';
    game.winners = [...new Set([...redIds, ...extraWinners])];
    return true;
  }

  return false;
}

function checkDayComplete() {
  if (!game || game.ph !== 'day' || game.phaseTransition || game.over) return;
  const alive = game.players.filter(p => p.alive);
  const doneCount = alive.filter(p => game.dayVotes[p.id] !== undefined).length;
  if (doneCount < alive.length) {
    broadcastState();
    return;
  }
  resolveDayPhase();
}

function resolveDayPhase() {
  if (!game) return;
  clearPhaseTimer();

  if (game.day === 1) {
    startToNightTransition();
    return;
  }

  const alive = game.players.filter(p => p.alive);
  const tally = {};
  alive.forEach(p => {
    tally[p.id] = p.provokedVotes || 0;
  });
  alive.forEach(p => {
    const v = game.dayVotes[p.id];
    if (typeof v === 'number' && v >= 0 && tally[v] !== undefined) {
      tally[v] = (tally[v] || 0) + 1;
    }
  });

  let maxVotes = 0;
  let topIds = [];
  Object.entries(tally).forEach(([tidStr, cnt]) => {
    const tid = parseInt(tidStr, 10);
    if (cnt > maxVotes) {
      maxVotes = cnt;
      topIds = [tid];
    } else if (cnt === maxVotes) {
      topIds.push(tid);
    }
  });

  // 挑発者の票も含めた過半数以上の票が集まった人が吊られる
  const majorityNeeded = Math.floor(alive.length / 2) + 1;

  if (maxVotes >= majorityNeeded && topIds.length === 1) {
    const exiled = game.players[topIds[0]];
    exiled.alive = false;

    const displayCamp = exiled.paintedRole ? exiled.paintedRole.c : exiled.realCamp;
    const displayRole = exiled.paintedRole ? exiled.paintedRole.role : exiled.realRole;
    const roleText = getConcreteRoleLabel(displayCamp, displayRole);
    exiled.rev = { t: roleText };

    const pubIcons = [
      { type: 'char', id: exiled.id },
      { type: 'kick' },
      { type: 'role', c: displayCamp, role: displayRole }
    ];

    let ghostVictimId = null;
    if (exiled.realRole === 'gho') {
      exiled.ghostWon = true;
      const voters = alive.filter(p => p.id !== exiled.id && game.dayVotes[p.id] === exiled.id);
      if (voters.length > 0) {
        const victim = randItem(voters);
        victim.alive = false;
        const vCamp = victim.paintedRole ? victim.paintedRole.c : victim.realCamp;
        const vRole = victim.paintedRole ? victim.paintedRole.role : victim.realRole;
        victim.rev = { t: getConcreteRoleLabel(vCamp, vRole) };
        ghostVictimId = victim.id;
        pubIcons.push({ type: 'ghost' }, { type: 'char', id: victim.id }, { type: 'skull' });
      }
    }

    game.publicLogs.push({ day: game.day, scope: 'public', icons: pubIcons });
    game.lastExile = {
      id: exiled.id,
      name: exiled.name,
      c: displayCamp,
      role: displayRole,
      roleText,
      ghostVictimId
    };

    const won = checkWinCondition();
    game.phaseTransition = 'exile';
    broadcastState();

    phaseTimer = setTimeout(() => {
      if (!game || mode !== 'game') return;
      game.lastExile = null;
      if (won) {
        startToResultTransition();
      } else {
        startToNightTransition();
      }
    }, PHASE_TIMERS.exile);
  } else {
    startToNightTransition();
  }
}

function startToNightTransition() {
  if (!game) return;
  game.phaseTransition = 'toNight';
  broadcastState();

  phaseTimer = setTimeout(() => {
    if (!game || mode !== 'game') return;
    game.ph = 'night';
    game.phaseTransition = null;
    game.nightActions = {};
    game.players.forEach(p => {
      p.myNightEvents = [];
      p.provokedVotes = 0;
      p.thiefRevealedNotice = null;
    });
    scheduleBotNightActions();
    broadcastState();
  }, PHASE_TIMERS.toNight);
}

function checkNightComplete() {
  if (!game || game.ph !== 'night' || game.phaseTransition || game.over) return;
  const alive = game.players.filter(p => p.alive);
  const doneCount = alive.filter(p => game.nightActions[p.id] !== undefined).length;
  if (doneCount < alive.length) {
    broadcastState();
    return;
  }
  resolveNightPhase();
}

function computeBlackmailedRedRole(target) {
  if (GREEN_ROLES.includes(target.realRole)) {
    return target.realRole;
  }
  if (target.realRole === 'fool') {
    return target.apparentRole || randItem(GREEN_ROLES.filter(r => r !== 'prov'));
  }
  if (target.realCamp === 'r') {
    return target.realRole || randItem(RED_ALL_ROLES);
  }
  return randItem(RED_ALL_ROLES);
}

// プレイヤーがその夜に実際に有効な訪問移動を行うかどうかを判定
function hasValidTargetVisit(p, act) {
  if (!act || act.isFoolFake) return false;
  if (act.t === undefined || act.t === p.id) return false;
  const target = game.players[act.t];
  if (!target || !target.alive) return false;

  // 赤陣営のキル行動は有効な訪問
  if (p.realCamp === 'r' && act.isKillAction) return true;

  // 魔術師の雷は遠隔攻撃なので家には訪問しない
  if (p.realRole === 'mag') return false;

  // ボマーの起爆は自宅行動
  if (p.realRole === 'bom' && act.det) return false;

  // サバイバーのシールドは自宅行動
  if (p.realRole === 'sur') return false;

  if (!TARGET_ROLES.includes(p.realRole)) return false;

  const limit = ROLE_LIMITS[p.realRole];
  const used = p.uses[p.realRole] || 0;
  if (limit && used >= limit) return false;

  const noRepeat = ['doc', 'pol', 'trk'].includes(p.realRole);
  if (noRepeat && p.last[p.realRole] === act.t) return false;

  return true;
}

function resolveNightPhase() {
  if (!game) return;
  clearPhaseTimer();

  const alive = game.players.filter(p => p.alive);
  const actions = game.nightActions;

  game.players.forEach(p => { p.myNightEvents = []; });

  const effectiveAct = new Map();
  alive.forEach(p => {
    const raw = actions[p.id] || {};
    if (p.realRole === 'fool') {
      if (raw.t !== undefined && raw.t !== p.id) {
        p.last[p.apparentRole] = raw.t;
      }
      effectiveAct.set(p.id, { isFoolFake: true, raw });
    } else {
      const isKillAction = (p.realCamp === 'r' && !!raw.kill);
      effectiveAct.set(p.id, { ...raw, isKillAction });
    }
  });

  const blockedSet = new Set();
  const trappedHouseMap = new Map();

  // 1. ポリス（緑・赤共通）の阻止判定を最優先で実行（トラッパーより先）
  alive.forEach(p => {
    const act = effectiveAct.get(p.id);
    if (!act || act.isFoolFake || act.isKillAction) return;
    if (p.realRole === 'pol' && act.t !== undefined && act.t !== p.id) {
      if (p.last.pol === act.t) return;
      p.last.pol = act.t;
      const target = game.players[act.t];
      const targetAct = effectiveAct.get(act.t);
      const targetWentOut = target && target.alive && hasValidTargetVisit(target, targetAct);
      if (targetWentOut) {
        blockedSet.add(target.id);
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'pol',
          camp: p.realCamp,
          result: 'ok'
        });
        p.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: p.id },
            { type: 'role', c: p.realCamp, role: 'pol' },
            { type: 'char', id: target.id },
            { type: 'mark', val: 'ok' }
          ]
        });
        target.myNightEvents.push({
          kind: 'blocked_pol',
          target: target.id
        });
        target.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'grayChar' },
            { type: 'role', c: p.realCamp, role: 'pol' },
            { type: 'char', id: target.id },
            { type: 'mark', val: 'ok' }
          ]
        });
      } else if (target) {
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'pol',
          camp: p.realCamp,
          result: 'ng'
        });
        p.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: p.id },
            { type: 'role', c: p.realCamp, role: 'pol' },
            { type: 'char', id: target.id },
            { type: 'mark', val: 'ng' }
          ]
        });
      }
    }
  });

  // 2. ポリスに阻止されなかったトラッパー（緑・赤共通）のみ罠を設置
  alive.forEach(p => {
    if (blockedSet.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!act || act.isFoolFake || act.isKillAction) return;
    if (p.realRole === 'trap' && act.t !== undefined && act.t !== p.id) {
      const used = p.uses.trap || 0;
      if (used < 2) {
        p.uses.trap = used + 1;
        if (!trappedHouseMap.has(act.t)) trappedHouseMap.set(act.t, []);
        trappedHouseMap.get(act.t).push(p.id);
      }
    }
  });

  // 3. 訪問＆トラップ発動判定（有効な訪問のみを記録）
  const houseVisitors = new Map();
  const playerDest = new Map();

  alive.forEach(p => {
    if (blockedSet.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!hasValidTargetVisit(p, act)) return;

    const targetHouseId = act.t;
    const trapperList = trappedHouseMap.get(targetHouseId) || [];
    const activeTrapperIdx = trapperList.findIndex(tid => tid !== p.id);
    if (activeTrapperIdx >= 0) {
      const trapperId = trapperList[activeTrapperIdx];
      trapperList.splice(activeTrapperIdx, 1);
      if (trapperList.length === 0) trappedHouseMap.delete(targetHouseId);

      blockedSet.add(p.id);
      p.myNightEvents.push({
        kind: 'trapped',
        target: p.id,
        house: targetHouseId
      });
      const trapper = game.players[trapperId];
      if (trapper) {
        trapper.myNightEvents.push({
          kind: 'act',
          actor: trapper.id,
          target: targetHouseId,
          role: 'trap',
          camp: trapper.realCamp,
          result: 'ok'
        });
        trapper.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: trapper.id },
            { type: 'role', c: trapper.realCamp, role: 'trap' },
            { type: 'char', id: p.id },
            { type: 'mark', val: 'ok' }
          ]
        });
      }
      return;
    }

    if (!houseVisitors.has(targetHouseId)) houseVisitors.set(targetHouseId, []);
    houseVisitors.get(targetHouseId).push(p.id);

    if (!playerDest.has(p.id)) playerDest.set(p.id, []);
    playerDest.get(p.id).push(targetHouseId);
  });

  // 4. バカ偽行動・サバイバー・ドクター
  const shieldedSet = new Set();
  const healedByMap = new Map();

  alive.forEach(p => {
    if (blockedSet.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!act) return;

    if (act.isFoolFake && act.raw.t !== undefined && act.raw.t !== p.id) {
      const target = game.players[act.raw.t];
      if (target) {
        const fakeRole = p.apparentRole;
        const limit = ROLE_LIMITS[fakeRole];
        const used = p.uses[fakeRole] || 0;
        if (limit && used >= limit) return;
        if (limit) {
          p.uses[fakeRole] = used + 1;
        }

        if (fakeRole === 'inv') {
          const fake1 = { c: 'g', role: randItem(GREEN_ROLES) };
          const fake2 = { c: 'r', role: randItem(RED_ALL_ROLES) };
          const choiceIcons = shuffle([fake1, fake2]);
          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: 'inv',
            camp: 'g',
            result: 'ok',
            choiceIcons
          });
          p.privateLogs.push({
            day: game.day,
            scope: 'private',
            icons: [
              { type: 'char', id: p.id },
              { type: 'role', c: 'g', role: 'inv' },
              { type: 'char', id: target.id },
              { type: 'role', c: choiceIcons[0].c, role: choiceIcons[0].role },
              { type: 'role', c: choiceIcons[1].c, role: choiceIcons[1].role }
            ]
          });
        } else {
          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: fakeRole,
            camp: 'g',
            result: fakeRole === 'rat' ? 'ok' : 'ng'
          });
          if (fakeRole !== 'rat') {
            p.privateLogs.push({
              day: game.day,
              scope: 'private',
              icons: [
                { type: 'char', id: p.id },
                { type: 'role', c: 'g', role: fakeRole },
                { type: 'char', id: target.id },
                { type: 'mark', val: 'ng' }
              ]
            });
          }
        }
      }
      return;
    }

    if (act.isKillAction) return;

    if (p.realRole === 'sur' && act.sh) {
      const used = p.uses.sur || 0;
      if (used < 3) {
        p.uses.sur = used + 1;
        shieldedSet.add(p.id);
        p.myNightEvents.push({
          kind: 'self_act',
          actor: p.id,
          role: 'sur'
        });
      }
    }

    if (p.realRole === 'doc' && act.t !== undefined && act.t !== p.id) {
      if (p.last.doc === act.t) return;
      p.last.doc = act.t;
      const target = game.players[act.t];
      if (target && target.alive) {
        if (!healedByMap.has(target.id)) healedByMap.set(target.id, []);
        healedByMap.get(target.id).push(p.id);
      }
    }
  });

  // 5. クリーナー・ブレイマー・挑発者
  const killedMap = new Map();
  const cleanedSet = new Set();

  alive.forEach(p => {
    if (blockedSet.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!act || act.isFoolFake || act.isKillAction) return;

    if (p.realRole === 'cln' && act.t !== undefined && act.t !== p.id) {
      cleanedSet.add(act.t);
      p.myNightEvents.push({
        kind: 'act',
        actor: p.id,
        target: act.t,
        role: 'cln',
        camp: 'r',
        result: 'ok'
      });
    }

    if (p.realRole === 'blm' && act.t !== undefined && act.t !== p.id) {
      const used = p.uses.blm || 0;
      const target = game.players[act.t];
      if (used < 2 && target && target.alive) {
        p.uses.blm = used + 1;
        const paintedRedRole = computeBlackmailedRedRole(target);
        target.paintedRole = { c: 'r', role: paintedRedRole };
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'blm',
          camp: 'r',
          result: 'ok'
        });
        p.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: p.id },
            { type: 'role', c: 'r', role: 'blm' },
            { type: 'char', id: target.id },
            { type: 'role', c: 'r', role: paintedRedRole }
          ]
        });
      }
    }

    if (p.realRole === 'prov' && act.t !== undefined && act.t !== p.id) {
      const used = p.uses.prov || 0;
      const target = game.players[act.t];
      if (used < 2 && target && target.alive) {
        p.uses.prov = used + 1;
        target.provokedVotes = (target.provokedVotes || 0) + 2;
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'prov',
          camp: p.realCamp,
          result: 'ok'
        });
        p.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: p.id },
            { type: 'role', c: p.realCamp, role: 'prov' },
            { type: 'char', id: target.id },
            { type: 'mark', val: 'ok' }
          ]
        });
      }
    }
  });

  // 6. キル＆シーフ殺害コピー（情報系役職より先に行動）
  const activeAttackersOnTarget = new Set();

  alive.forEach(p => {
    if (blockedSet.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!act || act.isFoolFake) return;

    if (p.realCamp === 'r' && act.isKillAction && act.t !== undefined && act.t !== p.id) {
      const target = game.players[act.t];
      if (target && target.alive) {
        activeAttackersOnTarget.add(target.id);
        const saved = healedByMap.has(target.id) || shieldedSet.has(target.id);
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'imp',
          camp: 'r',
          result: saved ? 'ng' : 'ok'
        });
        if (!saved) {
          const prev = killedMap.get(target.id);
          if (!prev || prev.killerRole !== 'sk') {
            killedMap.set(target.id, { killerId: p.id, killerRole: 'imp', killerCamp: 'r', isAsh: false });
          }
        }
      }
    }

    if (p.realRole === 'sk' && act.t !== undefined && act.t !== p.id) {
      const target = game.players[act.t];
      if (target && target.alive) {
        activeAttackersOnTarget.add(target.id);
        const saved = healedByMap.has(target.id) || shieldedSet.has(target.id);
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'sk',
          camp: 'b',
          result: saved ? 'ng' : 'ok'
        });
        if (!saved) {
          killedMap.set(target.id, { killerId: p.id, killerRole: 'sk', killerCamp: 'b', isAsh: false });
        }
      }
    }

    if (p.realRole === 'mag' && act.t !== undefined && act.t !== p.id && act.guess) {
      const target = game.players[act.t];
      if (target && target.alive) {
        let actualGuessKey = target.realRole;
        if (target.realCamp === 'r') {
          if (GREEN_ROLES.includes(target.realRole)) actualGuessKey = `r:${target.realRole}`;
          else actualGuessKey = target.realRole;
        }
        const hit = actualGuessKey === act.guess;
        if (hit) {
          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: 'mag',
            camp: 'b',
            result: 'ok'
          });
          const prev = killedMap.get(target.id);
          if (!prev || prev.killerRole !== 'sk') {
            killedMap.set(target.id, { killerId: p.id, killerRole: 'mag', killerCamp: 'b', isAsh: true });
          }
        } else {
          p.myNightEvents.push({
            kind: 'self_ash',
            target: p.id
          });
          killedMap.set(p.id, { killerId: p.id, killerRole: 'mag', killerCamp: 'b', isAsh: true });
        }
      }
    }

    if (p.realRole === 'bom') {
      if (act.det) {
        const bombedPlayers = game.players.filter(x => x.alive && x.bombsOnHouse > 0);
        const targets = bombedPlayers.map(x => x.id);
        const killedTargets = [];
        bombedPlayers.forEach(bp => {
          bp.bombed = true;
          bp.bombsOnHouse = 0;
          if (!healedByMap.has(bp.id) && !shieldedSet.has(bp.id)) {
            killedTargets.push(bp.id);
            const prev = killedMap.get(bp.id);
            if (!prev || prev.killerRole !== 'sk') {
              killedMap.set(bp.id, { killerId: p.id, killerRole: 'bom', killerCamp: 'b', isAsh: false });
            }
          }
        });
        if (targets.length > 0) {
          game.players.forEach(pl => {
            pl.myNightEvents.push({
              kind: 'bomb_blast',
              targets,
              killedTargets
            });
          });
        }
      } else if (act.t !== undefined && act.t !== p.id) {
        const target = game.players[act.t];
        if (target && target.alive) {
          target.bombsOnHouse = (target.bombsOnHouse || 0) + 1;
          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: 'bom',
            camp: 'b',
            result: 'ok'
          });
        }
      }
    }

    if (p.realRole === 'thf' && act.t !== undefined && act.t !== p.id) {
      const used = p.uses.thf || 0;
      const target = game.players[act.t];
      if (used < 1 && target && target.alive) {
        p.uses.thf = used + 1;
        activeAttackersOnTarget.add(target.id);
        const saved = healedByMap.has(target.id) || shieldedSet.has(target.id);

        if (saved) {
          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: 'thf',
            camp: 'b',
            result: 'ng'
          });
        } else {
          const prev = killedMap.get(target.id);
          if (!prev || prev.killerRole !== 'sk') {
            killedMap.set(target.id, { killerId: p.id, killerRole: 'thf', killerCamp: 'b', isAsh: false });
          }

          const stolenCamp = target.realCamp;
          const stolenRole = target.realRole;
          p.realCamp = stolenCamp;
          p.realRole = stolenRole;

          let newApparentCamp = stolenCamp;
          let newApparentRole = stolenRole;
          if (stolenRole === 'fool') {
            newApparentCamp = 'g';
            newApparentRole = pickFoolApparentRoleFromVillage(game.players, false);
          }

          p.pendingThiefReveal = {
            targetId: target.id,
            newCamp: stolenCamp,
            newRole: stolenRole,
            newApparentCamp,
            newApparentRole
          };

          p.myNightEvents.push({
            kind: 'act',
            actor: p.id,
            target: target.id,
            role: 'thf',
            camp: 'b',
            result: 'ok'
          });
        }
      }
    }
  });

  // 7. ドクター蘇生結果の通知
  healedByMap.forEach((docIds, targetId) => {
    const wasAttacked = activeAttackersOnTarget.has(targetId);
    docIds.forEach(docId => {
      const docPlayer = game.players[docId];
      if (docPlayer) {
        docPlayer.myNightEvents.push({
          kind: 'act',
          actor: docId,
          target: targetId,
          role: 'doc',
          camp: docPlayer.realCamp,
          result: wasAttacked ? 'ok' : 'ng'
        });
        docPlayer.privateLogs.push({
          day: game.day,
          scope: 'private',
          icons: [
            { type: 'char', id: docId },
            { type: 'role', c: docPlayer.realCamp, role: 'doc' },
            { type: 'char', id: targetId },
            { type: 'mark', val: wasAttacked ? 'ok' : 'ng' }
          ]
        });
      }
    });

    const targetPlayer = game.players[targetId];
    if (targetPlayer && !killedMap.has(targetId)) {
      targetPlayer.myNightEvents.push({
        kind: 'revived',
        target: targetId,
        saved: wasAttacked
      });
    }
  });

  // 8. 情報系役職（インベ・ルックアウト・トラッカー・ねずみ）
  // ※シリアルキラーやインポスターにすでに殺害されたプレイヤーは行動不可
  const morningRats = [];

  alive.forEach(p => {
    if (blockedSet.has(p.id) || killedMap.has(p.id)) return;
    const act = effectiveAct.get(p.id);
    if (!act || act.isFoolFake || act.isKillAction || act.t === undefined || act.t === p.id) return;
    const target = game.players[act.t];
    if (!target) return;

    if (p.realRole === 'inv') {
      const realPair = target.paintedRole
        ? { c: target.paintedRole.c, role: target.paintedRole.role }
        : { c: target.realCamp, role: target.realRole };
      const allPool = [
        ...GREEN_ALL_ROLES.map(r => ({ c: 'g', role: r })),
        ...RED_ALL_ROLES.map(r => ({ c: 'r', role: r })),
        ...BLUE_ROLES.map(r => ({ c: 'b', role: r }))
      ].filter(x => !(x.c === realPair.c && x.role === realPair.role));
      const decoy = randItem(allPool);
      const choiceIcons = shuffle([realPair, decoy]);

      p.myNightEvents.push({
        kind: 'act',
        actor: p.id,
        target: target.id,
        role: 'inv',
        camp: p.realCamp,
        result: 'ok',
        choiceIcons
      });
      p.privateLogs.push({
        day: game.day,
        scope: 'private',
        icons: [
          { type: 'char', id: p.id },
          { type: 'role', c: p.realCamp, role: 'inv' },
          { type: 'char', id: target.id },
          { type: 'role', c: choiceIcons[0].c, role: choiceIcons[0].role },
          { type: 'role', c: choiceIcons[1].c, role: choiceIcons[1].role }
        ]
      });
    } else if (p.realRole === 'look') {
      p.uses.look = (p.uses.look || 0) + 1;
      const visitorIds = (houseVisitors.get(target.id) || []).filter(vid => vid !== p.id);
      p.myNightEvents.push({
        kind: 'act',
        actor: p.id,
        target: target.id,
        role: 'look',
        camp: p.realCamp,
        result: visitorIds.length > 0 ? 'ok' : 'ng',
        visitorIds
      });
      const logIcons = [
        { type: 'char', id: p.id },
        { type: 'role', c: p.realCamp, role: 'look' },
        { type: 'char', id: target.id }
      ];
      if (visitorIds.length > 0) {
        visitorIds.forEach(vid => logIcons.push({ type: 'char', id: vid }));
      } else {
        logIcons.push({ type: 'mark', val: 'ng' });
      }
      p.privateLogs.push({ day: game.day, scope: 'private', icons: logIcons });
    } else if (p.realRole === 'trk') {
      if (p.last.trk === target.id) return;
      p.uses.trk = (p.uses.trk || 0) + 1;
      p.last.trk = target.id;
      const destIds = playerDest.get(target.id) || [];
      p.myNightEvents.push({
        kind: 'act',
        actor: p.id,
        target: target.id,
        role: 'trk',
        camp: p.realCamp,
        result: destIds.length > 0 ? 'ok' : 'ng',
        destIds
      });
      const logIcons = [
        { type: 'char', id: p.id },
        { type: 'role', c: p.realCamp, role: 'trk' },
        { type: 'char', id: target.id }
      ];
      if (destIds.length > 0) {
        destIds.forEach(did => logIcons.push({ type: 'char', id: did }));
      } else {
        logIcons.push({ type: 'mark', val: 'ng' });
      }
      p.privateLogs.push({ day: game.day, scope: 'private', icons: logIcons });
    } else if (p.realRole === 'rat') {
      const used = p.uses.rat || 0;
      if (used < 1) {
        p.uses.rat = used + 1;
        const destIds = playerDest.get(target.id) || [];
        const pointedId = destIds.length > 0 ? destIds[0] : target.id;
        p.myNightEvents.push({
          kind: 'act',
          actor: p.id,
          target: target.id,
          role: 'rat',
          camp: p.realCamp,
          result: 'ok'
        });
        // 昼のねずみ行動モーション後に公開ログへ追加するため logEntry を保持
        morningRats.push({
          actor: p.id,
          target: pointedId,
          logEntry: {
            day: game.day + 1,
            scope: 'public',
            icons: [
              { type: 'char', id: p.id },
              { type: 'role', c: p.realCamp, role: 'rat' },
              { type: 'char', id: pointedId }
            ]
          }
        });
      }
    }
  });

  // 9. 死亡確定＆公開役職決定（SKキル・クリーナー掃除は黄色枠?アイコン）
  const newDeaths = [];
  killedMap.forEach((info, victimId) => {
    const victim = game.players[victimId];
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.isAsh = !!info.isAsh;

    const isConcealed = cleanedSet.has(victim.id) || info.killerRole === 'sk';
    let displayCamp = victim.realCamp;
    let displayRole = victim.realRole;
    let roleText = '';

    if (isConcealed) {
      displayCamp = 'u';
      displayRole = 'unknown';
      roleText = '???';
    } else if (victim.paintedRole) {
      displayCamp = victim.paintedRole.c;
      displayRole = victim.paintedRole.role;
      roleText = getConcreteRoleLabel(displayCamp, displayRole);
    } else {
      roleText = getConcreteRoleLabel(displayCamp, displayRole);
    }

    victim.rev = { t: roleText };

    // ボマー爆破時は bomb_blast で演出済みのため killed イベントを重複追加しない
    if (victim.id !== info.killerId && info.killerRole !== 'bom') {
      victim.myNightEvents.push({
        kind: 'killed',
        target: victim.id,
        role: info.killerRole,
        camp: info.killerCamp
      });
    }

    // 昼の死体役職公表モーション後に公開ログへ追加するため logEntry を保持
    newDeaths.push({
      id: victim.id,
      name: victim.name,
      c: displayCamp,
      role: displayRole,
      roleText,
      logEntry: {
        day: game.day + 1,
        scope: 'public',
        icons: [
          { type: 'char', id: victim.id },
          { type: 'skull' },
          { type: 'role', c: displayCamp, role: displayRole }
        ]
      }
    });
  });

  game.newDeaths = newDeaths;
  game.morningDeathIdx = 0;
  game.morningRats = morningRats;
  game.morningRatIdx = 0;

  const maxNightEvents = Math.max(0, ...game.players.map(p => (p.myNightEvents || []).length));
  const nightDuration = maxNightEvents > 0
    ? maxNightEvents * PHASE_TIMERS.nightEvent
    : PHASE_TIMERS.nightEmpty;

  game.phaseTransition = 'nightAction';
  broadcastState();

  phaseTimer = setTimeout(() => {
    if (!game || mode !== 'game') return;
    startToDayTransition();
  }, nightDuration);
}

function startToDayTransition() {
  if (!game) return;
  game.day += 1;
  game.ph = 'day';
  game.dayVotes = {};
  game.phaseTransition = 'toDay';

  // シーフが前夜に奪った役職を翌朝に確定・開示
  game.players.forEach(p => {
    if (p.pendingThiefReveal) {
      const tr = p.pendingThiefReveal;
      p.pendingThiefReveal = null;
      p.apparentCamp = tr.newApparentCamp;
      p.apparentRole = tr.newApparentRole;
      if (tr.newRole && p.uses[tr.newRole] === undefined) {
        p.uses[tr.newRole] = 0;
      }
      const revealedLabel = getConcreteRoleLabel(tr.newApparentCamp, tr.newApparentRole);
      p.thiefRevealedNotice = {
        c: tr.newApparentCamp,
        role: tr.newApparentRole,
        label: revealedLabel
      };
      p.privateLogs.push({
        day: game.day,
        scope: 'private',
        icons: [
          { type: 'char', id: p.id },
          { type: 'role', c: 'b', role: 'thf' },
          { type: 'char', id: tr.targetId },
          { type: 'role', c: tr.newApparentCamp, role: tr.newApparentRole }
        ]
      });
    }
  });

  broadcastState();

  phaseTimer = setTimeout(() => {
    if (!game || mode !== 'game') return;
    if (game.newDeaths.length > 0) {
      startMorningDeathsTransition();
    } else if (checkWinCondition()) {
      startToResultTransition();
    } else if (game.morningRats.length > 0) {
      startMorningRatTransition();
    } else {
      enterDayDiscussion();
    }
  }, PHASE_TIMERS.toDay);
}

function startMorningDeathsTransition() {
  if (!game) return;
  game.phaseTransition = 'morningDeaths';
  game.morningDeathIdx = 0;
  broadcastState();

  const stepDeath = () => {
    if (!game || mode !== 'game') return;
    const currentDeath = game.newDeaths[game.morningDeathIdx];
    // 死体の役職公表モーション完了後に公開ログを更新
    if (currentDeath && currentDeath.logEntry) {
      game.publicLogs.push(currentDeath.logEntry);
      currentDeath.logEntry = null;
    }

    if (game.morningDeathIdx + 1 < game.newDeaths.length) {
      game.morningDeathIdx += 1;
      broadcastState();
      phaseTimer = setTimeout(stepDeath, PHASE_TIMERS.morningDeath);
    } else {
      if (checkWinCondition()) {
        // 残っているねずみログがあれば結果画面の前に補完
        game.morningRats.forEach(r => {
          if (r.logEntry) {
            game.publicLogs.push(r.logEntry);
            r.logEntry = null;
          }
        });
        startToResultTransition();
      } else if (game.morningRats.length > 0) {
        startMorningRatTransition();
      } else {
        enterDayDiscussion();
      }
    }
  };

  phaseTimer = setTimeout(stepDeath, PHASE_TIMERS.morningDeath);
}

function startMorningRatTransition() {
  if (!game) return;
  game.phaseTransition = 'morningRat';
  game.morningRatIdx = 0;
  broadcastState();

  const stepRat = () => {
    if (!game || mode !== 'game') return;
    const currentRat = game.morningRats[game.morningRatIdx];
    // ねずみの行動モーション完了後に公開ログを更新
    if (currentRat && currentRat.logEntry) {
      game.publicLogs.push(currentRat.logEntry);
      currentRat.logEntry = null;
    }

    if (game.morningRatIdx + 1 < game.morningRats.length) {
      game.morningRatIdx += 1;
      broadcastState();
      phaseTimer = setTimeout(stepRat, PHASE_TIMERS.morningRat);
    } else {
      enterDayDiscussion();
    }
  };

  phaseTimer = setTimeout(stepRat, PHASE_TIMERS.morningRat);
}

function enterDayDiscussion() {
  if (!game) return;
  game.phaseTransition = null;
  game.newDeaths = [];
  game.morningDeathIdx = 0;
  game.morningRats = [];
  game.morningRatIdx = 0;
  scheduleBotDayVotes();
  broadcastState();
}

function startToResultTransition() {
  if (!game) return;
  game.phaseTransition = 'toResult';
  broadcastState();

  phaseTimer = setTimeout(() => {
    if (!game || mode !== 'game') return;
    game.phaseTransition = null;
    game.showResult = true;
    broadcastState();
  }, PHASE_TIMERS.toResult);
}

function buildPlayerRoleBar(mePlayer) {
  const baseList = game.roleBarTemplate.map(item => ({
    c: item.c,
    role: item.role || '',
    isMe: false
  }));
  const myCamp = mePlayer.apparentCamp;
  const myRole = mePlayer.apparentRole || '';

  // 1. 自分の役職がすでにロビー設定で村に存在している場合は、その既存枠を1番右へ移動して自分の役にする
  const existingIdx = baseList.findIndex(item => item.c === myCamp && item.role === myRole);
  if (existingIdx >= 0) {
    const [mine] = baseList.splice(existingIdx, 1);
    mine.isMe = true;
    baseList.push(mine);
    return baseList;
  }

  // 2. ランダムから出た役職で村にまだ存在しない場合は、同陣営のランダム枠を1つ減らして1番右に自分の役として表示する
  const randomIdx = baseList.findIndex(item => item.c === myCamp && item.role === '');
  if (randomIdx >= 0) {
    baseList.splice(randomIdx, 1);
    baseList.push({ c: myCamp, role: myRole, isMe: true });
    return baseList;
  }

  // 3. フォールバック（万一該当枠が見つからない場合）
  const fallbackIdx = Math.min(mePlayer.assignedBarIdx || 0, Math.max(0, baseList.length - 1));
  if (baseList.length > 0) {
    baseList.splice(fallbackIdx, 1);
  }
  baseList.push({ c: myCamp, role: myRole, isMe: true });
  return baseList;
}

function buildPlayerView(targetUid) {
  if (!game) return null;
  const mePlayer = game.players.find(p => p.uid === targetUid) || game.players[0];
  const isResult = game.showResult;

  const tally = {};
  let skipCount = 0;
  const alivePlayers = game.players.filter(p => p.alive);
  if (game.ph === 'day') {
    alivePlayers.forEach(p => {
      tally[p.id] = p.provokedVotes || 0;
    });
    alivePlayers.forEach(p => {
      const v = game.dayVotes[p.id];
      if (v === -1) skipCount++;
      else if (typeof v === 'number' && v >= 0 && tally[v] !== undefined) {
        tally[v] = (tally[v] || 0) + 1;
      }
    });
  }

  const doneCount = game.ph === 'day'
    ? alivePlayers.filter(p => game.dayVotes[p.id] !== undefined).length
    : alivePlayers.filter(p => game.nightActions[p.id] !== undefined).length;

  const mergedTimeline = [...game.publicLogs, ...(mePlayer.privateLogs || [])]
    .sort((a, b) => a.day - b.day);

  const roleBar = buildPlayerRoleBar(mePlayer);

  const playersView = game.players.map(p => {
    const isMate = mePlayer.realCamp === 'r' && p.realCamp === 'r' && p.id !== mePlayer.id;
    let fullRoleData = null;
    if (isResult) {
      const changed = p.origCamp !== p.realCamp || p.origRole !== p.realRole;
      const origLabel = getConcreteRoleLabel(p.origCamp, p.origRole);
      const curLabel = getConcreteRoleLabel(p.realCamp, p.realRole);
      let suffix = '';
      if (p.paintedRole) {
        suffix = `（塗:${getConcreteRoleLabel(p.paintedRole.c, p.paintedRole.role)}）`;
      }
      fullRoleData = {
        text: (changed ? `${origLabel} ➔ ${curLabel}` : curLabel) + suffix,
        icons: changed
          ? [{ c: p.origCamp, role: p.origRole }, { c: p.realCamp, role: p.realRole }]
          : [{ c: p.realCamp, role: p.realRole }]
      };
    }

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      alive: p.alive,
      isAsh: p.isAsh,
      bombed: p.bombed,
      mate: isMate,
      rev: p.rev,
      fullRoleData
    };
  });

  const myBombsCount = game.players.filter(p => p.alive && p.bombsOnHouse > 0).length;
  const majorityNeeded = Math.floor(alivePlayers.length / 2) + 1;

  const safeNewDeaths = (game.newDeaths || []).map(d => ({
    id: d.id,
    name: d.name,
    c: d.c,
    role: d.role,
    roleText: d.roleText
  }));

  const safeMorningRats = (game.morningRats || []).map(r => ({
    actor: r.actor,
    target: r.target
  }));

  return {
    submitted: game.ph === 'day'
      ? game.dayVotes[mePlayer.id] !== undefined
      : game.nightActions[mePlayer.id] !== undefined,
    myNightAction: game.ph === 'night' ? (game.nightActions[mePlayer.id] || null) : null,
    progress: { done: doneCount, total: alivePlayers.length },
    view: {
      gid: game.gid,
      me: {
        id: mePlayer.id,
        camp: mePlayer.apparentCamp,
        rc: mePlayer.realCamp,
        er: mePlayer.apparentRole,
        label: getConcreteRoleLabel(mePlayer.apparentCamp, mePlayer.apparentRole),
        color: mePlayer.color,
        alive: mePlayer.alive,
        isAsh: mePlayer.isAsh,
        sur: mePlayer.apparentRole === 'sur',
        bombs: myBombsCount,
        uses: mePlayer.uses,
        last: mePlayer.last,
        thiefNotice: mePlayer.thiefRevealedNotice || null
      },
      players: playersView,
      timeline: mergedTimeline,
      day: game.day,
      ph: game.ph,
      over: game.over,
      winners: game.winners,
      lastExile: game.lastExile,
      tally,
      skipCount,
      majorityNeeded,
      myVote: game.dayVotes[mePlayer.id],
      roleBar,
      myNightEvents: mePlayer.myNightEvents || [],
      newDeaths: safeNewDeaths,
      morningDeathIdx: game.morningDeathIdx || 0,
      morningRats: safeMorningRats,
      morningRatIdx: game.morningRatIdx || 0
    }
  };
}

function broadcastState() {
  const lobbySlots = slots.map(s => ({
    c: s.c,
    role: s.role || null,
    label: getSlotLabel(s.c, s.role)
  }));
  const errors = validateConfig();
  const publicUsers = users.map(u => ({
    uid: u.uid,
    name: u.name,
    color: u.color,
    online: u.online
  }));

  io.sockets.sockets.forEach(sock => {
    const u = users.find(x => x.socketId === sock.id);
    if (!u) return;

    if (mode === 'lobby' || !game) {
      sock.emit('state', {
        mode: 'lobby',
        hostUid,
        users: publicUsers,
        totalPlayers,
        slots: lobbySlots,
        errors,
        showResult: false,
        phaseTransition: null,
        meta: META
      });
    } else {
      const pv = buildPlayerView(u.uid);
      sock.emit('state', {
        mode: 'game',
        hostUid,
        users: publicUsers,
        totalPlayers,
        slots: lobbySlots,
        errors,
        showResult: game.showResult,
        phaseTransition: game.phaseTransition,
        submitted: pv.submitted,
        myNightAction: pv.myNightAction,
        progress: pv.progress,
        view: pv.view,
        meta: META
      });
    }
  });
}

io.on('connection', (socket) => {
  socket.on('join', ({ uid, name, preferredColor }) => {
    if (!uid) return;
    const cleanName = (name || 'プレイヤー').trim().slice(0, 12) || 'プレイヤー';
    let existing = users.find(u => u.uid === uid);

    if (mode === 'game' && game) {
      const inGamePlayer = game.players.find(p => p.uid === uid);
      if (!inGamePlayer) {
        socket.emit('spectator');
        return;
      }
    }

    if (existing) {
      existing.name = cleanName;
      existing.online = true;
      existing.socketId = socket.id;
    } else {
      const color = pickAvailableColor(preferredColor);
      existing = {
        uid,
        name: cleanName,
        color,
        online: true,
        socketId: socket.id
      };
      users.push(existing);
    }

    if (!hostUid || !users.find(u => u.uid === hostUid && u.online)) {
      hostUid = uid;
    }

    broadcastState();
  });

  socket.on('selectColor', (colorId) => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || mode !== 'lobby') return;
    if (typeof colorId !== 'number' || colorId < 0 || colorId >= COLORS.length) return;
    const taken = users.some(x => x.uid !== u.uid && x.color === colorId);
    if (!taken) {
      u.color = colorId;
      broadcastState();
    }
  });

  socket.on('transferHost', (targetUid) => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid) return;
    const target = users.find(x => x.uid === targetUid && x.online);
    if (target) {
      hostUid = target.uid;
      broadcastState();
    }
  });

  socket.on('kickUser', (targetUid) => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid || targetUid === u.uid) return;
    const idx = users.findIndex(x => x.uid === targetUid);
    if (idx >= 0) {
      const kickedUser = users[idx];
      users.splice(idx, 1);
      if (kickedUser.socketId) {
        io.to(kickedUser.socketId).emit('kicked');
      }
      broadcastState();
    }
  });

  socket.on('updateConfig', ({ totalPlayers: newTotal, slots: newSlots }) => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid || mode !== 'lobby') return;

    if (Array.isArray(newSlots)) {
      slots = newSlots.slice(0, 20).map(s => ({
        c: ['g', 'r', 'b'].includes(s.c) ? s.c : 'g',
        role: s.role || null
      }));
      totalPlayers = slots.length;
    } else if (typeof newTotal === 'number' && newTotal >= 3 && newTotal <= 20) {
      totalPlayers = newTotal;
      while (slots.length < totalPlayers) {
        slots.push({ c: 'g', role: null });
      }
      while (slots.length > totalPlayers) {
        slots.pop();
      }
    }
    broadcastState();
  });

  socket.on('startGame', () => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid || mode !== 'lobby') return;
    if (validateConfig().length > 0) return;
    initGame();
  });

  socket.on('submitAction', (payload) => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || mode !== 'game' || !game || game.phaseTransition || game.over) return;
    const me = game.players.find(p => p.uid === u.uid);
    if (!me || !me.alive) return;

    if (game.ph === 'day') {
      if (game.dayVotes[me.id] !== undefined) return;
      const tid = typeof payload === 'number' ? payload : -1;
      game.dayVotes[me.id] = tid;
      checkDayComplete();
    } else if (game.ph === 'night') {
      game.nightActions[me.id] = payload || {};
      checkNightComplete();
    }
  });

  socket.on('cancelNightAction', () => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || mode !== 'game' || !game || game.ph !== 'night' || game.phaseTransition || game.over) return;
    const me = game.players.find(p => p.uid === u.uid);
    if (!me || !me.alive) return;
    delete game.nightActions[me.id];
    broadcastState();
  });

  socket.on('forceAdvance', () => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid || mode !== 'game' || !game || game.phaseTransition || game.over) return;

    const alive = game.players.filter(p => p.alive);
    if (game.ph === 'day') {
      alive.forEach(p => {
        if (game.dayVotes[p.id] === undefined) {
          game.dayVotes[p.id] = -1;
        }
      });
      resolveDayPhase();
    } else if (game.ph === 'night') {
      alive.forEach(p => {
        if (game.nightActions[p.id] === undefined) {
          game.nightActions[p.id] = {};
        }
      });
      resolveNightPhase();
    }
  });

  socket.on('backToLobby', () => {
    const u = users.find(x => x.socketId === socket.id);
    if (!u || u.uid !== hostUid) return;
    clearPhaseTimer();
    game = null;
    mode = 'lobby';
    broadcastState();
  });

  socket.on('disconnect', () => {
    const u = users.find(x => x.socketId === socket.id);
    if (u) {
      u.online = false;
      u.socketId = null;
      if (u.uid === hostUid) {
        const nextHost = users.find(x => x.online);
        if (nextHost) hostUid = nextHost.uid;
      }
      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mask Village server running on http://localhost:${PORT}`);
});
