const nodemailer = require('nodemailer');

// ── 보안: 시간당 이메일 발송 제한 (서버리스 인스턴스당) ──
const emailLog = [];
const MAX_EMAILS_PER_HOUR = 40;

function isRateLimited() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    while (emailLog.length > 0 && emailLog[0] < oneHourAgo) {
        emailLog.shift();
    }
    return emailLog.length >= MAX_EMAILS_PER_HOUR;
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 속도 제한 체크
    if (isRateLimited()) {
        return res.status(429).json({ error: '너무 많은 이메일 요청입니다. 잠시 후 다시 시도해주세요.' });
    }

    const SMTP_EMAIL = process.env.SMTP_EMAIL;
    const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
    const SMTP_SERVER = process.env.SMTP_SERVER || 'smtp.gmail.com';
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');

    if (!SMTP_EMAIL || !SMTP_PASSWORD) {
        return res.status(500).json({ error: 'SMTP 설정이 완료되지 않았습니다.' });
    }

    const { email, image } = req.body || {};

    if (!email || !email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: '올바른 이메일 주소가 필요합니다.' });
    }
    if (!image) {
        return res.status(400).json({ error: '이미지 데이터가 필요합니다.' });
    }

    try {
        // base64 이미지 디코딩
        const imgB64 = image.includes(',') ? image.split(',')[1] : image;
        const imgBuffer = Buffer.from(imgB64, 'base64');

        const transporter = nodemailer.createTransport({
            host: SMTP_SERVER,
            port: SMTP_PORT,
            secure: false,
            auth: { user: SMTP_EMAIL, pass: SMTP_PASSWORD }
        });

        // 이메일 본문은 서버에서 고정 (악용 방지: 임의 내용 전송 불가)
        await transporter.sendMail({
            from: SMTP_EMAIL,
            to: email,
            subject: '🎨 낙서 분석가 - 작품 분석 결과',
            html: `<div style="max-width:700px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#FFFCF2;padding:30px;border-radius:16px;border:2px solid #FFD700;">
                <h1 style="text-align:center;color:#FF6B6B;">🎨 낙서 분석가</h1>
                <p style="text-align:center;color:#888;font-style:italic;">- 모든 낙서는 무의식을 투영한다 -</p>
                <hr style="border:none;border-top:1px dashed #FFD700;margin:20px 0;">
                <p style="text-align:center;color:#555;">당신의 낙서 분석 결과가 도착했습니다!</p>
                <div style="text-align:center;margin:20px 0;">
                    <img src="cid:analysis_image" style="max-width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
                </div>
                <p style="text-align:center;color:#aaa;font-size:0.85em;margin-top:20px;">낙서 분석가 · Doodle Analyzer</p>
            </div>`,
            attachments: [{
                filename: 'doodle_analysis.png',
                content: imgBuffer,
                cid: 'analysis_image'
            }]
        });

        emailLog.push(Date.now());
        return res.status(200).json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
