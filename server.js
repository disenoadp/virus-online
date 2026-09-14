const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const games = {}; 

function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];
    
    // 4 Órganos de cada color
    colors.forEach(color => {
        for (let i = 0; i < 4; i++) deck.push({ type: 'organ', color: color });
    });
    // 4 Virus de cada color
    colors.forEach(color => {
        for (let i = 0; i < 4; i++) deck.push({ type: 'virus', color: color });
    });
    // 4 Medicinas de cada color
    colors.forEach(color => {
        for (let i = 0; i < 4; i++) deck.push({ type: 'medicine', color: color });
    });
    
    // Cartas de Tratamiento (1 de cada una)
    const treatments = ['transplant', 'thief', 'contagion', 'latex', 'medical_error'];
    treatments.forEach(t => deck.push({ type: 'treatment', subtype: t }));

    // Barajar
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function checkWin(player) {
    if (player.organs.length !== 4) return false;
    const colors = player.organs.map(o => o.color);
    const uniqueColors = new Set(colors);
    if (uniqueColors.size !== 4) return false;
    if (player.organs.some(o => o.infected)) return false;
    return true;
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('createGame', (playerName) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomId] = {
            deck: createDeck(),
            players: [{ id: socket.id, name: playerName, hand: [], organs: [] }],
            turn: 0,
            started: false,
            over: false,
            winner: null
        };
        socket.join(roomId);
        socket.emit('gameCreated', roomId);
        socket.emit('updateState', games[roomId]);
    });

    socket.on('joinGame', ({ roomId, playerName }) => {
        const game = games[roomId];
        if (!game) return socket.emit('errorMessage', 'La sala no existe.');
        if (game.started) return socket.emit('errorMessage', 'La partida ya ha comenzado.');
        if (game.players.length >= 4) return socket.emit('errorMessage', 'Sala llena.');

        game.players.push({ id: socket.id, name: playerName, hand: [], organs: [] });
        socket.join(roomId);
        socket.emit('gameJoined', roomId);
        io.to(roomId).emit('updateState', game);
    });

    socket.on('startGame', (roomId) => {
        const game = games[roomId];
        if (!game || game.players.length < 2) return;
        
        game.started = true;
        game.players.forEach(player => {
            for (let i = 0; i < 3; i++) {
                if (game.deck.length > 0) player.hand.push(game.deck.pop());
            }
        });
        io.to(roomId).emit('updateState', game);
    });

    socket.on('playCard', ({ roomId, cardIndex, actionData }) => {
        const game = games[roomId];
        if (!game || game.over) return;
        
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== game.turn) return;

        const player = game.players[playerIndex];
        const card = player.hand[cardIndex];
        if (!card) return;

        let cardPlayed = false;

        // LÓGICA ÓRGANO
        if (card.type === 'organ') {
            if (player.organs.length >= 4) return socket.emit('errorMessage', 'Ya tienes 4 órganos.');
            if (player.organs.some(o => o.color === card.color)) return socket.emit('errorMessage', 'Ya tienes un órgano de ese color.');
            player.organs.push({ color: card.color, infected: false });
            cardPlayed = true;
        } 
        // LÓGICA VIRUS Y MEDICINA
        else if (card.type === 'virus' || card.type === 'medicine') {
            const targetPlayer = game.players.find(p => p.id === actionData.targetId);
            if (!targetPlayer) return;
            const targetOrgan = targetPlayer.organs.find(o => o.color === card.color);
            if (!targetOrgan) return socket.emit('errorMessage', 'El objetivo no tiene ese órgano.');

            if (card.type === 'virus') {
                if (targetOrgan.infected) targetPlayer.organs = targetPlayer.organs.filter(o => o !== targetOrgan);
                else targetOrgan.infected = true;
            } else if (card.type === 'medicine') {
                targetOrgan.infected = false;
            }
            cardPlayed = true;
        } 
        // LÓGICA TRATAMIENTOS
        else if (card.type === 'treatment') {
            switch(actionData.type) {
                case 'treatment_transplant':
                    const me = player;
                    const targetT = game.players.find(p => p.id === actionData.targetId);
                    const myOrgan = me.organs.find(o => o.color === actionData.myColor);
                    const theirOrgan = targetT.organs.find(o => o.color === actionData.targetColor);
                    if (myOrgan && theirOrgan) {
                        me.organs = me.organs.map(o => o === myOrgan ? theirOrgan : o);
                        targetT.organs = targetT.organs.map(o => o === theirOrgan ? myOrgan : o);
                        cardPlayed = true;
                    }
                    break;
                case 'treatment_thief':
                    const targetThief = game.players.find(p => p.id === actionData.targetId);
                    const organToSteal = targetThief.organs.find(o => o.color === actionData.targetColor);
                    if (organToSteal && !player.organs.some(o => o.color === organToSteal.color) && player.organs.length < 4) {
                        organToSteal.infected = false; // Se limpia al robar
                        player.organs.push(organToSteal);
                        targetThief.organs = targetThief.organs.filter(o => o !== organToSteal);
                        cardPlayed = true;
                    }
                    break;
                case 'treatment_contagion':
                    const myInfected = player.organs.find(o => o.color === actionData.myColor && o.infected);
                    const targetCont = game.players.find(p => p.id === actionData.targetId);
                    const destOrgan = targetCont.organs.find(o => o.color === actionData.targetColor);
                    if (myInfected && destOrgan) {
                        myInfected.infected = false;
                        if (destOrgan.infected) {
                            targetCont.organs = targetCont.organs.filter(o => o !== destOrgan);
                        } else {
                            destOrgan.infected = true;
                        }
                        cardPlayed = true;
                    }
                    break;
                case 'treatment_latex':
                    game.players.forEach(p => {
                        if (p.id !== socket.id) {
                            p.hand = [];
                            for(let i=0; i<3; i++) {
                                if (game.deck.length > 0) p.hand.push(game.deck.pop());
                            }
                        }
                    });
                    cardPlayed = true;
                    break;
                case 'treatment_medical_error':
                    const targetME = game.players.find(p => p.id === actionData.targetId);
                    if (targetME) {
                        const tempOrgans = player.organs;
                        player.organs = targetME.organs;
                        targetME.organs = tempOrgans;
                        cardPlayed = true;
                    }
                    break;
            }
        }

        if (cardPlayed) {
            player.hand.splice(cardIndex, 1);
            if (game.deck.length > 0) player.hand.push(game.deck.pop());

            // Comprobar victoria
            if (checkWin(player)) {
                game.over = true;
                game.winner = player.name;
            } else {
                game.turn = (game.turn + 1) % game.players.length;
            }
            io.to(roomId).emit('updateState', game);
        }
    });

    socket.on('discardCard', ({ roomId, cardIndex }) => {
        const game = games[roomId];
        if (!game || game.over) return;
        
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== game.turn) return;

        const player = game.players[playerIndex];
        if (cardIndex < 0 || cardIndex >= player.hand.length) return;

        player.hand.splice(cardIndex, 1);
        if (game.deck.length > 0) player.hand.push(game.deck.pop());

        game.turn = (game.turn + 1) % game.players.length;
        io.to(roomId).emit('updateState', game);
    });

    socket.on('disconnect', () => {
        for (const roomId in games) {
            const game = games[roomId];
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                game.players.splice(playerIndex, 1);
                if (game.players.length === 0) {
                    delete games[roomId];
                } else {
                    if (game.turn > playerIndex) game.turn--;
                    io.to(roomId).emit('updateState', game);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
