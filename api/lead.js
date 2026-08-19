/* ═════════ רב מסר: קליטת לידים ורוכשים ═════════
   רץ כפונקציית Serverless על Vercel (אין מה להתקין, הקובץ בתיקיית api מספיק).
   שני הדפים שולחים לכאן JSON:
     stage:"lead"     → נרשם לרשימת ה-hotlist
     stage:"purchase" → נרשם לרשימת הרוכשים ונמחק מה-hotlist

   משתני סביבה (Vercel → Settings → Environment Variables):
     RAV_CLIENT_ID / RAV_CLIENT_SECRET / RAV_USER_TOKEN
                       שלושת הפרטים ממסך "מפתח כללי לחשבון" ברב מסר
                       (הגדרות → חיבורים חיצוניים API)
     RAV_LIST_HOTLIST  מזהה רשימת ה-hotlist (מספר)
     RAV_LIST_BUYERS   מזהה רשימת הרוכשים (מספר)
     RAV_SELFTEST=1    זמני: מאפשר לפתוח בדפדפן ‎/api/lead?selftest=1‎
                       כדי לוודא שהחיבור עובד ולקבל את מזהי הרשימות.
                       למחוק אחרי שההגדרה הושלמה.
     RAV_U_KEY / RAV_U_SECRET
                       אופציונלי: זוג מפתחות משתמש בסכמה הישנה שמנפיקה
                       התמיכה (03-7177777). אם הם מוגדרים, הם גוברים על
                       RAV_USER_TOKEN.

   ה-API לפי התיעוד הרשמי: github.com/responder/restapi
   האימות מנסה שתי וריאציות: הכותרת הקלאסית (MD5 + nonce) ואם היא
   נדחית — Bearer עם ה-User Token. הווריאציה שעבדה נרשמת בלוגים. */

const crypto = require('crypto');

const API_BASE = 'https://api.responder.co.il/main/';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function classicHeader() {
    const nonce = crypto.randomBytes(16).toString('hex');
    const uKey = process.env.RAV_U_KEY || process.env.RAV_USER_TOKEN;
    const uSecret = process.env.RAV_U_SECRET || process.env.RAV_USER_TOKEN;
    const parts = {
        c_key: process.env.RAV_CLIENT_ID,
        c_secret: md5(process.env.RAV_CLIENT_SECRET + nonce),
        u_key: uKey,
        u_secret: md5(uSecret + nonce),
        nonce: nonce,
        timestamp: Math.floor(Date.now() / 1000),
    };
    return Object.entries(parts)
        .map(([k, v]) => k + '=' + encodeURIComponent(v))
        .join(',');
}

const AUTH_VARIANTS = [
    { name: 'classic', header: classicHeader },
    { name: 'bearer', header: () => 'Bearer ' + process.env.RAV_USER_TOKEN },
];

/* קריאה לרב מסר. מנסה את וריאציות האימות לפי הסדר; 401/403 = לנסות את הבאה */
async function rav(method, path, form) {
    let last = null;
    for (const v of AUTH_VARIANTS) {
        const r = await fetch(API_BASE + path, {
            method: method,
            headers: {
                'Authorization': v.header(),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form ? new URLSearchParams(form).toString() : undefined,
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
        /* נשמר בלוגים של Vercel (Deployments → Functions) לצורך דיבוג */
        console.log(v.name, method, path, r.status, JSON.stringify(data).slice(0, 500));
        if (r.ok) return data;
        last = { status: r.status, data: data, variant: v.name };
        if (r.status !== 401 && r.status !== 403) break;
    }
    const err = new Error('rav ' + method + ' ' + last.status);
    err.detail = last;
    throw err;
}

function envMissing() {
    const need = ['RAV_CLIENT_ID', 'RAV_CLIENT_SECRET', 'RAV_USER_TOKEN'];
    return need.filter(k => !process.env[k]);
}

/* Vercel מפענח JSON לבד, אבל רק כשהגיעה כותרת Content-Type מתאימה.
   כאן מקבלים גם גוף גולמי, שלא נאבד ליד בגלל כותרת חסרה. */
function readBody(req) {
    const b = req.body;
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
    const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) {}
    try { return Object.fromEntries(new URLSearchParams(raw)); } catch (e) {}
    return {};
}

function isSelftest(req) {
    if (req.query && req.query.selftest === '1') return true;
    return /[?&]selftest=1(&|$)/.test(req.url || '');
}

module.exports = async (req, res) => {
    /* בדיקה עצמית: פותחים בדפדפן ‎/api/lead?selftest=1‎ (רק כש-RAV_SELFTEST=1).
       מאמתת את החיבור ומחזירה את הרשימות בחשבון עם המזהים שלהן. */
    if (req.method === 'GET') {
        if (process.env.RAV_SELFTEST !== '1' || !isSelftest(req)) {
            return res.status(404).json({ ok: false });
        }
        const missing = envMissing();
        if (missing.length) return res.status(500).json({ ok: false, missing: missing });
        try {
            const data = await rav('GET', 'lists');
            const lists = (data.LISTS || []).map(l => ({ id: l.ID, name: l.DESCRIPTION || l.NAME }));
            return res.status(200).json({
                ok: true,
                lists: lists,
                hotlist_env: process.env.RAV_LIST_HOTLIST || null,
                buyers_env: process.env.RAV_LIST_BUYERS || null,
            });
        } catch (e) {
            return res.status(502).json({ ok: false, upstream: e.detail || e.message });
        }
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false });

    const b = readBody(req);
    const email = String(b.email || '').trim();
    const name = String(b.name || '').trim().slice(0, 120);
    const phone = String(b.phone || '').replace(/[^0-9]/g, '');
    const stage = b.stage === 'purchase' ? 'purchase' : 'lead';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return res.status(400).json({ ok: false, error: 'bad email' });
    }

    const HOT = process.env.RAV_LIST_HOTLIST, BUY = process.env.RAV_LIST_BUYERS;
    if (envMissing().length || !HOT || !BUY) {
        console.log('rav-messer env vars missing');
        return res.status(500).json({ ok: false, error: 'env missing' });
    }

    /* PHONE_IGNORE: שלא נאבד ליד בגלל טלפון שרב מסר לא מקבל */
    const sub = { NAME: name, EMAIL: email, PHONE: phone, PHONE_IGNORE: true, NOTIFY: 2 };

    try {
        if (stage === 'purchase') {
            await rav('POST', 'lists/' + BUY + '/subscribers', { subscribers: JSON.stringify([sub]) });
            /* רוכש יוצא מה-hotlist כדי שלא ימשיך לקבל מיילים של "בוא תקנה" */
            await rav('DELETE', 'lists/' + HOT + '/subscribers', { subscribers: JSON.stringify([{ EMAIL: email }]) });
        } else {
            await rav('POST', 'lists/' + HOT + '/subscribers', { subscribers: JSON.stringify([sub]) });
        }
        return res.status(200).json({ ok: true });
    } catch (e) {
        console.log('rav-messer error:', e.message);
        return res.status(502).json({ ok: false });
    }
};
