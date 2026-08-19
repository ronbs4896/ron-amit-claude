/* ═════════ רב מסר: קליטת לידים ורוכשים ═════════
   רץ כפונקציית Serverless על Vercel (אין מה להתקין, הקובץ בתיקיית api מספיק).
   שני הדפים שולחים לכאן JSON:
     stage:"lead"     → נרשם לרשימת ה-hotlist
     stage:"purchase" → נרשם לרשימת הרוכשים ונמחק מה-hotlist

   מסלול המסירה: קודם ה-Webhook של Make, שכבר מחזיק מפתח לקוח מאושר מול
   רב מסר ולכן צריך רק את המפתח והסוד של החשבון. אם הוא לא זמין, מנסים את
   ה-API של רב מסר ישירות (דורש consumer key משלנו, שטרם קיבלנו).

   משתני סביבה (Vercel → Settings → Environment Variables):
     MAKE_WEBHOOK_URL  ה-Webhook של תרחיש Make. יש ברירת מחדל בקוד.
     META_CAPI_TOKEN   Access Token לשליחת אירועים למטא מהשרת (Conversions API)
     RAV_CLIENT_ID / RAV_CLIENT_SECRET / RAV_USER_TOKEN
                       שלושת הפרטים ממסך "מפתח כללי לחשבון" ברב מסר
                       (הגדרות → חיבורים חיצוניים API)
     RAV_LIST_HOTLIST  מזהה רשימת ה-hotlist (מספר)
     RAV_LIST_BUYERS   מזהה רשימת הרוכשים (מספר)
     RAV_SELFTEST=1    זמני: מאפשר לפתוח בדפדפן ‎/api/lead?selftest=1‎
                       כדי לאמת את החיבור ולקבל את מזהי הרשימות.
                       למחוק אחרי שההגדרה הושלמה.
     RAV_U_KEY / RAV_U_SECRET
                       זוג המפתח והסוד שמנפיקה התמיכה (03-7177777).

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
        /* זוג המפתח והסוד מהתמיכה. בלעדיו נופלים חזרה לטוקן של מסך החשבון */
        ukey: process.env.RAV_U_KEY || process.env.RAV_USER_TOKEN || '',
        usec: process.env.RAV_U_SECRET || process.env.RAV_USER_TOKEN || '',
    };
}

/* דיווח נוכחות בלבד: אורך המחרוזת, בלי לחשוף ערכים */
function credsReport() {
    const keys = ['RAV_CLIENT_ID', 'RAV_CLIENT_SECRET', 'RAV_USER_TOKEN', 'RAV_U_KEY', 'RAV_U_SECRET'];
    const out = {};
    for (const k of keys) out[k] = process.env[k] ? process.env[k].length + ' chars' : 'not set';
    return out;
}

/* ── וריאציות אימות ──
   מה שהאבחון כבר קבע: c_key חסר מוחזר עם 400 "Invalid consumer key", ואילו
   c_key שאינו מוכר גורם ל-500 עם גוף ריק. מפתח לקוח מומצא מחזיר בדיוק את
   אותו 500 כמו ה-Client ID של מסך החשבון, כלומר ה-Client ID אינו מפתח
   לקוח של ה-API הזה. לעומתו, הזוג שמנפיקה התמיכה הוא באורך 32 תווים,
   בדיוק כמו המפתחות שבתיעוד. לכן הווריאציות כאן מנסות את הזוג הזה בשני
   התפקידים: כמפתח לקוח וכמפתח משתמש. */

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const hmac = (alg, key, data) => crypto.createHmac(alg, key).update(data).digest('hex');

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

/* כותרת מלאה: זוג לקוח + זוג משתמש, בהצפנה המתועדת */
function pairVariant(name, pick) {
    return classicVariant(name, (c, n, ts) => {
        const p = pick(c);
        return hdr([
            ['c_key', p.ck], ['c_secret', md5(p.cs + n)],
            ['u_key', p.uk], ['u_secret', md5(p.us + n)],
            ['nonce', n], ['timestamp', ts],
        ]);
    });
}

const AUTH_VARIANTS = [
    /* 1. זוג התמיכה כמפתח הלקוח, והוא גם המשתמש */
    pairVariant('support-pair-both', c => ({ ck: c.ukey, cs: c.usec, uk: c.ukey, us: c.usec })),
    /* 2. זוג התמיכה כלקוח, הטוקן של מסך החשבון כמשתמש */
    pairVariant('support-client+token-user', c => ({ ck: c.ukey, cs: c.usec, uk: c.tok, us: c.tok })),
    /* 3. זוג התמיכה כלקוח, פרטי מסך החשבון כמשתמש */
    pairVariant('support-client+account-user', c => ({ ck: c.ukey, cs: c.usec, uk: c.cid, us: c.csec })),
    /* 4. הסכמה המתועדת כפשוטה: מסך החשבון כלקוח, זוג התמיכה כמשתמש */
    pairVariant('account-client+support-user', c => ({ ck: c.cid, cs: c.csec, uk: c.ukey, us: c.usec })),
    /* 5. זוג התמיכה כלקוח, בלי חלק משתמש */
    classicVariant('support-client-only', (c, n, ts) => hdr([
        ['c_key', c.ukey], ['c_secret', md5(c.usec + n)],
        ['nonce', n], ['timestamp', ts],
    ])),
    /* 6. זוג התמיכה כלקוח, בלי הצפנה */
    classicVariant('support-pair-raw', (c, n, ts) => hdr([
        ['c_key', c.ukey], ['c_secret', c.usec],
        ['u_key', c.ukey], ['u_secret', c.usec],
        ['nonce', n], ['timestamp', ts],
    ])),
];

/* ── בדיקות אבחון (רק ב-selftest) ──
   השאלה היחידה שנשארה: איזה מהערכים שברשותנו הוא מפתח לקוח מוכר. כל שורה
   כאן שולחת ערך אחר בתפקיד c_key, בלי חלק משתמש. ערך שיחזיר משהו אחר
   מ-500 הוא המפתח הנכון, וזה מה שנועל את כל השאר. */
function ckeyProbe(name, pick) {
    return classicVariant(name, (c, n, ts) => {
        const p = pick(c);
        return hdr([
            ['c_key', p.k], ['c_secret', md5(p.s + n)],
            ['nonce', n], ['timestamp', ts],
        ]);
    });
}

const PROBE_VARIANTS = [
    /* ביקורת: מפתח מומצא מול מפתח ריק, כדי לדעת מה כל קוד שגיאה אומר */
    ckeyProbe('control-fake-ckey', () => ({ k: 'no-such-consumer-key-0000', s: 'x' })),
    ckeyProbe('control-empty-ckey', () => ({ k: '', s: 'x' })),
    /* כל ערך שברשותנו, בתפקיד מפתח הלקוח */
    ckeyProbe('ckey-is-client-id', c => ({ k: c.cid, s: c.csec })),
    ckeyProbe('ckey-is-client-secret', c => ({ k: c.csec, s: c.cid })),
    ckeyProbe('ckey-is-user-token', c => ({ k: c.tok, s: c.tok })),
    ckeyProbe('ckey-is-support-key', c => ({ k: c.ukey, s: c.usec })),
    ckeyProbe('ckey-is-support-secret', c => ({ k: c.usec, s: c.ukey })),
    /* אותו מפתח תמיכה, נוסחאות הצפנה חלופיות לסוד */
    classicVariant('support-sha1', (c, n, ts) => hdr([
        ['c_key', c.ukey], ['c_secret', sha1(c.usec + n)], ['nonce', n], ['timestamp', ts],
    ])),
    classicVariant('support-hmac-md5', (c, n, ts) => hdr([
        ['c_key', c.ukey], ['c_secret', hmac('md5', c.usec, n)], ['nonce', n], ['timestamp', ts],
    ])),
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

/* ── מסירה דרך Make ──
   התרחיש "קורס סוכני AI — לידים ורוכשים לרב מסר" מקבל את אותו JSON ומנתב
   ליד ל-hotlist ורכישה לרשימת הרוכשים. Make רשום אצל רב מסר כאפליקציה
   מאושרת, ולכן החיבור שם דורש רק את מפתח וסוד החשבון. */
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL ||
    'https://hook.eu2.make.com/vi7378f9adzlztb6qb94bwclumg2oach';

async function sendToMake(payload) {
    if (!MAKE_WEBHOOK_URL) return false;
    const r = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await r.text();
    console.log('make', r.status, (text || '').slice(0, 120));
    return r.ok;
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


/* ══════════ Meta Conversions API ══════════
   הדפדפן כבר שולח Lead ו-Purchase, אבל חוסמי פרסומות, iOS והגבלות דפדפן
   בולעים חלק מהם. כאן אותם אירועים נשלחים גם מהשרת, עם אותו event_id,
   כך שמטא ממזגת אותם ולא סופרת פעמיים. הפרטים האישיים נשלחים מוצפנים
   ב-SHA-256, כפי שמטא דורשת.

   משתני סביבה:
     META_CAPI_TOKEN        חובה. Access Token מ-Events Manager
     META_PIXEL_ID          ברירת מחדל: הפיקסל שבדפים
     META_TEST_EVENT_CODE   זמני, לבדיקה במסך Test Events */

const META_PIXEL_ID = process.env.META_PIXEL_ID || '1410625827632523';
const META_API = 'https://graph.facebook.com/v21.0/';

function sha256(v) {
    return crypto.createHash('sha256').update(String(v)).digest('hex');
}

/* מטא דורשת נרמול לפני ההצפנה: אותיות קטנות, בלי רווחים, טלפון עם קידומת מדינה */
function hashed(v) {
    v = String(v || '').trim().toLowerCase();
    return v ? [sha256(v)] : undefined;
}
function hashedPhone(phone) {
    let d = String(phone || '').replace(/[^0-9]/g, '');
    if (!d) return undefined;
    if (d.charAt(0) === '0') d = '972' + d.slice(1);          /* ישראלי מקומי */
    else if (d.length === 10) d = '1' + d;                    /* אמריקאי בלי קידומת */
    return [sha256(d)];
}

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return fwd ? String(fwd).split(',')[0].trim() : (req.headers['x-real-ip'] || '');
}

async function sendToMeta(req, b, stage) {
    const token = process.env.META_CAPI_TOKEN;
    if (!token) return { skipped: 'no token' };

    const name = String(b.name || '').trim().split(/\s+/);
    const purchase = stage === 'purchase';
    const event = {
        event_name: purchase ? 'Purchase' : 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: b.event_id || undefined,
        event_source_url: b.source || undefined,
        action_source: 'website',
        user_data: {
            em: hashed(b.email),
            ph: hashedPhone(b.phone),
            fn: hashed(name[0]),
            ln: name.length > 1 ? hashed(name.slice(1).join(' ')) : undefined,
            country: hashed(b.country === 'US' ? 'us' : 'il'),
            client_ip_address: clientIp(req) || undefined,
            client_user_agent: req.headers['user-agent'] || undefined,
            fbp: b.fbp || undefined,
            fbc: b.fbc || undefined,
        },
        custom_data: {
            currency: 'ILS',
            value: purchase ? Number(b.value || 293.82) : 293.82,
            content_name: 'סוכני AI בוואטסאפ - קורס דיגיטלי',
            content_ids: ['ai-agents-course'],
            content_type: 'product',
        },
    };

    const payload = { data: [event] };
    if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

    const r = await fetch(META_API + META_PIXEL_ID + '/events?access_token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await r.text();
    console.log('meta capi', event.event_name, r.status, text.slice(0, 200));
    return { ok: r.ok, status: r.status };
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
        const tried = await Promise.all(AUTH_VARIANTS.concat(PROBE_VARIANTS).map(v =>
            attempt(v, 'GET', 'lists').catch(e => ({ variant: v.name, ok: false, error: e.message }))
        ));
        const win = tried.find(t => t.ok);
        if (!win) {
            return res.status(502).json({
                ok: false,
                hint: 'no auth variant accepted, send this output to Claude',
                creds: credsReport(),
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

    const payload = {
        stage: stage, name: name, phone: phone, email: email,
        value: b.value, currency: b.currency,
        ts: b.ts || new Date().toISOString(), source: b.source || '',
    };
    /* מקור הליד. נשלח כמחרוזות קצרות, כדי שיישב בשדות המותאמים של רב מסר */
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
                     'ref', 'fbclid', 'gclid', 'ttclid', 'landing_page', 'referrer', 'first_seen']) {
        payload[k] = b[k] ? String(b[k]).slice(0, 200) : '';
    }

    /* 1. Make. זה המסלול שעובד היום, כי מפתח הלקוח שלו מאושר אצל רב מסר */
    let delivered = false;
    try { delivered = await sendToMake(payload); }
    catch (e) { console.log('make error:', e.message); }

    /* 2. גיבוי: ה-API של רב מסר ישירות, כשיהיה לנו מפתח לקוח משלנו */
    const HOT = process.env.RAV_LIST_HOTLIST, BUY = process.env.RAV_LIST_BUYERS;
    if (!delivered && !envMissing().length && HOT && BUY) {
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
            delivered = true;
        } catch (e) {
            console.log('rav-messer error:', e.message, JSON.stringify(e.detail || {}).slice(0, 300));
        }
    }

    /* 3. מטא, מהשרת. כישלון כאן לא מפיל את הליד */
    try { await sendToMeta(req, b, stage); }
    catch (e) { console.log('meta capi error:', e.message); }

    if (!delivered) console.log('lead not delivered:', email);
    return res.status(delivered ? 200 : 502).json({ ok: delivered });
};
