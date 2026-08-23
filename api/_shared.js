/* ═════════ קוד משותף לשתי הפונקציות ═════════
   ‎/api/lead‎  — הטפסים באתר
   ‎/api/grow‎  — ה-Webhook של Grow אחרי תשלום
   הקובץ מתחיל בקו תחתון, ולכן Vercel לא מפרסם אותו ככתובת. */

const crypto = require('crypto');

/* Vercel מפענח JSON לבד, אבל רק כשהגיעה כותרת Content-Type מתאימה.
   Grow שולח לפעמים form-urlencoded, לכן מקבלים גם גוף גולמי. */
function readBody(req) {
    const b = req.body;
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
    const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) {}
    try { return Object.fromEntries(new URLSearchParams(raw)); } catch (e) {}
    return {};
}

/* ── מסירה דרך Make ──
   התרחיש "קורס סוכני AI — לידים ורוכשים לרב מסר" מקבל את אותו JSON ומנתב
   ליד ל-hotlist ורכישה לרשימת הרוכשים. */
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
const COURSE_NAME = 'סוכני AI בוואטסאפ - קורס דיגיטלי';
const COURSE_ID = 'ai-agents-course';
const COURSE_PRICE = 297;   /* מחיר ההשקה, כולל מע״מ */

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

/* ip ו-userAgent נשלחים רק כשהם של הגולש עצמו. ב-Webhook הם של השרת של
   Grow, ושליחה שלהם הייתה מזהה את הרוכשים כולם כאותו אדם ומורידה את
   איכות ההתאמה. לכן שם פשוט לא מעבירים אותם. */
async function sendToMeta(o) {
    const token = process.env.META_CAPI_TOKEN;
    if (!token) return { skipped: 'no token' };

    const name = String(o.name || '').trim().split(/\s+/);
    const event = {
        event_name: o.eventName,
        event_time: Math.floor((o.eventTime || Date.now()) / 1000),
        event_id: o.eventId || undefined,
        event_source_url: o.sourceUrl || undefined,
        action_source: o.actionSource || 'website',
        user_data: {
            em: hashed(o.email),
            ph: hashedPhone(o.phone),
            fn: hashed(name[0]),
            ln: name.length > 1 ? hashed(name.slice(1).join(' ')) : undefined,
            country: hashed(o.country === 'US' ? 'us' : 'il'),
            client_ip_address: o.ip || undefined,
            client_user_agent: o.userAgent || undefined,
            fbp: o.fbp || undefined,
            fbc: o.fbc || undefined,
        },
        custom_data: {
            currency: o.currency || 'ILS',
            value: Number(o.value || COURSE_PRICE),
            content_name: COURSE_NAME,
            content_ids: [COURSE_ID],
            content_type: 'product',
        },
    };
    if (o.orderId) event.custom_data.order_id = o.orderId;

    const payload = { data: [event] };
    if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

    const r = await fetch(META_API + META_PIXEL_ID + '/events?access_token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await r.text();
    console.log('meta capi', event.event_name, event.event_id, r.status, text.slice(0, 200));
    return { ok: r.ok, status: r.status };
}

/* ── מזהה הרכישה ──
   חייב לצאת זהה בדפדפן ובשרת, אחרת מטא סופרת שתי רכישות על מכירה אחת.
   Grow לא מעביר את מספר העסקה לכתובת ההפניה, ולכן הוא לא יכול לשמש כאן.
   במקומו נגזר המזהה מהמייל ומהתאריך: שני הצדדים מכירים את שניהם, בלי
   לתאם ובלי להיות תלויים בכך שה-Webhook בכלל יגיע.

   FNV-1a. לא הצפנה, רק פונקציה קצרה שאפשר לממש זהה בשני הצדדים, ושלא
   מכניסה כתובת מייל למזהה שנשלח למטא. */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
}

function purchaseEventId(email, when) {
    const d = when ? new Date(when) : new Date();
    const day = d.toISOString().slice(0, 10).replace(/-/g, '');
    return 'pur_' + fnv1a(String(email || '').trim().toLowerCase()) + '_' + day;
}

module.exports = {
    readBody, sendToMake, sendToMeta, clientIp, purchaseEventId,
    COURSE_NAME, COURSE_ID, COURSE_PRICE,
};
