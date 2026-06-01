socket.on('nextGameQuestion', (q) => {
    // Hide Lobby Overlays, Open Playboard Matrix
    document.getElementById('box-lobby-players').style.display = 'none';
    document.getElementById('btn-master-start').style.display = 'none';
    document.getElementById('board-live-interactive').style.display = 'block';
    
    // Inject Question Values
    document.getElementById('label-active-question').innerText = q.question;
    for(let i=0; i<4; i++) {
        document.getElementById(`choice-${i}`).innerText = q.answers[i] || '---';
    }
});

socket.on('answerFeedback', (data) => {
    // Dynamically update upper layout stats directly inside your engine
    document.getElementById('stat-gold').innerText = data.currentResources;
    document.getElementById('stat-score').innerText = data.newScoreTotal || '200';
});
