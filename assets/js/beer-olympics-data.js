// LocalStorage keys
const PLAYER_KEY = 'beerOlympicsPlayer';
const SCORES_KEY = 'beerOlympicsScores';
const TEAMS_KEY = 'beerOlympicsTeams';
const CHAT_KEY = 'beerOlympicsChat';

// Save/load helpers
function savePlayer(name) {
  localStorage.setItem(PLAYER_KEY, name);
}
function loadPlayer() {
  return localStorage.getItem(PLAYER_KEY) || '';
}
function saveScores(scores) {
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
}
function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(SCORES_KEY)) || [];
  } catch { return []; }
}
function saveTeams(teams) {
  localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
}
function loadTeams() {
  try {
    return JSON.parse(localStorage.getItem(TEAMS_KEY)) || [];
  } catch { return []; }
}

// Chat helpers
function saveChat(messages) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
}
function loadChat() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY)) || [];
  } catch { return []; }
}

function addChatMessage(author, text) {
  const messages = loadChat();
  const id = 'm_' + Date.now() + '_' + Math.floor(Math.random()*1000);
  const msg = { id, author, text, ts: Date.now(), likes: 0, likedBy: [] };
  messages.push(msg);
  saveChat(messages);
  return msg;
}

function toggleLikeMessage(msgId, userName) {
  const messages = loadChat();
  const msg = messages.find(m => m.id === msgId);
  if (!msg) return null;
  userName = (userName || '').trim();
  if (!userName) return null;
  const idx = msg.likedBy.indexOf(userName);
  if (idx === -1) {
    msg.likedBy.push(userName);
    msg.likes = (msg.likes||0) + 1;
  } else {
    msg.likedBy.splice(idx,1);
    msg.likes = Math.max(0, (msg.likes||0) - 1);
  }
  saveChat(messages);
  return msg;
}
