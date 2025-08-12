// --- DOM Elements ---
const logElement = document.getElementById('log');
const caboButton = document.getElementById('cabo-button');
const startButton = document.getElementById('start-button');
const winRateText = document.getElementById('win-rate-text');
const winRateBar = document.getElementById('win-rate-bar');
const actionButtonsDiv = document.getElementById('action-buttons');
const actionLogContent = document.getElementById('action-log-content');
const winProbChartCanvas = document.getElementById('winProbChart');
const scoreboardContent = document.getElementById('scoreboard-content');

// --- Game Constants & State ---
const NUM_PLAYERS = 4;
const INITIAL_CARDS_PER_HAND = 4;
const CABO_FAIL_PENALTY = 10;
const PLAYER_UI_SIMULATION_COUNT = 3000;
const HISTORY_SIMULATION_COUNT = 3000;
const BOT_CABO_WIN_PROB_THRESHOLD = 0.70;
const MULTI_SWAP_PROB_INCREASE_THRESHOLD = 0.10;

let useCardImages = false;
const CARD_IMAGE_PATH = 'card_image/';

let state = {};
let winProbChart;


// --- Helper Functions ---
function updateLog(message) { logElement.innerHTML = message; }
function getPlayerName(playerId) { return playerId === 0 ? '你' : `机器人 ${playerId}`; }
function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// --- Log, Chart, Scoreboard ---
function logAction(playerId, actionType, message) {
    const p = document.createElement('p');
    p.innerHTML = `<span class="log-turn">T${state.turnNumber}:</span> [${getPlayerName(playerId)}] ${message}`;
    p.classList.add(`log-${actionType}`);
    actionLogContent.prepend(p);
}

function initializeWinProbChart() {
    if (winProbChart) winProbChart.destroy();
    const playerColors = ['#007bff', '#dc3545', '#ffc107', '#28a745'];
    const chartData = {
        labels: [],
        datasets: Array(NUM_PLAYERS).fill(null).map((_, i) => ({
            label: getPlayerName(i), data: [], borderColor: playerColors[i],
            backgroundColor: `${playerColors[i]}33`, fill: false, tension: 0.1
        }))
    };
    winProbChart = new Chart(winProbChartCanvas, {
        type: 'line', data: chartData,
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 1, title: { display: true, text: '胜率' } },
                x: { title: { display: true, text: '轮次' } }
            },
            plugins: {
                title: { display: true, text: '各玩家胜率变化' },
                legend: {
                    labels: {
                        font: {
                            size: 5
                        }
                    }
                }
            }
        }
    });
}

async function updateWinProbChart() {
    const turnLabel = `T${state.turnNumber}`;
    winProbChart.data.labels.push(turnLabel);
    for (let i = 0; i < NUM_PLAYERS; i++) {
        const prob = calculateWinProbabilityForPlayer(i, HISTORY_SIMULATION_COUNT);
        winProbChart.data.datasets[i].data.push(prob);
    }
    winProbChart.update();
}

function renderScoreboard(roundScores = null) {
    let tableHTML = `<table><thead><tr><th>玩家</th><th>本轮得分</th><th>总分</th></tr></thead><tbody>`;
    for (let i = 0; i < NUM_PLAYERS; i++) {
        const roundScoreVal = roundScores ? (roundScores[i].score + (roundScores[i].penalty || 0)) : ' - ';
        const penaltyText = roundScores && roundScores[i].penalty ? ` (+${roundScores[i].penalty})` : '';
        tableHTML += `<tr><td>${getPlayerName(i)}</td><td>${roundScoreVal}${penaltyText}</td><td>${state.totalScores[i]}</td></tr>`;
    }
    tableHTML += `</tbody></table>`;
    scoreboardContent.innerHTML = tableHTML;
}

// --- Image Check, Deck Creation ---
function checkForCardImages() {
    return new Promise(resolve => {
        const testImage = new Image();
        testImage.onload = () => { useCardImages = true; resolve(); };
        testImage.onerror = () => { useCardImages = false; resolve(); };
        testImage.src = `${CARD_IMAGE_PATH}0.png`;
    });
}

function createDeck() {
    const deck = [];
    let cardIdCounter = 0;
    const createCard = (value, ability = 'none') => ({ value, points: value, ability, id: cardIdCounter++ });
    for (let i = 0; i < 2; i++) { deck.push(createCard(0)); deck.push(createCard(13)); }
    for (let val = 1; val <= 12; val++) {
        for (let i = 0; i < 4; i++) {
            let ability = 'none';
            if (val === 7 || val === 8) ability = 'peek_self';
            if (val === 9 || val === 10) ability = 'peek_opponent';
            if (val === 11 || val === 12) ability = 'swap';
            deck.push(createCard(val, ability));
        }
    }
    return shuffle(deck);
}

// --- Game State Initialization ---
async function startGame() {
    if (!state.totalScores) {
        state.totalScores = Array(NUM_PLAYERS).fill(0);
    }
    startNewRound();
}

async function startNewRound() {
    state = {
        ...state,
        players: Array(NUM_PLAYERS).fill(null).map((_, i) => ({
            id: i, isBot: i !== 0, hand: [],
            knowledge: Array(NUM_PLAYERS).fill(null).map(() => Array(INITIAL_CARDS_PER_HAND).fill(null)),
        })),
        deck: createDeck(), discardPile: [], currentPlayerIndex: 0, gamePhase: 'playing',
        drawnCard: null, caboCalledBy: null, lastTurnPlayer: null, actionState: {}, turnNumber: 1,
    };

    for (let i = 0; i < INITIAL_CARDS_PER_HAND; i++) {
        for (let j = 0; j < NUM_PLAYERS; j++) {
            state.players[j].hand.push(state.deck.pop());
        }
    }
    state.discardPile.push(state.deck.pop());

    actionLogContent.innerHTML = '';
    logAction('System', 'end', '新一轮开始!');
    initializeWinProbChart();
    renderScoreboard();

    for (let p = 0; p < NUM_PLAYERS; p++) {
        const player = state.players[p];
        player.knowledge[p][0] = player.hand[0];
        player.knowledge[p][1] = player.hand[1];
    }
    updateLog("新一轮开始！你和机器人都已查看自己的前两张手牌。");

    caboButton.disabled = false;
    startButton.innerText = "重新开局";
    startButton.onclick = () => { state.totalScores = null; startGame(); };
    document.querySelectorAll('.player-area').forEach(p => p.classList.remove('active-player'));
    document.getElementById('player-0').classList.add('active-player');
    
    await checkForCardImages();
    render();
    updateWinProbabilityForPlayerUI();
    updateWinProbChart();
    updateLog("轮到你了。从牌堆或弃牌堆摸一张牌。");
}

// --- Main Game Flow ---
function nextTurn() {
    actionButtonsDiv.innerHTML = '';
    document.getElementById(`player-${state.currentPlayerIndex}`).classList.remove('active-player');
    if (state.caboCalledBy !== null && state.currentPlayerIndex === state.lastTurnPlayer) {
        endRound(); return;
    }
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % NUM_PLAYERS;
    if (state.currentPlayerIndex === state.caboCalledBy) {
         endRound(); return;
    }
    state.turnNumber++;
    updateWinProbChart();
    document.getElementById(`player-${state.currentPlayerIndex}`).classList.add('active-player');
    state.gamePhase = 'playing';
    if (state.players[state.currentPlayerIndex].isBot) {
        updateLog(`轮到机器人 ${state.currentPlayerIndex} 了...`);
        setTimeout(botTurn, 1500);
    } else {
        updateLog("轮到你了。从牌堆或弃牌堆摸一张牌。");
        caboButton.disabled = (state.caboCalledBy !== null);
    }
    render();
}

// --- Player Actions & Multi-Swap ---
function drawFromDeck() {
    if (state.currentPlayerIndex !== 0 || state.gamePhase !== 'playing') return;
    if (state.deck.length === 0) { updateLog("牌堆已空！无法摸牌。"); return; }
    state.drawnCard = state.deck.pop();
    logAction(0, 'draw', `从牌堆摸到 ${state.drawnCard.value}`);
    updateLog(`你摸到了 ${state.drawnCard.value}。`);
    state.gamePhase = 'post_draw_action';
    renderPostDrawActions();
    render();
}
function drawFromDiscard() {
    if (state.currentPlayerIndex !== 0 || state.gamePhase !== 'playing' || state.discardPile.length === 0) return;
    state.drawnCard = state.discardPile.pop();
    logAction(0, 'draw', `从弃牌堆拿起 ${state.drawnCard.value}`);
    // BUGFIX 1: Use a specific game phase for swapping from discard
    state.gamePhase = 'swapping_from_discard'; 
    updateLog(`你从弃牌堆拿了 ${state.drawnCard.value}。必须选择一张手牌替换，这张牌将保持面朝上。`);
    render();
}

// BUGFIX 1: This function now ONLY handles swapping from the discard pile.
function selectPlayerCardToSwapFromDiscard(cardIndex) {
    if (state.gamePhase !== 'swapping_from_discard' || !state.drawnCard) return;
    const player = state.players[0];
    const discardedCard = player.hand[cardIndex];

    player.hand[cardIndex] = state.drawnCard;
    player.hand[cardIndex].isFaceUp = true;

    for (let i = 0; i < NUM_PLAYERS; i++) {
        state.players[i].knowledge[0][cardIndex] = player.hand[cardIndex];
    }
    state.discardPile.push(discardedCard);
    logAction(0, 'swap', `用弃牌堆的 ${state.drawnCard.value} 换掉了手牌 (原为 ${discardedCard.value})。这张新牌将保持面朝上。`);
    state.drawnCard = null;
    endPlayerTurn();
}

// BUGFIX 1: New function to handle swapping with a card drawn from the deck.
function selectPlayerCardToSwapFromDeck(cardIndex) {
    if (state.gamePhase !== 'swapping_from_deck' || !state.drawnCard) return;
    const player = state.players[0];
    const discardedCard = player.hand[cardIndex];
    player.hand[cardIndex] = state.drawnCard;
    player.knowledge[0][cardIndex] = state.drawnCard; // Only you know this new card
    state.discardPile.push(discardedCard);
    logAction(0, 'swap', `用摸到的 ${state.drawnCard.value} 换掉了手牌 (原为 ${discardedCard.value})`);
    state.drawnCard = null;
    endPlayerTurn();
}

function discardDrawnCard() {
    if (!state.drawnCard) return;
    logAction(0, 'swap', `丢弃了摸到的 ${state.drawnCard.value}`);
    state.discardPile.push(state.drawnCard);
    state.drawnCard = null;
    endPlayerTurn();
}
function initiateMultiSwap() {
    state.gamePhase = 'multi_swap_selection';
    state.actionState = { selectedMultiSwapIndices: [] };
    actionButtonsDiv.innerHTML = '';
    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = '确认交换';
    confirmBtn.className = 'confirm-btn';
    confirmBtn.onclick = executeMultiSwap;
    actionButtonsDiv.appendChild(confirmBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '取消';
    cancelBtn.className = 'cancel-btn';
    cancelBtn.onclick = () => {
        state.gamePhase = 'post_draw_action';
        state.actionState = {};
        renderPostDrawActions();
        render();
    };
    actionButtonsDiv.appendChild(cancelBtn);
    updateLog('选择你手中所有相同点数的牌，然后点击"确认交换"。');
    render();
}
function selectCardForMultiSwap(cardIndex) {
    if (state.gamePhase !== 'multi_swap_selection') return;
    const player = state.players[0];
    const selectedIndices = state.actionState.selectedMultiSwapIndices;
    const isSelected = selectedIndices.includes(cardIndex);
    if (isSelected) {
        state.actionState.selectedMultiSwapIndices = selectedIndices.filter(i => i !== cardIndex);
    } else {
        if (selectedIndices.length > 0) {
            const firstSelectedValue = player.hand[selectedIndices[0]].value;
            if (player.hand[cardIndex].value !== firstSelectedValue) {
                updateLog('只能选择点数相同的牌！');
                setTimeout(() => updateLog('选择你手中所有相同点数的牌，然后点击"确认交换"。'), 2000);
                return;
            }
        }
        selectedIndices.push(cardIndex);
    }
    render();
}
function executeMultiSwap() {
    const player = state.players[0];
    const selectedIndices = state.actionState.selectedMultiSwapIndices;
    if (selectedIndices.length < 1) {
        updateLog('请至少选择一张牌进行交换。'); return;
    }
    const valueToMatch = player.hand[selectedIndices[0]].value;
    const allMatch = selectedIndices.every(index => player.hand[index].value === valueToMatch);
    if (!allMatch) {
        updateLog('错误：你选择的牌点数不完全相同！请重新选择。');
        state.actionState.selectedMultiSwapIndices = [];
        render();
        return;
    }
    logAction(0, 'swap', `发起多换一，用 ${selectedIndices.length} 张 ${valueToMatch} 交换 ${state.drawnCard.value}`);
    const discardedCards = [], newHand = [], newKnowledge = [];
    for(let i=0; i < player.hand.length; i++) {
        if(selectedIndices.includes(i)) { discardedCards.push(player.hand[i]); } 
        else { newHand.push(player.hand[i]); newKnowledge.push(player.knowledge[0][i]); }
    }
    newHand.push(state.drawnCard);
    newKnowledge.push(state.drawnCard);
    player.hand = newHand;
    while(newKnowledge.length < INITIAL_CARDS_PER_HAND) { newKnowledge.push(null); }
    player.knowledge[0] = newKnowledge;
    discardedCards.forEach(c => state.discardPile.push(c));
    state.drawnCard = null;
    endPlayerTurn();
}

// --- Ability & Action Button Rendering ---
function renderPostDrawActions() {
    actionButtonsDiv.innerHTML = '';
    const ability = state.drawnCard.ability;
    const discardBtn = document.createElement('button');
    discardBtn.innerText = '常规交换/丢弃';
    // BUGFIX 1: Set the correct game phase for swapping from the deck.
    discardBtn.onclick = () => {
        state.gamePhase = 'swapping_from_deck';
        actionButtonsDiv.innerHTML = '';
        updateLog('选择一张手牌替换，或点击弃牌堆放弃交换。');
        render();
    };
    actionButtonsDiv.appendChild(discardBtn);
    const multiSwapBtn = document.createElement('button');
    multiSwapBtn.innerText = '多换一';
    multiSwapBtn.onclick = initiateMultiSwap;
    actionButtonsDiv.appendChild(multiSwapBtn);
    if (ability !== 'none') {
        let abilityText = '';
        if (ability === 'peek_self') abilityText = '看自己的牌';
        if (ability === 'peek_opponent') abilityText = '看别人的牌';
        if (ability === 'swap') abilityText = '和别人换牌';
        const useBtn = document.createElement('button');
        useBtn.innerText = `使用能力 (${abilityText})`;
        useBtn.onclick = () => executeAbility(ability);
        actionButtonsDiv.appendChild(useBtn);
    }
}
function executeAbility(ability) {
    actionButtonsDiv.innerHTML = '';
    state.gamePhase = `ability_${ability}`;
    logAction(0, 'ability', `决定使用 ${state.drawnCard.value} 的能力: ${ability}`);
    if (ability === 'peek_self') updateLog('选择一张你自己的未知手牌来查看。');
    if (ability === 'peek_opponent') updateLog('选择一个对手的一张手牌来查看。');
    if (ability === 'swap') {
        updateLog('选择一张你自己的手牌用于交换。');
        state.actionState.step = 'select_own_card';
    }
    render();
}
function handleAbilityClick(playerId, cardIndex) {
    const player = state.players[0];
    switch (state.gamePhase) {
        case 'ability_peek_self':
            if (playerId !== 0) return;
            const peekedCard = player.hand[cardIndex];
            player.knowledge[0][cardIndex] = peekedCard;
            logAction(0, 'ability', `查看了自己的第 ${cardIndex + 1} 张牌，是 ${peekedCard.value}`);
            updateLog(`你看到你的牌是 ${peekedCard.value}。`);
            peekAndReset(playerId, cardIndex);
            break;
        case 'ability_peek_opponent':
            if (playerId === 0 || cardIndex >= state.players[playerId].hand.length) return;
            const targetCard = state.players[playerId].hand[cardIndex];
            player.knowledge[playerId][cardIndex] = targetCard;
            logAction(0, 'ability', `查看了 ${getPlayerName(playerId)} 的第 ${cardIndex + 1} 张牌，是 ${targetCard.value}`);
            updateLog(`你看到 ${getPlayerName(playerId)} 的牌是 ${targetCard.value}。`);
            peekAndReset(playerId, cardIndex);
            break;
        case 'ability_swap':
            if (state.actionState.step === 'select_own_card') {
                if (playerId !== 0) return;
                state.actionState.ownCardIndex = cardIndex;
                state.actionState.step = 'select_opponent_card';
                updateLog('现在选择一个对手的手牌来交换。');
                render();
            } else if (state.actionState.step === 'select_opponent_card') {
                if (playerId === 0 || cardIndex >= state.players[playerId].hand.length) return;
                const opponentCardIndex = cardIndex;
                const ownCardIndex = state.actionState.ownCardIndex;
                const opponent = state.players[playerId];
                const ownCardKnowledge = player.knowledge[0][ownCardIndex];
                const opponentCardKnowledge = player.knowledge[playerId][opponentCardIndex];
                const temp = player.hand[ownCardIndex];
                player.hand[ownCardIndex] = opponent.hand[opponentCardIndex];
                opponent.hand[opponentCardIndex] = temp;
                player.knowledge[0][ownCardIndex] = opponentCardKnowledge;
                player.knowledge[playerId][opponentCardIndex] = ownCardKnowledge;
                opponent.knowledge[playerId][opponentCardIndex] = opponent.hand[opponentCardIndex];
                logAction(0, 'ability', `与 ${getPlayerName(playerId)} 交换了手牌`);
                updateLog(`你用你的牌和 ${getPlayerName(playerId)} 的牌交换了。`);
                state.actionState = {};
                endPlayerTurn();
            }
            break;
    }
}
function peekAndReset(playerId, cardIndex) {
    render();
    setTimeout(() => {
        state.gamePhase = 'playing';
        endPlayerTurn();
    }, 2000);
}
function endPlayerTurn() {
    if (state.drawnCard) {
        state.discardPile.push(state.drawnCard);
        state.drawnCard = null;
    }
    state.gamePhase = 'playing';
    caboButton.disabled = true;
    actionButtonsDiv.innerHTML = '';
    updateWinProbabilityForPlayerUI();
    setTimeout(nextTurn, 500);
}

// --- Bot AI ---
function executeBotAbility(bot, drawnCard) {
    switch (drawnCard.ability) {
        case 'peek_self': {
            const unknownCardIndex = bot.knowledge[bot.id].findIndex(k => k === null);
            if (unknownCardIndex !== -1) {
                const peekedCard = bot.hand[unknownCardIndex];
                bot.knowledge[bot.id][unknownCardIndex] = peekedCard;
                logAction(bot.id, 'ability', `使用 ${drawnCard.value} 的能力，查看了自己的一张牌 (是 ${peekedCard.value})`);
                return true;
            }
            return false;
        }
        case 'peek_opponent': {
            const opponentIds = Array.from({ length: NUM_PLAYERS }, (_, i) => i).filter(id => id !== bot.id);
            shuffle(opponentIds);
            for (const pId of opponentIds) {
                const unknownCardIndex = bot.knowledge[pId].findIndex(k => k === null);
                if (unknownCardIndex !== -1 && unknownCardIndex < state.players[pId].hand.length) {
                    const targetCard = state.players[pId].hand[unknownCardIndex];
                    bot.knowledge[pId][unknownCardIndex] = targetCard;
                    logAction(bot.id, 'ability', `使用 ${drawnCard.value} 的能力，查看了 ${getPlayerName(pId)} 的一张牌 (是 ${targetCard.value})`);
                    return true;
                }
            }
            return false;
        }
        case 'swap': {
            let [maxKnownValue, ownCardToSwapIndex] = [-1, -1];
            bot.knowledge[bot.id].forEach((card, i) => {
                if (card && card.value > maxKnownValue) {
                    maxKnownValue = card.value;
                    ownCardToSwapIndex = i;
                }
            });
            if (ownCardToSwapIndex === -1 || maxKnownValue <= 6) { return false; }
            const opponentIds = Array.from({ length: NUM_PLAYERS }, (_, i) => i).filter(id => id !== bot.id);
            let bestTarget = { value: Infinity, pId: -1, cardIndex: -1 };
            for (const pId of opponentIds) {
                bot.knowledge[pId].forEach((card, c_idx) => {
                    if (card && card.value < bestTarget.value) {
                        bestTarget = { value: card.value, pId, cardIndex: c_idx };
                    }
                });
            }
            if (bestTarget.pId !== -1 && maxKnownValue > bestTarget.value) {
                const { pId, cardIndex } = bestTarget;
                const opponent = state.players[pId];
                const ownCardKnowledge = bot.knowledge[bot.id][ownCardToSwapIndex];
                const opponentCardKnowledge = bot.knowledge[pId][cardIndex];
                const temp = bot.hand[ownCardToSwapIndex];
                bot.hand[ownCardToSwapIndex] = opponent.hand[cardIndex];
                opponent.hand[cardIndex] = temp;
                bot.knowledge[bot.id][ownCardToSwapIndex] = opponentCardKnowledge;
                bot.knowledge[pId][cardIndex] = ownCardKnowledge;
                opponent.knowledge[pId][cardIndex] = opponent.hand[cardIndex];
                logAction(bot.id, 'ability', `使用 ${drawnCard.value} 能力，用自己的 ${maxKnownValue} 与 ${getPlayerName(pId)} 的已知牌 ${bestTarget.value} 交换`);
                return true;
            }
            shuffle(opponentIds);
            for (const pId of opponentIds) {
                 const opponent = state.players[pId];
                 const opponentCardIndex = bot.knowledge[pId].findIndex(k => k === null);
                if (opponentCardIndex !== -1 && opponentCardIndex < opponent.hand.length) {
                    const ownCardKnowledge = bot.knowledge[bot.id][ownCardToSwapIndex];
                    const opponentCardKnowledge = null;
                    const temp = bot.hand[ownCardToSwapIndex];
                    bot.hand[ownCardToSwapIndex] = opponent.hand[opponentCardIndex];
                    opponent.hand[opponentCardIndex] = temp;
                    bot.knowledge[bot.id][ownCardToSwapIndex] = opponentCardKnowledge;
                    bot.knowledge[pId][opponentCardIndex] = ownCardKnowledge;
                    opponent.knowledge[pId][opponentCardIndex] = opponent.hand[opponentCardIndex];
                    logAction(bot.id, 'ability', `使用 ${drawnCard.value} 能力，用自己的 ${maxKnownValue} 与 ${getPlayerName(pId)} 的一张未知牌交换`);
                    return true;
                }
            }
            return false;
        }
    }
    return false;
}

function evaluateMultiSwap(bot, drawnCard, indicesToSwap) {
    const simState = JSON.parse(JSON.stringify(state));
    const originalState = state; 

    try {
        state = simState; 
        
        const simBot = state.players[bot.id];
        const valueToMatch = simBot.hand[indicesToSwap[0]].value;
        const discardedCards = [];
        const newHand = [], newKnowledge = [];

        for (let i = 0; i < simBot.hand.length; i++) {
            if (indicesToSwap.includes(i)) {
                discardedCards.push(simBot.hand[i]);
            } else {
                newHand.push(simBot.hand[i]);
                newKnowledge.push(simBot.knowledge[simBot.id][i]);
            }
        }
        newHand.push(drawnCard);
        newKnowledge.push(drawnCard);

        simBot.hand = newHand;
        while (newKnowledge.length < INITIAL_CARDS_PER_HAND) { newKnowledge.push(null); }
        simBot.knowledge[simBot.id] = newKnowledge;
        discardedCards.forEach(c => state.discardPile.push(c));
        return calculateWinProbabilityForPlayer(bot.id, PLAYER_UI_SIMULATION_COUNT);

    } finally {
        state = originalState;
    }
}

function executeMultiSwapForBot(bot, drawnCard, indicesToSwap) {
    const valueToMatch = bot.hand[indicesToSwap[0]].value;
    logAction(bot.id, 'swap', `执行多换一, 用 ${indicesToSwap.length} 张 ${valueToMatch} 交换摸到的 ${drawnCard.value}`);

    const discardedCards = [], newHand = [], newKnowledge = [];
    for (let i = bot.hand.length - 1; i >= 0; i--) {
        if (indicesToSwap.includes(i)) {
            discardedCards.push(bot.hand.splice(i, 1)[0]);
            bot.knowledge[bot.id].splice(i, 1);
        }
    }

    bot.hand.push(drawnCard);
    bot.knowledge[bot.id].push(drawnCard);

    discardedCards.forEach(c => state.discardPile.push(c));
}

function botTurn() {
    const bot = state.players[state.currentPlayerIndex];
    const topDiscard = state.discardPile[state.discardPile.length - 1];

    let [maxKnownValue, maxKnownIndex] = [-1, -1];
    bot.knowledge[bot.id].forEach((card, i) => {
        if (card && card.value > maxKnownValue) {
            maxKnownValue = card.value;
            maxKnownIndex = i;
        }
    });

    if (topDiscard && topDiscard.value <= 4 && (maxKnownIndex === -1 || topDiscard.value < maxKnownValue)) {
        const drawnCard = state.discardPile.pop();
        const indexToSwap = (maxKnownIndex !== -1) ? maxKnownIndex : Math.floor(Math.random() * bot.hand.length);
        const discarded = bot.hand[indexToSwap];
        bot.hand[indexToSwap] = drawnCard;
        
        bot.hand[indexToSwap].isFaceUp = true;

        for (let i = 0; i < NUM_PLAYERS; i++) {
            state.players[i].knowledge[bot.id][indexToSwap] = bot.hand[indexToSwap];
        }

        state.discardPile.push(discarded);
        logAction(bot.id, 'draw', `从弃牌堆拿 ${drawnCard.value} 替换了一张牌 (原为 ${discarded.value})。这张新牌将保持面朝上。`);
    
    } else {
        if (state.deck.length === 0) {
            logAction(bot.id, 'draw', '发现牌堆已空, 跳过回合');
            setTimeout(nextTurn, 500);
            return;
        }
        const drawnCard = state.deck.pop();
        logAction(bot.id, 'draw', `从牌堆摸了一张牌 (${drawnCard.value})`);

        let multiSwapExecuted = false;
        const cardCounts = new Map();
        bot.hand.forEach(card => cardCounts.set(card.value, (cardCounts.get(card.value) || 0) + 1));
        
        for (const [value, count] of cardCounts.entries()) {
            if (count > 1) {
                const indicesToSwap = bot.hand.map((card, index) => card.value === value ? index : -1).filter(index => index !== -1);
                
                const probBefore = calculateWinProbabilityForPlayer(bot.id, PLAYER_UI_SIMULATION_COUNT);
                const probAfter = evaluateMultiSwap(bot, drawnCard, indicesToSwap);

                if (probAfter > probBefore + MULTI_SWAP_PROB_INCREASE_THRESHOLD) {
                    executeMultiSwapForBot(bot, drawnCard, indicesToSwap);
                    multiSwapExecuted = true;
                    break;
                }
            }
        }
        
        if (!multiSwapExecuted) {
            let usedAbility = false;
            if (drawnCard.ability !== 'none') {
                usedAbility = executeBotAbility(bot, drawnCard);
            }

            if (usedAbility) {
                state.discardPile.push(drawnCard);
            } else {
                 let [currentMaxKnownValue, currentMaxKnownIndex] = [-1, -1];
                 bot.knowledge[bot.id].forEach((card, i) => {
                     if (card && card.value > currentMaxKnownValue) {
                         currentMaxKnownValue = card.value;
                         currentMaxKnownIndex = i;
                     }
                 });
                
                if (drawnCard.value < currentMaxKnownValue) {
                     const discarded = bot.hand[currentMaxKnownIndex];
                     bot.hand[currentMaxKnownIndex] = drawnCard;
                     bot.knowledge[bot.id][currentMaxKnownIndex] = drawnCard;
                     state.discardPile.push(discarded);
                     logAction(bot.id, 'swap', `用摸到的 ${drawnCard.value} 换了一张牌 (原为 ${discarded.value})`);
                } else {
                    // BUGFIX 2: Enhanced AI logic. If drawn card is not better than a known card,
                    // check if it's a good candidate to replace an UNKNOWN card.
                    const unknownCardIndex = bot.knowledge[bot.id].findIndex(k => k === null);
                    // A low-value card (e.g. <=4) is a good candidate to replace an unknown card.
                    if (unknownCardIndex !== -1 && drawnCard.value <= 4) {
                        const discarded = bot.hand[unknownCardIndex];
                        bot.hand[unknownCardIndex] = drawnCard;
                        bot.knowledge[bot.id][unknownCardIndex] = drawnCard;
                        state.discardPile.push(discarded);
                        logAction(bot.id, 'swap', `用摸到的 ${drawnCard.value} 换掉了一张未知牌`);
                    } else {
                        // Otherwise, the drawn card is too high to risk, or there are no unknowns. Discard it.
                        state.discardPile.push(drawnCard);
                        logAction(bot.id, 'swap', `直接弃掉了摸到的 ${drawnCard.value}`);
                    }
                }
            }
        }
    }

    if (state.caboCalledBy === null) {
        const winProb = calculateWinProbabilityForPlayer(bot.id, PLAYER_UI_SIMULATION_COUNT);
        if (winProb >= BOT_CABO_WIN_PROB_THRESHOLD) {
            callCaboForBot(bot.id, winProb);
        }
    }

    setTimeout(nextTurn, 500);
}


// --- Win Prob, Rendering, End of Round ---
function calculateWinProbabilityForPlayer(playerId, simulationCount) {
    if (state.gamePhase === 'gameOver' || !state.players[playerId] || !state.players[playerId].hand.length) return 0;
    const perspectivePlayer = state.players[playerId];
    const knownCards = new Map();
    const addKnown = (card) => { if(card) knownCards.set(card.id, card); };
    state.discardPile.forEach(addKnown);
    for (let p = 0; p < NUM_PLAYERS; p++) {
        const player = state.players[p];
        if(!player) continue;
        for (let c = 0; c < player.hand.length; c++) {
            if (perspectivePlayer.knowledge[p][c]) {
                addKnown(perspectivePlayer.knowledge[p][c]);
            }
        }
    }
    const fullDeck = createDeck();
    const unknownCards = fullDeck.filter(card => !knownCards.has(card.id));
    if (unknownCards.length === 0) return 1.0;
    let wins = 0;
    for (let i = 0; i < simulationCount; i++) {
        const shuffledUnknowns = shuffle([...unknownCards]);
        let unknownCursor = 0;
        const simScores = Array(NUM_PLAYERS).fill(0);
        for (let p_idx = 0; p_idx < NUM_PLAYERS; p_idx++) {
            let currentScore = 0;
            const player = state.players[p_idx];
            if(!player) continue;
            for (let c_idx = 0; c_idx < player.hand.length; c_idx++) {
                const knownCard = perspectivePlayer.knowledge[p_idx][c_idx];
                if (knownCard) { currentScore += knownCard.points; } 
                else { currentScore += (shuffledUnknowns[unknownCursor++] || {points: 6.5}).points; }
            }
            simScores[p_idx] = currentScore;
        }
        const myScore = simScores[playerId];
        if (myScore <= Math.min(...simScores.filter(s => s !== null && s !== undefined))) { wins++; }
    }
    return wins / simulationCount;
}
function updateWinProbabilityForPlayerUI() {
    updateLog("正在计算胜率...");
    setTimeout(() => {
        const winProbability = calculateWinProbabilityForPlayer(0, PLAYER_UI_SIMULATION_COUNT);
        const percentage = (winProbability * 100).toFixed(1);
        winRateText.innerText = `${percentage}%`;
        winRateBar.style.width = `${percentage}%`;
        if (state.currentPlayerIndex === 0 && state.gamePhase === 'playing') {
             updateLog("轮到你了。从牌堆或弃牌堆摸一张牌。");
        } else if (state.gamePhase === 'playing') {
             updateLog(`轮到机器人 ${state.currentPlayerIndex} 了...`);
        }
    }, 50);
}
function render() {
    state.players.forEach((player, p_idx) => {
        const handDiv = document.querySelector(`#player-${p_idx} .hand`);
        handDiv.innerHTML = '';
        player.hand.forEach((card, c_idx) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card';
            
            const isKnownByHuman = state.players[0].knowledge[p_idx][c_idx];
            const isPubliclyFaceUp = card.isFaceUp === true;

            if (state.gamePhase === 'gameOver' || isKnownByHuman || isPubliclyFaceUp) {
                cardDiv.classList.add('face-up');
                if (useCardImages) {
                    cardDiv.classList.add('image-card');
                    cardDiv.style.backgroundImage = `url(${CARD_IMAGE_PATH}${card.value}.png)`;
                } else { cardDiv.innerText = card.value; }
            }

            // BUGFIX 1: Set up card clicks to call the correct swap function based on game phase.
            if (state.currentPlayerIndex === 0) {
                const phase = state.gamePhase;
                if (phase === 'multi_swap_selection' && p_idx === 0) {
                    cardDiv.classList.add('selectable');
                    if(state.actionState.selectedMultiSwapIndices.includes(c_idx)) { cardDiv.classList.add('selected'); }
                    cardDiv.onclick = () => selectCardForMultiSwap(c_idx);
                } else if ((phase === 'ability_peek_self' && p_idx === 0) ||
                    (phase === 'ability_peek_opponent' && p_idx !== 0) ||
                    (phase === 'ability_swap' && state.actionState.step === 'select_own_card' && p_idx === 0) ||
                    (phase === 'ability_swap' && state.actionState.step === 'select_opponent_card' && p_idx !== 0)) {
                    cardDiv.classList.add('selectable');
                    cardDiv.onclick = () => handleAbilityClick(p_idx, c_idx);
                } else if (phase === 'swapping_from_deck' && p_idx === 0) {
                    cardDiv.classList.add('selectable');
                    cardDiv.onclick = () => selectPlayerCardToSwapFromDeck(c_idx);
                } else if (phase === 'swapping_from_discard' && p_idx === 0) {
                    cardDiv.classList.add('selectable');
                    cardDiv.onclick = () => selectPlayerCardToSwapFromDiscard(c_idx);
                }
            }
            handDiv.appendChild(cardDiv);
        });
    });
    const discardPileDiv = document.querySelector('.discard');
    discardPileDiv.innerHTML = '';
    if (state.discardPile.length > 0) {
        const topCard = state.discardPile[state.discardPile.length - 1];
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card face-up';
        if (useCardImages) {
            cardDiv.classList.add('image-card');
            cardDiv.style.backgroundImage = `url(${CARD_IMAGE_PATH}${topCard.value}.png)`;
        } else { cardDiv.innerText = topCard.value; }
        discardPileDiv.appendChild(cardDiv);
    }
    const deckPileDiv = document.querySelector('.deck');
    if (state.currentPlayerIndex === 0 && state.gamePhase === 'playing') {
        discardPileDiv.onclick = state.discardPile.length > 0 ? drawFromDiscard : null;
        deckPileDiv.onclick = state.deck.length > 0 ? drawFromDeck : null;
    } else if (state.currentPlayerIndex === 0 && (state.gamePhase === 'swapping_from_deck' || state.gamePhase === 'post_draw_action')) {
        // Player can click discard pile to cancel the swap from deck
        discardPileDiv.onclick = discardDrawnCard;
        deckPileDiv.onclick = null;
    } else {
        discardPileDiv.onclick = null;
        deckPileDiv.onclick = null;
    }
}
function callCabo() {
    if (state.currentPlayerIndex !== 0) return;
    state.caboCalledBy = 0;
    state.lastTurnPlayer = (NUM_PLAYERS - 1 + state.currentPlayerIndex) % NUM_PLAYERS;
    caboButton.disabled = true;
    updateLog("你喊了'Cabo!'，本轮是最后一轮。");
    logAction(0, 'cabo', "喊了 Cabo!");
    nextTurn();
}
function callCaboForBot(botId, winProb) {
    state.caboCalledBy = botId;
    state.lastTurnPlayer = (botId - 1 + NUM_PLAYERS) % NUM_PLAYERS;
    caboButton.disabled = true;
    updateLog(`机器人 ${botId} 喊了'Cabo!'`);
    logAction(botId, 'cabo', `喊了 Cabo! (胜率: ${(winProb * 100).toFixed(1)}%)`);
}
function endRound() {
    state.gamePhase = 'gameOver';
    actionButtonsDiv.innerHTML = '';
    let scores = state.players.map(p => ({
        id: p.id, score: p.hand.reduce((sum, card) => sum + card.points, 0), penalty: 0
    }));
    let minScore = Math.min(...scores.map(s => s.score));
    let winners = scores.filter(s => s.score === minScore);
    if (state.caboCalledBy !== null) {
        const callerIsWinner = winners.some(w => w.id === state.caboCalledBy);
        if (!callerIsWinner) {
            const callerScore = scores.find(s => s.id === state.caboCalledBy);
            callerScore.penalty = CABO_FAIL_PENALTY;
            logAction('System', 'end', `${getPlayerName(state.caboCalledBy)} 喊Cabo失败，+${CABO_FAIL_PENALTY}分惩罚!`);
        }
    }
    let resultLog = "回合结束！亮牌！<br>";
    scores.forEach(s => {
        const totalScoreForRound = s.score + s.penalty;
        state.totalScores[s.id] += totalScoreForRound;
        resultLog += `${getPlayerName(s.id)} 本轮得分: ${s.score}${s.penalty > 0 ? ` (+${s.penalty})` : ''} = ${totalScoreForRound} (总分: ${state.totalScores[s.id]})<br>`;
        logAction('System', 'end', `${getPlayerName(s.id)} 分数: ${totalScoreForRound}`);
    });
    const winnerNames = winners.map(w => getPlayerName(w.id)).join(', ');
    resultLog += `<br><strong>本轮点数最低: ${winnerNames}!</strong>`;
    logAction('System', 'end', `胜利者: ${winnerNames}!`);
    updateLog(resultLog);
    renderScoreboard(scores);
    caboButton.disabled = true;
    startButton.innerText = "开始下一轮";
    startButton.onclick = startNewRound;
    render();
}

// Initial call
startGame();
