const { kv } = require('@vercel/kv');
const crypto = require('crypto');

const GALLERY_MAX = 100;

// ============================================================
//  Vercel KV Storage Helpers
//  - 'gallery_ids'      → Array of doodle IDs (ordered)
//  - 'doodle:{id}'      → Individual doodle JSON object
// ============================================================

async function loadGallery() {
    const ids = await kv.get('gallery_ids') || [];
    if (ids.length === 0) return [];

    // Fetch all doodles in parallel
    const keys = ids.map(id => 'doodle:' + id);
    const doodles = await kv.mget(...keys);

    // Filter out nulls (deleted or expired entries)
    return doodles.filter(Boolean);
}

async function saveDoodle(entry) {
    await kv.set('doodle:' + entry.id, entry);

    const ids = await kv.get('gallery_ids') || [];
    ids.push(entry.id);

    // Trim if over max: remove oldest low-liked entries
    if (ids.length > GALLERY_MAX) {
        const all = await loadGallery();
        all.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.created_at || 0) - (a.created_at || 0));
        const keep = all.slice(0, GALLERY_MAX);
        const keepIds = keep.map(d => d.id);

        // Delete removed doodles
        const removeIds = ids.filter(id => !keepIds.includes(id));
        for (const rid of removeIds) {
            await kv.del('doodle:' + rid);
        }

        await kv.set('gallery_ids', keepIds);
    } else {
        await kv.set('gallery_ids', ids);
    }
}

async function updateDoodle(doodle) {
    await kv.set('doodle:' + doodle.id, doodle);
}

// ============================================================
//  API Handler
// ============================================================

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET /api/gallery — List all doodles sorted by likes
        if (req.method === 'GET') {
            const gallery = await loadGallery();
            gallery.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.created_at || 0) - (a.created_at || 0));
            return res.status(200).json({ gallery });
        }

        // POST /api/gallery — Save, Like, Unlike
        if (req.method === 'POST') {
            const { action, image, title, id } = req.body || {};

            // --- Save ---
            if (action === 'save' || (!action && image)) {
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

                await saveDoodle(entry);
                return res.status(200).json({ success: true, id: entry.id });
            }

            // --- Like ---
            if (action === 'like') {
                if (!id) {
                    return res.status(400).json({ error: '낙서 ID가 필요합니다.' });
                }

                const doodle = await kv.get('doodle:' + id);
                if (!doodle) {
                    return res.status(404).json({ error: '해당 낙서를 찾을 수 없습니다.' });
                }

                doodle.likes = (doodle.likes || 0) + 1;
                await updateDoodle(doodle);
                return res.status(200).json({ success: true, likes: doodle.likes });
            }

            // --- Unlike ---
            if (action === 'unlike') {
                if (!id) {
                    return res.status(400).json({ error: '낙서 ID가 필요합니다.' });
                }

                const doodle = await kv.get('doodle:' + id);
                if (!doodle) {
                    return res.status(404).json({ error: '해당 낙서를 찾을 수 없습니다.' });
                }

                doodle.likes = Math.max(0, (doodle.likes || 0) - 1);
                await updateDoodle(doodle);
                return res.status(200).json({ success: true, likes: doodle.likes });
            }

            return res.status(400).json({ error: '올바른 action을 지정해주세요 (save, like, unlike).' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('Gallery API error:', e);
        return res.status(500).json({ error: e.message });
    }
};
