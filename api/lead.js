/* ═════════ רב מסר: קליטת לידים ורוכשים ═════════
   רץ כפונקציית Serverless על Vercel (אין מה להתקין, הקובץ בתיקיית api מספיק).
   שני הדפים שולחים לכאן JSON:
     stage:"lead"     → נרשם לרשימת ה-hotlist
     stage:"purchase" → נרשם לרשימת הרוכשים ונמחק מה-hotlist

   משתני סביבה (Vercel → Settings → Environment Variables), כולם חובה:
     RAV_C_KEY / RAV_C_SECRET   מפתחות ה-client מרב מסר
     RAV_U_KEY / RAV_U_SECRET   מפתחות המשתמש מרב מסר
     RAV_LIST_HOTLIST           מזהה רשימת ה-hotlist (מספר)
     RAV_LIST_BUYERS            מזהה רשימת הרוכשים (מספר)

   מבנה האימות לפי התיעוד הרשמי: github.com/responder/restapi */

const crypto = require('crypto');

const API_BASE = 'https://api.responder.co.il/main/lists/';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function authHeader() {
    const nonce = crypto.randomBytes(16).toString('hex');
    const parts = {
        c_key: process.env.RAV_C_KEY,
        c_secret: md5(process.env.RAV_C_SECRET + nonce),
        u_key: process.env.RAV_U_KEY,
        u_secret: md5(process.env.RAV_U_SECRET + nonce),
        nonce: nonce,
        timestamp: Math.floor(Date.now() / 1000),
    };
    return Object.entries(parts)
        .map(([k, v]) => k + '=' + encodeURIComponent(v))
        .join(',');
}

async function rav(method, listId, subscribers) {
    const r = await fetch(API_BASE + listId + '/subscribers', {
        method: method,
        headers: {
            'Authorization': authHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ subscribers: JSON.stringify(subscribers) }).toString(),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
    /* נשמר בלוגים של Vercel (Deployments → Functions) לצורך דיבוג */
    console.log(method, listId, r.status, JSON.stringify(data).slice(0, 500));
    if (!r.ok) throw new Error('rav ' + method + ' ' + r.status);
    return data;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false });

    const b = req.body || {};
    const email = String(b.email || '').trim();
    const name = String(b.name || '').trim().slice(0, 120);
    const phone = String(b.phone || '').replace(/[^0-9]/g, '');
    const stage = b.stage === 'purchase' ? 'purchase' : 'lead';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return res.status(400).json({ ok: false, error: 'bad email' });
    }

    const HOT = process.env.RAV_LIST_HOTLIST, BUY = process.env.RAV_LIST_BUYERS;
    if (!process.env.RAV_C_KEY || !process.env.RAV_C_SECRET ||
        !process.env.RAV_U_KEY || !process.env.RAV_U_SECRET || !HOT || !BUY) {
        console.log('rav-messer env vars missing');
        return res.status(500).json({ ok: false, error: 'env missing' });
    }

    /* PHONE_IGNORE: שלא נאבד ליד בגלל טלפון שרב מסר לא מקבל */
    const sub = { NAME: name, EMAIL: email, PHONE: phone, PHONE_IGNORE: true, NOTIFY: 2 };

    try {
        if (stage === 'purchase') {
            await rav('POST', BUY, [sub]);
            /* רוכש יוצא מה-hotlist כדי שלא ימשיך לקבל מיילים של "בוא תקנה" */
            await rav('DELETE', HOT, [{ EMAIL: email }]);
        } else {
            await rav('POST', HOT, [sub]);
        }
        return res.status(200).json({ ok: true });
    } catch (e) {
        console.log('rav-messer error:', e.message);
        return res.status(502).json({ ok: false });
    }
};
