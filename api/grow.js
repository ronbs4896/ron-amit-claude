/* ═════════ Grow: Webhook של תשלום ═════════
   Grow קורא לכתובת הזאת אחרי כל עסקה, בלי קשר לאמצעי התשלום — אשראי, ביט,
   Apple Pay, Google Pay, PayBox או העברה בנקאית. זה הופך את השרת למקור
   האמת היחיד לרכישות: גם מי שסגר את הדפדפן לפני שחזר לדף התודה, גם מי
   ששילם ממכשיר אחר, וגם מי שחוסם את הפיקסל — כולם נספרים.

   מה קורה כאן:
     1. אימות שהקריאה באמת מ-Grow ולא ממישהו שניחש את הכתובת
     2. Purchase למטא דרך Conversions API, עם event_id שנגזר ממספר העסקה
     3. הרוכש עובר ברב מסר מרשימת ה-hotlist לרשימת הרוכשים

   משתני סביבה (Vercel ← Settings ← Environment Variables):
     GROW_URL_TOKEN     מחרוזת אקראית שאנחנו ממציאים. מוסיפים אותה לכתובת
                        ה-Webhook שמגדירים אצל Grow: /api/grow?t=<הערך>
     GROW_WEBHOOK_KEY   ה-webhookKey ש-Grow שולח בגוף הקריאה, אם הוגדר אצלם
     GROW_LEARN=1       זמני. מדפיס ללוג את כל שמות השדות שהגיעו, כדי
                        לנעול אותם אחרי העסקה האמיתית הראשונה.

   חובה להגדיר לפחות אחד מהשניים הראשונים. בלעדיהם הכתובת פתוחה לכל אחד,
   ומי שימצא אותה יוכל להזריק רכישות מזויפות לפיקסל ולרשימת הדיוור. */

const crypto = require('crypto');
const { readBody, sendToMake, sendToMeta, COURSE_PRICE } = require('./_shared.js');

/* שמות השדות של Grow. מקבלים גם וריאציות, כי חלק מהמסכים שולחים
   ‎snake_case‎ וחלק ‎camelCase‎. */
function pick(b, ...names) {
    for (const n of names) {
        if (b[n] !== undefined && b[n] !== null && String(b[n]).trim() !== '') return String(b[n]).trim();
    }
    return '';
}

/* Grow מסמן עסקה שנפרעה ב-statusCode=2 ("שולם"). כל סטטוס אחר, וכל
   זיכוי, לא אמור להיספר כרכישה. */
function isPaid(b) {
    const status = pick(b, 'statusCode', 'status_code', 'status');
    if (status) return status === '2' || status === 'שולם';
    /* אין שדה סטטוס: נסמוך על סכום חיובי, ונרשום ללוג כדי לחדד אחר כך */
    return Number(pick(b, 'paymentSum', 'sum', 'amount') || 0) > 0;
}

function isRefund(b) {
    const t = pick(b, 'transactionType', 'transaction_type') + ' ' + pick(b, 'paymentType', 'type');
    return /refund|credit|זיכוי|ביטול/i.test(t);
}

/* השוואה בזמן קבוע, שלא ידלוף מידע דרך הבדלי זמן */
function sameSecret(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isSelftest(req) {
    if (req.query && req.query.selftest === '1') return true;
    return /[?&]selftest=1(&|$)/.test(req.url || '');
}

function urlToken(req) {
    if (req.query && req.query.t) return String(req.query.t);
    const m = /[?&]t=([^&]+)/.exec(req.url || '');
    return m ? decodeURIComponent(m[1]) : '';
}

/* מה הגיע, בלי לחשוף פרטים אישיים בלוג */
function shape(b) {
    const out = {};
    for (const k of Object.keys(b)) {
        const v = String(b[k] === null ? '' : b[k]);
        out[k] = /mail|phone|name|card|token|key/i.test(k) ? '<' + v.length + ' תווים>' : v.slice(0, 60);
    }
    return out;
}

module.exports = async (req, res) => {
    const expectedUrl = process.env.GROW_URL_TOKEN;
    const expectedKey = process.env.GROW_WEBHOOK_KEY;

    if (req.method === 'GET') {
        /* ‎?selftest=1‎ מאמת שהטוקן שבכתובת זהה לזה שב-Vercel, ומדווח מה
           מוגדר. מחזיר קיים או לא קיים בלבד, אף פעם לא ערכים.
           ‎&simulate=1‎ שולח Purchase לדוגמה למטא, ורק כשהוגדר
           META_TEST_EVENT_CODE, כלומר האירוע נוחת ב-Test Events ולא
           בנתונים האמיתיים. הוא לא נוגע ברב מסר. */
        /* configured אומר לדף התודה מי הבעלים של אירוע הרכישה. הוא לא חושף
           שום סוד, רק אם ה-Webhook מוגדר בכלל. */
        if (!isSelftest(req)) {
            return res.status(200).json({ ok: true, endpoint: 'grow webhook', configured: !!expectedUrl });
        }
        if (!expectedUrl || !sameSecret(urlToken(req), expectedUrl)) {
            return res.status(401).json({ ok: false, error: 'הטוקן שבכתובת לא תואם ל-GROW_URL_TOKEN שב-Vercel' });
        }
        const report = {
            ok: true,
            url_token: true,
            webhook_key_set: !!expectedKey,
            meta_capi_token_set: !!process.env.META_CAPI_TOKEN,
            meta_test_event_code_set: !!process.env.META_TEST_EVENT_CODE,
            learn_mode: process.env.GROW_LEARN === '1',
        };
        if (/[?&]simulate=1(&|$)/.test(req.url || '')) {
            if (!process.env.META_TEST_EVENT_CODE) {
                report.simulate = 'דלוג: בלי META_TEST_EVENT_CODE האירוע היה נכנס לנתונים האמיתיים';
            } else {
                const r = await sendToMeta({
                    eventName: 'Purchase', eventId: 'grow_selftest_' + Date.now(),
                    sourceUrl: 'https://ron-amit-claude.vercel.app/thanks',
                    name: 'בדיקה בדיקה', email: 'selftest@example.com', phone: '0500000000',
                    value: COURSE_PRICE, currency: 'ILS',
                });
                report.simulate = r;
            }
        }
        return res.status(200).json(report);
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

    const b = readBody(req);

    /* ── 1. אימות ── */
    if (!expectedUrl && !expectedKey) {
        console.log('grow: refusing, neither GROW_URL_TOKEN nor GROW_WEBHOOK_KEY is set');
        return res.status(401).json({ ok: false, error: 'webhook not configured' });
    }
    if (expectedUrl && !sameSecret(urlToken(req), expectedUrl)) {
        console.log('grow: bad url token');
        return res.status(401).json({ ok: false });
    }
    if (expectedKey && !sameSecret(pick(b, 'webhookKey', 'webhook_key'), expectedKey)) {
        console.log('grow: bad webhookKey');
        return res.status(401).json({ ok: false });
    }

    if (process.env.GROW_LEARN === '1') console.log('grow payload:', JSON.stringify(shape(b)));

    /* ── 2. האם זו בכלל רכישה ── */
    const code = pick(b, 'transactionCode', 'transaction_code', 'transactionId', 'asmachta');
    if (isRefund(b) || !isPaid(b)) {
        console.log('grow: ignored', code, pick(b, 'statusCode', 'status') || '-', pick(b, 'transactionType') || '-');
        return res.status(200).json({ ok: true, ignored: true });
    }

    const email = pick(b, 'payerEmail', 'payer_email', 'email').toLowerCase();
    const phone = pick(b, 'payerPhone', 'payer_phone', 'phone');
    const name = pick(b, 'fullName', 'full_name', 'payerName', 'name');
    const value = Number(pick(b, 'paymentSum', 'sum', 'amount') || COURSE_PRICE);

    if (!email && !phone) {
        console.log('grow: no contact details on', code);
        return res.status(200).json({ ok: true, ignored: 'no contact' });
    }

    /* אותו מזהה שדף התודה משתמש בו, כדי שמטא תמזג ולא תספור פעמיים */
    const eventId = code ? 'grow_' + code : 'grow_' + crypto.createHash('sha1')
        .update(email + '|' + value).digest('hex').slice(0, 16);

    /* אם נעביר את fbp/fbc בשדות המותאמים של דף התשלום, הם יחזרו לכאן
       וישפרו את ההתאמה. עד אז מטא מתאימה לפי המייל והטלפון המוצפנים. */
    const fbp = pick(b, 'fbp', 'cField1', 'custom1');
    const fbc = pick(b, 'fbc', 'cField2', 'custom2');
    /* cField3 נשלח מדף המכירה כמחרוזת אחת מופרדת בקו אנכי, באותו סדר */
    const utm = pick(b, 'cField3', 'custom3').split('|');
    const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
    const attribution = {};
    UTM_KEYS.forEach((k, i) => { if (utm[i]) attribution[k] = utm[i]; });

    let metaOk = false, ravOk = false;

    /* ── 3. מטא ──
       בלי ip ובלי user agent: אלה של השרת של Grow, ושליחתם הייתה מזהה את
       כל הרוכשים כאותו אדם. */
    try {
        const r = await sendToMeta({
            eventName: 'Purchase', eventId: eventId, orderId: code || undefined,
            sourceUrl: 'https://ron-amit-claude.vercel.app/thanks',
            name: name, email: email, phone: phone, value: value, currency: 'ILS',
            fbp: fbp, fbc: fbc,
        });
        metaOk = !!(r && (r.ok || r.skipped));
    } catch (e) { console.log('grow → meta error:', e.message); }

    /* ── 4. רב מסר, דרך אותו תרחיש Make שכבר עובד ── */
    try {
        ravOk = await sendToMake(Object.assign({
            stage: 'purchase', name: name, phone: phone, email: email,
            value: value, currency: 'ILS',
            ts: new Date().toISOString(),
            source: 'grow-webhook',
            transaction: code, asmachta: pick(b, 'asmachta'),
        }, attribution));
    } catch (e) { console.log('grow → make error:', e.message); }

    console.log('grow purchase', code, 'meta:', metaOk, 'rav:', ravOk);
    /* 500 רק כשגם המסירה לרב מסר נכשלה, כדי ש-Grow ינסה שוב */
    return res.status(ravOk ? 200 : 500).json({ ok: ravOk, meta: metaOk, event_id: eventId });
};
