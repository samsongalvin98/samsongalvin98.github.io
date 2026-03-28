// LocalStorage keys
const PLAYER_KEY = 'beerOlympicsPlayer';
const SCORES_KEY = 'beerOlympicsScores';
const TEAMS_KEY = 'beerOlympicsTeams';

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
