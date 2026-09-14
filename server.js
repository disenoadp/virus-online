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
    
    colors.forEach(color => {
        for (let i = 0; i < 4; i++) {
            deck.push({ type: 'organ', color: color });
        }
    });
    
    colors.forEach(color => {
        for (let i = 0; i < 2; i++) {
            deck.push({ type: 'virus', color: color });
        }
    });

    colors.forEach(color => {
        for (let i = 0; i < 2; i++) {
            deck.push({ type: 'medicine', color: color });
        }
    });

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('createGame', (playerName) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomId] = {
            deck: createDeck(),
            players: [{ id: socket.id, name: playerName, hand: [], organs: [] }],
            turn: 0,
            started: false
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

    socket.on('playCard', ({ roomId, cardIndex, targetType, targetId }) => {
        const game = games[roomId];
        if (!game) return;
        
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== game.turn) return; 

        const player = game.players[playerIndex];
        const card = player.hand[cardIndex];

        if (!card) return;

        if (card.type === 'organ') {
            if (!player.organs.some(o => o.color === card.color)) {
                player.organs.push({ color: card.color, infected: false });
                player.hand.splice(cardIndex, 1);
            } else {
                return socket.emit('errorMessage', 'Ya tienes un órgano de ese color.');
            }
        } 
        else if (card.type === 'virus' || card.type === 'medicine') {
            const targetPlayer = game.players.find(p => p.id === targetId);
            if (!targetPlayer) return;

            const targetOrgan = targetPlayer.organs.find(o => o.color === card.color);
            if (!targetOrgan) return socket.emit('errorMessage', 'El objetivo no tiene ese órgano.');

            if (card.type === 'virus') {
                if (targetOrgan.infected) {
                    targetPlayer.organs = targetPlayer.organs.filter(o => o !== targetOrgan);
                } else {
                    targetOrgan.infected = true; 
                }
            } else if (card.type === 'medicine') {
                targetOrgan.infected = false; 
            }
            player.hand.splice(cardIndex, 1);
        }

        if (game.deck.length > 0) {
            player.hand.push(game.deck.pop());
        }

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
