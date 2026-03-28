// Beer Olympics Enhanced
// Requires beer-olympics-data.js

const games = [
  { name: "Beer Ball", icon: "assets/images/bo2.jpg", desc: "Teams throw ping pong balls at beer cans. If you hit, drink until the ball is returned. First team to finish wins." },
  { name: "Musical Flip Cup", icon: "assets/images/bo3.jpg", desc: "Like musical chairs, but with flip cup. When music stops, last to flip is out." },
  { name: "Fuck Yeah", icon: "assets/images/bo4.jpg", desc: "Players take turns saying 'fuck yeah' in a circle. If you mess up, drink. Last standing wins." },
  { name: "Beer Darts", icon: "assets/images/bo5.jpeg", desc: "Throw darts at beer cans. If you puncture a can, the owner drinks. Points for accuracy." },
  { name: "Stack Cup", icon: "assets/images/bo6.jpg", desc: "Bounce a ball into a cup, then stack it. Last player with unstacked cup loses." }
];


let players = loadScores();
let teams = loadTeams();
let currentGameIndex = 0;
let playerName = loadPlayer();
let chatMessages = loadChat();

// migrate players to include optIn array if missing
players = players.map(p => {
  if (!Array.isArray(p.optIn) || p.optIn.length !== games.length) {
    p.optIn = Array(games.length).fill(true);
  }
  if (!Array.isArray(p.scores) || p.scores.length !== games.length) {
    p.scores = Array(games.length).fill(0);
  }
  return p;
});
saveScores(players);

function handleNameInput(e) {
  e.preventDefault();
  const name = (document.getElementById('beerPlayerNameFooter') && document.getElementById('beerPlayerNameFooter').value || '').trim();
  if (!name) return;
  playerName = name;
  savePlayer(name);
  if (!players.some(p => p.name === name)) {
    players.push({ name, scores: Array(games.length).fill(0), optIn: Array(games.length).fill(true) });
    saveScores(players);
  }
  renderMain();
}

function renderMain() {
  document.getElementById('beerMain').innerHTML = `
    <div style="display:flex;gap:40px;justify-content:center;align-items:flex-start;">
      <section class="beer-section" id="beer-current-game" style="flex:1 1 0;min-width:320px;">
        <h2>Current Game</h2>
        <div style="margin-bottom:10px;">
          <select id="currentGameSelect" style="font-size:1.1rem;padding:6px 12px;border-radius:8px;">
            ${games.map((g,i)=>`<option value="${i}" ${i===currentGameIndex?'selected':''}>${g.name}</option>`).join('')}
          </select>
        </div>
        <div class="beer-game" id="currentGameDisplay">
          <div style="text-align:center; width:100%">
            <img id="currentGameIcon" src="${games[currentGameIndex].icon}" alt="Game Icon">
            <div class="beer-game-title" id="currentGameName">${games[currentGameIndex].name}</div>
          </div>
        </div>
        <div style="color:#fbbf24;margin:10px 0 18px;">${games[currentGameIndex].desc}</div>
        <div id="teamGenSection">
          <input type="number" id="numTeams" min="2" max="10" placeholder="# of teams" style="width:90px;"> 
          <button class="beer-next-btn" id="genTeamsBtn">Generate Teams</button>
        </div>
        <div id="teamsDisplay"></div>
        <div style="margin-top:18px;">
          <input type="text" id="winnersInput" placeholder="Winners (comma separated names or team #s)" style="width:220px;">
          <button class="beer-next-btn" id="addPointsBtn">Add Points</button>
        </div>
      </section>
      <section class="beer-section" id="beer-leaderboard" style="flex:1 1 0;min-width:320px;position:relative;">
        <h2>Leaderboard</h2>
        <div class="beer-leaderboard" id="leaderboardGraph"></div>
        <div id="chatSection" style="margin-top:18px;">
          <h3 style="color:#fbbf24;margin-bottom:8px;">Chat</h3>
          <div id="chatList" style="max-height:260px;overflow:auto;background:#17171a;padding:8px;border-radius:8px;margin-bottom:8px;"></div>
          <form id="chatForm" style="display:flex;gap:8px;">
            <input id="chatInput" placeholder="Say something..." style="flex:1;padding:8px;border-radius:8px;border:1px solid #fbbf24;background:#18181b;color:#fbbf24;">
            <button class="beer-next-btn" id="chatSendBtn" type="submit">Send</button>
          </form>
        </div>
      </section>
    </div>
  `;
  document.getElementById('currentGameSelect').addEventListener('change', function(e) {
    currentGameIndex = Number(e.target.value);
    renderMain();
  });
  // render opt-in list
  const optEl = document.createElement('div');
  optEl.id = 'optInList';
  optEl.style.margin = '12px 0 6px';
  const currentSection = document.getElementById('beer-current-game');
  if (currentSection) currentSection.insertBefore(optEl, document.getElementById('teamGenSection'));
  renderOptInList();
  document.getElementById('genTeamsBtn').addEventListener('click', function(e) {
    e.preventDefault();
    const n = Number(document.getElementById('numTeams').value);
    if (n < 2 || n > 10) return alert('Enter 2-10 teams.');
    const activeNames = players.filter(p => p.optIn[currentGameIndex]).map(p=>p.name);
    if (activeNames.length < n) return alert('Not enough active players for that many teams.');
    teams = randomTeams(activeNames, n);
    saveTeams(teams);
    renderTeams();
  });
  renderTeams();
  document.getElementById('addPointsBtn').addEventListener('click', function(e) {
    e.preventDefault();
    const winners = document.getElementById('winnersInput').value.split(',').map(s=>s.trim()).filter(Boolean);
    if (!winners.length) return;
    let pts = 5; // Default points per win
    if (teams.length && winners[0].match(/^\d+$/)) {
      // Team numbers
      winners.forEach(tn => {
        const team = teams[Number(tn)-1];
        if (team) team.forEach(name => addPoints(name, currentGameIndex, pts));
      });
    } else {
      winners.forEach(name => addPoints(name, currentGameIndex, pts));
    }
    saveScores(players);
    renderMain();
  });
  // Attach handler to footer sign-in form (optional)
  const footerForm = document.getElementById('beerSignInFooter');
  const footerInput = document.getElementById('beerPlayerNameFooter');
  if (footerInput && playerName) footerInput.value = playerName;
  if (footerForm) footerForm.addEventListener('submit', function(e){
    e.preventDefault();
    const name = (footerInput && footerInput.value || '').trim();
    if (!name) return;
    playerName = name;
    savePlayer(name);
    if (!players.some(p => p.name === name)) {
      players.push({ name, scores: Array(games.length).fill(0), optIn: Array(games.length).fill(true) });
      saveScores(players);
    }
    renderMain();
  });
  renderLeaderboard();
  // chat wiring
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  if (chatForm) {
    chatForm.addEventListener('submit', function(e){
      e.preventDefault();
      const text = (chatInput && chatInput.value || '').trim();
      if (!text) return;
      if (!playerName) return alert('Please sign in to post messages.');
      addChatMessage(playerName, text);
      chatInput.value = '';
      renderChat();
    });
  }
  renderChat();
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

function renderChat() {
  const el = document.getElementById('chatList');
  if (!el) return;
  const messages = loadChat().slice(-200);
  if (!messages.length) { el.innerHTML = '<div style="color:#fbbf24;">No messages yet.</div>'; return; }
  let html = '';
  messages.slice().reverse().forEach(m => {
    const liked = playerName && (m.likedBy || []).includes(playerName);
    html += `<div style="padding:8px;border-bottom:1px dashed #2b2b2f;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="color:#fbbf24;font-weight:bold;">${m.author}</div>
        <div style="color:#9ca3af;font-size:0.85rem;">${formatTime(m.ts)}</div>
      </div>
      <div style="margin-top:6px;color:#e5e7eb;">${escapeHtml(m.text)}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
        <button data-like="${m.id}" class="chat-like-btn" style="background:${liked? '#f59e0b':'#32343a'};color:#fff;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;">❤ ${m.likes||0}</button>
      </div>
    </div>`;
  });
  el.innerHTML = html;
  Array.from(el.querySelectorAll('.chat-like-btn')).forEach(btn => {
    btn.addEventListener('click', function(){
      if (!playerName) return alert('Sign in to like messages.');
      const id = this.getAttribute('data-like');
      toggleLikeMessage(id, playerName);
      renderChat();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderOptInList() {
  const el = document.getElementById('optInList');
  if (!el) return;
  if (!players.length) { el.innerHTML = '<div style="color:#fbbf24;">No players yet.</div>'; return; }
  let html = '<div style="display:flex;flex-direction:column;gap:6px;">';
  players.forEach(p => {
    const checked = p.optIn && p.optIn[currentGameIndex] ? 'checked' : '';
    const disabled = (playerName && (playerName === p.name || String(playerName).toLowerCase() === 'samson')) ? '' : 'disabled';
    const note = (p.optIn && p.optIn[currentGameIndex]) ? '' : ' <span style="color:#f87171;">(sitting out)</span>';
    html += `<label style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" data-player="${p.name}" ${checked} ${disabled}>
      <span style="color:#fbbf24;width:160px;">${p.name}</span>
      <span style="color:#e5e7eb;">${note}</span>
    </label>`;
  });
  html += '</div>';
  el.innerHTML = html;
  Array.from(el.querySelectorAll('input[type=checkbox]')).forEach(cb => {
    cb.addEventListener('change', function(){
      const name = this.getAttribute('data-player');
      const p = players.find(x=>x.name===name);
      if (!p) return;
      p.optIn[currentGameIndex] = !!this.checked;
      saveScores(players);
      renderTeams();
      renderLeaderboard();
      renderOptInList();
    });
  });
}

function renderTeams() {
  const el = document.getElementById('teamsDisplay');
  if (!el) return;
  if (!teams.length) { el.innerHTML = ''; return; }
  let html = '<div style="margin:10px 0 0 0;">';
  teams.forEach((team, i) => {
    html += `<div style="margin-bottom:6px;"><b>Team ${i+1}:</b> ${team.join(', ')}</div>`;
  });
  html += '</div>';
  el.innerHTML = html;
  // wire up remove buttons
  Array.from(el.querySelectorAll('.remove-player-btn')).forEach(btn => {
    btn.addEventListener('click', function() {
      const name = this.getAttribute('data-remove');
      removePlayer(name);
    });
  });
}

function addPoints(name, gameIdx, pts) {
  const p = players.find(p => p.name === name);
  if (p) {
    if (Array.isArray(p.optIn) && p.optIn[gameIdx] === false) return; // skip if opted out
    p.scores[gameIdx] = (p.scores[gameIdx]||0) + pts;
  }
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboardGraph');
  if (!el) return;
  if (!players.length) {
    el.innerHTML = '<div style="color:#fbbf24;">No players yet. Sign in to join!</div>';
    return;
  }
  // Sort by total points
  const sorted = [...players].sort((a,b)=>b.scores.reduce((x,y)=>x+y,0)-a.scores.reduce((x,y)=>x+y,0));
  const max = Math.max(...sorted.map(p=>p.scores.reduce((a,b)=>a+b,0)), 1);
  let html = '<div style="width:100%;max-width:420px;margin:0 auto;">';
  sorted.forEach((p,i) => {
    const total = p.scores.reduce((a,b)=>a+b,0);
    const optedOut = Array.isArray(p.optIn) && p.optIn[currentGameIndex] === false;
    html += `<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;opacity:${optedOut?0.45:1};">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:110px;display:inline-block;">${p.name}${optedOut? ' <span style=\"color:#f87171;\">(sitting out)</span>':''}</span>
        <div style="background:#fbbf24;height:28px;border-radius:8px;width:${Math.round(220*total/max)}px;min-width:14px;display:inline-block;"></div>
        <span style="margin-left:10px;">${total}</span>
      </div>
      ${ (playerName && String(playerName).toLowerCase() === 'samson') ? `<button data-remove="${p.name}" class="remove-player-btn" style="background:#ef4444;color:#fff;border:none;padding:6px 8px;border-radius:6px;">Remove</button>` : '' }
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

function randomTeams(names, numTeams) {
  const shuffled = [...names].sort(()=>Math.random()-0.5);
  const teams = Array.from({length:numTeams},()=>[]);
  shuffled.forEach((name,i)=>{
    teams[i%numTeams].push(name);
  });
  return teams;
}

function removePlayer(name) {
  if (!playerName || String(playerName).toLowerCase() !== 'samson') return;
  if (!window.confirm('Remove player ' + name + ' from tournament?')) return;
  players = players.filter(p => p.name !== name);
  saveScores(players);
  renderMain();
}

// Rules dropdown
const rulesBtn = document.getElementById('beerRulesBtn');
const rulesList = document.getElementById('beerRulesList');
if (rulesBtn && rulesList) {
  rulesBtn.addEventListener('click',()=>{
    rulesList.classList.toggle('active');
  });
}


// Initial render
renderMain();
