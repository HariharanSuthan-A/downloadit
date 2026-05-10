const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ── Find yt-dlp binary ─────────────────────────────── */
function findYtDlp() {
    const candidates = [
        path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
        path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
        path.join(__dirname, 'bin', 'yt-dlp.exe'),
        'yt-dlp'
    ];
    for (const c of candidates) {
        if (c === 'yt-dlp') {
            try { execSync('yt-dlp --version', { stdio: 'ignore' }); return c; } catch { continue; }
        }
        if (fs.existsSync(c)) return c;
    }
    return null;
}

const YT_DLP = findYtDlp();

/* ── Check ffmpeg availability ─────────────────────── */
function hasFfmpeg() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return true;
    } catch { return false; }
}
const FFMPEG_AVAILABLE = hasFfmpeg();

/* ── Helpers ───────────────────────────────────────── */
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return 'Unknown size';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function parseDuration(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ── API: Health ───────────────────────────────────── */
app.get('/api/health', (req, res) => {
    res.json({ ok: true, ytDlp: !!YT_DLP, ffmpeg: FFMPEG_AVAILABLE });
});

/* ── API: Info ───────────────────────────────────────── */
app.get('/api/info', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (!YT_DLP) {
        return res.status(500).json({ error: 'yt-dlp binary not found. Please run npm install.' });
    }

    console.log(`[INFO] Fetching info for: ${url}`);
    
    let output = '';
    let errorOutput = '';
    
    const yt = spawn(YT_DLP, [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        '--no-check-certificates',
        '--prefer-free-formats',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        '--extractor-args', 'youtube:player_client=android,web;player_skip=webpage,configs,js',
        url
    ]);

    yt.stdout.on('data', chunk => output += chunk.toString());
    yt.stderr.on('data', chunk => errorOutput += chunk.toString());

    yt.on('error', err => {
        console.error('[ERROR] yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start yt-dlp process' });
    });

    yt.on('close', code => {
        if (code !== 0 || !output.trim()) {
            console.error('[ERROR] yt-dlp failed with code', code, 'stderr:', errorOutput);
            return res.status(400).json({ error: 'Could not fetch media info.', details: errorOutput.substring(0, 200) });
        }

        try {
            const rawInfo = JSON.parse(output);
            let mediaInfo = rawInfo;
            
            if (Array.isArray(rawInfo)) {
                mediaInfo = rawInfo[0];
            }

            if (!mediaInfo) throw new Error('No media info found in JSON output');

            const videoMap = new Map();
            const audioMap = new Map();

            if (mediaInfo.formats) {
                for (const fmt of mediaInfo.formats) {
                    const isVideo = fmt.vcodec && fmt.vcodec !== 'none';
                    const isAudio = fmt.acodec && fmt.acodec !== 'none';
                    const height = fmt.height || 0;

                    if (isVideo && isAudio) {
                        const key = height;
                        const existing = videoMap.get(key);
                        const size = fmt.filesize || fmt.filesize_approx || 0;
                        if (!existing || size > (existing.filesize || 0)) {
                            videoMap.set(key, {
                                formatId: fmt.format_id,
                                ext: fmt.ext || 'mp4',
                                resolution: fmt.resolution || `${fmt.width || '?'}x${fmt.height || '?'}`,
                                height,
                                filesize: size,
                                filesizeStr: formatBytes(size)
                            });
                        }
                    } else if (!isVideo && isAudio) {
                        const key = `${fmt.ext || 'unknown'}_${fmt.abr || 0}`;
                        const existing = audioMap.get(key);
                        const abr = fmt.abr || 0;
                        const size = fmt.filesize || fmt.filesize_approx || 0;
                        if (!existing || abr > existing.abr) {
                            audioMap.set(key, {
                                formatId: fmt.format_id,
                                ext: fmt.ext || 'm4a',
                                abr,
                                filesizeStr: formatBytes(size),
                                bitrate: abr ? `${abr} kbps` : 'Unknown'
                            });
                        }
                    }
                }
            }

            let videoFormats = Array.from(videoMap.values()).sort((a, b) => b.height - a.height);
            let audioFormats = Array.from(audioMap.values()).sort((a, b) => b.abr - a.abr);

            // Fallbacks
            if (videoFormats.length === 0) {
                videoFormats.push({ formatId: 'best', ext: 'mp4', resolution: 'Best', height: 0, filesizeStr: 'Unknown' });
            }
            if (audioFormats.length === 0) {
                audioFormats.push({ formatId: 'bestaudio', ext: 'm4a', bitrate: 'Best', filesizeStr: 'Unknown' });
            }

            const qualityLabels = { 2160:'4K', 1440:'2K', 1080:'1080p', 720:'720p', 480:'480p', 360:'360p', 240:'240p', 144:'144p' };
            videoFormats = videoFormats.map(f => ({ ...f, qualityLabel: qualityLabels[f.height] || `${f.height}p` }));

            res.json({
                success: true,
                title: mediaInfo.title || 'Untitled',
                duration: parseDuration(mediaInfo.duration),
                thumbnail: mediaInfo.thumbnail || '',
                platform: mediaInfo.extractor || 'unknown',
                uploader: mediaInfo.uploader || mediaInfo.channel || '',
                ffmpegAvailable: FFMPEG_AVAILABLE,
                videoFormats,
                audioFormats
            });
        } catch (err) {
            console.error('[ERROR] JSON Parse Error:', err.message);
            res.status(500).json({ error: 'Failed to parse media metadata.' });
        }
    });
});

/* ── API: Download ───────────────────────────────────── */
app.get('/api/download', (req, res) => {
    const { url, formatId, filename, audioConvert } = req.query;
    if (!url || !YT_DLP) return res.status(400).json({ error: 'Invalid request' });

    const args = [
        '-f', formatId || 'best',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        '--extractor-args', 'youtube:player_client=android,web;player_skip=webpage,configs,js',
        url
    ];

    let ext = 'mp4';
    if (audioConvert && FFMPEG_AVAILABLE) {
        args.push('--extract-audio', '--audio-format', audioConvert);
        ext = audioConvert;
    }

    const safeFilename = (filename || 'download').replace(/[^a-zA-Z0-9._\-\s]/g, '_').substring(0, 100);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.${ext}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const yt = spawn(YT_DLP, args);
    yt.stdout.pipe(res);
    
    yt.on('close', code => {
        if (code !== 0 && !res.writableEnded) res.end();
    });

    req.on('close', () => yt.kill('SIGTERM'));
});

/* ── 404 & Error Handling ──────────────────────────── */
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('[CRITICAL ERROR]', err.stack);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

/* ── Start server ──────────────────────────────────── */
app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║   DownloadIt server running [v3.2]       ║`);
    console.log(`  ║   http://localhost:${PORT}                  ║`);
    console.log(`  ║   yt-dlp: ${YT_DLP ? '✓ Found' : '✗ NOT FOUND'}                  ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
});
