import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

// Put your real URL and Key back in!
const supabaseUrl = 'https://kodvkxihswertogolsza.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvZHZreGloc3dlcnRvZ29sc3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDY2NzgsImV4cCI6MjA5NjY4MjY3OH0.cqPL7TG15Y-TddONu7au1O_Apb6UI7zNXXpUvgQ28lk'; 
const supabase = createClient(supabaseUrl, supabaseKey);

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
let playerRole = ''; 
let currentGameState = '';
let countdownStarted = false;

// Lobby Logic
ui.btnCreate.addEventListener('click', async () => {
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    playerRole = 'p1';
    
    const { error } = await supabase
        .from('rooms')
        .insert([{ id: roomCode, p1: true, p2: false }]);
        
    if (error) return showLobbyError("Connection failed.");
    
    window.addEventListener('beforeunload', () => {
        supabase.from('rooms').delete().eq('id', roomCode).then();
    });

    startGameUI();
});

ui.btnJoin.addEventListener('click', async () => {
    const code = ui.inputJoin.value;
    if(code.length !== 4) return showLobbyError("Invalid pin");
    
    const { data } = await supabase.from('rooms').select('*').eq('id', code).single();
        
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
    ui.roomDisplay.innerText = `PIN: ${roomCode}`;
    listenToRoom();
}

// Game Loop Logic
async function listenToRoom() {
    const { data } = await supabase.from('rooms').select('*').eq('id', roomCode).single();
    if (data) syncGameState(data);

    supabase.channel('room-updates')
        .on('postgres_changes', 
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomCode}` },
            (payload) => syncGameState(payload.new)
        )
        .subscribe();
}

async function syncGameState(data) {
    if (!data) return alert("Room closed");
    currentGameState = data.state;

    // Update Scores
    ui.scoreYou.innerText = playerRole === 'p1' ? data.score_p1 : data.score_p2;
    ui.scoreThem.innerText = playerRole === 'p1' ? data.score_p2 : data.score_p1;
    ui.roundDisplay.innerText = `${data.round}/10`;

    // 1. WAITING FOR PLAYERS
    if (data.p1 && data.p2 && data.state === 'waiting') {
        countdownStarted = false;
        if (playerRole === 'p1') {
            await supabase.from('rooms').update({ state: 'picking', p1_letter: '', p2_letter: '', winning_word: '' }).eq('id', roomCode);
        }
    }

    // 2. PICKING PHASE
    if (data.state === 'picking') {
        const myLetter = playerRole === 'p1' ? data.p1_letter : data.p2_letter;
        
        if (myLetter) {
            ui.statusText.innerText = "WAITING FOR THEM...";
            ui.wordInput.disabled = true;
            ui.btnSubmit.disabled = true;
            ui.wordInput.placeholder = "WAITING...";
            ui.wordInput.value = '';
        } else {
            ui.statusText.innerText = "PICK A LETTER, DARLING!";
            ui.letterDisplay.innerText = "♡";
            ui.letterDisplay.classList.remove('animate-pop', 'text-4xl', 'text-retro-rose'); 
            
            ui.wordInput.disabled = false;
            ui.wordInput.maxLength = 1; 
            ui.wordInput.value = '';
            ui.wordInput.placeholder = "TYPE 1 LETTER...";
            
            ui.btnSubmit.disabled = false;
            ui.btnSubmit.innerText = "LOCK IN";
            if (document.activeElement !== ui.wordInput) ui.wordInput.focus();
        }

        if (playerRole === 'p1' && data.p1_letter && data.p2_letter && !countdownStarted) {
            countdownStarted = true;
            startCountdown(data.p1_letter, data.p2_letter);
        }
    }

    // 3. COUNTDOWN PHASE
    if (data.state === 'countdown') {
        ui.wordInput.disabled = true;
        ui.btnSubmit.disabled = true;
        ui.wordInput.placeholder = "GET READY...";
        ui.statusText.innerText = "HERE WE GO...";
        ui.letterDisplay.innerText = data.current_letter; 
    }

    // 4. PLAYING PHASE 
    if (data.state === 'playing') {
        ui.statusText.innerText = "RACE TO TYPE!";
        ui.letterDisplay.innerText = `${data.current_letter[0]} ... ${data.current_letter[1]}`;
        ui.letterDisplay.classList.add('animate-pop');
        
        ui.wordInput.disabled = false;
        ui.wordInput.maxLength = 50; 
        ui.wordInput.value = '';
        ui.wordInput.placeholder = "TYPE YOUR WORD...";
        
        ui.btnSubmit.disabled = false;
        ui.btnSubmit.innerText = "SUBMIT";
        if (document.activeElement !== ui.wordInput) ui.wordInput.focus();
    }

    // 5. ROUND OVER
    if (data.state === 'round_over') {
        ui.wordInput.disabled = true;
        ui.btnSubmit.disabled = true;
        
        const isWinner = data.winner === playerRole;
        ui.statusText.innerText = isWinner ? "YOU WON THIS ROUND!" : "TOO SLOW, LOVE!";
        
        // Safety Fallback: Ensure the app never crashes even if the word fails to save
        const finalWord = data.winning_word ? data.winning_word.toUpperCase() : "ERROR";
        
        // Display the winning word for both players
        ui.letterDisplay.innerText = finalWord;
        ui.letterDisplay.classList.add('animate-pop', 'text-4xl'); 

        document.body.classList.add(isWinner ? 'flash-green' : 'flash-red');
        setTimeout(() => document.body.classList.remove('flash-green', 'flash-red'), 500);

        if (playerRole === 'p1') setTimeout(() => advanceRound(data.round), 4000);
    }

    // 6. FINISHED
    if (data.state === 'finished') {
        const youWon = (playerRole === 'p1' ? data.score_p1 : data.score_p2) > (playerRole === 'p1' ? data.score_p2 : data.score_p1);
        const tie = data.score_p1 === data.score_p2;
        ui.statusText.innerText = tie ? "IT'S A TIE!" : (youWon ? "YOU ARE THE CHAMPION ♡" : "MATCH LOST 💔");
        ui.letterDisplay.innerText = "END";
        ui.letterDisplay.classList.remove('text-4xl');
    }
}

async function startCountdown(l1, l2) {
    for (let i = 3; i > 0; i--) {
        await supabase.from('rooms').update({ state: 'countdown', current_letter: i.toString() }).eq('id', roomCode);
        await new Promise(r => setTimeout(r, 1000));
    }
    const combined = l1 + l2;
    await supabase.from('rooms').update({ state: 'playing', current_letter: combined }).eq('id', roomCode);
}

async function advanceRound(currentRound) {
    if (currentRound >= 10) {
        await supabase.from('rooms').update({ state: 'finished' }).eq('id', roomCode);
    } else {
        await supabase.from('rooms').update({ state: 'waiting', round: currentRound + 1 }).eq('id', roomCode);
    }
}

// Universal Input Handler
ui.btnSubmit.addEventListener('click', handleInput);
ui.wordInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleInput(); });

function handleInput() {
    if (currentGameState === 'picking') {
        submitLetter();
    } else if (currentGameState === 'playing') {
        submitWord();
    }
}

async function submitLetter() {
    const letter = ui.wordInput.value.trim().toUpperCase();
    
    if (letter.length !== 1 || !/[A-Z]/.test(letter)) {
        ui.wordInput.classList.add('animate-pop');
        setTimeout(() => ui.wordInput.classList.remove('animate-pop'), 300);
        return;
    }

    ui.wordInput.disabled = true;
    ui.btnSubmit.disabled = true;

    const updateData = playerRole === 'p1' ? { p1_letter: letter } : { p2_letter: letter };
    await supabase.from('rooms').update(updateData).eq('id', roomCode);
}

async function submitWord() {
    const word = ui.wordInput.value.trim().toLowerCase();
    const displayedText = ui.letterDisplay.innerText;
    const firstReq = displayedText.charAt(0).toLowerCase();
    const lastReq = displayedText.charAt(displayedText.length - 1).toLowerCase();
    
    // Check if the word starts and ends with the correct letters locally
    if (!word.startsWith(firstReq) || !word.endsWith(lastReq) || word.length < 2) {
        ui.wordInput.classList.add('animate-pop'); 
        setTimeout(() => ui.wordInput.classList.remove('animate-pop'), 300);
        return;
    }

    // Lock UI while checking dictionary
    ui.wordInput.disabled = true;
    ui.btnSubmit.disabled = true;
    ui.statusText.innerText = "CHECKING DICTIONARY...";

    try {
        // We now use the Stricter Free Dictionary API
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        
        if (!res.ok) {
            // A 404 response means the word does not exist in the dictionary
            throw new Error("Invalid Word");
        }

        // If we reach this line, the word is officially valid!
        const { data } = await supabase.from('rooms').select('*').eq('id', roomCode).single();
        
        // Ensure the round hasn't already been won by the other player
        if (data.state === 'playing') {
            const scoreUpdate = playerRole === 'p1' 
                ? { score_p1: data.score_p1 + 1 } 
                : { score_p2: data.score_p2 + 1 };
                
            // Save the winning word directly into Supabase
            await supabase.from('rooms')
                .update({ state: 'round_over', winner: playerRole, winning_word: word, ...scoreUpdate })
                .eq('id', roomCode);
        }

    } catch (err) {
        // EXPLICIT REJECTION FEEDBACK
        ui.statusText.innerText = "NOT IN DICTIONARY!";
        ui.wordInput.classList.add('animate-pop');
        ui.letterDisplay.classList.add('text-retro-rose'); // Turn the big letters red momentarily

        // Reset the input box after a brief pause so they can try again
        setTimeout(() => {
            ui.wordInput.classList.remove('animate-pop');
            ui.letterDisplay.classList.remove('text-retro-rose');
            ui.statusText.innerText = "RACE TO TYPE!";
            ui.wordInput.disabled = false;
            ui.btnSubmit.disabled = false;
            ui.wordInput.value = '';
            ui.wordInput.focus();
        }, 1500);
    }
}