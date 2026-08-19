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
                       כדי לאמת את החיבור ולקבל את מזהי הרשימות.
                       למחוק אחרי שההגדרה הושלמה.
     RAV_U_SECRET      אופציונלי: "user secret" בסכמה הישנה, אם קיבלת
                       מהתמיכה זוג מפתחות ולא טוקן אחד.

   התיעוד הפתוח (github.com/responder/restapi) מתאר את הסכמה הישנה, ומסך
   המפתחות בחשבון הוא חדש יותר. לכן יש כאן כמה וריאציות אימות: הקוד מנסה
   אותן לפי הסדר עד שאחת מתקבלת, וזוכר את המנצחת. ‎?selftest=1‎ מריץ את כולן
   ומחזיר טבלת אבחון עם התשובה של רב מסר לכל וריאציה. */

const crypto = require('crypto');

const API_BASE = 'https://api.responder.co.il/main/';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function creds() {
    return {
        cid: process.env.RAV_CLIENT_ID || '',
        csec: process.env.RAV_CLIENT_SECRET || '',
        tok: process.env.RAV_USER_TOKEN || '',
        usec: process.env.RAV_U_SECRET || process.env.RAV_USER_TOKEN || '',
    };
}

/* ── וריאציות אימות ──
   מה שכבר ידוע מהאבחון: כותרת בלי c_key מוחזרת עם 400 "Invalid consumer key",
   ואילו c_key=Client ID עובר את הבדיקה הזאת ונופל אחריה. כלומר הכותרת
   הקלאסית היא הנכונה ו-Client ID הוא ה-consumer key; מה שנשאר לברר הוא איך
   נכנסים לתוכה פרטי המשתמש. לכן כל הווריאציות כאן חולקות את אותו שלד
   ונבדלות רק בחלק המשתמש, באופן ההצפנה ובפרטים קטנים של הפורמט. */

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* בונה כותרת מזוגות, בסדר שנשמר */
function hdr(pairs, sep) {
    return pairs
        .filter(p => p[1] !== undefined && p[1] !== null)
        .map(p => p[0] + '=' + encodeURIComponent(p[1]))
        .join(sep || ',');
}

function classicVariant(name, build) {
    return {
        name: name,
        headers: () => {
            const c = creds();
            const nonce = crypto.randomBytes(16).toString('hex');
            const ts = Math.floor(Date.now() / 1000);
            return { Authorization: build(c, nonce, ts) };
        },
    };
}

const AUTH_VARIANTS = [
    /* 1. הסכמה המתועדת, כשהטוקן משמש גם כמפתח וגם כסוד */
    classicVariant('md5-token', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['u_secret', md5(c.usec + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 2. הטוקן כמפתח משתמש בלבד, בלי סוד משתמש */
    classicVariant('md5-ukey-only', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['nonce', n], ['timestamp', ts],
    ])),
    /* 3. בלי חלק משתמש בכלל. השגיאה שתחזור תגלה מה חסר */
    classicVariant('md5-no-user', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 4. שם שדה אחר לטוקן */
    classicVariant('md5-u_token', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_token', c.tok], ['nonce', n], ['timestamp', ts],
    ])),
    /* 5. הטוקן כסוד המשתמש, ומפתח המשתמש הוא זהות הלקוח */
    classicVariant('md5-ukey-cid', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.cid], ['u_secret', md5(c.tok + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 6. סוד המשתמש זהה לסוד הלקוח */
    classicVariant('md5-usec-csec', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['u_secret', md5(c.csec + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 7. הטוקן נשלח כמו שהוא, בלי הצפנה */
    classicVariant('md5-usec-raw', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['u_secret', c.usec],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 8. שני הסודות בלי הצפנה */
    classicVariant('raw-secrets', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', c.csec],
        ['u_key', c.tok], ['u_secret', c.usec],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 9. סדר הפוך בהצפנה: nonce ואז הסוד */
    classicVariant('md5-reversed', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(n + c.csec)],
        ['u_key', c.tok], ['u_secret', md5(n + c.usec)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 10. sha256 במקום md5 */
    classicVariant('sha256', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', sha256(c.csec + n)],
        ['u_key', c.tok], ['u_secret', sha256(c.usec + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 11. חותמת זמן באלפיות שנייה */
    classicVariant('md5-ms-timestamp', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['u_secret', md5(c.usec + n)],
        ['nonce', n], ['timestamp', Date.now()],
    ])),
    /* 12. רווח אחרי הפסיק, כמו בהרבה דוגמאות של OAuth 1 */
    classicVariant('md5-spaced', (c, n, ts) => hdr([
        ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
        ['u_key', c.tok], ['u_secret', md5(c.usec + n)],
        ['nonce', n], ['timestamp', ts],
    ], ', ')),
    /* 13. הטוקן בכותרת נפרדת, לצד זיהוי הלקוח הקלאסי */
    {
        name: 'classic+token-header',
        headers: () => {
            const c = creds(), n = crypto.randomBytes(16).toString('hex');
            return {
                Authorization: hdr([
                    ['c_key', c.cid], ['c_secret', md5(c.csec + n)],
                    ['nonce', n], ['timestamp', Math.floor(Date.now() / 1000)],
                ]),
                'X-User-Token': c.tok,
            };
        },
    },
];

/* הווריאציה שהצליחה לאחרונה. המופע של הפונקציה חי בין קריאות, אז זה חוסך ניסיונות */
let preferred = null;

async function attempt(variant, method, path, form) {
    const headers = variant.headers();
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const r = await fetch(API_BASE + path, {
        method: method,
        headers: headers,
        body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = null; }
    /* נשמר בלוגים של Vercel (Deployments → Functions) */
    console.log(variant.name, method, path, r.status, (text || '(empty body)').slice(0, 300));
    return {
        variant: variant.name, ok: r.ok, status: r.status, data: data,
        body: (text || '').slice(0, 300),
        contentType: r.headers.get('content-type') || '',
    };
}

/* קריאה לרב מסר. מנסה וריאציות עד שאחת מתקבלת */
async function rav(method, path, form) {
    const order = preferred
        ? [preferred].concat(AUTH_VARIANTS.filter(v => v !== preferred))
        : AUTH_VARIANTS;
    let last = null;
    for (const v of order) {
        let out;
        try { out = await attempt(v, method, path, form); }
        catch (e) { console.log(v.name, 'network error:', e.message); continue; }
        if (out.ok) { preferred = v; return out.data; }
        last = out;
    }
    const err = new Error('rav ' + method + ' failed');
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
       מריצה את כל וריאציות האימות מול רשימת הרשימות ומחזירה מה ענה רב מסר
       לכל אחת, כדי לזהות את הפורמט הנכון בלי לנחש. */
    if (req.method === 'GET') {
        if (process.env.RAV_SELFTEST !== '1' || !isSelftest(req)) {
            return res.status(404).json({ ok: false });
        }
        const missing = envMissing();
        if (missing.length) return res.status(500).json({ ok: false, missing: missing });

        /* במקביל, כדי לא לחרוג מזמן הריצה של הפונקציה */
        const tried = await Promise.all(AUTH_VARIANTS.map(v =>
            attempt(v, 'GET', 'lists').catch(e => ({ variant: v.name, ok: false, error: e.message }))
        ));
        const win = tried.find(t => t.ok);
        if (!win) {
            return res.status(502).json({
                ok: false,
                hint: 'no auth variant accepted, send this output to Claude',
                tried: tried.map(t => ({ variant: t.variant, status: t.status, body: t.body, error: t.error })),
            });
        }
        preferred = AUTH_VARIANTS.find(v => v.name === win.variant) || null;
        const lists = ((win.data && win.data.LISTS) || []).map(l => ({ id: l.ID, name: l.DESCRIPTION || l.NAME }));
        return res.status(200).json({
            ok: true,
            variant: win.variant,
            lists: lists,
            hotlist_env: process.env.RAV_LIST_HOTLIST || null,
            buyers_env: process.env.RAV_LIST_BUYERS || null,
        });
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
        console.log('rav-messer error:', e.message, JSON.stringify(e.detail || {}).slice(0, 300));
        return res.status(502).json({ ok: false });
    }
};
