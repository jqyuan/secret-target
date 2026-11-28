import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc as fDoc, collection as fCol, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot as fOn, getDocs, addDoc, query, orderBy as fOrderBy, limit as fLimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* Small wrapper so the game code talks to Firestore through doc()/collection() refs. */
function wrapDoc(s){ return { id:s.id, exists:s.exists(), data:() => s.data(), metadata:s.metadata }; }
function wrapQuery(qs){ return { docs:qs.docs.map(wrapDoc), size:qs.size, empty:qs.empty, metadata:qs.metadata }; }
function makeDB(fs){
  const docRef = path => {
    const r = fDoc(fs, path);
    return {
      id:r.id, path,
      get: async () => wrapDoc(await getDoc(r)),
      set: d => setDoc(r, d),
      update: d => updateDoc(r, d),
      delete: () => deleteDoc(r),
      onSnapshot: (next, err) => fOn(r, { includeMetadataChanges:true }, s => next(wrapDoc(s)), err)
    };
  };
  const q = (base, cons) => {
    const built = () => cons.length ? query(base, ...cons) : base;
    return {
      orderBy: (f, dir) => q(base, [...cons, fOrderBy(f, dir || "asc")]),
      limit: n => q(base, [...cons, fLimit(n)]),
      get: async () => wrapQuery(await getDocs(built())),
      onSnapshot: (next, err) => fOn(built(), s => next(wrapQuery(s)), err)
    };
  };
  const colRef = path => {
    const c = fCol(fs, path);
    return Object.assign(q(c, []), {
      path,
      doc: id => docRef(path + "/" + id),
      add: async d => { const r = await addDoc(c, d); return docRef(path + "/" + r.id); }
    });
  };
  return { doc:docRef, collection:colRef };
}

const DEFAULT_TASKS = [
  "Get them to sing the alphabet",
  "Get them to name a doppelganger",
  "Get them to stand back to back with you to compare height",
  "Get them to grab something off a shelf",
  "Get them to name all 5 senses",
  "Get them to show you a photo from their camera roll",
  "Get them to show you their wingspan",
  "Get them to take off or put on their shoes",
  "Get them to ask about the cost of an item in the house",
  "Get them to name all seven continents",
  "Get them to name all the planets in order",
  "Get them to say the months of the year backwards",
  "Get them to count to ten in another language",
  "Get them to name three U.S. presidents",
  "Get them to hum the Jeopardy theme",
  "Get them to tell you their shoe size",
  "Get them to tell you their middle name",
  "Get them to spell their last name out loud",
  "Get them to compare hand sizes with you",
  "Get them to touch their toes",
  "Get them to stand on one foot",
  "Get them to roll their tongue",
  "Get them to show you how they hold a pencil",
  "Get them to show you their phone's home screen",
  "Get them to tell you their screen time for today",
  "Get them to tell you what time they woke up today",
  "Get them to tell you what they ate for breakfast",
  "Get them to tell you the last song they listened to",
  "Get them to name a song from the year they were born",
  "Get them to read the ingredients on a food label",
  "Get them to explain how to tie a tie",
  "Get them to show you their best dance move",
  "Get them to name all the colors of the rainbow in order",
  "Get them to count backwards from 20",
  "Get them to name all seven dwarfs",
  "Get them to name five states that start with the letter M",
  "Get them to guess your age",
  "Get them to guess how many people are at the party",
  "Get them to tell you their battery percentage",
  "Get them to tell you what their phone is named",
  "Get them to show you their most recently used emoji",
  "Get them to tell you how many unread texts they have",
  "Get them to look up tomorrow's weather",
  "Get them to recommend a show for you to watch",
  "Get them to tell you the last movie they watched",
  "Get them to tell you the first concert they went to",
  "Get them to tell you their go-to karaoke song",
  "Get them to tell you their dream car",
  "Get them to say what three things they'd bring to a desert island",
  "Get them to rate the food at the party out of ten",
  "Get them to try a riddle you tell them",
  "Get them to thumb wrestle you",
  "Get them to snap with both hands",
  "Get them to try on something you're wearing"
];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const S = {
  db:null, me:null, ready:false, fatal:"",
  code:null, loaded:false, game:null, players:{}, feed:[],
  unsubs:[], slowTimer:null,
  ui:{ name:"", codeIn:"", err:"", busy:false, reveal:false, confirmKill:false, arm:null, tasksDraft:null, slow:false }
};

const store = {
  get(k){ try{ return localStorage.getItem(k); }catch{ return null; } },
  set(k,v){ try{ v==null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch{} }
};

function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)){
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nameOf = id => (S.players[id] && S.players[id].name) || "Someone";
const myP = () => S.players[S.me];
const isHost = () => S.game && S.game.hostId === S.me;
const pRef = id => S.db.doc(`games/${S.code}/players/${id}`);
const gRef = () => S.db.doc(`games/${S.code}`);
const alivePlayers = () => Object.values(S.players).filter(p => p.alive);
const ago = t => { const s = Math.max(0, Math.round((Date.now()-t)/1000)); if (s<60) return "just now"; const m=Math.round(s/60); if (m<60) return m+" min ago"; return Math.round(m/60)+" h ago"; };
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const cleanName = s => String(s||"").replace(/\s+/g," ").trim().slice(0,24);

const inviteLink = () => location.origin + location.pathname + "?code=" + S.code;
async function copyInvite(){
  try { await navigator.clipboard.writeText(inviteLink()); S.ui.copied = true; }
  catch { S.ui.err = "Couldn't copy. Press and hold the link above to copy it."; }
  render();
  setTimeout(() => { S.ui.copied = false; render(); }, 2500);
}
// Phones open the share sheet (Messages, WhatsApp, AirDrop…); other browsers copy the link.
async function shareInvite(){
  if (navigator.share){
    try { await navigator.share({ title:"Secret Target", text:`Join my Secret Target game. Code ${S.code}`, url:inviteLink() }); return; }
    catch(e){ if (e && e.name === "AbortError") return; }
  }
  copyInvite();
}

function errText(e){
  const c = e && e.code;
  if (c === "permission-denied") return "The game database refused this. Check the Firestore rules in README.md.";
  if (c === "resource-exhausted") return "The free Firebase limit was hit for today, or too many taps at once. Wait and try again.";
  if (c === "not-found") return "That player or game doesn't exist anymore.";
  return "Couldn't reach the game. Check your connection and try again.";
}

async function run(fn){
  if (S.ui.busy) return;
  S.ui.busy = true; S.ui.err = ""; render();
  try { await fn(); }
  catch(e){ console.error(e); S.ui.err = typeof e === "string" ? e : errText(e); }
  S.ui.busy = false; render();
}

/* ---------- subscriptions ---------- */
function unsubscribeAll(){ S.unsubs.forEach(u => { try{u();}catch{} }); S.unsubs = []; clearTimeout(S.slowTimer); }
function openGame(code){
  unsubscribeAll();
  S.code = code; S.loaded = false; S.game = null; S.players = {}; S.feed = [];
  S.ui.tasksDraft = null; S.ui.slow = false; S.ui.reveal = false; S.ui.confirmKill = false; S.ui.arm = null;
  store.set("pa.code", code);
  S.ui.invited = false;
  if (location.search) history.replaceState(null, "", location.pathname);
  if (!code){ render(); return; }
  S.slowTimer = setTimeout(() => { S.ui.slow = true; render(); }, 10000);
  const onErr = e => { console.error(e); S.ui.err = errText(e); S.loaded = true; render(); };
  S.unsubs.push(gRef().onSnapshot(snap => {
    S.game = snap.exists ? snap.data() : null;
    if (!snap.metadata.fromCache){ S.loaded = true; S.ui.slow = false; clearTimeout(S.slowTimer); }
    else if (snap.exists) S.loaded = true;
    render();
  }, onErr));
  S.unsubs.push(S.db.collection(`games/${code}/players`).onSnapshot(snap => {
    const m = {}; snap.docs.forEach(d => { m[d.id] = Object.assign({uid:d.id}, d.data()); });
    S.players = m; render();
  }, onErr));
  S.unsubs.push(S.db.collection(`games/${code}/feed`).orderBy("at","desc").limit(100).onSnapshot(snap => {
    S.feed = snap.docs.map(d => d.data()); render();
  }, onErr));
  render();
}

/* ---------- actions ---------- */
function newPlayer(name){ return { name, alive:true, kills:0, targetId:null, task:null, claim:null, joinedAt:Date.now() }; }

async function hostGame(){
  const name = cleanName(S.ui.name);
  if (!name) throw "Type your name first.";
  store.set("pa.name", name);
  let code = "";
  for (let tries=0; tries<5; tries++){
    code = Array.from({length:4}, () => CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join("");
    const g = await S.db.doc(`games/${code}`).get();
    if (!g.exists) break;
  }
  await S.db.doc(`games/${code}`).set({ hostId:S.me, status:"lobby", tasks:DEFAULT_TASKS, createdAt:Date.now() });
  await S.db.doc(`games/${code}/players/${S.me}`).set(newPlayer(name));
  openGame(code);
}

async function joinWithCode(){
  const name = cleanName(S.ui.name);
  const code = String(S.ui.codeIn||"").toUpperCase().replace(/[^A-Z]/g,"");
  if (!name) throw "Type your name first.";
  if (code.length !== 4) throw "Game codes are 4 letters.";
  store.set("pa.name", name);
  const g = await S.db.doc(`games/${code}`).get();
  if (!g.exists) throw `No game with code ${code}. Check it with the host.`;
  const p = await S.db.doc(`games/${code}/players/${S.me}`).get();
  if (!p.exists){
    if (g.data().status !== "lobby") throw "That game has already started. Ask the host to start a new one.";
    await S.db.doc(`games/${code}/players/${S.me}`).set(newPlayer(name));
  }
  openGame(code);
}

async function joinCurrent(){
  const name = cleanName(S.ui.name);
  if (!name) throw "Type your name first.";
  store.set("pa.name", name);
  await pRef(S.me).set(newPlayer(name));
}

async function leaveLobby(){
  if (S.game && S.game.status === "lobby" && myP() && !isHost()) await pRef(S.me).delete();
  openGame(null);
}

function parseTasks(txt){ return String(txt||"").split("\n").map(s => s.trim()).filter(Boolean).slice(0,200); }

async function saveTasks(){
  const tasks = parseTasks(S.ui.tasksDraft);
  if (!tasks.length) throw "Add at least one task.";
  await gRef().update({ tasks });
  S.ui.tasksDraft = null;
}

async function startGame(){
  const tasks = S.ui.tasksDraft != null ? parseTasks(S.ui.tasksDraft) : (S.game.tasks || []);
  if (!tasks.length) throw "Add at least one task.";
  const ids = shuffle(Object.keys(S.players));
  if (ids.length < 3) throw "You need at least 3 players to start.";
  // Everyone gets two different starting tasks to choose between.
  let pool = [];
  const draw = avoid => {
    if (!pool.length) pool = shuffle(tasks);
    let i = pool.findIndex(t => t !== avoid);
    if (i < 0){ pool = shuffle(tasks); i = Math.max(0, pool.findIndex(t => t !== avoid)); }
    return pool.splice(i, 1)[0];
  };
  const options = ids.map(() => { const a = draw(null); const b = draw(a); return a === b ? [a] : [a, b]; });
  const now = Date.now();
  await Promise.all(ids.map((id, i) => pRef(id).update({
    alive:true, kills:0, claim:null, killedBy:null, diedAt:null, removed:false,
    targetId: ids[(i+1) % ids.length], task: null, taskOptions: options[i], assignedAt: now, resetsLeft: 1
  })));
  await gRef().update({ status:"live", tasks, startedAt:now, endedAt:null, endReason:null });
  S.ui.tasksDraft = null;
}

async function claimKill(){
  const me = myP(); if (!me || !me.alive || !me.targetId) return;
  await pRef(me.targetId).update({ claim:{ by:S.me, at:Date.now() } });
  S.ui.confirmKill = false;
}
async function chooseTask(task){
  const me = myP(); if (!me || me.task || !(me.taskOptions||[]).includes(task)) return;
  await pRef(S.me).update({ task, taskOptions:null });
}
// One task reset per player for the whole night, on any contract.
const canReset = me => me && me.alive && me.task && (me.resetsLeft||0) > 0;
async function resetTask(){
  const me = myP(); if (!canReset(me)) return;
  const t = S.players[me.targetId];
  if (t && t.claim && t.claim.by === S.me) throw "Take back your claim before resetting your task.";
  const all = (S.game.tasks || []).filter(x => x !== me.task);
  if (!all.length) throw "There are no other tasks to switch to.";
  const inUse = new Set(alivePlayers().map(p => p.task));
  const fresh = all.filter(x => !inUse.has(x));
  const pool = fresh.length ? fresh : all;
  await pRef(S.me).update({ task: pool[Math.floor(Math.random()*pool.length)], resetsLeft: 0 });
}
// A player who never picked passes on one of their two options at random.
const taskOf = p => p.task || (p.taskOptions && p.taskOptions.length ? p.taskOptions[Math.floor(Math.random()*p.taskOptions.length)] : null);

async function cancelClaim(){
  const me = myP(); if (!me || !me.targetId) return;
  const t = S.players[me.targetId];
  if (t && t.claim && t.claim.by === S.me) await pRef(me.targetId).update({ claim:null });
}

// Victim (or host on their behalf) confirms: victim is out, killer inherits victim's target and task.
async function confirmDeath(victimId){
  const v = S.players[victimId]; if (!v || !v.alive || !v.claim) return;
  const kId = v.claim.by, k = S.players[kId];
  if (!k || !k.alive || k.targetId !== victimId){ await pRef(victimId).update({ claim:null }); return; }
  const usedTask = k.task, now = Date.now();
  const last = v.targetId === kId;
  await pRef(kId).update({ targetId: last ? null : v.targetId, task: last ? null : taskOf(v), taskOptions:null, kills:(k.kills||0)+1, assignedAt:now });
  await pRef(victimId).update({ alive:false, claim:null, killedBy:kId, killTask:usedTask, diedAt:now, targetId:null, task:null });
  await S.db.collection(`games/${S.code}/feed`).add({ killer:kId, victim:victimId, task:usedTask||"", at:now });
  if (last) await gRef().update({ status:"ended", endedAt:now, endReason:"last" });
}
async function denyDeath(){ await pRef(S.me).update({ claim:null }); }

// Host removes a player who left: their hunter inherits their target and task, no kill credit.
async function removePlayer(id){
  const v = S.players[id]; if (!v || !v.alive) return;
  const hunter = alivePlayers().find(p => p.targetId === id && p.uid !== id);
  const now = Date.now();
  const remaining = alivePlayers().length - 1;
  if (hunter){
    const self = v.targetId === hunter.uid;
    await pRef(hunter.uid).update({ targetId: self ? null : v.targetId, task: self ? null : taskOf(v), taskOptions:null, assignedAt:now });
  }
  await pRef(id).update({ alive:false, removed:true, claim:null, diedAt:now, targetId:null, task:null });
  await S.db.collection(`games/${S.code}/feed`).add({ victim:id, removed:true, at:now });
  if (remaining <= 1) await gRef().update({ status:"ended", endedAt:now, endReason:"last" });
}

async function endGame(){ await gRef().update({ status:"ended", endedAt:Date.now(), endReason:"host" }); }

async function playAgain(){
  const fs = await S.db.collection(`games/${S.code}/feed`).get();
  for (const d of fs.docs) await S.db.doc(`games/${S.code}/feed/${d.id}`).delete();
  await Promise.all(Object.keys(S.players).map(id => pRef(id).update({
    alive:true, kills:0, claim:null, killedBy:null, killTask:null, diedAt:null, removed:false, targetId:null, task:null, taskOptions:null
  })));
  await gRef().update({ status:"lobby", startedAt:null, endedAt:null, endReason:null });
}

/* ---------- view pieces ---------- */
function armed(key, label, fn, cls){
  if (S.ui.arm === key){
    return h("div", {class:"row"},
      h("button", {class:"btn sm danger", disabled:S.ui.busy, onclick:() => { S.ui.arm = null; run(fn); }}, "Yes, " + label.toLowerCase()),
      h("button", {class:"btn sm ghost", onclick:() => { S.ui.arm = null; render(); }}, "Cancel"));
  }
  return h("button", {class:"btn sm " + (cls||""), onclick:() => { S.ui.arm = key; render(); }}, label);
}

function topBar(){
  return h("div", {class:"top"},
    h("div", {class:"brand"}, "Secret ", h("span", null, "Target")),
    S.code ? h("div", {class:"chip", "aria-label":"Game code"}, S.code) : null);
}
const errBox = () => S.ui.err ? h("div", {class:"err", role:"alert"}, S.ui.err) : null;

// While the game is live, who tagged whom (and tag counts) stay secret. Everything is revealed at the end.
const revealed = () => S.game && S.game.status === "ended";

function leaderboard(){
  const open = revealed();
  const ps = Object.values(S.players).sort(open
    ? (a,b) => (b.kills||0)-(a.kills||0) || (b.alive?1:0)-(a.alive?1:0) || a.name.localeCompare(b.name)
    : (a,b) => (b.alive?1:0)-(a.alive?1:0) || a.name.localeCompare(b.name));
  return h("div", {class:"panel"},
    h("div", {class:"label"}, open ? "Final leaderboard" : "Players"),
    open ? null : h("div", {class:"muted small"}, "Tag counts stay secret until the game ends."),
    h("ul", {class:"players"}, ps.map((p,i) =>
      h("li", {class:(p.uid===S.me?"me ":"") + (p.alive?"":"dead")},
        open ? h("span", {class:"rank"}, i+1) : null,
        h("span", {class:"nm"}, p.name, p.uid===S.me ? h("span", {class:"muted small"}, " (you)") : null),
        h("span", {class:"tag " + (p.alive?"alive":"out")}, p.alive ? "Alive" : (p.removed ? "Left" : "Out")),
        open ? h("span", {class:"kills", title:"Tags"}, (p.kills||0) + " tagged") : null))));
}

function feedPanel(){
  if (!S.feed.length) return null;
  const open = revealed();
  return h("div", {class:"panel"},
    h("div", {class:"label"}, open ? "How it went down" : "Activity"),
    h("ul", {class:"feed"}, S.feed.map(f => f.removed
      ? h("li", {class:"rm"}, h("div", null, nameOf(f.victim), " left the game"), h("div", {class:"when"}, ago(f.at)))
      : open
        ? h("li", null,
            h("div", null, h("b", null, nameOf(f.killer)), " eliminated ", h("b", null, nameOf(f.victim))),
            f.task ? h("div", {class:"muted small"}, f.task) : null,
            h("div", {class:"when"}, ago(f.at)))
        : h("li", null,
            h("div", null, h("b", null, nameOf(f.victim)), " was eliminated"),
            h("div", {class:"when"}, ago(f.at))))));
}

function hostPanel(){
  if (!isHost()) return null;
  const alive = alivePlayers().sort((a,b) => a.name.localeCompare(b.name));
  return h("details", {class:"panel host", open:!!S.ui.hostOpen, ontoggle:e => { S.ui.hostOpen = e.target.open; }},
    h("summary", null, "Host controls"),
    h("p", {class:"muted small", style:"margin:0"}, "Confirm a tag for someone whose phone died, or remove a player who went home. Whoever was after them takes over their target and task."),
    h("ul", {class:"players"}, alive.map(p =>
      h("li", null,
        h("span", {class:"nm"}, p.name),
        p.claim ? armed("force:"+p.uid, "Confirm tag", () => confirmDeath(p.uid), "primary") : null,
        armed("rm:"+p.uid, "Remove", () => removePlayer(p.uid))))),
    S.ui.arm === "end"
      ? h("div", {class:"stack"}, h("div", {class:"small"}, "End the game for everyone and show final results?"),
          h("div", {class:"row"},
            h("button", {class:"btn danger", onclick:() => { S.ui.arm=null; run(endGame); }}, "End game now"),
            h("button", {class:"btn ghost", onclick:() => { S.ui.arm=null; render(); }}, "Keep playing")))
      : h("button", {class:"btn", onclick:() => { S.ui.arm="end"; render(); }}, "End the game"));
}

/* ---------- screens ---------- */
function inviteView(){
  return [topBar(),
    h("div", {class:"panel", style:"text-align:center"},
      h("div", {class:"label"}, "You're invited to game"),
      h("div", {class:"bigcode"}, S.ui.codeIn),
      h("div", {class:"muted small"}, "Everyone gets a secret target and a task. Get them to do it without them catching on.")),
    h("div", {class:"panel"},
      h("label", {class:"label", for:"name-in"}, "Your name"),
      h("input", {id:"name-in", type:"text", autocomplete:"nickname", maxlength:"24", placeholder:"What people call you", value:S.ui.name,
        oninput:e => { S.ui.name = e.target.value; }, onkeydown:e => { if (e.key==="Enter") run(joinWithCode); }}),
      h("button", {class:"btn big primary", disabled:S.ui.busy, onclick:() => run(joinWithCode)}, "Join game"),
      errBox()),
    h("button", {class:"btn ghost", onclick:() => { S.ui.invited = false; S.ui.codeIn = ""; history.replaceState(null, "", location.pathname); render(); }}, "Host my own game instead")];
}

function homeView(){
  if (S.ui.invited) return inviteView();
  return [topBar(),
    h("div", {class:"panel"},
      h("h2", {style:"font-family:var(--f-display);font-size:34px;text-transform:uppercase;line-height:1"}, "Everyone gets a target. Everyone is one."),
      h("ol", {class:"howto"},
        h("li", null, "Each player gets a secret target and a task."),
        h("li", null, "Get your target to do the task without them catching on."),
        h("li", null, "Claim it. They confirm on their phone."),
        h("li", null, "You take over their target and task. Most tags wins."))),
    h("div", {class:"panel"},
      h("label", {class:"label", for:"name-in"}, "Your name"),
      h("input", {id:"name-in", type:"text", autocomplete:"nickname", maxlength:"24", placeholder:"What people call you", value:S.ui.name,
        oninput:e => { S.ui.name = e.target.value; }}),
      h("button", {class:"btn primary", disabled:S.ui.busy, onclick:() => run(hostGame)}, "Host a new game"),
      h("div", {class:"divider"}, "or join one"),
      h("div", {class:"row"},
        h("input", {id:"code-in", class:"code", type:"text", maxlength:"4", autocomplete:"off", autocapitalize:"characters", placeholder:"CODE", "aria-label":"Game code", value:S.ui.codeIn,
          oninput:e => { S.ui.codeIn = e.target.value; }, onkeydown:e => { if (e.key==="Enter") run(joinWithCode); }}),
        h("button", {class:"btn", disabled:S.ui.busy, onclick:() => run(joinWithCode)}, "Join")),
      errBox())];
}

function lobbyView(){
  const g = S.game, me = myP(), host = isHost();
  const ps = Object.values(S.players).sort((a,b) => (a.joinedAt||0)-(b.joinedAt||0));
  const draft = S.ui.tasksDraft != null ? S.ui.tasksDraft : (g.tasks||[]).join("\n");
  const taskCount = parseTasks(draft).length;
  return [topBar(),
    h("div", {class:"panel", style:"text-align:center"},
      h("div", {class:"label"}, "Game code"),
      h("div", {class:"bigcode"}, S.code),
      h("div", {class:"muted small"}, "Send friends the game link. It opens straight into this game."),
      h("div", {class:"invite-link"}, inviteLink()),
      h("div", {class:"row"},
        h("button", {class:"btn primary", onclick:shareInvite}, "Share game link"),
        h("button", {class:"btn", onclick:copyInvite}, S.ui.copied ? "Copied" : "Copy link"))),
    !me ? h("div", {class:"panel"},
      h("label", {class:"label", for:"name-in"}, "Your name"),
      h("input", {id:"name-in", type:"text", maxlength:"24", value:S.ui.name, oninput:e => { S.ui.name = e.target.value; }}),
      h("button", {class:"btn primary", disabled:S.ui.busy, onclick:() => run(joinCurrent)}, "Join this game"), errBox()) : null,
    h("div", {class:"panel"},
      h("div", {class:"label"}, `Players · ${ps.length}`),
      ps.length ? h("ul", {class:"players"}, ps.map(p =>
        h("li", {class:p.uid===S.me?"me":""},
          h("span", {class:"nm"}, p.name, p.uid===S.me ? h("span", {class:"muted small"}, " (you)") : null),
          p.uid === g.hostId ? h("span", {class:"tag host"}, "Host") : null,
          host && p.uid !== S.me ? armed("kick:"+p.uid, "Kick", () => pRef(p.uid).delete()) : null)))
        : h("div", {class:"muted"}, "No one yet.")),
    host ? h("div", {class:"panel"},
      h("label", {class:"label", for:"tasks-in"}, `Tasks · ${taskCount} · one per line`),
      h("textarea", {id:"tasks-in", value:draft, oninput:e => { S.ui.tasksDraft = e.target.value; }}),
      S.ui.tasksDraft != null ? h("button", {class:"btn sm", disabled:S.ui.busy, onclick:() => run(saveTasks)}, "Save tasks") : null,
      h("button", {class:"btn big primary", disabled:S.ui.busy || ps.length < 3, onclick:() => run(startGame)}, "Start the game"),
      ps.length < 3 ? h("div", {class:"muted small"}, "Waiting for at least 3 players.") : null,
      errBox())
    : me ? h("div", {class:"panel"},
      h("div", null, "Waiting for ", h("b", null, nameOf(g.hostId)), " to start the game."),
      h("div", {class:"muted small"}, `${(g.tasks||[]).length} tasks in the pool. Your target and task will appear here when it starts.`),
      errBox()) : null,
    h("button", {class:"btn ghost", onclick:() => run(leaveLobby)}, host ? "Back to start" : "Leave game")];
}

function dossier(me){
  const t = S.players[me.targetId];
  if (!t) return h("div", {class:"dossier"}, h("div", {class:"head"}, h("span", null, "Contract"), h("span", null, "—")), h("div", null, "No target right now."));
  const pending = t.claim && t.claim.by === S.me;
  const hidden = !S.ui.reveal && !pending;
  const fresh = me.assignedAt && Date.now() - me.assignedAt < 20000 && (me.kills||0) > 0;
  if (!me.task && (me.taskOptions||[]).length) return h("div", {class:"dossier"},
    h("div", {class:"head"}, h("span", null, "Your contract"), h("span", null, "Pick a task")),
    h("div", {class:"stack", style:"gap:4px"}, h("div", {class:"k"}, "Target"), h("div", {class:"target" + (S.ui.reveal?"":" hidden-txt")}, S.ui.reveal ? t.name : "XXXXXX")),
    S.ui.reveal
      ? h("div", {class:"stack"},
          h("div", {class:"k"}, "Choose your task. You can't change it later."),
          me.taskOptions.map(opt => h("button", {class:"btn task-option", disabled:S.ui.busy, onclick:() => run(() => chooseTask(opt))}, opt)),
          h("button", {class:"btn sm", onclick:() => { S.ui.reveal=false; render(); }}, "Hide"))
      : h("div", {class:"stack"},
          h("div", null, "Tap Show to see your target and pick one of two tasks."),
          h("button", {class:"btn primary", onclick:() => { S.ui.reveal=true; render(); }}, "Show")));
  return h("div", {class:"dossier"},
    h("div", {class:"head"}, h("span", null, "Your contract"), h("span", null, "No. " + String((me.kills||0)+1).padStart(3,"0"))),
    fresh ? h("div", {class:"banner", style:"background:var(--paper-ink);color:var(--paper)"}, "New contract. You inherited this target and task.") : null,
    h("div", {class:"stack", style:"gap:4px"}, h("div", {class:"k"}, "Target"), h("div", {class:"target" + (hidden?" hidden-txt":"")}, hidden ? "XXXXXX" : t.name)),
    h("div", {class:"stack", style:"gap:4px"}, h("div", {class:"k"}, "Task"), h("div", {class:"task" + (hidden?" hidden-txt":"")}, hidden ? "Hidden until you tap show" : me.task)),
    pending
      ? h("div", {class:"stack"},
          h("div", null, "Waiting for ", h("b", null, t.name), " to confirm on their phone…"),
          h("button", {class:"btn sm", disabled:S.ui.busy, onclick:() => run(cancelClaim)}, "Take back the claim"))
      : S.ui.confirmKill
        ? h("div", {class:"stack"},
            h("div", null, "Did ", h("b", null, t.name), " just do it?"),
            h("div", {class:"row"},
              h("button", {class:"btn primary", disabled:S.ui.busy, onclick:() => run(claimKill)}, "Yes, claim it"),
              h("button", {class:"btn", onclick:() => { S.ui.confirmKill=false; render(); }}, "Not yet")))
        : h("div", {class:"stack"},
            h("div", {class:"row"},
              h("button", {class:"btn", onclick:() => { S.ui.reveal = !S.ui.reveal; render(); }}, S.ui.reveal ? "Hide" : "Show"),
              h("button", {class:"btn primary", onclick:() => { S.ui.confirmKill=true; S.ui.reveal=true; render(); }}, "Mission complete")),
            canReset(me) ? (S.ui.arm === "reset"
              ? h("div", {class:"stack"},
                  h("div", {class:"small"}, "Get a random new task for this target? You only get one reset all night."),
                  h("div", {class:"row"},
                    h("button", {class:"btn primary", disabled:S.ui.busy, onclick:() => { S.ui.arm=null; run(resetTask); }}, "Reset my task"),
                    h("button", {class:"btn", onclick:() => { S.ui.arm=null; render(); }}, "Keep this one")))
              : h("button", {class:"btn sm", onclick:() => { S.ui.arm="reset"; S.ui.reveal=true; render(); }}, "Reset task (1 left tonight)"))
              : h("div", {class:"small", style:"opacity:.7"}, "Task reset used.")));
}

function deadCard(me){
  return h("div", {class:"dossier"},
    h("div", {class:"head"}, h("span", null, "Your file"), h("span", null, "Closed")),
    h("div", {class:"stamp"}, me.removed ? "Left" : "Eliminated"),
    h("div", {class:"target", style:"padding-right:120px"}, me.name),
    me.removed ? h("div", null, "You're out of this round.")
      : h("div", {class:"task"}, "Eliminated by ", h("b", null, nameOf(me.killedBy)), me.killTask ? [" with: ", h("i", null, me.killTask)] : null),
    h("div", {class:"small"}, `You finished with ${me.kills||0} tag${(me.kills||0)===1?"":"s"}. Keep watching the board.`));
}

function claimOverlay(me){
  return h("div", {class:"overlay", role:"dialog", "aria-modal":"true", "aria-labelledby":"ov-t"},
    h("div", {class:"card"},
      h("h2", {id:"ov-t"}, "You've been caught"),
      h("div", null, h("b", null, nameOf(me.claim.by)), " says they got you with this task:"),
      h("div", {class:"quote"}, (S.players[me.claim.by] && S.players[me.claim.by].task) || "their task"),
      h("div", {class:"muted small"}, "Confirming means you’re eliminated. They take over your target and your task."),
      h("button", {class:"btn danger big", disabled:S.ui.busy, onclick:() => run(() => confirmDeath(S.me))}, "Yes, they got me"),
      h("button", {class:"btn", disabled:S.ui.busy, onclick:() => run(denyDeath)}, "No, that didn't happen"),
      errBox()));
}

function liveView(){
  const me = myP(), alive = alivePlayers().length, total = Object.keys(S.players).length;
  return [topBar(),
    !me ? h("div", {class:"panel"}, h("div", null, "This game started without you. You can watch the board."),
      h("button", {class:"btn", onclick:() => openGame(null)}, "Back to start")) : null,
    me ? (me.alive ? dossier(me) : deadCard(me)) : null,
    errBox(),
    h("div", {class:"stats"},
      h("div", {class:"stat"}, h("b", null, me ? (me.kills||0) : "–"), h("span", null, "Your tags")),
      h("div", {class:"stat"}, h("b", null, alive), h("span", null, "Alive")),
      h("div", {class:"stat"}, h("b", null, total - alive), h("span", null, "Out"))),
    leaderboard(), feedPanel(), hostPanel(),
    me && me.alive && me.claim ? claimOverlay(me) : null];
}

function endedView(){
  const ps = Object.values(S.players);
  const top = Math.max(0, ...ps.map(p => p.kills||0));
  const winners = ps.filter(p => (p.kills||0) === top && top > 0);
  const lastAlive = alivePlayers();
  return [topBar(),
    h("div", {class:"panel winner"},
      h("div", {class:"label"}, winners.length > 1 ? "Tied for most tags" : "Most tags"),
      winners.length ? winners.map(w => h("div", {class:"nm"}, w.name)) : h("div", {class:"nm"}, "Nobody"),
      h("div", {class:"muted"}, top ? `${top} tag${top===1?"":"s"}` : "No tags this round"),
      S.game.endReason === "last" && lastAlive.length === 1 ? h("div", {class:"small"}, "Last one standing: ", h("b", null, lastAlive[0].name)) : null),
    leaderboard(), feedPanel(),
    isHost() ? h("button", {class:"btn primary", disabled:S.ui.busy, onclick:() => run(playAgain)}, "Play again with the same players") : null,
    errBox(),
    h("button", {class:"btn ghost", onclick:() => openGame(null)}, "Back to start")];
}

function view(){
  if (S.fatal) return [topBar(), h("div", {class:"panel"}, S.fatal)];
  if (!S.ready) return [topBar(), h("div", {class:"panel muted"}, "Connecting…")];
  if (!S.code) return homeView();
  if (!S.loaded) return [topBar(), h("div", {class:"panel muted"}, S.ui.slow ? "Can't reach the game yet. Check your connection." : `Loading game ${S.code}…`)];
  if (!S.game) return [topBar(), h("div", {class:"panel"}, `Game ${S.code} doesn't exist anymore.`, h("button", {class:"btn", onclick:() => openGame(null)}, "Back to start"))];
  if (S.game.status === "lobby") return lobbyView();
  if (S.game.status === "live") return liveView();
  return endedView();
}

function render(){
  const app = document.getElementById("app");
  const act = document.activeElement, fid = act && act.id;
  let sel = null; try { if (fid && act.setSelectionRange) sel = [act.selectionStart, act.selectionEnd]; } catch {}
  app.replaceChildren(...[view()].flat(Infinity).filter(Boolean));
  if (fid){ const el = document.getElementById(fid); if (el && el !== document.activeElement){ el.focus({preventScroll:true}); if (sel) try{ el.setSelectionRange(sel[0], sel[1]); }catch{} } }
}

// refresh "x min ago" and the new-contract banner
setInterval(() => { if (S.code && S.game && S.game.status === "live" && !document.activeElement?.id) render(); }, 15000);

async function boot(){
  S.ui.name = store.get("pa.name") || "";
  render();
  if (!firebaseConfig || !firebaseConfig.projectId || String(firebaseConfig.apiKey).startsWith("PASTE")){
    S.fatal = "Setup needed: paste your Firebase config into firebase-config.js (see README.md)."; render(); return;
  }
  let db;
  try { db = makeDB(getFirestore(initializeApp(firebaseConfig))); }
  catch(e){ console.error(e); S.fatal = "Couldn't start Firebase. Check the values in firebase-config.js."; render(); return; }
  // Each phone gets a random player id that it remembers.
  let id = store.get("st.uid");
  if (!id){
    id = "p" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2,"0")).join("");
    store.set("st.uid", id);
  }
  S.db = db; S.me = id; S.ready = true;
  const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z]/g,"").slice(0,4);
  const saved = store.get("pa.code");
  if (urlCode && urlCode !== saved){ S.ui.codeIn = urlCode; S.ui.invited = true; render(); return; }
  if (saved) openGame(saved); else render();
}
boot();
