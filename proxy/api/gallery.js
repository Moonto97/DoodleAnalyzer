const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use /tmp for Vercel serverless (persists during warm instances)
const GALLERY_FILE = path.join('/tmp', 'gallery.json');
const GALLERY_MAX = 100;

function loadGallery() {
    try {
        const data = fs.readFileSync(GALLERY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

function saveGallery(data) {
    fs.writeFileSync(GALLERY_FILE, JSON.stringify(data), 'utf-8');
}

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET /api/gallery - List all doodles sorted by likes
        if (req.method === 'GET') {
            const gallery = loadGallery();
            gallery.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.created_at || 0) - (a.created_at || 0));
            return res.status(200).json({ gallery });
        }

        // POST /api/gallery - Save, Like, Unlike
        if (req.method === 'POST') {
            const { action, image, title, id } = req.body || {};

            if (action === 'save' || (!action && image)) {
                // Save new doodle
                if (!image) {
                    return res.status(400).json({ error: '이미지 데이터가 필요합니다.' });
                }

                const entry = {
                    id: crypto.randomUUID().slice(0, 8),
                    image: image,
                    title: (title || '무제').slice(0, 50),
                    likes: 0,
                    created_at: Date.now() / 1000
                };

                const gallery = loadGallery();
                gallery.push(entry);

                if (gallery.length > GALLERY_MAX) {
                    gallery.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.created_at || 0) - (a.created_at || 0));
                    gallery.length = GALLERY_MAX;
                }

                saveGallery(gallery);
                return res.status(200).json({ success: true, id: entry.id });
            }

            if (action === 'like') {
                if (!id) {
                    return res.status(400).json({ error: '낙서 ID가 필요합니다.' });
                }

                const gallery = loadGallery();
                const item = gallery.find(g => g.id === id);
                if (!item) {
                    return res.status(404).json({ error: '해당 낙서를 찾을 수 없습니다.' });
                }

                item.likes = (item.likes || 0) + 1;
                saveGallery(gallery);
                return res.status(200).json({ success: true, likes: item.likes });
            }

            if (action === 'unlike') {
                if (!id) {
                    return res.status(400).json({ error: '낙서 ID가 필요합니다.' });
                }

                const gallery = loadGallery();
                const item = gallery.find(g => g.id === id);
                if (!item) {
                    return res.status(404).json({ error: '해당 낙서를 찾을 수 없습니다.' });
                }

                item.likes = Math.max(0, (item.likes || 0) - 1);
                saveGallery(gallery);
                return res.status(200).json({ success: true, likes: item.likes });
            }

            return res.status(400).json({ error: '올바른 action을 지정해주세요 (save, like, unlike).' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
