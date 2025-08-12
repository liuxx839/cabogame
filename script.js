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
const HISTORY_SIMULATION_COUNT = 500;
const BOT_CABO_WIN_PROB_THRESHOLD = 0.70;

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
    state.gamePhase = 'swapping';
    updateLog(`你从弃牌堆拿了 ${state.drawnCard.value}。必须选择一张手牌替换。`);
    render();
}
function selectPlayerCardToSwap(cardIndex) {
    if (state.gamePhase !== 'swapping' || !state.drawnCard) return;
    const player = state.players[0];
    const discardedCard = player.hand[cardIndex];
    player.hand[cardIndex] = state.drawnCard;
    player.knowledge[0][cardIndex] = state.drawnCard;
    state.discardPile.push(discardedCard);
    logAction(0, 'swap', `用 ${state.drawnCard.value} 换掉了手牌 (原为 ${discardedCard.value})`);
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
    discardBtn.onclick = () => {
        state.gamePhase = 'swapping';
        actionButtonsDiv.innerHTML = '';
        updateLog('选择一张手牌替换，或点击弃牌堆放弃。');
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

                // MODIFIED: Store knowledge from player's perspective BEFORE the swap
                const ownCardKnowledge = player.knowledge[0][ownCardIndex];
                const opponentCardKnowledge = player.knowledge[playerId][opponentCardIndex];

                // Perform the physical swap
                const temp = player.hand[ownCardIndex];
                player.hand[ownCardIndex] = opponent.hand[opponentCardIndex];
                opponent.hand[opponentCardIndex] = temp;

                // MODIFIED: Update player's knowledge based on pre-swap state
                // The knowledge of your new card is what you knew about the card you received.
                // The knowledge of the opponent's new card is what you knew about the card you gave.
                player.knowledge[0][ownCardIndex] = opponentCardKnowledge;
                player.knowledge[playerId][opponentCardIndex] = ownCardKnowledge;

                // Opponent now knows the card they received in the swap
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

// --- MODIFIED: Bot Ability AI ---
/**
 * Decides if and how a bot should use a card's ability.
 * @param {object} bot The bot player object.
 * @param {object} drawnCard The card with an ability.
 * @returns {boolean} True if an ability was successfully used, false otherwise.
 */
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
            return false; // No unknown cards to peek
        }

        case 'peek_opponent': {
            const opponentIds = Array.from({ length: NUM_PLAYERS }, (_, i) => i).filter(id => id !== bot.id);
            shuffle(opponentIds); // Randomize opponent order
            for (const pId of opponentIds) {
                const unknownCardIndex = bot.knowledge[pId].findIndex(k => k === null);
                if (unknownCardIndex !== -1 && unknownCardIndex < state.players[pId].hand.length) {
                    const targetCard = state.players[pId].hand[unknownCardIndex];
                    bot.knowledge[pId][unknownCardIndex] = targetCard;
                    logAction(bot.id, 'ability', `使用 ${drawnCard.value} 的能力，查看了 ${getPlayerName(pId)} 的一张牌 (是 ${targetCard.value})`);
                    return true;
                }
            }
            return false; // All opponent cards are known
        }

        case 'swap': {
            // Find bot's highest known card to trade away
            let [maxKnownValue, ownCardToSwapIndex] = [-1, -1];
            bot.knowledge[bot.id].forEach((card, i) => {
                if (card && card.value > maxKnownValue) {
                    maxKnownValue = card.value;
                    ownCardToSwapIndex = i;
                }
            });

            // Only swap if we have a known high card (e.g., > 6 is a reasonable threshold)
            if (ownCardToSwapIndex === -1 || maxKnownValue <= 6) {
                return false;
            }

            const opponentIds = Array.from({ length: NUM_PLAYERS }, (_, i) => i).filter(id => id !== bot.id);

            // --- STRATEGY 1: PRIORITIZE swapping with a a KNOWN low-value opponent card ---
            let bestTarget = { value: Infinity, pId: -1, cardIndex: -1 };
            for (const pId of opponentIds) {
                bot.knowledge[pId].forEach((card, c_idx) => {
                    if (card && card.value < bestTarget.value) {
                        bestTarget = { value: card.value, pId, cardIndex: c_idx };
                    }
                });
            }
            
            // If a beneficial swap with a known card is found, execute it.
            if (bestTarget.pId !== -1 && maxKnownValue > bestTarget.value) {
                const { pId, cardIndex } = bestTarget;
                const opponent = state.players[pId];

                // Store knowledge for correct update
                const ownCardKnowledge = bot.knowledge[bot.id][ownCardToSwapIndex];
                const opponentCardKnowledge = bot.knowledge[pId][cardIndex]; // This is known

                // Swap cards
                const temp = bot.hand[ownCardToSwapIndex];
                bot.hand[ownCardToSwapIndex] = opponent.hand[cardIndex];
                opponent.hand[cardIndex] = temp;

                // Update knowledge based on pre-swap state
                bot.knowledge[bot.id][ownCardToSwapIndex] = opponentCardKnowledge;
                bot.knowledge[pId][cardIndex] = ownCardKnowledge;
                opponent.knowledge[pId][cardIndex] = opponent.hand[cardIndex]; // Opponent knows what they received

                logAction(bot.id, 'ability', `使用 ${drawnCard.value} 能力，用自己的 ${maxKnownValue} 与 ${getPlayerName(pId)} 的已知牌 ${bestTarget.value} 交换`);
                return true;
            }

            // --- STRATEGY 2 (Fallback): Swap with an UNKNOWN opponent card ---
            shuffle(opponentIds);
            for (const pId of opponentIds) {
                 const opponent = state.players[pId];
                 const opponentCardIndex = bot.knowledge[pId].findIndex(k => k === null);

                if (opponentCardIndex !== -1 && opponentCardIndex < opponent.hand.length) {
                    // Store knowledge for correct update
                    const ownCardKnowledge = bot.knowledge[bot.id][ownCardToSwapIndex];
                    const opponentCardKnowledge = null; // Card is unknown

                    // Swap cards
                    const temp = bot.hand[ownCardToSwapIndex];
                    bot.hand[ownCardToSwapIndex] = opponent.hand[opponentCardIndex];
                    opponent.hand[opponentCardIndex] = temp;

                    // Update knowledge based on pre-swap state
                    bot.knowledge[bot.id][ownCardToSwapIndex] = opponentCardKnowledge; // Becomes unknown (null)
                    bot.knowledge[pId][opponentCardIndex] = ownCardKnowledge;
                    opponent.knowledge[pId][opponentCardIndex] = opponent.hand[opponentCardIndex]; // Opponent knows their new card

                    logAction(bot.id, 'ability', `使用 ${drawnCard.value} 能力，用自己的 ${maxKnownValue} 与 ${getPlayerName(pId)} 的一张未知牌交换`);
                    return true;
                }
            }
            return false; // Didn't find any suitable swap
        }
    }
    return false;
}


// --- REFACTORED: Bot AI Turn ---
function botTurn() {
    const bot = state.players[state.currentPlayerIndex];
    const topDiscard = state.discardPile[state.discardPile.length - 1];

    // Find bot's highest known card value and its index
    let [maxKnownValue, maxKnownIndex] = [-1, -1];
    bot.knowledge[bot.id].forEach((card, i) => {
        if (card && card.value > maxKnownValue) {
            maxKnownValue = card.value;
            maxKnownIndex = i;
        }
    });

    // Step 1: Check if the discard pile top is a good, low-value card
    if (topDiscard && topDiscard.value <= 4 && (maxKnownIndex === -1 || topDiscard.value < maxKnownValue)) {
        const drawnCard = state.discardPile.pop();
        // If bot knows a high card, swap it. Otherwise, guess a card to replace.
        const indexToSwap = (maxKnownIndex !== -1) ? maxKnownIndex : Math.floor(Math.random() * bot.hand.length);
        const discarded = bot.hand[indexToSwap];
        bot.hand[indexToSwap] = drawnCard;
        bot.knowledge[bot.id][indexToSwap] = drawnCard; // Bot knows the new card
        state.discardPile.push(discarded);
        logAction(bot.id, 'draw', `从弃牌堆拿 ${drawnCard.value} 替换了一张牌 (原为 ${discarded.value})`);
    
    // Step 2: If discard is not taken, draw from deck
    } else {
        if (state.deck.length === 0) {
            logAction(bot.id, 'draw', '发现牌堆已空, 跳过回合');
            setTimeout(nextTurn, 500);
            return;
        }
        const drawnCard = state.deck.pop();
        logAction(bot.id, 'draw', `从牌堆摸了一张牌 (${drawnCard.value})`);

        // Step 3: Try to use the drawn card's ability
        let usedAbility = false;
        if (drawnCard.ability !== 'none') {
            usedAbility = executeBotAbility(bot, drawnCard);
        }

        // Step 4: If ability was used, discard the drawn card and end.
        // If not, proceed with normal swap/discard logic.
        if (usedAbility) {
            state.discardPile.push(drawnCard);
        } else {
            // Find the highest known card *again* in case an ability changed it (though current logic doesn't)
             let [currentMaxKnownValue, currentMaxKnownIndex] = [-1, -1];
             bot.knowledge[bot.id].forEach((card, i) => {
                 if (card && card.value > currentMaxKnownValue) {
                     currentMaxKnownValue = card.value;
                     currentMaxKnownIndex = i;
                 }
             });

            // Decide whether to swap the drawn card with a card in hand
            const valueToReplace = (currentMaxKnownIndex !== -1) ? currentMaxKnownValue : 14; // Assume 14 (worse than any card) if no card is known
            
            if (drawnCard.value < valueToReplace) {
                 const indexToSwap = (currentMaxKnownIndex !== -1) ? currentMaxKnownIndex : Math.floor(Math.random() * bot.hand.length);
                 const discarded = bot.hand[indexToSwap];
                 bot.hand[indexToSwap] = drawnCard;
                 bot.knowledge[bot.id][indexToSwap] = drawnCard; // Bot knows the new card
                 state.discardPile.push(discarded);
                 logAction(bot.id, 'swap', `用摸到的 ${drawnCard.value} 换了一张牌 (原为 ${discarded.value})`);
            } else {
                state.discardPile.push(drawnCard);
                logAction(bot.id, 'swap', `直接弃掉了摸到的 ${drawnCard.value}`);
            }
        }
    }

    // Step 5: After any action, check if it's a good time to call Cabo
    if (state.caboCalledBy === null) {
        const winProb = calculateWinProbabilityForPlayer(bot.id, PLAYER_UI_SIMULATION_COUNT);
        if (winProb >= BOT_CABO_WIN_PROB_THRESHOLD) {
            callCaboForBot(bot.id, winProb);
        }
    }

    // End turn
    setTimeout(nextTurn, 500);
}


// --- Win Prob, Rendering, End of Round (Unchanged from original) ---
function calculateWinProbabilityForPlayer(playerId, simulationCount) {
    if (state.gamePhase === 'gameOver' || !state.players[playerId].hand.length) return 0;
    const perspectivePlayer = state.players[playerId];
    const knownCards = new Map();
    const addKnown = (card) => { if(card) knownCards.set(card.id, card); };
    state.discardPile.forEach(addKnown);
    for (let p = 0; p < NUM_PLAYERS; p++) {
        for (let c = 0; c < state.players[p].hand.length; c++) {
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
            for (let c_idx = 0; c_idx < state.players[p_idx].hand.length; c_idx++) {
                const knownCard = perspectivePlayer.knowledge[p_idx][c_idx];
                if (knownCard) { currentScore += knownCard.points; } 
                else { currentScore += (shuffledUnknowns[unknownCursor++] || {points: 6.5}).points; }
            }
            simScores[p_idx] = currentScore;
        }
        const myScore = simScores[playerId];
        if (myScore <= Math.min(...simScores)) { wins++; }
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
            const isKnown = state.players[0].knowledge[p_idx][c_idx] || (p_idx === 0 && state.players[0].knowledge[0][c_idx]);
            if (state.gamePhase === 'gameOver' || isKnown) {
                cardDiv.classList.add('face-up');
                if (useCardImages) {
                    cardDiv.classList.add('image-card');
                    cardDiv.style.backgroundImage = `url(${CARD_IMAGE_PATH}${card.value}.png)`;
                } else { cardDiv.innerText = card.value; }
            }
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
                } else if (phase === 'swapping' && p_idx === 0) {
                    cardDiv.classList.add('selectable');
                    cardDiv.onclick = () => selectPlayerCardToSwap(c_idx);
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
    } else if (state.currentPlayerIndex === 0 && (state.gamePhase === 'swapping' || state.gamePhase === 'post_draw_action')) {
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
