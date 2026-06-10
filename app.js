import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

// 1. REPLACE WITH YOUR SUPABASE URL AND ANON KEY
// Read keys from the globally injected config object
const supabaseUrl = window.ENV?.SUPABASE_URL || '';
const supabaseKey = window.ENV?.SUPABASE_ANON_KEY || '';

const supabase = superClass.createClient(supabaseUrl, supabaseKey); // Your existing initialization

// DOM Elements
const ui = {
    lobby: document.getElementById('lobby'),
    gameUi: document.getElementById('game-ui'),
    btnCreate: document.getElementById('btn-create'),
    btnJoin: document.getElementById('btn-join'),
    inputJoin: document.getElementById('input-join'),
    lobbyMsg: document.getElementById('lobby-msg'),
    scoreYou: document.getElementById('score-you'),
    scoreThem: document.getElementById('score-them'),
    roundDisplay: document.getElementById('round-display'),
    roomDisplay: document.getElementById('room-display'),
    statusText: document.getElementById('status-text'),
    letterDisplay: document.getElementById('letter-display'),
    wordInput: document.getElementById('word-input'),
    btnSubmit: document.getElementById('btn-submit')
};

// Game State
let roomCode = '';
let playerRole = ''; // 'p1' or 'p2'
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Lobby Logic
ui.btnCreate.addEventListener('click', async () => {
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    playerRole = 'p1';
    
    const { error } = await supabase
        .from('rooms')
        .insert([{ id: roomCode, p1: true, p2: false }]);
        
    if (error) return showLobbyError("Error creating room.");
    
    // Optional: Cleanup on window close
    window.addEventListener('beforeunload', () => {
        supabase.from('rooms').delete().eq('id', roomCode).then();
    });

    startGameUI();
});

ui.btnJoin.addEventListener('click', async () => {
    const code = ui.inputJoin.value;
    if(code.length !== 4) return showLobbyError("Invalid code");
    
    // Check if room exists and p2 is empty
    const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', code)
        .single();
        
    if (data && !data.p2) {
        roomCode = code;
        playerRole = 'p2';
        await supabase.from('rooms').update({ p2: true }).eq('id', code);
        startGameUI();
    } else {
        showLobbyError("Room full or not found");
    }
});

function showLobbyError(msg) {
    ui.lobbyMsg.innerText = msg;
    setTimeout(() => ui.lobbyMsg.innerText = '', 3000);
}

function startGameUI() {
    ui.lobby.classList.add('hidden');
    ui.gameUi.classList.remove('hidden');
    ui.roomDisplay.innerText = `Code: ${roomCode}`;
    listenToRoom();
}

// Game Loop Logic
async function listenToRoom() {
    // Fetch initial state
    const { data } = await supabase.from('rooms').select('*').eq('id', roomCode).single();
    if (data) syncGameState(data);

    // Subscribe to real-time updates
    supabase.channel('room-updates')
        .on('postgres_changes', 
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomCode}` },
            (payload) => syncGameState(payload.new)
        )
        .subscribe();
}

async function syncGameState(data) {
    if (!data) return alert("Room closed");

    // Update Scores & Rounds
    ui.scoreYou.innerText = playerRole === 'p1' ? data.score_p1 : data.score_p2;
    ui.scoreThem.innerText = playerRole === 'p1' ? data.score_p2 : data.score_p1;
    ui.roundDisplay.innerText = `${data.round}/10`;

    if (data.p1 && data.p2 && data.state === 'waiting') {
        if (playerRole === 'p1') startCountdown();
    }

    if (data.state === 'countdown') {
        ui.wordInput.disabled = true;
        ui.btnSubmit.disabled = true;
        ui.statusText.innerText = data.current_letter; // Reusing letter col for "3", "2", "1"
        ui.letterDisplay.classList.remove('animate-pop');
    }

    if (data.state === 'playing') {
        ui.statusText.innerText = "TYPE!";
        ui.letterDisplay.innerText = data.current_letter;
        ui.letterDisplay.classList.add('animate-pop');
        ui.wordInput.disabled = false;
        ui.btnSubmit.disabled = false;
        if (document.activeElement !== ui.wordInput) ui.wordInput.focus();
    }

    if (data.state === 'round_over') {
        ui.wordInput.disabled = true;
        ui.btnSubmit.disabled = true;
        ui.wordInput.value = '';
        
        const isWinner = data.winner === playerRole;
        ui.statusText.innerText = isWinner ? "You Won!" : "Too Slow!";
        document.body.classList.add(isWinner ? 'flash-green' : 'flash-red');
        setTimeout(() => document.body.classList.remove('flash-green', 'flash-red'), 500);

        if (playerRole === 'p1') setTimeout(() => advanceRound(data.round), 3000);
    }

    if (data.state === 'finished') {
        const youWon = (playerRole === 'p1' ? data.score_p1 : data.score_p2) > (playerRole === 'p1' ? data.score_p2 : data.score_p1);
        const tie = data.score_p1 === data.score_p2;
        ui.statusText.innerText = tie ? "It's a Tie!" : (youWon ? "Match Winner! 🎉" : "Match Lost 💔");
        ui.letterDisplay.innerText = "";
    }
}

async function startCountdown() {
    for (let i = 3; i > 0; i--) {
        await supabase.from('rooms').update({ state: 'countdown', current_letter: i.toString() }).eq('id', roomCode);
        await new Promise(r => setTimeout(r, 1000));
    }
    const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    await supabase.from('rooms').update({ state: 'playing', current_letter: randomLetter }).eq('id', roomCode);
}

async function advanceRound(currentRound) {
    if (currentRound >= 10) {
        await supabase.from('rooms').update({ state: 'finished' }).eq('id', roomCode);
    } else {
        await supabase.from('rooms').update({ state: 'waiting', round: currentRound + 1 }).eq('id', roomCode);
    }
}

// Validation & Submission
ui.btnSubmit.addEventListener('click', submitWord);
ui.wordInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') submitWord(); });

async function submitWord() {
    const word = ui.wordInput.value.trim().toLowerCase();
    const currentLetter = ui.letterDisplay.innerText.toLowerCase();
    
    if (!word.startsWith(currentLetter)) {
        ui.wordInput.classList.add('animate-pop'); 
        setTimeout(() => ui.wordInput.classList.remove('animate-pop'), 300);
        return;
    }

    ui.wordInput.disabled = true;
    ui.btnSubmit.disabled = true;

    // Validate with Datamuse Free API
    const res = await fetch(`https://api.datamuse.com/words?sp=${word}&max=1`);
    const json = await res.json();
    const isValid = json.length > 0 && json[0].word === word;

    if (isValid) {
        // Fetch latest state to prevent double-scoring if both submit instantly
        const { data } = await supabase.from('rooms').select('*').eq('id', roomCode).single();
        
        if (data.state === 'playing') {
            const scoreUpdate = playerRole === 'p1' 
                ? { score_p1: data.score_p1 + 1 } 
                : { score_p2: data.score_p2 + 1 };
                
            await supabase.from('rooms')
                .update({ state: 'round_over', winner: playerRole, ...scoreUpdate })
                .eq('id', roomCode);
        }
    } else {
        ui.wordInput.disabled = false;
        ui.btnSubmit.disabled = false;
        ui.wordInput.value = '';
        ui.wordInput.focus();
    }
}