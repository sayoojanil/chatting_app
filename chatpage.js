let socket;
    let username = '';
    let isTyping = false;
    let typingTimeout;
    let typingUsers = new Set();
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let recordingStartTime;
    let waveSurfers = new Map();

    // Debounce function to limit typing event emissions
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function loadMessages() {
        const savedMessages = localStorage.getItem('chatMessages');
        if (savedMessages) {
            const messages = JSON.parse(savedMessages);
            messages.forEach(msg => {
                const id = msg.id || '';
                if (msg.type === 'system') {
                    let messageType = 'default';
                    if (msg.message.includes('Connected to chat!')) {
                        messageType = 'connected';
                    } else if (msg.message.includes('Disconnected from chat.') || msg.message.includes('You have logged out.') || msg.message.includes('Chat cleared.')) {
                        messageType = 'disconnected';
                    }
                    addSystemMessage(msg.message, messageType);
                } else if (msg.type === 'image') {
                    addImageMessage(msg.sender, msg.image, msg.sender === username, id);
                } else if (msg.type === 'voice') {
                    addVoiceMessage(msg.sender, msg.audio, msg.duration, msg.sender === username, id);
                } else {
                    addMessage(msg.sender, msg.message, msg.sender === username, id);
                }
            });
        }
    }

    function triggerImageInput() {
        document.getElementById('imageInput').click();
    }

    function sendImage(event) {
        const file = event.target.files[0];
        if (!file || !socket.connected) {
            addSystemMessage('Cannot send image: Not connected to server or no file selected.', 'default');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const base64Image = e.target.result;
            const data = { username, image: base64Image };
            socket.emit('image', data);
            socket.emit('stopTyping', { username });
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    async function toggleRecording() {
        if (!socket.connected) {
            addSystemMessage('Cannot record: Not connected to server.', 'disconnected');
            return;
        }

        const recordButton = document.querySelector('.record-button');
        const recordText = document.getElementById('recordText');

        if (!isRecording) {
            try {
                // Request microphone access
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunks = [];
                recordingStartTime = Date.now();

                mediaRecorder.ondataavailable = (e) => {
                    audioChunks.push(e.data);
                };

                mediaRecorder.onstop = () => {
                    const duration = Math.round((Date.now() - recordingStartTime) / 1000);
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64Audio = reader.result;
                        socket.emit('voice', { username, audio: base64Audio, duration });
                        socket.emit('stopTyping', { username });
                    };
                    reader.readAsDataURL(audioBlob);
                };

                mediaRecorder.start();
                isRecording = true;
                recordButton.classList.add('recording');
                recordText.textContent = 'Stop';
                socket.emit('typing', { username });
            } catch (err) {
                console.error('Microphone error:', err);
                let errorMessage = 'Failed to access microphone.';
                if (err.name === 'NotAllowedError') {
                    errorMessage = 'Microphone access denied by the system. Please check your OS microphone settings, ensure no other app is using it, and refresh the page to re-request permission.';
                } else if (err.name === 'NotFoundError') {
                    errorMessage = 'No microphone detected. Please connect a microphone and try again.';
                } else if (err.name === 'NotReadableError') {
                    errorMessage = 'Microphone is in use by another application. Please close other apps and try again.';
                } else if (err.name === 'AbortError') {
                    errorMessage = 'Microphone access was interrupted. Please refresh the page and try again.';
                }
                addSystemMessage(errorMessage, 'disconnected');
            }
        } else {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            isRecording = false;
            recordButton.classList.remove('recording');
            recordText.textContent = 'Record';
            socket.emit('stopTyping', { username });
        }
    }

    function addMessage(sender, message, isSent, id = '') {
        const messages = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.dataset.messageId = id;
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isSent) {
            messageDiv.innerHTML = `
                <div class="message-content">${message}</div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-sender">${sender}</div>
                <div class="message-content">${message}</div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        }
        
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
    }

    function addImageMessage(sender, image, isSent, id = '') {
        const messages = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.dataset.messageId = id;
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isSent) {
            messageDiv.innerHTML = `
                <div class="message-content"><img src="${image}" style="max-width:180px;max-height:180px;border-radius:8px;box-shadow:0 2px 8px #0002"></div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-sender">${sender}</div>
                <div class="message-content"><img src="${image}" style="max-width:180px;max-height:180px;border-radius:8px;box-shadow:0 2px 8px #0002"></div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        }
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
    }

    function addVoiceMessage(sender, audio, duration, isSent, id = '') {
        const messages = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.dataset.messageId = id;
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const durationText = `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`;
        const waveformId = `waveform-${id || Date.now()}`;

        if (isSent) {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="audio-player-container">
                        <button class="audio-control-button" data-waveform-id="${waveformId}">
                            <i class="fas fa-play"></i>
                        </button>
                        <div class="waveform-container">
                            <div id="${waveformId}" class="waveform"></div>
                            <div class="audio-progress" style="width: 0%"></div>
                        </div>
                        <span class="audio-time">0:00 / ${durationText}</span>
                    </div>
                </div>
                <div class="audio-duration">${durationText}</div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-sender">${sender}</div>
                <div class="message-content">
                    <div class="audio-player-container">
                        <button class="audio-control-button" data-waveform-id="${waveformId}">
                            <i class="fas fa-play"></i>
                        </button>
                        <div class="waveform-container">
                            <div id="${waveformId}" class="waveform"></div>
                            <div class="audio-progress" style="width: 0%"></div>
                        </div>
                        <span class="audio-time">0:00 / ${durationText}</span>
                    </div>
                </div>
                <div class="audio-duration">${durationText}</div>
                <div class="timestamp">${timeString}</div>
                <div class="seen-indicator"></div>
            `;
        }
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;

        // Initialize WaveSurfer
        const wavesurfer = WaveSurfer.create({
            container: `#${waveformId}`,
            waveColor: isSent ? '#93c5fd' : '#d1d5db',
            progressColor: 'transparent',
            cursorColor: 'transparent',
            height: 40,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            normalize: true,
            responsive: true
        });

        wavesurfer.load(audio);
        waveSurfers.set(waveformId, wavesurfer);

        const playButton = messageDiv.querySelector('.audio-control-button');
        const progressBar = messageDiv.querySelector('.audio-progress');
        const timeDisplay = messageDiv.querySelector('.audio-time');

        wavesurfer.on('ready', () => {
            playButton.onclick = () => {
                wavesurfer.playPause();
                playButton.innerHTML = wavesurfer.isPlaying() ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
            };

            wavesurfer.on('audioprocess', () => {
                const currentTime = wavesurfer.getCurrentTime();
                const totalDuration = wavesurfer.getDuration();
                const progress = (currentTime / totalDuration) * 100;
                progressBar.style.width = `${progress}%`;
                timeDisplay.textContent = `${formatTime(currentTime)} / ${durationText}`;
            });

            wavesurfer.on('finish', () => {
                wavesurfer.stop();
                playButton.innerHTML = '<i class="fas fa-play"></i>';
                progressBar.style.width = '0%';
                timeDisplay.textContent = `0:00 / ${durationText}`;
            });

            // Make waveform seekable
            const waveformContainer = messageDiv.querySelector('.waveform');
            waveformContainer.addEventListener('click', (e) => {
                const rect = waveformContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const width = rect.width;
                const seekPosition = x / width;
                wavesurfer.seekTo(seekPosition);
            });

            // Update waveform on resize
            window.addEventListener('resize', () => {
                wavesurfer.drawBuffer();
            });
        });
    }

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    function saveMessage(messageObj) {
        const savedMessages = localStorage.getItem('chatMessages');
        const messages = savedMessages ? JSON.parse(savedMessages) : [];
        messages.push(messageObj);
        localStorage.setItem('chatMessages', JSON.stringify(messages));
    }

    function clearChat() {
        if (!confirm('Are you sure you want to clear all chat messages? This action cannot be undone.')) {
            return;
        }
        // Clear WaveSurfer instances
        waveSurfers.forEach((ws) => ws.destroy());
        waveSurfers.clear();
        // Clear messages from UI
        const messages = document.getElementById('messages');
        messages.innerHTML = '';
        // Clear localStorage
        localStorage.removeItem('chatMessages');
        // Add system message
        const systemMessage = { type: 'system', message: 'Chat cleared.' };
        addSystemMessage(systemMessage.message, 'disconnected');
        saveMessage(systemMessage);
    }

    function registerUser() {
        const usernameInput = document.getElementById('username').value.trim();
        const error = document.getElementById('error');
        const errorText = document.getElementById('error-text');
        
        if (usernameInput.length < 3) {
            errorText.textContent = 'Username must be at least 3 characters long';
            error.classList.remove('hidden');
            return;
        }

        username = usernameInput;
        localStorage.setItem('username', username);
        document.getElementById('register').classList.add('hidden');
        document.getElementById('chat').classList.remove('hidden');
        document.getElementById('currentUser').textContent = `@${username}`;
        document.getElementById('userNameDisplay').classList.remove('hidden');
        
        loadMessages();
        
        socket = io('https://chat-server-gs4g.onrender.com');
        
        socket.on('connect', () => {
            console.log('Connected to Socket.IO');
            const systemMessage = { type: 'system', message: 'Connected to chat!' };
            addSystemMessage(systemMessage.message, 'connected');
            saveMessage(systemMessage);
            socket.emit('join', username);
            document.getElementById('statusText').textContent = 'Online';
        });
        
        socket.on('connect_error', (err) => {
            console.log('Connection error:', err.message);
            const systemMessage = { type: 'system', message: 'Failed to connect to server: ' + err.message };
            addSystemMessage(systemMessage.message, 'disconnected');
            saveMessage(systemMessage);
            document.getElementById('statusText').textContent = 'Offline';
        });
        
        socket.on('message', (data) => {
            console.log('Received message:', data);
            addMessage(data.username, data.message, data.username === username, data.id);
            saveMessage({ type: 'message', sender: data.username, message: data.message, id: data.id });
            if (data.username !== username) {
                socket.emit('seen', { messageId: data.id, username });
            }
            typingUsers.delete(data.username);
            updateTypingIndicator();
        });

        socket.on('image', (data) => {
            console.log('Received image:', data);
            addImageMessage(data.username, data.image, data.username === username, data.id);
            saveMessage({ type: 'image', sender: data.username, image: data.image, id: data.id });
            if (data.username !== username) {
                socket.emit('seen', { messageId: data.id, username });
            }
            typingUsers.delete(data.username);
            updateTypingIndicator();
        });

        socket.on('voice', (data) => {
            console.log('Received voice:', data);
            addVoiceMessage(data.username, data.audio, data.duration, data.username === username, data.id);
            saveMessage({ type: 'voice', sender: data.username, audio: data.audio, duration: data.duration, id: data.id });
            if (data.username !== username) {
                socket.emit('seen', { messageId: data.id, username });
            }
            typingUsers.delete(data.username);
            updateTypingIndicator();
        });
        
        socket.on('seen_update', (data) => {
            console.log('Received seen_update:', data);
            const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageDiv) {
                const seenElem = messageDiv.querySelector('.seen-indicator');
                if (seenElem) {
                    seenElem.textContent = data.seenBy.length > 0 ? `Seen by ${data.seenBy.join(', ')}` : '';
                }
            }
        });
        
        socket.on('typing', (data) => {
            console.log(`${data.username} is typing (received)`);
            if (data.username !== username) {
                typingUsers.add(data.username);
                updateTypingIndicator();
            }
        });

        socket.on('stopTyping', (data) => {
            console.log(`${data.username} stopped typing (received)`);
            typingUsers.delete(data.username);
            updateTypingIndicator();
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from Socket.IO');
            const systemMessage = { type: 'system', message: 'Disconnected from chat.' };
            addSystemMessage(systemMessage.message, 'disconnected');
            saveMessage(systemMessage);
            document.getElementById('statusText').textContent = 'Offline';
            document.getElementById('userNameDisplay').classList.add('hidden');
        });
    }

    function sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (message && socket.connected) {
            const data = { username, message };
            console.log('Sending message:', data);
            socket.emit('message', data);
            input.value = '';
            input.focus();
            if (isTyping) {
                isTyping = false;
                socket.emit('stopTyping', { username });
                console.log('Emitted stopTyping event after sending message');
            }
        } else if (!socket.connected) {
            const systemMessage = { type: 'system', message: 'Cannot send message: Not connected to server.' };
            addSystemMessage(systemMessage.message, 'disconnected');
            saveMessage(systemMessage);
        }
    }

    function logout() {
        if (socket) {
            socket.emit('stopTyping', { username });
            socket.disconnect();
        }
        // Clean up WaveSurfer instances
        waveSurfers.forEach((ws) => ws.destroy());
        waveSurfers.clear();
        localStorage.removeItem('username');
        document.getElementById('chat').classList.add('hidden');
        document.getElementById('register').classList.remove('hidden');
        document.getElementById('username').value = '';
        document.getElementById('username').focus();
        document.getElementById('userNameDisplay').classList.add('hidden');
        const systemMessage = { type: 'system', message: 'You have logged out.' };
        addSystemMessage(systemMessage.message, 'disconnected');
        saveMessage(systemMessage);
    }

    function addSystemMessage(message, messageType = 'default') {
        const messages = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        if (messageType === 'connected') {
            messageDiv.classList.add('system-message-connected');
            messageDiv.innerHTML = `<i class="fas fa-plug"></i> ${message}`;
        } else if (messageType === 'disconnected') {
            messageDiv.classList.add('system-message-disconnected');
            messageDiv.innerHTML = `<i class="fas fa-power-off"></i> ${message}`;
        } else {
            messageDiv.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
        }
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
        if (messageType === 'connected' || messageType === 'disconnected') {
            setTimeout(() => {
                messageDiv.style.transition = 'opacity 0.5s ease';
                messageDiv.style.opacity = '0';
                setTimeout(() => {
                    messageDiv.remove();
                }, 500);
            }, 3000);
        }
    }

    function updateTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (typingUsers.size === 0) {
            indicator.classList.add('hidden');
            indicator.textContent = '';
        } else {
            let text;
            const usersArray = Array.from(typingUsers);
            if (typingUsers.size === 1) {
                text = `${usersArray[0]} is typing`;
            } else if (typingUsers.size === 2) {
                text = `${usersArray[0]} and ${usersArray[1]} are typing`;
            } else {
                text = 'Several people are typing';
            }
            indicator.innerHTML = ` ${text}`;
            indicator.classList.remove('hidden');
            const messages = document.getElementById('messages');
            messages.scrollTop = messages.scrollHeight;
        }
    }

    function handleTyping() {
        const input = document.getElementById('messageInput');
        if (!socket || !socket.connected) {
            console.log('Cannot send typing event: Not connected');
            return;
        }

        if (!isTyping && input.value.trim().length > 0) {
            isTyping = true;
            socket.emit('typing', { username });
            console.log('Emitted typing event');
        }

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (isTyping) {
                isTyping = false;
                socket.emit('stopTyping', { username });
                console.log('Emitted stopTyping event');
            }
        }, 2000);
    }

    document.getElementById('messageInput').addEventListener('input', debounce(handleTyping, 300));
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        } else {
            debounce(handleTyping, 300)();
        }
    });

    document.getElementById('username').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') registerUser();
    });

    window.addEventListener('DOMContentLoaded', () => {
        const savedUsername = localStorage.getItem('username');
        if (savedUsername && savedUsername.length >= 3) {
            document.getElementById('username').value = savedUsername;
            registerUser();
        } else {
            document.getElementById('username').focus();
        }
    });

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    window.addEventListener('resize', () => {
        const messages = document.getElementById('messages');
        messages.scrollTop = messages.scrollHeight;
    });