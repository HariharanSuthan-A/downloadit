document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const pasteBtn = document.getElementById('pasteBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const statusArea = document.getElementById('statusArea');
    const resultArea = document.getElementById('resultArea');
    const statusText = document.getElementById('statusText');
    const videoOptions = document.getElementById('videoOptions');
    const audioOptions = document.getElementById('audioOptions');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const newDownloadBtn = document.getElementById('newDownloadBtn');

    // Media Details Elements
    const mediaThumb = document.getElementById('mediaThumb');
    const mediaDuration = document.getElementById('mediaDuration');
    const mediaTitle = document.getElementById('mediaTitle');
    const mediaPlatform = document.getElementById('mediaPlatform');
    const mediaUploader = document.getElementById('mediaUploader');
    const mediaDesc = document.getElementById('mediaDesc');

    let currentMediaData = null;

    // Paste from clipboard
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            urlInput.focus();
        } catch (err) {
            console.error('Failed to read clipboard', err);
        }
    });

    // Handle Analysis
    analyzeBtn.addEventListener('click', analyzeMedia);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') analyzeMedia();
    });

    async function analyzeMedia() {
        const url = urlInput.value.trim();
        if (!url) {
            alert('Please paste a URL first');
            return;
        }

        // Show loading state
        analyzeBtn.disabled = true;
        statusArea.classList.remove('hidden');
        resultArea.classList.add('hidden');
        statusText.textContent = 'Connecting to server...';

        try {
            const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch media info');
            }

            currentMediaData = data;
            displayResults(data);
        } catch (err) {
            alert(err.message);
            statusArea.classList.add('hidden');
        } finally {
            analyzeBtn.disabled = false;
        }
    }

    function displayResults(data) {
        statusArea.classList.add('hidden');
        resultArea.classList.remove('hidden');

        // Set metadata
        mediaThumb.src = data.thumbnail || 'https://via.placeholder.com/640x360?text=No+Thumbnail';
        mediaDuration.textContent = data.duration;
        mediaTitle.textContent = data.title;
        mediaPlatform.textContent = data.platform;
        mediaUploader.textContent = data.uploader;
        mediaDesc.textContent = data.description || 'No description available.';

        // Render Video Options
        videoOptions.innerHTML = '';
        data.videoFormats.forEach(fmt => {
            videoOptions.appendChild(createOptionCard(fmt, data.title, false));
        });

        // Render Audio Options
        audioOptions.innerHTML = '';
        data.audioFormats.forEach(fmt => {
            audioOptions.appendChild(createOptionCard(fmt, data.title, true));
        });

        // Add MP3 conversion option if ffmpeg is available
        if (data.ffmpegAvailable) {
            audioOptions.appendChild(createConversionCard('MP3', 'mp3', data.title));
            audioOptions.appendChild(createConversionCard('M4A', 'm4a', data.title));
        }
    }

    function createOptionCard(fmt, title, isAudio) {
        const card = document.createElement('div');
        card.className = 'option-card';
        
        const label = isAudio ? `${fmt.ext.toUpperCase()} Audio` : fmt.qualityLabel;
        const meta = isAudio ? fmt.bitrate : `${fmt.ext.toUpperCase()} • ${fmt.filesizeStr}`;

        card.innerHTML = `
            <div class="option-info">
                <span class="opt-label">${label}</span>
                <span class="opt-meta">${meta}</span>
            </div>
            <button class="dl-btn" title="Download">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
        `;

        card.querySelector('.dl-btn').addEventListener('click', () => {
            window.location.href = `/api/download?url=${encodeURIComponent(urlInput.value)}&formatId=${fmt.formatId}&filename=${encodeURIComponent(title)}`;
        });

        return card;
    }

    function createConversionCard(label, ext, title) {
        const card = document.createElement('div');
        card.className = 'option-card';
        card.innerHTML = `
            <div class="option-info">
                <span class="opt-label">${label} (High Quality)</span>
                <span class="opt-meta">Converted via Server</span>
            </div>
            <button class="dl-btn" title="Convert & Download">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
        `;

        card.querySelector('.dl-btn').addEventListener('click', () => {
            window.location.href = `/api/download?url=${encodeURIComponent(urlInput.value)}&audioConvert=${ext}&filename=${encodeURIComponent(title)}`;
        });

        return card;
    }

    // Tab Switching Logic
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.dataset.tab;
            if (tab === 'video') {
                videoOptions.classList.remove('hidden');
                audioOptions.classList.add('hidden');
            } else {
                videoOptions.classList.add('hidden');
                audioOptions.classList.remove('hidden');
            }
        });
    });

    // Reset UI for new download
    newDownloadBtn.addEventListener('click', () => {
        resultArea.classList.add('hidden');
        urlInput.value = '';
        urlInput.focus();
    });
});
