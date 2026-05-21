// ============================================================
//  PIXEL DUNGEON - Gua Kegelapan  |  game.js
//  Top-down RPG dengan dungeon procedural, musuh, item, combat
// ============================================================

// ---- CANVAS & SCALING -----------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TILE   = 32;        // pixel per tile
const VIEW_W = 19;        // tiles visible X
const VIEW_H = 13;        // tiles visible Y

let cw, ch, scale;

function resizeCanvas() {
  const avW = window.innerWidth;
  const avH = window.innerHeight - 80; // HUD top+bot ~80px
  const scX = avW / (VIEW_W * TILE);
  const scY = avH / (VIEW_H * TILE);
  scale  = Math.min(scX, scY, 2);
  cw     = Math.floor(VIEW_W * TILE * scale);
  ch     = Math.floor(VIEW_H * TILE * scale);
  canvas.width  = cw;
  canvas.height = ch;
  ctx.imageSmoothingEnabled = false;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ---- TILES ----------------------------------------------------------
const T = { WALL:0, FLOOR:1, DOOR:2, DOOR_OPEN:3, STAIRS:4, CHEST:5, CHEST_OPEN:6, TRAP:7 };
const TILE_COLORS = {
  [T.WALL]:       { fill:'#1a1230', stroke:'#2a1f50' },
  [T.FLOOR]:      { fill:'#1e1e2e', stroke:'#2a2a3e' },
  [T.DOOR]:       { fill:'#5d3a1a', stroke:'#7a4d2a' },
  [T.DOOR_OPEN]:  { fill:'#3d2a1a', stroke:'#5a3d20' },
  [T.STAIRS]:     { fill:'#0d3d0d', stroke:'#1a5a1a' },
  [T.CHEST]:      { fill:'#7a5c2a', stroke:'#a07830' },
  [T.CHEST_OPEN]: { fill:'#4a3a1a', stroke:'#6a5020' },
  [T.TRAP]:       { fill:'#1e1e2e', stroke:'#2a2a3e' },
};

// ---- MAP GENERATOR --------------------------------------------------
const MAP_W = 40, MAP_H = 40;

function generateDungeon(floor) {
  const map  = Array.from({length: MAP_H}, () => new Array(MAP_W).fill(T.WALL));
  const rooms = [];
  const numRooms = 6 + floor * 2;

  for (let attempt = 0; attempt < 200; attempt++) {
    if (rooms.length >= numRooms) break;
    const rw = 4 + Math.floor(Math.random() * 5);
    const rh = 4 + Math.floor(Math.random() * 5);
    const rx = 1 + Math.floor(Math.random() * (MAP_W - rw - 2));
    const ry = 1 + Math.floor(Math.random() * (MAP_H - rh - 2));

    // Check overlap
    let overlap = false;
    for (const r of rooms) {
      if (rx < r.x + r.w + 2 && rx + rw + 2 > r.x &&
          ry < r.y + r.h + 2 && ry + rh + 2 > r.y) {
        overlap = true; break;
      }
    }
    if (overlap) continue;

    // Carve room
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++)
        map[y][x] = T.FLOOR;

    rooms.push({ x:rx, y:ry, w:rw, h:rh,
      cx: rx + Math.floor(rw/2), cy: ry + Math.floor(rh/2) });
  }

  // Connect rooms with corridors
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i-1], b = rooms[i];
    let cx = a.cx, cy = a.cy;
    while (cx !== b.cx) {
      map[cy][cx] = T.FLOOR;
      cx += cx < b.cx ? 1 : -1;
    }
    while (cy !== b.cy) {
      map[cy][cx] = T.FLOOR;
      cy += cy < b.cy ? 1 : -1;
    }
  }

  // Add doors on corridor entrances
  for (const r of rooms) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (map[r.y-1] && map[r.y-1][x] === T.FLOOR && map[r.y-2] && map[r.y-2][x] === T.FLOOR)
        map[r.y][x] = T.DOOR;
      if (map[r.y+r.h] && map[r.y+r.h][x] === T.FLOOR && map[r.y+r.h+1] && map[r.y+r.h+1][x] === T.FLOOR)
        map[r.y+r.h-1][x] = T.DOOR;
    }
  }

  // Stairs in last room
  const lastRoom = rooms[rooms.length - 1];
  map[lastRoom.cy][lastRoom.cx] = T.STAIRS;

  // Chests in random rooms
  for (let i = 1; i < rooms.length - 1; i++) {
    if (Math.random() < 0.5) {
      const r = rooms[i];
      map[r.cy][r.cx] = T.CHEST;
    }
  }

  // Traps
  for (let i = 0; i < 4 + floor * 2; i++) {
    const r = rooms[Math.floor(Math.random() * rooms.length)];
    const tx = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
    const ty = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
    if (map[ty][tx] === T.FLOOR) map[ty][tx] = T.TRAP;
  }

  return { map, rooms };
}

// ---- FOG OF WAR -----------------------------------------------------
let fog, visited;
function initFog() {
  fog     = Array.from({length:MAP_H}, ()=>new Array(MAP_W).fill(true));
  visited = Array.from({length:MAP_H}, ()=>new Array(MAP_W).fill(false));
}
function updateFog(px, py, radius=4) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx*dx+dy*dy <= radius*radius) {
        const fx=px+dx, fy=py+dy;
        if (fx>=0&&fx<MAP_W&&fy>=0&&fy<MAP_H) {
          fog[fy][fx]     = false;
          visited[fy][fx] = true;
        }
      }
    }
  }
}

// ---- PLAYER ---------------------------------------------------------
const player = {
  tx: 2, ty: 2,     // tile position
  px: 0, py: 0,     // pixel position (for smooth movement)
  moving: false,
  moveProgress: 0,
  fromTx: 2, fromTy: 2,
  targetTx: 2, targetTy: 2,
  MOVE_SPEED: 8,    // tiles per second

  hp: 20, maxHp: 20,
  atk: 4,
  potions: 2,
  gold: 0,
  keys: 0,
  kills: 0,
  score: 0,
  floor: 1,
  attackCooldown: 0,
  invincible: 0,
  attackAnim: 0,
  facing: 'down',
  walkFrame: 0,
  walkTimer: 0,

  reset() {
    this.hp = this.maxHp = 20;
    this.atk = 4;
    this.potions = 2;
    this.gold = 0;
    this.keys = 0;
    this.kills = 0;
    this.score = 0;
    this.floor = 1;
    this.attackCooldown = 0;
    this.invincible = 0;
    this.attackAnim = 0;
    this.facing = 'down';
    this.walkFrame = 0;
    this.walkTimer = 0;
  },

  draw(sx, sy) {
    const x = Math.round(sx), y = Math.round(sy);
    const s = Math.round(TILE * scale);
    const px2 = x + 2, py2 = y + 2;
    const pw = s - 4, ph = s - 4;

    ctx.save();

    // Invincible flash
    if (this.invincible > 0 && Math.floor(this.invincible * 10) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x + s/2, y + s - 4, pw*0.4, 4, 0, 0, Math.PI*2);
    ctx.fill();

    // Body
    ctx.fillStyle = this.attackAnim > 0 ? '#e8b84b' : '#3498db';
    ctx.fillRect(px2 + 6, py2 + 12, pw - 12, ph - 14);

    // Head
    ctx.fillStyle = '#f5cba7';
    ctx.fillRect(px2 + 7, py2 + 2, pw - 14, 12);

    // Hair
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(px2 + 7, py2 + 2, pw - 14, 4);

    // Eyes
    ctx.fillStyle = '#fff';
    if (this.facing === 'left') {
      ctx.fillRect(px2 + 8, py2 + 6, 4, 3);
    } else if (this.facing === 'right') {
      ctx.fillRect(px2 + pw - 16, py2 + 6, 4, 3);
    } else {
      ctx.fillRect(px2 + 8, py2 + 6, 3, 3);
      ctx.fillRect(px2 + pw - 14, py2 + 6, 3, 3);
    }
    ctx.fillStyle = '#2c3e50';
    if (this.facing === 'left') {
      ctx.fillRect(px2 + 9, py2 + 7, 2, 2);
    } else if (this.facing === 'right') {
      ctx.fillRect(px2 + pw - 15, py2 + 7, 2, 2);
    } else {
      ctx.fillRect(px2 + 9, py2 + 7, 2, 2);
      ctx.fillRect(px2 + pw - 13, py2 + 7, 2, 2);
    }

    // Legs (walk anim)
    ctx.fillStyle = '#2c3e50';
    const legOff = this.moving ? (this.walkFrame % 2 === 0 ? 2 : -2) : 0;
    ctx.fillRect(px2 + 7, py2 + ph - 8, pw/2 - 6, 8);
    ctx.fillRect(px2 + pw/2 + 2, py2 + ph - 8 + legOff*0.5, pw/2 - 6, 8);

    // Weapon (sword)
    if (this.attackAnim > 0) {
      ctx.fillStyle = '#e8b84b';
      ctx.strokeStyle = '#c9a535';
      ctx.lineWidth = 1;
      let wx, wy, ww, wh;
      if (this.facing === 'up')    { wx = x+s/2-3; wy = y-8; ww=6; wh=16; }
      else if (this.facing === 'down') { wx = x+s/2-3; wy = y+s-4; ww=6; wh=16; }
      else if (this.facing === 'left') { wx = x-12; wy = y+s/2-3; ww=16; wh=6; }
      else                         { wx = x+s+2; wy = y+s/2-3; ww=16; wh=6; }
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeRect(wx, wy, ww, wh);
    }

    ctx.restore();
  }
};

// ---- ENEMIES --------------------------------------------------------
const ENEMY_TYPES = [
  { id:'slime',  name:'Slime',   hp:6,  atk:2, spd:1.5, color:'#2ecc71', color2:'#27ae60', xp:5,  gold:2 },
  { id:'goblin', name:'Goblin',  hp:10, atk:3, spd:2.0, color:'#e74c3c', color2:'#c0392b', xp:10, gold:4 },
  { id:'orc',    name:'Orc',     hp:18, atk:5, spd:1.2, color:'#8e44ad', color2:'#6c3483', xp:20, gold:8 },
  { id:'skull',  name:'Tengkorak',hp:14,atk:4, spd:2.5, color:'#ecf0f1', color2:'#bdc3c7', xp:15, gold:5 },
  { id:'boss',   name:'BOSS',    hp:60, atk:8, spd:1.8, color:'#e67e22', color2:'#d35400', xp:100,gold:30},
];

let enemies = [];
let eid = 0;

function spawnEnemies(rooms, floor, map) {
  enemies = [];
  const types = floor >= 5
    ? ENEMY_TYPES
    : ENEMY_TYPES.slice(0, Math.min(2 + Math.floor(floor/2), 4));

  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const count = 1 + Math.floor(Math.random() * (1 + Math.floor(floor/2)));
    for (let j = 0; j < count; j++) {
      const type = types[Math.floor(Math.random() * types.length)];
      let ex, ey;
      do {
        ex = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
        ey = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      } while (map[ey][ex] !== T.FLOOR);

      const hp = type.hp + floor * 2;
      enemies.push({
        id: eid++,
        type: type.id,
        name: type.name,
        tx: ex, ty: ey,
        px: ex * TILE, py: ey * TILE,
        hp, maxHp: hp,
        atk: type.atk + Math.floor(floor/2),
        spd: type.spd,
        color: type.color,
        color2: type.color2,
        xp: type.xp,
        gold: type.gold,
        moving: false,
        moveTimer: 0,
        moveInterval: 1 / type.spd,
        aggroRange: type.id === 'boss' ? 12 : 6,
        aggro: false,
        attackCooldown: 0,
        facing: 'down',
        walkFrame: 0,
        hurtFlash: 0,
        frame: 0,
        frameTimer: 0,
        dead: false,
      });
    }
  }

  // Boss on last floor
  if (floor === MAX_FLOOR) {
    const lastRoom = rooms[rooms.length - 1];
    const bt = ENEMY_TYPES[4];
    enemies.push({
      id: eid++,
      type: 'boss', name: 'BOSS PENJAGA',
      tx: lastRoom.cx, ty: lastRoom.cy - 1,
      px: lastRoom.cx*TILE, py: (lastRoom.cy-1)*TILE,
      hp: bt.hp, maxHp: bt.hp,
      atk: bt.atk + floor, spd: bt.spd,
      color: bt.color, color2: bt.color2,
      xp: bt.xp, gold: bt.gold,
      moving: false, moveTimer: 0, moveInterval: 1/bt.spd,
      aggroRange: 15, aggro: false,
      attackCooldown: 0, facing: 'down', walkFrame: 0,
      hurtFlash: 0, frame: 0, frameTimer: 0, dead: false,
    });
  }
}

function drawEnemy(e, sx, sy) {
  const s = Math.round(TILE * scale);
  const x = Math.round(sx), y = Math.round(sy);

  ctx.save();
  if (e.hurtFlash > 0) ctx.globalAlpha = 0.5;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x+s/2, y+s-4, s*0.35, 4, 0, 0, Math.PI*2);
  ctx.fill();

  const isBoss = e.type === 'boss';
  const sz = isBoss ? s - 2 : s - 6;
  const ox = isBoss ? 1 : 3;
  const oy = isBoss ? 1 : 3;

  if (e.type === 'slime') {
    // Slime blob
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(x+s/2, y+s*0.65, sz*0.42, sz*0.32, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = e.color2;
    ctx.beginPath();
    ctx.ellipse(x+s/2-2, y+s*0.57, sz*0.18, sz*0.14, -0.2, 0, Math.PI*2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+s/2-7, y+s*0.55, 5, 5);
    ctx.fillRect(x+s/2+2, y+s*0.55, 5, 5);
    ctx.fillStyle = '#111';
    ctx.fillRect(x+s/2-6, y+s*0.56, 3, 3);
    ctx.fillRect(x+s/2+3, y+s*0.56, 3, 3);

  } else if (e.type === 'skull') {
    // Skull
    ctx.fillStyle = e.color;
    ctx.fillRect(x+ox+4, y+oy+2, sz-8, sz-6);
    ctx.fillStyle = '#222';
    ctx.fillRect(x+ox+6, y+oy+6, 5, 5);
    ctx.fillRect(x+ox+sz-11, y+oy+6, 5, 5);
    ctx.fillRect(x+ox+6, y+oy+sz-10, 3, 4);
    ctx.fillRect(x+ox+sz-12, y+oy+sz-10, 3, 4);
    ctx.fillRect(x+ox+sz/2-5, y+oy+sz-10, 10, 4);

  } else {
    // Generic humanoid (goblin/orc/boss)
    // Body
    ctx.fillStyle = e.color;
    ctx.fillRect(x+ox+4, y+oy+10, sz-8, sz-14);
    // Head
    ctx.fillStyle = isBoss ? '#f39c12' : e.color;
    ctx.fillRect(x+ox+5, y+oy+1, sz-10, 10);
    // Eyes (red for enemies)
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(x+ox+7, y+oy+3, 3, 3);
    ctx.fillRect(x+ox+sz-12, y+oy+3, 3, 3);
    // Horns for boss
    if (isBoss) {
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(x+ox+4, y+oy-5, 4, 8);
      ctx.fillRect(x+ox+sz-10, y+oy-5, 4, 8);
    }
    // Legs
    ctx.fillStyle = e.color2;
    ctx.fillRect(x+ox+4, y+oy+sz-8, sz/2-5, 8);
    ctx.fillRect(x+ox+sz/2+1, y+oy+sz-8, sz/2-5, 8);
  }

  // HP bar
  if (e.hp < e.maxHp) {
    const barW = s - 4;
    ctx.fillStyle = '#333';
    ctx.fillRect(x+2, y-8, barW, 4);
    ctx.fillStyle = e.hp/e.maxHp > 0.5 ? '#2ecc71' : e.hp/e.maxHp > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(x+2, y-8, barW*(e.hp/e.maxHp), 4);
  }

  ctx.restore();
}

// ---- ITEMS / PICKUPS ------------------------------------------------
let items = [];

function spawnItems(rooms, floor) {
  items = [];
  for (let i = 1; i < rooms.length; i++) {
    if (Math.random() < 0.4) {
      const r = rooms[i];
      items.push({
        tx: r.x + 1 + Math.floor(Math.random()*(r.w-2)),
        ty: r.y + 1 + Math.floor(Math.random()*(r.h-2)),
        type: Math.random() < 0.5 ? 'gold' : 'potion',
        collected: false,
        bob: Math.random() * Math.PI * 2,
      });
    }
  }
}

function drawItem(item, sx, sy, time) {
  const s = Math.round(TILE * scale);
  const x = Math.round(sx), y = Math.round(sy);
  const bobY = Math.sin(item.bob + time*2) * 2;

  if (item.type === 'gold') {
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(x+s/2, y+s/2+bobY, s*0.25, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#e67e22';
    ctx.beginPath();
    ctx.arc(x+s/2-2, y+s/2-2+bobY, s*0.1, 0, Math.PI*2);
    ctx.fill();
  } else {
    // Potion
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(x+s/2-5, y+s/2-4+bobY, 10, 12);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x+s/2-3, y+s/2-2+bobY, 6, 8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+s/2-2, y+s/2+bobY, 4, 2);
    // Bottle neck
    ctx.fillStyle = '#95a5a6';
    ctx.fillRect(x+s/2-3, y+s/2-8+bobY, 6, 5);
    ctx.fillRect(x+s/2-2, y+s/2-10+bobY, 4, 3);
  }
}

// ---- PARTICLES ------------------------------------------------------
let particles = [];

function spawnHitParticles(x, y, color) {
  for (let i=0;i<8;i++) {
    const a = Math.random()*Math.PI*2;
    const spd = 40+Math.random()*80;
    particles.push({x,y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd-60,
      life:1, maxLife:1, r:2+Math.random()*3, color});
  }
}

function spawnFloatText(x, y, text, color='#e8b84b') {
  particles.push({type:'text', x, y, vy:-30, life:1.5, maxLife:1.5, text, color, size:11});
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x  += (p.vx||0)*dt;
    p.y  += (p.vy||0)*dt;
    if (p.type !== 'text') p.vy = (p.vy||0)+150*dt;
    p.life -= dt*(p.type==='text'?0.8:2);
  }
  particles = particles.filter(p=>p.life>0);
}

function drawParticles(camX, camY) {
  const s = TILE * scale;
  for (const p of particles) {
    const sx = (p.x - camX)*scale + cw/2;
    const sy = (p.y - camY)*scale + ch/2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life/p.maxLife);
    if (p.type==='text') {
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.size}px 'Courier New'`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, sx, sy);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(sx,sy,p.r,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

// ---- GAME STATE -----------------------------------------------------
let gmap, grooms;
let gameState = 'start';
let hiScore   = parseInt(localStorage.getItem('dungeon_hi')||'0');
let msgTimeout;
const MAX_FLOOR = 5;
let totalTime = 0;

function setMsg(txt, dur=2500) {
  const el = document.getElementById('msg-box');
  el.textContent = txt;
  clearTimeout(msgTimeout);
  if (dur) msgTimeout = setTimeout(()=>{ el.textContent=''; }, dur);
}

// ---- FLOOR INIT -----------------------------------------------------
function initFloor(floor) {
  const result = generateDungeon(floor);
  gmap   = result.map;
  grooms = result.rooms;

  initFog();

  // Place player in first room
  const startRoom = grooms[0];
  player.tx = startRoom.cx;
  player.ty = startRoom.cy;
  player.px = player.tx * TILE;
  player.py = player.ty * TILE;
  player.fromTx = player.tx; player.fromTy = player.ty;
  player.moving = false;
  player.attackCooldown = 0;
  player.invincible = 0;

  spawnEnemies(grooms, floor, gmap);
  spawnItems(grooms, floor);
  particles = [];

  updateFog(player.tx, player.ty);
  updateHUD();
}

function startGame() {
  player.reset();
  initFloor(1);
  gameState = 'playing';
  showScreen('screen-game');
  setMsg('Selamat datang di Gua Kegelapan! Cari tangga untuk naik lantai.', 4000);
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// ---- INPUT ----------------------------------------------------------
const keys = {};
window.addEventListener('keydown', e => {
  if (!keys[e.code]) {
    keys[e.code] = true;
    handleInput(e.code);
  }
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
    e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function handleInput(code) {
  if (gameState === 'paused') {
    if (code === 'Escape') resumeGame();
    return;
  }
  if (gameState !== 'playing') return;

  if (code === 'Escape') { pauseGame(); return; }

  // Use potion
  if (code === 'KeyF' || code === 'KeyQ') {
    if (player.potions > 0 && player.hp < player.maxHp) {
      const heal = Math.floor(player.maxHp * 0.4);
      player.hp = Math.min(player.maxHp, player.hp + heal);
      player.potions--;
      setMsg(`+${heal} HP dari potion!`);
      spawnFloatText(player.px + TILE/2, player.py, `+${heal}HP`, '#2ecc71');
      updateHUD();
    } else if (player.potions === 0) {
      setMsg('Tidak ada potion!');
    }
    return;
  }

  // Attack
  if (code === 'Space') {
    attackInFacing();
    return;
  }

  // Move
  if (!player.moving) {
    let dx=0, dy=0;
    if (code==='KeyW'||code==='ArrowUp')    { dy=-1; player.facing='up'; }
    if (code==='KeyS'||code==='ArrowDown')  { dy= 1; player.facing='down'; }
    if (code==='KeyA'||code==='ArrowLeft')  { dx=-1; player.facing='left'; }
    if (code==='KeyD'||code==='ArrowRight') { dx= 1; player.facing='right'; }
    if (dx||dy) tryMove(player.tx+dx, player.ty+dy, dx, dy);
  }

  // Interact
  if (code==='KeyE') interactFacing();
}

function tryMove(nx, ny) {
  if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return;
  const tile = gmap[ny][nx];
  if (tile===T.WALL) return;
  if (tile===T.DOOR) {
    gmap[ny][nx] = T.DOOR_OPEN;
    setMsg('Pintu terbuka!');
  }
  // Check enemy at target
  const enemy = enemies.find(e=>!e.dead&&e.tx===nx&&e.ty===ny);
  if (enemy) { attackEnemy(enemy); return; }

  // Move
  player.fromTx = player.tx; player.fromTy = player.ty;
  player.targetTx = nx; player.targetTy = ny;
  player.tx = nx; player.ty = ny;
  player.moving = true;
  player.moveProgress = 0;

  // Tile effects on arrival (handled in update)
}

function attackInFacing() {
  if (player.attackCooldown > 0) return;
  let dx=0, dy=0;
  if (player.facing==='up')    dy=-1;
  if (player.facing==='down')  dy= 1;
  if (player.facing==='left')  dx=-1;
  if (player.facing==='right') dx= 1;
  const tx=player.tx+dx, ty=player.ty+dy;
  const enemy=enemies.find(e=>!e.dead&&e.tx===tx&&e.ty===ty);
  if (enemy) attackEnemy(enemy);
  else {
    player.attackAnim = 0.3;
    player.attackCooldown = 0.3;
  }
}

function attackEnemy(e) {
  const dmg = player.atk + Math.floor(Math.random()*3);
  e.hp -= dmg;
  e.hurtFlash = 0.2;
  player.attackAnim    = 0.3;
  player.attackCooldown= 0.4;

  // World-space particle
  spawnHitParticles(e.px+TILE/2, e.py+TILE/2, '#e8b84b');
  spawnFloatText(e.px+TILE/2, e.py, `-${dmg}`, '#e74c3c');

  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  player.kills++;
  player.score += e.type === 'boss'
    ? e.xp + player.floor * 50
    : e.xp;
  const gold = e.gold + Math.floor(Math.random()*3);
  player.gold += gold;
  setMsg(`${e.name} mati! +${e.xp} XP, +${gold}G`);
  spawnFloatText(e.px+TILE/2, e.py-8, `+${e.xp}XP`, '#f1c40f');
  updateHUD();
}

function interactFacing() {
  let dx=0, dy=0;
  if (player.facing==='up')    dy=-1;
  if (player.facing==='down')  dy= 1;
  if (player.facing==='left')  dx=-1;
  if (player.facing==='right') dx= 1;
  const tx=player.tx+dx, ty=player.ty+dy;
  if (gmap[ty] && gmap[ty][tx]===T.CHEST) {
    openChest(tx, ty);
  }
}

function openChest(tx, ty) {
  gmap[ty][tx] = T.CHEST_OPEN;
  const roll = Math.random();
  if (roll < 0.4) {
    const gold = 5 + Math.floor(Math.random()*15);
    player.gold += gold;
    setMsg(`Peti terbuka! +${gold} GOLD`);
    spawnFloatText(tx*TILE+TILE/2, ty*TILE, `+${gold}G`, '#f1c40f');
  } else if (roll < 0.7) {
    player.potions++;
    setMsg('Peti terbuka! +1 POTION');
    spawnFloatText(tx*TILE+TILE/2, ty*TILE, '+POTION', '#e74c3c');
  } else if (roll < 0.85) {
    player.atk += 2;
    setMsg(`Peti terbuka! Senjata baru! ATK +2 (total ${player.atk})`);
    spawnFloatText(tx*TILE+TILE/2, ty*TILE, '+ATK!', '#e8b84b');
  } else {
    player.maxHp += 4;
    player.hp = Math.min(player.maxHp, player.hp + 4);
    setMsg(`Peti terbuka! Max HP +4 (total ${player.maxHp})`);
    spawnFloatText(tx*TILE+TILE/2, ty*TILE, '+MAX HP!', '#2ecc71');
  }
  updateHUD();
}

// ---- ENEMY AI -------------------------------------------------------
function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;

    // Update timers
    if (e.hurtFlash > 0)     e.hurtFlash -= dt;
    if (e.attackCooldown > 0) e.attackCooldown -= dt;
    if (e.frameTimer !== undefined) {
      e.frameTimer += dt;
      if (e.frameTimer > 0.15) { e.frame = (e.frame+1)%2; e.frameTimer=0; }
    }

    // Smooth movement
    if (e.moving) {
      e.moveProgress = Math.min(1, e.moveProgress + dt * e.spd * 4);
      e.px = lerp(e.fromPx, e.targetPx, e.moveProgress);
      e.py = lerp(e.fromPy, e.targetPy, e.moveProgress);
      if (e.moveProgress >= 1) {
        e.px = e.targetPx; e.py = e.targetPy;
        e.moving = false;
      }
      continue;
    }

    // Aggro check
    const dist = Math.abs(e.tx - player.tx) + Math.abs(e.ty - player.ty);
    if (dist <= e.aggroRange && !fog[e.ty]?.[e.tx]) e.aggro = true;
    if (!e.aggro) continue;

    // Attack if adjacent
    if (dist === 1 && e.attackCooldown <= 0) {
      enemyAttack(e);
      continue;
    }

    // Move towards player
    e.moveTimer -= dt;
    if (e.moveTimer > 0) continue;
    e.moveTimer = e.moveInterval;

    // Simple pathfinding: move on axis closest to player
    const pdx = player.tx - e.tx;
    const pdy = player.ty - e.ty;
    let moved = false;

    // Try primary axis
    const dirs = Math.abs(pdx) >= Math.abs(pdy)
      ? [[Math.sign(pdx),0],[0,Math.sign(pdy)]]
      : [[0,Math.sign(pdy)],[Math.sign(pdx),0]];

    for (const [dx,dy] of dirs) {
      if (!dx && !dy) continue;
      const nx = e.tx+dx, ny = e.ty+dy;
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      const tile = gmap[ny][nx];
      if (tile===T.WALL) continue;
      if (enemies.find(o=>!o.dead&&o.tx===nx&&o.ty===ny)) continue;
      if (player.tx===nx && player.ty===ny) continue;

      e.fromPx = e.px; e.fromPy = e.py;
      e.targetPx = nx*TILE; e.targetPy = ny*TILE;
      e.tx = nx; e.ty = ny;
      e.moving = true; e.moveProgress = 0;
      if (dx < 0) e.facing='left'; else if (dx>0) e.facing='right';
      else if (dy < 0) e.facing='up'; else e.facing='down';
      moved = true;
      break;
    }
  }
}

function enemyAttack(e) {
  if (player.invincible > 0) return;
  const dmg = Math.max(1, e.atk - Math.floor(Math.random()*2));
  player.hp = Math.max(0, player.hp - dmg);
  player.invincible = 0.6;
  e.attackCooldown = 1.0;

  spawnHitParticles(player.px+TILE/2, player.py+TILE/2, '#e74c3c');
  spawnFloatText(player.px+TILE/2, player.py, `-${dmg}`, '#fff');

  if (player.hp <= 0) {
    gameState = 'dead';
    setTimeout(showGameOver, 600);
  }
  updateHUD();
}

function lerp(a,b,t){ return a+(b-a)*t; }

// ---- TILE INTERACTION ON STEP ---------------------------------------
function onPlayerStep() {
  const tx=player.tx, ty=player.ty;
  const tile=gmap[ty][tx];

  // Pick up items
  for (const item of items) {
    if (!item.collected && item.tx===tx && item.ty===ty) {
      item.collected = true;
      if (item.type==='gold') {
        const g=3+Math.floor(Math.random()*6);
        player.gold+=g;
        setMsg(`+${g} GOLD`);
        spawnFloatText(tx*TILE+TILE/2, ty*TILE, `+${g}G`, '#f1c40f');
      } else {
        player.potions++;
        setMsg('+1 POTION');
        spawnFloatText(tx*TILE+TILE/2, ty*TILE, '+POTION', '#e74c3c');
      }
      updateHUD();
    }
  }

  // Trap
  if (tile === T.TRAP) {
    if (player.invincible <= 0) {
      const dmg = 2 + player.floor;
      player.hp = Math.max(0, player.hp - dmg);
      player.invincible = 0.5;
      setMsg(`JEBAKAN! -${dmg} HP!`);
      spawnHitParticles(player.px+TILE/2, player.py+TILE/2,'#8e44ad');
      spawnFloatText(player.px+TILE/2, player.py, `TRAP -${dmg}!`, '#9b59b6');
      gmap[ty][tx] = T.FLOOR; // disarm after step
      if (player.hp<=0) { gameState='dead'; setTimeout(showGameOver,600); }
      updateHUD();
    }
  }

  // Stairs — next floor
  if (tile === T.STAIRS) {
    nextFloor();
  }
}

function nextFloor() {
  player.floor++;
  player.score += player.floor * 50;
  if (player.floor > MAX_FLOOR) {
    gameState = 'won';
    showWin();
    return;
  }
  // Small heal between floors
  player.hp = Math.min(player.maxHp, player.hp + Math.floor(player.maxHp*0.25));
  setMsg(`🎉 Lantai ${player.floor}! HP dipulihkan sedikit.`, 3500);
  initFloor(player.floor);
  updateHUD();
}

// ---- HUD UPDATE -----------------------------------------------------
function updateHUD() {
  const hp = Math.max(0, player.hp);
  const pct = hp/player.maxHp;
  const bar = document.getElementById('hp-bar');
  bar.style.width = (pct*100)+'%';
  bar.style.background = pct>0.5?'#27ae60':pct>0.25?'#f39c12':'#c0392b';
  document.getElementById('hp-text').textContent = `${hp}/${player.maxHp}`;
  document.getElementById('hud-floor').textContent = player.floor;
  document.getElementById('hud-score').textContent = player.score;
  document.getElementById('potion-count').textContent = player.potions;
  document.getElementById('gold-count').textContent  = player.gold+'G';
  document.getElementById('key-count').textContent   = player.keys;
}

// ---- MAIN RENDER ----------------------------------------------------
let lastTime = 0;
let gameTime = 0;

function loop(ts) {
  if (gameState !== 'playing') return;
  const dt   = Math.min((ts - lastTime)/1000, 0.05);
  lastTime   = ts;
  gameTime  += dt;

  // Update player movement
  if (player.moving) {
    player.moveProgress = Math.min(1, player.moveProgress + dt * player.MOVE_SPEED);
    player.px = lerp(player.fromTx*TILE, player.targetTx*TILE, player.moveProgress);
    player.py = lerp(player.fromTy*TILE, player.targetTy*TILE, player.moveProgress);
    player.walkTimer += dt;
    if (player.walkTimer > 0.1) { player.walkFrame++; player.walkTimer=0; }
    if (player.moveProgress >= 1) {
      player.px = player.targetTx*TILE;
      player.py = player.targetTy*TILE;
      player.moving = false;
      updateFog(player.tx, player.ty);
      onPlayerStep();
    }
  }

  // Continuous movement (hold key)
  if (!player.moving) {
    let dx=0, dy=0;
    if (keys['KeyW']||keys['ArrowUp'])    { dy=-1; player.facing='up'; }
    if (keys['KeyS']||keys['ArrowDown'])  { dy= 1; player.facing='down'; }
    if (keys['KeyA']||keys['ArrowLeft'])  { dx=-1; player.facing='left'; }
    if (keys['KeyD']||keys['ArrowRight']) { dx= 1; player.facing='right'; }
    if (dx||dy) tryMove(player.tx+dx, player.ty+dy);
  }

  // Timers
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (player.invincible > 0)     player.invincible -= dt;
  if (player.attackAnim > 0)     player.attackAnim  -= dt;

  // Enemies
  updateEnemies(dt);
  enemies = enemies.filter(e=>!e.dead || e.hurtFlash>0);

  // Particles
  updateParticles(dt);

  // ---- DRAW ----
  ctx.clearRect(0,0,cw,ch);

  // Camera: center on player pixel
  const camX = player.px + TILE/2;
  const camY = player.py + TILE/2;

  // Draw tiles
  const s = Math.round(TILE*scale);
  const tilesX = Math.ceil(cw/s)+2;
  const tilesY = Math.ceil(ch/s)+2;
  const startTX = Math.floor(camX/TILE) - Math.floor(tilesX/2);
  const startTY = Math.floor(camY/TILE) - Math.floor(tilesY/2);

  for (let ty=startTY; ty<startTY+tilesY; ty++) {
    for (let tx=startTX; tx<startTX+tilesX; tx++) {
      if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) {
        // Out of bounds = wall
        const sx = (tx*TILE - camX)*scale + cw/2;
        const sy = (ty*TILE - camY)*scale + ch/2;
        ctx.fillStyle = '#0a0814';
        ctx.fillRect(Math.round(sx), Math.round(sy), s+1, s+1);
        continue;
      }

      const isFog     = fog[ty][tx];
      const isVisited = visited[ty][tx];
      if (!isVisited) continue; // never seen = invisible

      const sx = (tx*TILE - camX)*scale + cw/2;
      const sy = (ty*TILE - camY)*scale + ch/2;
      const tile = gmap[ty][tx];
      const tc = TILE_COLORS[tile] || TILE_COLORS[T.FLOOR];

      ctx.globalAlpha = isFog ? 0.35 : 1;

      ctx.fillStyle = tc.fill;
      ctx.fillRect(Math.round(sx), Math.round(sy), s+1, s+1);
      ctx.strokeStyle = tc.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(sx)+0.5, Math.round(sy)+0.5, s, s);

      // Tile icons
      if (!isFog) {
        if (tile===T.STAIRS) {
          ctx.fillStyle='#4ade80';
          ctx.font=`${s*0.55}px serif`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText('▼', Math.round(sx)+s/2, Math.round(sy)+s/2);
        } else if (tile===T.CHEST) {
          ctx.font=`${s*0.55}px serif`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText('📦', Math.round(sx)+s/2, Math.round(sy)+s/2);
        } else if (tile===T.CHEST_OPEN) {
          ctx.globalAlpha=0.4;
          ctx.font=`${s*0.5}px serif`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText('📦', Math.round(sx)+s/2, Math.round(sy)+s/2);
          ctx.globalAlpha=isFog?0.35:1;
        } else if (tile===T.DOOR) {
          ctx.fillStyle='#8B4513';
          ctx.fillRect(Math.round(sx)+4, Math.round(sy)+4, s-8, s-8);
          ctx.fillStyle='#c49a6c';
          ctx.fillRect(Math.round(sx)+s/2-3, Math.round(sy)+s/2-3, 6,6);
        } else if (tile===T.TRAP) {
          ctx.strokeStyle='rgba(155,89,182,0.4)';
          ctx.lineWidth=1;
          ctx.beginPath();
          ctx.moveTo(Math.round(sx)+s/2-4, Math.round(sy)+s/2);
          ctx.lineTo(Math.round(sx)+s/2+4, Math.round(sy)+s/2);
          ctx.moveTo(Math.round(sx)+s/2, Math.round(sy)+s/2-4);
          ctx.lineTo(Math.round(sx)+s/2, Math.round(sy)+s/2+4);
          ctx.stroke();
        }
      }

      ctx.globalAlpha=1;
    }
  }

  // Draw items
  for (const item of items) {
    if (item.collected) continue;
    if (fog[item.ty]?.[item.tx]) continue;
    const sx=(item.tx*TILE-camX)*scale+cw/2;
    const sy=(item.ty*TILE-camY)*scale+ch/2;
    ctx.save();
    ctx.scale(scale,scale);
    drawItem(item, sx/scale, sy/scale, gameTime);
    ctx.restore();
  }

  // Draw enemies
  for (const e of enemies) {
    if (e.dead) continue;
    if (fog[e.ty]?.[e.tx] && !e.moving) continue;
    const epx = e.moving ? e.px : e.tx*TILE;
    const epy = e.moving ? e.py : e.ty*TILE;
    const sx=(epx-camX)*scale+cw/2;
    const sy=(epy-camY)*scale+ch/2;
    drawEnemy(e,sx,sy);
  }

  // Draw player
  const psx=(player.px-camX)*scale+cw/2;
  const psy=(player.py-camY)*scale+ch/2;
  player.draw(psx, psy);

  // Particles
  drawParticles(camX, camY);

  // Minimap
  drawMinimap(camX, camY);

  requestAnimationFrame(loop);
}

// ---- MINIMAP --------------------------------------------------------
function drawMinimap(camX, camY) {
  const mm   = 3;   // px per tile
  const offX = cw - MAP_W*mm - 8;
  const offY = 8;
  const alpha= 0.7;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(offX-2, offY-2, MAP_W*mm+4, MAP_H*mm+4);

  for (let ty=0; ty<MAP_H; ty++) {
    for (let tx=0; tx<MAP_W; tx++) {
      if (!visited[ty][tx]) continue;
      const tile=gmap[ty][tx];
      const isFog=fog[ty][tx];
      let color='#2a2a3e';
      if (tile===T.WALL)   color='#111';
      else if (tile===T.FLOOR||tile===T.TRAP) color= isFog?'#333':'#4a4a6a';
      else if (tile===T.STAIRS) color='#4ade80';
      else if (tile===T.DOOR||tile===T.DOOR_OPEN) color='#8B4513';
      else if (tile===T.CHEST)  color='#f1c40f';
      else color='#4a4a6a';

      ctx.fillStyle=color;
      ctx.fillRect(offX+tx*mm, offY+ty*mm, mm,mm);
    }
  }

  // Enemies on minimap
  for (const e of enemies) {
    if (e.dead) continue;
    if (fog[e.ty]?.[e.tx]) continue;
    ctx.fillStyle=e.type==='boss'?'#e67e22':'#e74c3c';
    ctx.fillRect(offX+e.tx*mm, offY+e.ty*mm, mm+1,mm+1);
  }

  // Player dot
  ctx.fillStyle='#3498db';
  ctx.fillRect(offX+player.tx*mm-1, offY+player.ty*mm-1, mm+2,mm+2);

  ctx.restore();
}

// ---- PAUSE / GAMEOVER -----------------------------------------------
function pauseGame() {
  gameState = 'paused';
  showScreen('screen-pause');
}
function resumeGame() {
  gameState = 'playing';
  showScreen('screen-game');
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function showGameOver() {
  const score = player.score;
  const isRec = score > hiScore;
  if (isRec) { hiScore=score; localStorage.setItem('dungeon_hi',hiScore); }
  document.getElementById('go-floor').textContent = player.floor;
  document.getElementById('go-score').textContent = score;
  document.getElementById('go-kills').textContent = player.kills;
  document.getElementById('go-hi').textContent    = hiScore;
  document.getElementById('go-record').classList.toggle('hidden',!isRec);
  showScreen('screen-gameover');
}

function showWin() {
  document.getElementById('win-score').textContent = player.score;
  document.getElementById('win-kills').textContent = player.kills;
  const score=player.score;
  if (score>hiScore){ hiScore=score; localStorage.setItem('dungeon_hi',hiScore); }
  showScreen('screen-win');
}

// ---- SCREEN UTILS ---------------------------------------------------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id===id);
    s.style.display = s.id===id ? 'flex' : 'none';
  });
}

// ---- BUTTON BINDINGS ------------------------------------------------
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', ()=>{
  gameState='start'; showScreen('screen-start');
  document.getElementById('display-hi').textContent=hiScore;
});
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit').addEventListener('click', ()=>{
  gameState='start'; showScreen('screen-start');
  document.getElementById('display-hi').textContent=hiScore;
});
document.getElementById('btn-winmenu').addEventListener('click', ()=>{
  gameState='start'; showScreen('screen-start');
  document.getElementById('display-hi').textContent=hiScore;
});

// ---- INIT -----------------------------------------------------------
document.getElementById('display-hi').textContent = hiScore;
showScreen('screen-start');
document.querySelectorAll('.screen').forEach(s=>{
  if(!s.classList.contains('active')) s.style.display='none';
});
