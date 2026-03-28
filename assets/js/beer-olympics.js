document.getElementById("beerSignInForm").addEventListener("submit", function(e) {
document.getElementById("nextGameBtn").addEventListener("click", function() {
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

function renderSignIn() {
  document.getElementById('beerMain').innerHTML = `
    <section class="beer-section" style="margin: 0 auto; max-width: 400px;">
      <h2>Sign In</h2>
      <form class="beer-form" id="beerSignInForm">
        <input type="text" id="beerPlayerName" placeholder="Enter your name" required value="">
        <button type="submit">Join Beer Olympics</button>
      </form>
    </section>
  `;
  document.getElementById('beerSignInForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('beerPlayerName').value.trim();
    if (!name) return;
    playerName = name;
    savePlayer(name);
    if (!players.some(p => p.name === name)) {
      players.push({ name, scores: Array(games.length).fill(0) });
      saveScores(players);
    }
    renderMain();
  });
}

function renderMain() {
  document.getElementById('beerMain').innerHTML = `
    <section class="beer-section" id="beer-current-game">
      <h2>Current Game</h2>
      <div style="margin-bottom:10px;">
        <select id="currentGameSelect" style="font-size:1.1rem;padding:6px 12px;border-radius:8px;">
          ${games.map((g,i)=>`<option value="${i}" ${i===currentGameIndex?'selected':''}>${g.name}</option>`).join('')}
        </select>
      </div>
      <div class="beer-game" id="currentGameDisplay">
        <img id="currentGameIcon" src="${games[currentGameIndex].icon}" alt="Game Icon">
        <span class="beer-game-title" id="currentGameName">${games[currentGameIndex].name}</span>
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
    <section class="beer-section" id="beer-leaderboard">
      <h2>Leaderboard</h2>
      <div class="beer-leaderboard" id="leaderboardGraph"></div>
    </section>
  `;
  document.getElementById('currentGameSelect').addEventListener('change', function(e) {
    currentGameIndex = Number(e.target.value);
    renderMain();
  });
  document.getElementById('genTeamsBtn').addEventListener('click', function(e) {
    e.preventDefault();
    const n = Number(document.getElementById('numTeams').value);
    if (n < 2 || n > 10) return alert('Enter 2-10 teams.');
    teams = randomTeams(players.map(p=>p.name), n);
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
  renderLeaderboard();
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
}

function addPoints(name, gameIdx, pts) {
  const p = players.find(p => p.name === name);
  if (p) {
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
  let html = '<div style="width:100%;max-width:400px;margin:0 auto;">';
  sorted.forEach((p,i) => {
    const total = p.scores.reduce((a,b)=>a+b,0);
    html += `<div style="margin-bottom:10px;display:flex;align-items:center;">
      <span style="width:90px;display:inline-block;">${p.name}</span>
      <div style="background:#fbbf24;height:24px;border-radius:8px;width:${Math.round(220*total/max)}px;min-width:10px;display:inline-block;"></div>
      <span style="margin-left:10px;">${total}</span>
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

// Rules dropdown
const rulesBtn = document.getElementById('beerRulesBtn');
const rulesList = document.getElementById('beerRulesList');
if (rulesBtn && rulesList) {
  rulesBtn.addEventListener('click',()=>{
    rulesList.classList.toggle('active');
  });
}

// Initial render
if (!playerName) {
  renderSignIn();
} else {
  if (!players.some(p=>p.name===playerName)) {
    players.push({ name: playerName, scores: Array(games.length).fill(0) });
    saveScores(players);
  }
  renderMain();
}
